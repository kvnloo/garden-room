"""Synthetic CPU-only shell checks. No private photos, generation, or ML imports."""
import importlib.util
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('depth_shell', ROOT/'tools/real_depth_shell.py')
shell = importlib.util.module_from_spec(spec)
if (ROOT/'tools/real_depth_shell.py').exists():
    spec.loader.exec_module(shell)


def camera(width=80, height=60):
    return {'fov': 62, 'aspect': width/height,
            'matrixWorld': np.eye(4).flatten(order='F').tolist()}


def xyz(points):
    return np.column_stack([points[k] for k in ('x', 'y', 'z')])


class ShellTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(hasattr(shell, 'build_points'), 'deterministic depth shell is missing')

    def test_exact_pixel_center_reprojection_and_unsupported_pixels(self):
        h, w = 60, 80
        depth = np.full((h, w), 3., dtype='<f4')
        depth[:2] = 0
        rgb = np.full((h, w, 3), [213, 71, 29], dtype='uint8')
        pixels = np.flatnonzero(depth.ravel() > .05)
        cam = camera(w, h)
        cam['aspect'] += .004  # The exact recorded aspect, not width/height.
        p = shell.build_points(rgb, depth, cam, pixels, (1, 1))
        world = xyz(p)
        f = 1/math.tan(math.radians(31))
        u = (world[:, 0]/-world[:, 2]*f/cam['aspect']+1)*w/2
        v = (1-world[:, 1]/-world[:, 2]*f)*h/2
        np.testing.assert_allclose(u, pixels % w+.5, atol=1e-5)
        np.testing.assert_allclose(v, pixels // w+.5, atol=1e-5)
        np.testing.assert_allclose(-world[:, 2], 3, atol=1e-6)
        colors = .5+.28209479177387814*np.column_stack([p[f'f_dc_{i}'] for i in range(3)])
        np.testing.assert_allclose(colors, np.broadcast_to(rgb[2, 0]/255, colors.shape), atol=1e-6)

    def test_known_camera_translation_and_rotation(self):
        depth = np.full((60, 80), 2.5)
        rgb = np.zeros((60, 80, 3), dtype='uint8')
        cam = camera()
        matrix = np.array([[0., 0., 1., 4.], [0., 1., 0., 1.5], [-1., 0., 0., -2.], [0., 0., 0., 1.]])
        pixels = np.arange(depth.size)
        local = shell.build_points(rgb, depth, cam, pixels, (1, 1))
        cam['matrixWorld'] = matrix.flatten(order='F').tolist()
        world = shell.build_points(rgb, depth, cam, pixels, (1, 1))
        np.testing.assert_allclose(xyz(world), xyz(local)@matrix[:3, :3].T+matrix[:3, 3], atol=5e-7)
        report = shell.projected_depth_diagnostic(world, depth, cam)
        self.assertEqual(report['samples'], depth.size)
        self.assertLess(report['maxM'], 1e-5)
        world['x'] += .1
        self.assertGreater(shell.projected_depth_diagnostic(world, depth, cam)['medianM'], .09)

    def test_surface_tangents_do_not_bridge_silhouettes_and_overlap(self):
        from scipy.spatial.transform import Rotation
        depth = np.full((60, 80), 3.)
        depth[:, 40:] = 10.
        rgb = np.zeros((60, 80, 3), dtype='uint8')
        pixels = np.arange(depth.size)
        p = shell.build_points(rgb, depth, camera(), pixels, (1, 1))
        scales = np.exp(np.column_stack([p[f'scale_{i}'] for i in range(3)]))
        q = np.column_stack([p[f'rot_{i}'] for i in (1, 2, 3, 0)])
        rotation = Rotation.from_quat(q).as_matrix()
        normals = rotation[:, :, 2]
        self.assertTrue((np.abs(normals[:, 2]) > .999).all())
        f = 60/(2*math.tan(math.radians(31)))
        projected = scales[:, :2]*f/depth.ravel()[:, None]
        self.assertGreater(float(projected.min()), .6)
        self.assertLess(float(projected.max()), 2.)
        self.assertLess(float(scales[:, :2].max()), .25)

    def test_slanted_plane_covariance_is_tangent(self):
        from scipy.spatial.transform import Rotation
        yy, xx = np.mgrid[:60, :80]
        ray_x = (2*(xx+.5)/80-1)*math.tan(math.radians(31))*80/60
        depth = 3/(1-.4*ray_x)
        p = shell.build_points(np.zeros((60, 80, 3), dtype='uint8'), depth, camera(), np.arange(4800), (1, 1))
        q = np.column_stack([p[f'rot_{i}'] for i in (1, 2, 3, 0)])
        normal = Rotation.from_quat(q).as_matrix()[:, :, 2]
        expected = np.array([.4, 0, 1])/math.sqrt(1.16)
        self.assertGreater(float(np.abs(normal@expected).min()), .999)

    def test_window_pixels_stay_on_glass_and_no_missing_depth_is_filled(self):
        depth = np.full((60, 80), 3., dtype='<f4')
        depth[20:30, 30:40] = 1.  # Foreground plant over a glass proxy.
        depth[:5, :5] = 0
        rgb = np.full((60, 80, 3), [220, 70, 20], dtype='uint8')
        pixels, _ = shell.stratified_pixels(np.flatnonzero(depth.ravel() > .05), 80, 60, 400000)
        p = shell.build_points(rgb, depth, camera(), pixels, (1, 1))
        self.assertEqual(len(p), 4800-25)
        self.assertEqual(int((p['z'] == -3).sum()), 4800-25-100)
        self.assertEqual(int((p['z'] == -1).sum()), 100)

    def test_caps_determinism_and_nested_sampling(self):
        pixels = np.arange(1280*720)
        fine, _ = shell.stratified_pixels(pixels, 1280, 720, shell.FINE_LIMIT)
        coarse, _ = shell.stratified_pixels(fine, 1280, 720, shell.COARSE_LIMIT)
        self.assertLessEqual(len(fine), 400000)
        self.assertLessEqual(len(coarse), 40000)
        self.assertGreater(len(coarse), 39000)
        self.assertTrue(np.isin(coarse, fine).all())
        self.assertTrue(np.array_equal(coarse, shell.stratified_pixels(fine, 1280, 720, shell.COARSE_LIMIT)[0]))
        for selection in (fine, coarse):
            self.assertLess(int((selection % 1280).min()), 10)
            self.assertGreater(int((selection % 1280).max()), 1270)
            self.assertGreater(int((selection // 1280).max()), 710)

    def test_stratified_shell_covers_source_pixels_at_both_budgets(self):
        from scipy.spatial import cKDTree
        width, height = 1280, 720
        fine, _ = shell.stratified_pixels(np.arange(width*height), width, height, 400000)
        coarse, _ = shell.stratified_pixels(fine, width, height, 40000)
        source = np.column_stack(np.unravel_index(np.arange(width*height), (height, width)))
        for available, budget in ((fine, 40000), (np.arange(width*height), 400000)):
            selected, spacing = shell.stratified_pixels(
                available, width, height, budget)
            centers = np.column_stack((selected//width, selected % width))
            sigma = np.array([spacing[1], spacing[0]])*.8
            distance, _ = cKDTree(centers/sigma).query(source/sigma, workers=1)
            self.assertLess(float(distance.max()), 2.)

    def test_deletion_during_fine_export_cannot_publish(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)/('a'*24)/('b'*24)
            d.mkdir(parents=True)
            np.full((60,80),3.,dtype='<f4').tofile(d/'depth.f32')
            Image.new('RGB',(80,60),(220,70,20)).save(d/'real.png')
            (d/'capture.json').write_text(json.dumps({'camera':camera(),'depth':{'width':80,'height':60}}))
            writer=shell.write_splat
            def delete(path, points):
                if path.name=='fine.splat.tmp':
                    (d/'deleted.json').write_text('{}')
                writer(path,points)
            with patch.object(shell,'write_splat',side_effect=delete):
                self.assertIsNone(shell.run(d))
            self.assertNotIn('fine',json.loads((d/'status.json').read_text())['splat'])
            self.assertFalse((d/'fine.splat').exists())
            self.assertFalse((d.parent/'scene.json').exists())

    def test_progressive_metadata_latency_and_no_ml_imports(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)/('a'*24)/('b'*24)
            d.mkdir(parents=True)
            depth = np.full((60, 80), 3., dtype='<f4')
            depth.tofile(d/'depth.f32')
            Image.new('RGB', (80, 60), (220, 70, 20)).save(d/'real.png')
            (d/'capture.json').write_text(json.dumps({'camera': camera(), 'depth': {'width': 80, 'height': 60}}))
            (d/'status.json').write_text(json.dumps({'hq': True, 'timings': {'hqMs': 123}}))
            original = shell.write_splat
            def watch(path, points):
                if path.name == 'fine.splat.tmp':
                    status = json.loads((d/'status.json').read_text())
                    self.assertIn('coarse', status['splat'])
                    self.assertNotIn('fine', status['splat'])
                return original(path, points)
            with patch.object(shell, 'write_splat', side_effect=watch):
                shell.run(d)
            state = json.loads((d/'status.json').read_text())
            self.assertEqual(state['backend'], 'procedural-depth-shell')
            self.assertEqual(state['geometryPrior'], 'captured procedural')
            self.assertTrue(state['productionSafe'])
            self.assertIn('OpenAI', state['license'])
            self.assertFalse(state['alignment']['independentAccuracy'])
            self.assertEqual(state['alignment']['medianM'], 0)
            self.assertIn('construction', state['alignment']['scope'])
            self.assertEqual(state['walkValidity'], {'angleDeg': 15, 'distanceM': .3})
            self.assertEqual(state['timings']['hqMs'], 123)
            for key in ('shellBuildMs', 'shellCoarseMs', 'shellFineMs', 'shellMs'):
                self.assertGreater(state['timings'][key], 0)
            self.assertGreater(state['alignment']['projectedDepthDiagnostic']['samples'], 0)
            for stage in ('coarse', 'fine'):
                record = state['splat'][stage]
                self.assertEqual((d/Path(record['url']).name).stat().st_size, 32*record['count'])
            self.assertFalse((d.parent/'scene.json').exists())
            # Run the actual CLI in a clean interpreter, observing loaded modules.
            script = "import runpy,sys; path=sys.argv.pop(1); runpy.run_path(path,run_name='__main__'); assert not any(k.split('.')[0] in ('torch','sharp','real_sharp') for k in sys.modules)"
            result = subprocess.run([sys.executable, '-c', script, str(ROOT/'tools/real_depth_shell.py'), str(d)], capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            # Exercise the default render entry point with a durable synthetic HQ.
            (d/'layout.json').write_text(json.dumps({'room':{'poly':[[0,0],[3,0],[3,3]]},'items':[]}))
            Image.new('RGB',(80,60)).save(d/'ids.png')
            env = dict(os.environ, GARDEN_REAL_BACKEND='shell', REAL_RESEARCH_PREVIEW='0')
            result = subprocess.run([sys.executable, '-c', script, str(ROOT/'tools/render_real.py'), str(d), '--camera'], env=env, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads((d/'status.json').read_text())['state'], 'ready')
            (d/'deleted.json').write_text('{}')
            before = (d/'status.json').read_bytes()
            self.assertIsNone(shell.run(d))
            self.assertEqual(before, (d/'status.json').read_bytes())


if __name__ == '__main__':
    unittest.main()
