"""Free cached-cohort replay contract: real CPU exports, synthetic labelled RGB only."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('replay',ROOT/'tools/replay_real_shell.py')
assert spec is not None and spec.loader is not None
replay=importlib.util.module_from_spec(spec);spec.loader.exec_module(replay)


class ReplayTests(unittest.TestCase):
    def test_six_cached_exports_preserve_images_and_recover_legacy_photo_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            before,after=Path(tmp)/'before',Path(tmp)/'after'
            before.mkdir();records=[]
            camera={'fov':60,'aspect':1,'matrixWorld':np.eye(4).flatten(order='F').tolist()}
            for i in range(6):
                name='pose-'+str(i);d=before/name;d.mkdir()
                capture={'camera':camera,'layout':{'items':[{'id':'p01','name':'Synthetic plant','kind':'plant'}]},
                         'objects':[{'id':'p01','kind':'plant','label':1}],
                         'depth':{'width':64,'height':64},'captureMs':12}
                (d/'capture.json').write_text(json.dumps(capture))
                np.full((64,64),2.,dtype='<f4').tofile(d/'depth.f32')
                Image.new('RGB',(64,64),(1,0,0)).save(d/'ids.png')
                for file in ('real.png','procedural.jpg'):Image.new('RGB',(64,64),(30,180,30)).save(d/file)
                (d/'provenance.json').write_text(json.dumps({'real.png':{'seconds':10,'route':'synthetic unit-test RGB, not generation'}}))
                (d/'status.json').write_text(json.dumps({'created':1000+i}))
                records.append({'name':name,'revision':'a'*24,'id':str(i).zfill(24),'camera':camera,
                                'view':{'id':str(i).zfill(24),'camera':camera}})
            (before/'records.json').write_text(json.dumps(records))
            result=replay.replay(before,after)
            self.assertEqual(len(result),6)
            for i,record in enumerate(result):
                d=after/record['name'];photo=record['view']
                self.assertEqual(photo['created'],1000+i)
                self.assertEqual([p['id'] for p in photo['plants']],['p01'])
                self.assertEqual(photo['status']['state'],'ready')
                self.assertEqual(photo['status']['backend'],'procedural-depth-shell')
                self.assertEqual(record['sourceHashes']['real.png'],hashlib.sha256((d/'real.png').read_bytes()).hexdigest())
                self.assertTrue((d/'coarse.splat').stat().st_size>0)
                self.assertTrue((d/'fine.splat').stat().st_size>0)
                self.assertTrue(photo['status']['splat']['fine']['url'].startswith('/real-visual-cache/'))


if __name__=='__main__':unittest.main()
