"""Disposable, CPU-only camera pipeline regressions. Never calls image generation."""
import base64
import copy
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import subprocess
import struct
import tempfile
import unittest
import zlib
from unittest.mock import patch

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


route = load('camera_route', ROOT/'routes/real.py')
render = load('camera_render', ROOT/'tools/render_real.py')
lift = load('camera_lift', ROOT/'tools/real_sharp.py')


def fixture(d):
    w = h = 64
    camera = {'matrixWorld': np.eye(4).flatten(order='F').tolist(),
              'position': [0, 0, 0], 'quaternion': [0, 0, 0, 1],
              'fov': 62, 'aspect': 1, 'near': .01, 'far': 50}
    layout = {'room': {'poly': [[0, 0], [3, 0], [3, 3], [0, 3]]}, 'items': [
        {'id': 'p01', 'kind': 'plant', 'name': 'Trailing plant', 'src': 'plants/p01.webp', 'x': 1},
        {'id': 'p02-copy', 'kind': 'plant', 'name': 'Eggplant copy', 'src': 'plants/p02.webp', 'x': 2},
        {'id': 'p03', 'kind': 'plant', 'name': 'Hidden plant', 'src': 'plants/p03.webp'},
        {'id': 'table', 'kind': 'table', 'name': 'Table'}]}
    labels = np.zeros((h, w, 3), dtype='uint8')
    labels[8:16, 16:24, 0] = 1
    labels[32:40, 40:48, 0] = 2
    labels[0:4, 0:5, 0] = 3  # exactly 20 pixels must be excluded
    labels[50:60, 0:20, 0] = 4
    Image.fromarray(labels).save(d/'ids.png')
    Image.new('RGB', (w, h), (80, 130, 70)).save(d/'view.jpg')
    yy, xx = np.mgrid[:h, :w]
    depth = (1.4*(.8+yy/h+.15*xx/w)+.3).astype('<f4')
    depth.tofile(d/'depth.f32')
    capture = {'camera': camera, 'depth': {'width': w, 'height': h, 'encoding': 'float32-le-meters-camera-z'},
               'objects': [{'id': item['id'], 'kind': item['kind'], 'label': i+1}
                           for i, item in enumerate(layout['items'])], 'revision': d.parent.name}
    (d/'capture.json').write_text(json.dumps(capture))
    (d/'layout.json').write_text(json.dumps(layout))
    (d/'status.json').write_text(json.dumps({'state': 'queued', 'created': 12, 'timings': {}}))
    return capture, layout


def points_grid():
    dtype = [(k, 'f4') for k in ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity',
                                  'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3']]
    yy, xx = np.mgrid[:64, :64]
    z = .8+yy/64+.15*xx/64
    f = 64/(2*math.tan(math.radians(31)))
    p = np.zeros(4096, dtype=dtype)
    p['x'] = ((xx-32)/f*z).ravel(); p['y'] = ((yy-32)/f*z).ravel(); p['z'] = z.ravel()
    p['opacity'] = 3; p['rot_0'] = 1
    for k in range(3): p[f'scale_{k}'] = math.log(.01)
    return p


def request_payload(d):
    capture=json.loads((d/'capture.json').read_text())
    return capture | {'layout':json.loads((d/'layout.json').read_text()),'explicit':True,
                      'depth':capture['depth'] | {'data':base64.b64encode((d/'depth.f32').read_bytes()).decode()},
                      'view':'data:image/jpeg;base64,'+base64.b64encode((d/'view.jpg').read_bytes()).decode(),
                      'ids':'data:image/png;base64,'+base64.b64encode((d/'ids.png').read_bytes()).decode()}


class HTTP:
    def __init__(self, payload=None): self.payload = payload; self.responses = []
    def body(self): return copy.deepcopy(self.payload)
    def send_json(self, code, data): self.responses.append((code, data))


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = Path(self.tmp.name)/'real'
        self.d = self.store/('a'*24)/('b'*24)
        self.d.mkdir(parents=True)
        self.capture, self.layout = fixture(self.d)

    def test_visible_id_masks_exclude_hidden_and_tiny_plants(self):
        visible = route.visible_plants(self.d)
        self.assertEqual([v['id'] for v in visible], ['p01', 'p02-copy'])
        self.assertEqual(visible[0]['pixels'], 64)
        self.assertEqual(visible[0]['bbox'], [.25, .125, .375, .25])
        self.assertEqual(visible[0]['centroid'], [.3125, .1875])
        self.assertEqual(visible[1]['name'], 'Eggplant copy')

    def test_legacy_gallery_inventory_is_cached_and_invalidates_with_inputs(self):
        first = route.job_record(self.d)['plants']
        self.assertEqual([p['id'] for p in first], ['p01', 'p02-copy'])
        with patch.object(route, 'id_pixels', side_effect=AssertionError('old PNG decoded on gallery poll')):
            self.assertEqual(route.job_record(self.d)['plants'], first)
        layout = json.loads((self.d/'layout.json').read_text())
        layout['items'][0]['name'] = 'Updated synthetic plant name'
        (self.d/'layout.json').write_text(json.dumps(layout))
        changed = route.job_record(self.d)['plants']
        self.assertEqual(changed[0]['name'], 'Updated synthetic plant name')
        self.assertNotEqual(changed, first)

    def test_id_png_filters_rgba_and_large_integer_labels(self):
        # Encode each PNG filter independently, including alpha and labels >255.
        rgb=np.zeros((5,64,4),dtype='uint8');rgb[:,:,3]=255
        rgb[:,10:20,:3]=[1,2,3]
        rgb[0,10:20,3]=0
        encoded=bytearray()
        previous=np.zeros(64*4,dtype='int64')
        for mode,row in enumerate(rgb.reshape(5,-1).astype('int64')):
            encoded.append(mode)
            for i,value in enumerate(row):
                left=int(row[i-4]) if i>=4 else 0;up=int(previous[i]);corner=int(previous[i-4]) if i>=4 else 0
                p=left+up-corner
                distance=[abs(p-left),abs(p-up),abs(p-corner)]
                predictor=[0,left,up,(left+up)//2,[left,up,corner][distance.index(min(distance))]][mode]
                encoded.append((int(value)-predictor)&255)
            previous=row
        def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data))
        png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',64,5,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(encoded))+chunk(b'IEND',b'')
        path=self.d/'filters.png';path.write_bytes(png)
        pixels=list(route.id_pixels(path))
        self.assertEqual(sum(pixel[4]==197121 for pixel in pixels),40)
        self.assertEqual(sum(pixel[4]==0 for pixel in pixels),280)

    def test_explicit_shots_only_and_revision_three_cache_identity(self):
        payload=request_payload(self.d)
        with patch.object(route,'STORE',self.store),patch.object(route.threading,'Thread'),patch.dict(os.environ,{},clear=True):
            route.ACTIVE.clear()
            try:
                implicit=HTTP(payload | {'explicit':False});route.handle(implicit,'POST','/api/real/view')
                self.assertEqual(implicit.responses[-1][0],400)
                self.assertEqual(route.ACTIVE,{})
                h=HTTP(payload);route.handle(h,'POST','/api/real/view')
                code,shot=h.responses[-1];self.assertEqual(code,202)
                pose={'position':[0,0,0],'quaternion':[0,0,0,1],'fov':62,'aspect':1}
                expected=hashlib.sha256(route.canonical({'revision':shot['revision'],'pose':pose,'pipeline':3,'backend':'procedural-depth-shell'}).encode()).hexdigest()[:24]
                self.assertEqual(shot['id'],expected)
                d=self.store/shot['revision']/shot['id']
                self.assertEqual(len(json.loads((d/'capture.json').read_text())['visiblePlants']),2)
                h=HTTP();route.handle(h,'POST',f'/api/real/photo/{shot["revision"]}/{shot["id"]}/delete')
                h=HTTP(payload);route.handle(h,'POST','/api/real/view')
                self.assertEqual(h.responses[-1][0],410)
            finally:route.ACTIVE.clear()

    def test_prompt_inputs_include_depth_refs_and_each_visible_cutout(self):
        with patch.object(render, 'ROOT', self.synthetic_assets()):
            prompt, images, provenance = render.camera_inputs(self.d, self.capture, self.layout)
        self.assertEqual(len(images), 6)  # beauty, depth, two private room refs, two cutouts
        self.assertEqual([p['id'] for p in provenance['visiblePlants']], ['p01', 'p02-copy'])
        self.assertEqual([p['role'] for p in provenance['inputs']],
                         ['beauty', 'depth-layout', 'room-identity-style', 'room-identity-style', 'plant-cutout', 'plant-cutout'])
        for encoded, record in zip(images, provenance['inputs']):
            self.assertEqual(hashlib.sha256(base64.b64decode(encoded)).hexdigest(), record['sha256'])
        self.assertIn('Eggplant copy', prompt)
        self.assertIn('[0.625, 0.5, 0.75, 0.625]', prompt)
        self.assertIn('62', prompt)
        self.assertIn('depth', prompt.lower())
        self.assertIn('purple', prompt.lower())
        self.assertNotIn('Hidden plant', prompt)
        self.assertTrue((self.d/'depth-guide.png').is_file())

    def test_depth_guide_reserves_black_for_missing_geometry(self):
        depth=np.fromfile(self.d/'depth.f32',dtype='<f4').reshape(64,64)
        depth[0,0]=0;depth.tofile(self.d/'depth.f32')
        with patch.object(render, 'ROOT', self.synthetic_assets()):
            render.camera_inputs(self.d,self.capture,self.layout)
        guide=np.asarray(Image.open(self.d/'depth-guide.png'))
        self.assertTrue((guide[0,0]==0).all())
        self.assertGreater(int(guide[-1,-1,0]),0)

    def test_all_revision_gallery_delete_is_idempotent_and_hides_scene(self):
        Image.new('RGB', (64, 64)).save(self.d/'real.png')
        other = self.store/('c'*24)/('d'*24); other.mkdir(parents=True); fixture(other)
        Image.new('RGB', (64, 64)).save(other/'real.png')
        (other/'status.json').write_text(json.dumps({'state': 'alignment-rejected', 'hq': True, 'created': 15}))
        (self.d.parent/'scene.json').write_text(json.dumps({'views': [self.d.name], 'url': '/stale.splat', 'count': 42}))
        with patch.object(route, 'STORE', self.store):
            h = HTTP(); route.handle(h, 'GET', '/api/real/photos')
            photos = h.responses[-1][1]['photos']
            self.assertEqual([p['revision'] for p in photos], ['c'*24, 'a'*24])
            self.assertEqual(len(photos[1]['plants']), 2)
            route.ACTIVE[self.d.name] = True
            try:
                for _ in range(2):
                    h = HTTP(); route.handle(h, 'POST', f'/api/real/photo/{self.d.parent.name}/{self.d.name}/delete')
                    self.assertEqual(h.responses[-1][0], 200)
                self.assertTrue((self.d/'real.png').exists(), 'active worker input must survive deletion')
                h = HTTP(); route.handle(h, 'GET', '/api/real/photos')
                self.assertEqual(len(h.responses[-1][1]['photos']), 1)
                h = HTTP(); route.handle(h, 'GET', f'/api/real/{self.d.parent.name}/views')
                self.assertEqual(h.responses[-1][1]['views'], [])
                self.assertFalse(h.responses[-1][1]['scene'].get('url'))
            finally: route.ACTIVE.clear()

    def test_delete_rejects_traversal_and_symlink(self):
        outside = Path(self.tmp.name)/'outside'; outside.mkdir()
        link = self.store/('e'*24); link.symlink_to(outside, target_is_directory=True)
        with patch.object(route, 'STORE', self.store):
            for path in ['/api/real/photo/../../delete', f'/api/real/photo/{"e"*24}/{"f"*24}/delete']:
                h = HTTP(); route.handle(h, 'POST', path)
                self.assertIn(h.responses[-1][0], (400, 404))
        self.assertEqual(list(outside.iterdir()), [])

    def test_default_preview_worker_is_never_spawned(self):
        with patch.object(route,'STORE',self.store),patch.dict(os.environ, {}, clear=True), patch.object(route.subprocess, 'Popen') as spawn:
            route.start_preview()
            spawn.assert_not_called()

    def test_preview_worker_requires_opt_in_and_reuses_process(self):
        with (patch.object(route,'STORE',self.store),patch.object(route,'PREVIEW',None),
              patch.dict(os.environ,{'REAL_RESEARCH_PREVIEW':'1'},clear=True),patch.object(route.subprocess,'Popen') as spawn):
            spawn.return_value.poll.return_value=None
            route.start_preview();route.start_preview()
            self.assertEqual(spawn.call_count,1)

    def test_hq_remains_published_when_splat_process_fails(self):
        Image.new('RGB', (64, 64), (30, 180, 30)).save(self.d/'real.png')
        (self.d/'provenance.json').write_text(json.dumps({'real.png': {'seconds': 1, 'sha256': 'cached'}}))
        with patch.dict(os.environ, {'GARDEN_REAL_BACKEND':'sharp-research'}, clear=True), patch.object(render.subprocess, 'run', side_effect=RuntimeError('splat unavailable')):
            render.camera_pipeline(self.d)
        state = json.loads((self.d/'status.json').read_text())
        self.assertTrue(state['hq'])
        self.assertTrue((self.d/'real.png').exists())
        self.assertEqual(state['state'], 'alignment-rejected')

    def test_existing_hq_without_provenance_is_recovered_without_generation(self):
        Image.new('RGB',(64,64),(30,180,30)).save(self.d/'real.png')
        with (patch.dict(os.environ,{'GARDEN_REAL_BACKEND':'sharp-research'},clear=True),patch.object(render,'generate_image',side_effect=AssertionError('must not repurchase')),
              patch.object(render.subprocess,'run',side_effect=RuntimeError('no inference'))):
            render.camera_pipeline(self.d)
        provenance=json.loads((self.d/'provenance.json').read_text())['real.png']
        self.assertTrue(provenance['provenanceGap'])
        self.assertEqual(len(provenance['visiblePlants']),2)

    def test_raw_hq_survives_interrupted_final_resize(self):
        Image.new('RGB',(128,128),(30,180,30)).save(self.d/'real.raw.png')
        with (patch.dict(os.environ,{'GARDEN_REAL_BACKEND':'sharp-research'},clear=True),patch.object(render,'generate_image',side_effect=AssertionError('must not repurchase')),
              patch.object(render.subprocess,'run',side_effect=RuntimeError('no inference'))):
            render.camera_pipeline(self.d)
        with Image.open(self.d/'real.png') as image:
            self.assertEqual(image.size,(64,64))
        self.assertTrue(json.loads((self.d/'status.json').read_text())['hq'])

    def synthetic_assets(self):
        root = Path(self.tmp.name)/'synthetic-assets'
        (root/'refs').mkdir(parents=True, exist_ok=True)
        (root/'public/plants').mkdir(parents=True, exist_ok=True)
        for name in render.ROOM_REFS:
            Image.new('RGB', (64,64), (120,90,70)).save(root/'refs'/name)
        for name in ('p01.webp', 'p02.webp'):
            Image.new('RGB', (64,64), (30,180,30)).save(root/'public/plants'/name)
        return root

    def test_default_backend_uses_no_sharp_subprocess_or_generation(self):
        Image.new('RGB',(64,64),(30,180,30)).save(self.d/'real.png')
        with (patch.dict(os.environ,{},clear=True),
              patch.object(render,'generate_image',side_effect=AssertionError('must not generate')),
              patch.object(render.subprocess,'run',side_effect=AssertionError('must not launch SHARP')) as run):
            render.camera_pipeline(self.d)
        run.assert_not_called()
        state=json.loads((self.d/'status.json').read_text())
        self.assertEqual(state['state'],'ready')
        self.assertEqual(state['backend'],'procedural-depth-shell')
        self.assertTrue(state['productionSafe'])
        self.assertIn('OpenAI',state['license'])
        self.assertIn('fine',state['splat'])

    def test_default_splat_only_cli_uses_captured_depth_without_private_refs(self):
        Image.new('RGB',(64,64),(30,180,30)).save(self.d/'real.png')
        with (patch.dict(os.environ,{},clear=True),
              patch.object(os.sys,'argv',['render_real.py',str(self.d),'--splat-only']),
              patch.object(render,'b64',side_effect=AssertionError('private reference read')),
              patch.object(render,'generate_image',side_effect=AssertionError('image generation')),
              patch.object(render.subprocess,'run',side_effect=AssertionError('SHARP process'))):
            render.main()
        self.assertEqual(json.loads((self.d/'status.json').read_text())['state'],'ready')

    def test_backend_is_frozen_and_part_of_cache_identity(self):
        payload=request_payload(self.d)
        with patch.object(route,'STORE',self.store),patch.object(route.threading,'Thread'),patch.object(route,'start_preview'):
            route.ACTIVE.clear()
            self.addCleanup(route.ACTIVE.clear)
            ids=[]
            for backend in ('shell','sharp-research','shell'):
                with patch.dict(os.environ,{'GARDEN_REAL_BACKEND':backend},clear=True):
                    h=HTTP(payload);route.handle(h,'POST','/api/real/view')
                    shot=h.responses[-1][1]
                    ids.append(shot['id'])
                    d=self.store/shot['revision']/shot['id']
                    stored=json.loads((d/'capture.json').read_text())
                    expected='procedural-depth-shell' if backend=='shell' else backend
                    self.assertEqual(stored['backend'],expected)
                    self.assertEqual(json.loads((d/'status.json').read_text())['productionSafe'],backend=='shell')
            self.assertNotEqual(ids[0],ids[1])
            self.assertEqual(ids[0],ids[2])

    def test_progressive_artifacts_are_nested_stable_single_source(self):
        points = points_grid()
        state = lift.publish_progressive(self.d, points, coarse_limit=128)
        self.assertEqual(state['coarse']['count'], 128)
        self.assertEqual(state['fine']['count'], 4096)
        self.assertEqual(state['source'], self.d.name)
        self.assertFalse(state['productionSafe'])
        self.assertEqual(state['walkValidity'], {'angleDeg': 15, 'distanceM': .3})
        for stage in ['coarse', 'fine']:
            artifact = self.d/Path(state[stage]['url']).name
            self.assertEqual(artifact.stat().st_size, state[stage]['count']*32)
        before = (self.d/'coarse.splat').read_bytes()
        lift.publish_progressive(self.d, points, coarse_limit=128)
        self.assertEqual(before, (self.d/'coarse.splat').read_bytes())
        self.assertEqual(json.loads((self.d/'status.json').read_text())['splat']['fine']['count'], 4096)
        self.assertEqual(json.loads((self.d.parent/'scene.json').read_text())['views'], [self.d.name])
        # Coarse coverage reaches every image quadrant rather than retaining early rows.
        xyz = np.frombuffer(before, dtype=np.dtype([('xyz', '<f4', (3,)), ('rest', 'u1', (20,))]))['xyz']
        self.assertTrue((xyz[:, 0] < 0).any() and (xyz[:, 0] > 0).any())
        self.assertTrue((xyz[:, 1] < 0).any() and (xyz[:, 1] > 0).any())

    def test_coarse_published_before_fine_and_deleted_shot_cannot_publish(self):
        writer=lift.write_splat
        observed=[]
        def watch(path,points):
            if path.name=='fine.splat.tmp':
                state=json.loads((self.d/'status.json').read_text())['splat']
                observed.append(state)
                self.assertTrue((self.d/'coarse.splat').is_file())
                self.assertNotIn('fine',state)
            return writer(path,points)
        with patch.object(lift,'write_splat',side_effect=watch):
            lift.publish_progressive(self.d,points_grid(),coarse_limit=128)
        self.assertEqual(len(observed),1)
        (self.d/'deleted.json').write_text('{}')
        self.assertIsNone(lift.publish_progressive(self.d,points_grid()))

    def test_delete_during_fine_export_cannot_restore_scene_manifest(self):
        writer=lift.write_splat
        def delete_while_exporting(path,points):
            if path.name=='fine.splat.tmp':
                h=HTTP();route.handle(h,'POST',f'/api/real/photo/{self.d.parent.name}/{self.d.name}/delete')
                self.assertEqual(h.responses[-1][0],200)
            return writer(path,points)
        with patch.object(route,'STORE',self.store),patch.object(lift,'write_splat',side_effect=delete_while_exporting):
            self.assertIsNone(lift.publish_progressive(self.d,points_grid(),coarse_limit=128))
        self.assertEqual(json.loads((self.d.parent/'scene.json').read_text())['views'],[])

    def test_compatibility_fusion_excludes_tombstoned_sources(self):
        other=self.d.parent/('c'*24);other.mkdir()
        for d in [self.d,other]:
            lift.ply_write(d/'aligned.ply',points_grid())
            np.save(d/'confidence.npy',np.ones(4096))
            (d/'alignment.json').write_text(json.dumps({'accepted':True}))
        (self.d/'deleted.json').write_text('{}')
        scene=lift.fuse(self.d)
        self.assertEqual(scene['views'],[other.name])

    def test_quality_filters_remove_low_confidence_opacity_stretch_and_size(self):
        p = points_grid()[:6].copy(); confidence = np.ones(6)
        p['opacity'][1] = -8; confidence[2] = .01
        p['scale_0'][3] = math.log(.9)
        for k in range(3): p[f'scale_{k}'][4] = math.log(2)
        p['x'][5] = np.nan
        keep, report = lift.quality_filter(p, confidence, focal=80)
        self.assertEqual(keep.tolist(), [True, False, False, False, False, False])
        self.assertEqual(report['retained'], 1)

    def test_default_coarse_budget_and_fine_mobile_cap(self):
        p=np.tile(points_grid(),123)[:500000]
        state=lift.publish_progressive(self.d,p)
        self.assertEqual(state['coarse']['count'],50000)
        self.assertEqual(state['fine']['count'],450000)

    def test_residual_correction_reports_pre_and_post_independently(self):
        capture = self.capture | {'_directory': str(self.d)}
        p = points_grid()
        # Local smooth mismatch remains within the global fit acceptance gate.
        p['z'] *= 1+.06*np.sin(np.arange(4096)/200)
        result, report = lift.align(p, capture)
        self.assertTrue(report['accepted'])
        self.assertIn('preCorrection', report)
        self.assertIn('postCorrection', report)
        self.assertIn('regions', report['residualCorrection'])
        self.assertFalse(report['postCorrection']['independentAccuracy'])
        self.assertLess(report['postCorrection']['medianM'], report['preCorrection']['medianM'])

    def test_window_proxy_fills_holes_using_hq_pixels_only_on_known_plane(self):
        layout=copy.deepcopy(self.layout)
        layout['room']={'poly':[[-2,-3],[2,-3],[2,1],[-2,1]],
                        'window':{'edge':0,'t0':.5,'t1':3.5,'sill':-.6,'top':.6}}
        (self.d/'layout.json').write_text(json.dumps(layout))
        Image.new('RGB',(64,64),(220,70,20)).save(self.d/'real.png')
        capture=self.capture | {'_directory':str(self.d)}
        proxy=lift.window_proxy(points_grid().dtype,capture,np.full((64,64),3.),np.ones((64,64),dtype=bool),
                                64/(2*math.tan(math.radians(31))))
        self.assertGreater(len(proxy),300)
        self.assertTrue(np.allclose(proxy['z'],-3))
        self.assertTrue((np.abs(proxy['x'])<=1.5).all())
        self.assertTrue((np.abs(proxy['y'])<=.6).all())
        rgb=.5+.28209479177387814*np.column_stack([proxy[f'f_dc_{i}'] for i in range(3)])
        self.assertTrue(np.allclose(rgb,np.array([220,70,20])/255,atol=1e-6))
        # A foreground occluder must not be overwritten by the background proxy.
        for foreground_depth in [1.,2.85,2.9]:
            hidden=lift.window_proxy(points_grid().dtype,capture,np.full((64,64),foreground_depth),np.ones((64,64),dtype=bool),
                                     64/(2*math.tan(math.radians(31))))
            self.assertEqual(len(hidden),0)
        # Even a plant touching the pane is excluded by the authoritative ID pass.
        Image.new('RGB',(64,64),(1,0,0)).save(self.d/'ids.png')
        hidden=lift.window_proxy(points_grid().dtype,capture,np.full((64,64),3.),np.ones((64,64),dtype=bool),
                                 64/(2*math.tan(math.radians(31))))
        self.assertEqual(len(hidden),0)

    def test_alignment_fills_window_when_sharp_has_no_window_gaussians(self):
        layout=copy.deepcopy(self.layout)
        layout['room']={'poly':[[-2,-3],[2,-3],[2,1],[-2,1]],
                        'window':{'edge':0,'t0':1,'t1':3,'sill':-.6,'top':.6}}
        (self.d/'layout.json').write_text(json.dumps(layout))
        Image.new('RGB',(64,64),(220,70,20)).save(self.d/'real.png')
        Image.new('RGB',(64,64)).save(self.d/'ids.png')
        f=64/(2*math.tan(math.radians(31)))
        yy,xx=np.mgrid[:64,:64]
        glass=(np.abs((xx+.5-32)/f*3)<=1)&(np.abs((yy+.5-32)/f*3)<=.6)
        depth=np.fromfile(self.d/'depth.f32',dtype='<f4').reshape(64,64)
        depth[glass]=3;depth.tofile(self.d/'depth.f32')
        p=points_grid()[~glass.ravel()]
        result,report=lift.align(p,self.capture | {'_directory':str(self.d)})
        self.assertTrue(report['accepted'])
        self.assertGreater(report['windowProxyCount'],300)
        points,_=result
        proxy=points[-report['windowProxyCount']:]
        self.assertTrue(np.allclose(proxy['z'],-3))

    def test_align_only_uses_existing_ply_without_loading_sharp(self):
        lift.ply_write(self.d/'sharp.ply', points_grid())
        result = subprocess.run([os.sys.executable, str(ROOT/'tools/real_sharp.py'), str(self.d), '--align-only'],
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.d/'fine.splat').exists())
        self.assertFalse((self.d.parent/'fusion.lock').exists())

    def test_explicit_compatibility_fuse_after_first_alignment(self):
        lift.ply_write(self.d/'sharp.ply',points_grid())
        result=subprocess.run([os.sys.executable,str(ROOT/'tools/real_sharp.py'),str(self.d),'--align-only','--fuse'],
                              capture_output=True,text=True,timeout=30)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(json.loads((self.d/'alignment.json').read_text())['scene']['views'],[self.d.name])


if __name__ == '__main__': unittest.main()
