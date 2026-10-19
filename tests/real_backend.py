"""No network/GPU jobs: validate actual browser depth, metric fit and bounded fusion.
Run after node tests/real_capture.mjs using the ComfyUI Python.
"""
import base64
import copy
import importlib.util
import json
import math
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import hashlib
import numpy as np
from plyfile import PlyData

ROOT=Path(__file__).resolve().parents[1]


def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    assert spec is not None and spec.loader is not None
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod


route=load('real_route',ROOT/'routes/real.py')
lift=load('real_lift',ROOT/'tools/real_sharp.py')


class RealTests(unittest.TestCase):
    def test_browser_capture_validation_and_revision(self):
        capture=json.loads((ROOT/'work/real-capture-test.json').read_text())
        layout,camera,raw=route.validate(capture)
        self.assertEqual(len(raw),capture['depth']['width']*capture['depth']['height']*4)
        old=route.revision(layout)
        care=copy.deepcopy(layout);care['items'][0]['_sat']=.12
        self.assertEqual(old,route.revision(care))
        care['items'][0]['x']+=.1
        self.assertNotEqual(old,route.revision(care))
        bad=copy.deepcopy(capture);b=bytearray(raw);b[:4]=np.array([np.nan],dtype='<f4').tobytes();bad['depth']['data']=base64.b64encode(b).decode()
        with self.assertRaisesRegex(ValueError,'finite'):route.validate(bad)
        bad['depth']['data']=base64.b64encode(bytes(len(raw))).decode()
        with self.assertRaisesRegex(ValueError,'visible'):route.validate(bad)

    def test_cache_immutable_capture_and_restart_resume(self):
        capture=json.loads((ROOT/'work/real-capture-test.json').read_text())
        class HTTP:
            def __init__(self,payload):self.payload=payload;self.responses=[]
            def body(self):return copy.deepcopy(self.payload)
            def send_json(self,code,data):self.responses.append((code,data))
        with tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR')) as directory:
            with patch.object(route,'STORE',Path(directory)),patch.object(route,'start_preview'),patch.object(route.threading,'Thread') as thread:
                route.ACTIVE.clear()
                first=HTTP(capture);self.assertTrue(route.handle(first,'POST','/api/real/view'));code,value=first.responses[-1]
                self.assertEqual(code,202);self.assertFalse(value['cached'])
                d=Path(directory)/value['revision']/value['id'];original=(d/'view.jpg').read_bytes()
                second=HTTP(capture);route.handle(second,'POST','/api/real/view');self.assertTrue(second.responses[-1][1]['cached']);self.assertEqual(thread.call_count,1)
                route.ACTIVE.clear() # Simulate a web-service restart, not a new capture.
                changed=copy.deepcopy(capture);changed['view']='data:image/jpeg;base64,'+base64.b64encode(b'not the original').decode()
                resume=HTTP(changed);route.handle(resume,'POST','/api/real/view')
                self.assertTrue(resume.responses[-1][1]['resumed']);self.assertEqual(thread.call_count,2)
                self.assertEqual((d/'view.jpg').read_bytes(),original)
                (d/'status.json').write_text(json.dumps({'state':'ready'}))
                done=HTTP(capture);route.handle(done,'POST','/api/real/view');self.assertEqual(done.responses[-1][0],200);self.assertEqual(thread.call_count,2)
                retry=HTTP(capture|{'retry':True});route.handle(retry,'POST','/api/real/view');self.assertNotEqual(retry.responses[-1][1]['id'],value['id'])
                route.ACTIVE.clear()

    def test_robust_fit_and_rejection(self):
        rng=np.random.default_rng(1);x=rng.uniform(.3,4,8000);y=1.4*x+.3+rng.normal(0,.02,len(x));y[:800]=rng.uniform(.2,7,800)
        fit=lift.robust_fit(x,y)
        self.assertTrue(fit['accepted']);self.assertAlmostEqual(fit['scale'],1.4,delta=.03)
        self.assertFalse(lift.robust_fit(x,rng.uniform(.2,7,len(x)))['accepted'])

    def test_metric_world_transform_and_confidence_fusion(self):
        dtype=[(k,'f4') for k in ['x','y','z','f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3']]
        with tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR')) as temporary:
            parent=Path(temporary)/('a'*24);parent.mkdir()
            d=parent/('b'*24);d.mkdir();w=h=64;yy,xx=np.mgrid[:h,:w];z=.8+yy/h+.15*xx/w
            depth=(1.4*z+.3).astype('<f4');depth.tofile(d/'depth.f32')
            (d/'layout.json').write_text(json.dumps({'room':{'poly':[[0,0],[3,0],[3,3],[0,3]]},'items':[]}))
            capture={'_directory':str(d),'depth':{'width':w,'height':h},'camera':{'fov':62,'matrixWorld':np.eye(4).flatten(order='F').tolist()}}
            f=h/(2*math.tan(math.radians(31)));p=np.zeros(w*h,dtype=dtype)
            p['x']=((xx-w/2)/f*z).ravel();p['y']=((yy-h/2)/f*z).ravel();p['z']=z.ravel();p['opacity']=3;p['rot_0']=1
            for k in range(3):p[f'scale_{k}']=math.log(.01)
            result,report=lift.align(p,capture);self.assertTrue(report['accepted']);points,confidence=result
            self.assertLess(report['medianM'],.002);self.assertLess(float(np.max(np.abs(-points['z']-depth.ravel()))),.002)
            self.assertTrue(np.isfinite(points['scale_0']).all())
            lift.ply_write(d/'aligned.ply',points);np.save(d/'confidence.npy',confidence);(d/'alignment.json').write_text(json.dumps(report))
            other=parent/('c'*24);other.mkdir();lift.ply_write(other/'aligned.ply',points);np.save(other/'confidence.npy',confidence*.5);(other/'alignment.json').write_text(json.dumps(report))
            scene=lift.fuse(d)
            self.assertLessEqual(scene['count'],len(points));self.assertEqual(scene['bytes'],scene['count']*32)
            self.assertEqual(len(scene['views']),2)
            artifact=parent/Path(scene['url']).name
            self.assertEqual(artifact.stat().st_size,scene['bytes'])
            self.assertEqual(json.loads((parent/'scene.json').read_text())['url'],scene['url'])


if __name__=='__main__':unittest.main()
