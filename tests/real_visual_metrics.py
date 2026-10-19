"""Metric conventions and ID support tests; CPU, no image or judge turns."""
import importlib.util
import math
from pathlib import Path
import unittest
import numpy as np
spec=importlib.util.spec_from_file_location('score_real',Path(__file__).resolve().parents[1]/'tools/score_real_visual.py')
assert spec is not None and spec.loader is not None
score=importlib.util.module_from_spec(spec);spec.loader.exec_module(score)

class MetricTests(unittest.TestCase):
    def test_id_support_counts_only_visible_plants(self):
        labels=np.zeros((64,64),dtype='int32');labels[10:30,10:30]=1;labels[40:50,40:50]=2;labels[0,0]=3
        rgb=np.zeros((64,64,3),dtype='uint8');rgb[10:30,10:30]=[40,170,40]
        objects=[{'id':'p01','kind':'plant','label':1},{'id':'table','kind':'table','label':2},{'id':'p03','kind':'plant','label':3},{'id':'p04','kind':'plant','label':4}]
        result=score.plant_support(rgb,labels,objects)
        self.assertEqual(result['expectedVisible'],1);self.assertEqual(result['supported'],1)
        self.assertEqual(result['objects'][0]['bbox'],[10,10,29,29])
        self.assertIn('NOT a semantic',result['method'])
        result=score.plant_support(np.zeros_like(rgb),labels,objects)
        self.assertEqual(result['expectedVisible'],1);self.assertEqual(result['supported'],0)
        self.assertIsNone(result['objects'][0]['supportCentroidErrorPx'])

    def test_projected_depth_convention_and_residual(self):
        w=80;h=64;f=h/(2*math.tan(math.radians(60)/2));yy,xx=np.mgrid[:h,:w]
        aspect=w/h+.004;fx=w/(2*math.tan(math.radians(60)/2)*aspect)
        depth=(1+xx*.03+yy*.02).astype('float32')
        points=np.stack(((xx+.5-w/2)/fx*depth,-(yy+.5-h/2)/f*depth,-depth),axis=-1).reshape(-1,3)
        camera={'fov':60,'aspect':aspect,'matrixWorld':np.eye(4).flatten(order='F').tolist()}
        result=score.depth_score(points,camera,depth)
        self.assertEqual(result['samples'],w*h);self.assertAlmostEqual(result['coverageFraction'],1)
        self.assertLess(result['medianM'],1e-6)
        shifted=score.depth_score(points,camera,depth+.2)
        self.assertAlmostEqual(shifted['medianM'],.2,places=5)
        self.assertIn('not alpha-composited',result['method'])

if __name__=='__main__':unittest.main()
