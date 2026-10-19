#!/usr/bin/env python3
"""Deterministic same-view Gaussian shell from HQ RGB and captured camera-Z depth.

CPU only. Geometry is a procedural prior, not recovered photographic accuracy.
Only supported source pixels are represented; glass keeps its captured proxy depth.
"""
import fcntl
import json
import math
from pathlib import Path
import sys
import time

import numpy as np
from PIL import Image
from scipy.spatial.transform import Rotation

BACKEND = 'procedural-depth-shell'
COARSE_LIMIT = 40_000
FINE_LIMIT = 400_000
WALK_VALIDITY = {'angleDeg': 15, 'distanceM': .3}
LICENSE = 'No ML lift weights; generated RGB remains subject to applicable OpenAI output terms'
DTYPE = np.dtype([(name, '<f4') for name in (
    'x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity',
    'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3')])


def intrinsics(camera, width, height):
    tangent = math.tan(math.radians(camera['fov'])/2)
    return width/(2*tangent*camera['aspect']), height/(2*tangent)


def stratified_pixels(pixels, width, height, limit):
    """One supported pixel nearest each image stratum's center, in stable order."""
    if len(pixels) <= limit:
        return pixels.copy(), (1., 1.)
    columns = min(width, max(1, int(math.sqrt(limit*width/height))))
    rows = min(height, max(1, limit//columns))
    x, y = pixels % width, pixels//width
    cx = np.minimum(x*columns//width, columns-1)
    cy = np.minimum(y*rows//height, rows-1)
    cell = cy*columns+cx
    distance = ((x+.5)-(cx+.5)*width/columns)**2+((y+.5)-(cy+.5)*height/rows)**2
    order = np.lexsort((pixels, distance, cell))
    keys = cell[order]
    chosen = order[np.r_[True, keys[1:] != keys[:-1]]]
    return pixels[chosen], (width/columns, height/rows)


def build_points(rgb, depth, camera, pixels, spacing):
    """Place centers exactly; estimate tangents only within continuous depth."""
    height, width = depth.shape
    fx, fy = intrinsics(camera, width, height)
    y, x = pixels//width, pixels % width
    z = depth[y, x].astype('float64')

    def local(px, py, pz):
        return np.column_stack(((px+.5-width/2)*pz/fx, -(py+.5-height/2)*pz/fy, -pz))

    centers = local(x, y, z)
    derivatives = []
    for axis in (0, 1):
        before_x, after_x = np.maximum(x-1, 0), np.minimum(x+1, width-1)
        before_y, after_y = np.maximum(y-1, 0), np.minimum(y+1, height-1)
        bx, by = (before_x, y) if axis == 0 else (x, before_y)
        ax, ay = (after_x, y) if axis == 0 else (x, after_y)
        bz, az = depth[by, bx], depth[ay, ax]
        threshold = np.maximum(.02, z*.02)
        good_before = (bz > .05) & (np.abs(bz-z) < threshold) & ((bx != x) | (by != y))
        good_after = (az > .05) & (np.abs(az-z) < threshold) & ((ax != x) | (ay != y))
        backward = centers-local(bx, by, bz)
        forward = local(ax, ay, az)-centers
        fallback = np.zeros_like(centers)
        fallback[:, axis] = z/(fx if axis == 0 else -fy)
        derivative = np.where(good_after[:, None], forward,
                              np.where(good_before[:, None], backward, fallback))
        derivatives.append(derivative)
    dx, dy = derivatives
    normal = np.cross(dx, dy)
    normal /= np.linalg.norm(normal, axis=1)[:, None]
    sx, sy = spacing
    # A depth jump never contributes a tangent. Bound grazing footprints as well.
    tangent_x, tangent_y = dx*(.8*sx), dy*(.8*sy)
    ceiling = 4*z/ min(fx, fy)*max(sx, sy)
    for tangent in (tangent_x, tangent_y):
        tangent *= np.minimum(1., ceiling/np.linalg.norm(tangent, axis=1))[:, None]
    thickness = np.minimum(np.linalg.norm(tangent_x, axis=1), np.linalg.norm(tangent_y, axis=1))/15
    covariance = (tangent_x[:, :, None]*tangent_x[:, None, :]
                  + tangent_y[:, :, None]*tangent_y[:, None, :]
                  + normal[:, :, None]*normal[:, None, :]*thickness[:, None, None]**2)
    eigenvalues, basis = np.linalg.eigh(covariance)
    eigenvalues, basis = eigenvalues[:, ::-1], basis[:, :, ::-1].copy()
    basis[:, :, 2] *= np.linalg.det(basis)[:, None]
    matrix = np.asarray(camera['matrixWorld'], dtype='float64').reshape(4, 4, order='F')
    world = centers@matrix[:3, :3].T+matrix[:3, 3]
    basis = matrix[:3, :3]@basis
    quaternions = Rotation.from_matrix(basis).as_quat()[:, [3, 0, 1, 2]]
    quaternions *= np.where(quaternions[:, :1] < 0, -1., 1.)
    points = np.zeros(len(pixels), dtype=DTYPE)
    for i, name in enumerate(('x', 'y', 'z')):
        points[name] = world[:, i]
    for i in range(3):
        points[f'f_dc_{i}'] = (rgb[y, x, i]/255.-.5)/.28209479177387814
        points[f'scale_{i}'] = .5*np.log(np.maximum(eigenvalues[:, i], 1e-14))
    for i in range(4):
        points[f'rot_{i}'] = quaternions[:, i]
    points['opacity'] = 4.6
    return points


def projected_depth_diagnostic(points, depth, camera):
    """Independent inverse-camera projection of the serialized float32 centers.

    This checks implementation consistency against the procedural input only.
    It does not measure geometry accuracy of the generated photograph.
    """
    height, width = depth.shape
    fx, fy = intrinsics(camera, width, height)
    world = np.column_stack([points[k] for k in ('x', 'y', 'z')]).astype('float64')
    inverse = np.linalg.inv(np.asarray(camera['matrixWorld']).reshape(4, 4, order='F'))
    local = world@inverse[:3, :3].T+inverse[:3, 3]
    z = -local[:, 2]
    u = local[:, 0]/z*fx+width/2
    v = -local[:, 1]/z*fy+height/2
    inside = (z > .05) & (u >= 0) & (u < width) & (v >= 0) & (v < height)
    target = np.zeros(len(points))
    target[inside] = depth[np.floor(v[inside]).astype(int), np.floor(u[inside]).astype(int)]
    valid = inside & (target > .05)
    error = np.abs(z[valid]-target[valid])
    pixel_error = np.hypot(u[valid]-(np.floor(u[valid])+.5), v[valid]-(np.floor(v[valid])+.5))
    return {'method': 'inverse-camera projection of exported centers against captured camera-Z depth',
            'samples': int(valid.sum()), 'unsupported': int((~valid).sum()),
            'medianM': float(np.median(error)) if len(error) else None,
            'p90M': float(np.percentile(error, 90)) if len(error) else None,
            'maxM': float(error.max()) if len(error) else None,
            'maxPixelCenterErrorPx': float(pixel_error.max()) if len(error) else None,
            'independentAccuracy': False,
            'scope': 'independent implementation check; procedural prior consistency, not recovered accuracy'}


def write_splat(path, points):
    """Standard 32-byte .splat records, SH degree zero, w/x/y/z quaternions."""
    packed = np.empty(len(points), dtype=[('pos', '<f4', (3,)), ('scale', '<f4', (3,)),
                                         ('color', 'u1', (4,)), ('quat', 'u1', (4,))])
    packed['pos'] = np.column_stack([points[k] for k in ('x', 'y', 'z')])
    packed['scale'] = np.exp(np.column_stack([points[f'scale_{i}'] for i in range(3)]))
    packed['color'][:, :3] = np.rint(np.clip((.5+.28209479177387814*np.column_stack(
        [points[f'f_dc_{i}'] for i in range(3)]))*255, 0, 255)).astype('u1')
    packed['color'][:, 3] = (255/(1+np.exp(-points['opacity']))).astype('u1')
    packed['quat'] = np.clip(128+128*np.column_stack([points[f'rot_{i}'] for i in range(4)]), 0, 255).astype('u1')
    packed.tofile(path)


def update_status(directory, **fields):
    path = directory/'status.json'
    state = json.loads(path.read_text()) if path.exists() else {}
    state.update(fields)
    tmp = directory/'status.shell.tmp'
    tmp.write_text(json.dumps(state, allow_nan=False))
    tmp.replace(path)


def run(directory):
    directory = Path(directory)
    if (directory/'deleted.json').exists():
        return None
    started = time.perf_counter()
    capture = json.loads((directory/'capture.json').read_text())
    width, height = capture['depth']['width'], capture['depth']['height']
    depth = np.fromfile(directory/'depth.f32', dtype='<f4').reshape(height, width)
    camera = capture['camera']
    matrix = np.asarray(camera['matrixWorld']).reshape(4, 4, order='F')
    if (not np.isfinite(matrix).all() or not np.allclose(matrix[3], [0, 0, 0, 1])
            or not np.allclose(matrix[:3, :3].T@matrix[:3, :3], np.eye(3), atol=1e-5)
            or not np.isclose(np.linalg.det(matrix[:3, :3]), 1, atol=1e-5)):
        raise ValueError('Expected a finite rigid camera matrixWorld')
    if not (10 <= camera['fov'] <= 130 and .2 <= camera['aspect'] <= 5):
        raise ValueError('Invalid captured camera intrinsics')
    if not np.isfinite(depth).all() or (depth < 0).any() or (depth > 100).any():
        raise ValueError('Expected finite captured metric depth in [0,100]')
    with Image.open(directory/'real.png') as image:
        if image.size != (width, height):
            raise ValueError('HQ RGB and captured depth dimensions differ')
        rgb = np.asarray(image.convert('RGB'))
    supported = np.flatnonzero(depth.ravel() > .05)
    if not len(supported):
        raise ValueError('No supported captured depth surfaces')
    fine, fine_spacing = stratified_pixels(supported, width, height, FINE_LIMIT)
    coarse, coarse_spacing = stratified_pixels(fine, width, height, COARSE_LIMIT)
    metadata = {'backend': BACKEND, 'geometryPrior': 'captured procedural',
                'mode': 'single-view', 'source': directory.name, 'sources': [directory.name],
                'productionSafe': True, 'license': LICENSE, 'walkValidity': WALK_VALIDITY.copy(),
                'limitation': 'Production-safe lift only; RGB subject to OpenAI output terms. No claim of model semantic accuracy, photographic depth recovery, or unseen surfaces.',
                'windowUsesGlassProxy': True}
    timings = json.loads((directory/'status.json').read_text()).get('timings', {}) if (directory/'status.json').exists() else {}
    build_ms = 0.
    for stage, pixels, spacing in (('coarse', coarse, coarse_spacing), ('fine', fine, fine_spacing)):
        if (directory/'deleted.json').exists():
            return None
        stage_started = time.perf_counter()
        points = build_points(rgb, depth, camera, pixels, spacing)
        build_ms += (time.perf_counter()-stage_started)*1000
        tmp = directory/(stage+'.splat.tmp')
        write_splat(tmp, points)
        # Use the route's existing publication lock so deletion wins every race.
        with open(directory.parent/'publication.lock', 'a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            if (directory/'deleted.json').exists():
                tmp.unlink(missing_ok=True)
                return None
            path = directory/(stage+'.splat')
            tmp.replace(path)
            metadata[stage] = {'url': f'/renders/real/{directory.parent.name}/{directory.name}/{path.name}',
                               'count': len(points), 'bytes': path.stat().st_size}
            timings['shell'+stage.capitalize()+'Ms'] = (time.perf_counter()-stage_started)*1000
            timings['shell'+stage.capitalize()+'ElapsedMs'] = (time.perf_counter()-started)*1000
            update_status(directory, **{k: v for k, v in metadata.items() if k not in ('coarse', 'fine')},
                          splat=metadata.copy(), timings=timings.copy())
    diagnostic = projected_depth_diagnostic(points, depth, camera)
    accepted = (diagnostic['samples'] == len(points) and diagnostic['maxM'] < 1e-4
                and diagnostic['maxPixelCenterErrorPx'] < 1e-3)
    timings.update(shellBuildMs=build_ms, shellMs=(time.perf_counter()-started)*1000)
    report = {'accepted': accepted, 'backend': BACKEND, 'geometryPrior': 'captured procedural',
              'medianM': 0., 'p90M': 0., 'rmseM': 0., 'samples': len(points),
              'scope': 'zero metric residual by construction against captured procedural depth; not recovered accuracy',
              'independentAccuracy': False, 'projectedDepthDiagnostic': diagnostic,
              'supportedPixels': len(supported), 'splat': metadata, 'timings': timings,
              'productionSafe': True, 'license': LICENSE, 'walkValidity': WALK_VALIDITY.copy()}
    with open(directory.parent/'publication.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if (directory/'deleted.json').exists():
            return None
        tmp = directory/'alignment.shell.tmp'
        tmp.write_text(json.dumps(report, allow_nan=False))
        tmp.replace(directory/'alignment.json')
        update_status(directory, state='ready' if accepted else 'alignment-rejected',
                      alignment=report, timings=timings)
    return report


if __name__ == '__main__':
    print(json.dumps(run(Path(sys.argv[1]).resolve()), allow_nan=False))
