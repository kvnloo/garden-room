"""Executable geometry/validation regressions, no detector weights or plan writes."""
import sys
from pathlib import Path
import unittest
import numpy as np
import cv2
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from scan_live_geometry import camera, ray, intersect_rays, rigid, transform, alignment, fit_planes, plane_alignment, Geometry, dense_stereo, CV_FROM_XR


class GeometryTests(unittest.TestCase):
    def test_pose_and_intrinsics_validation(self):
        meta=dict(pose=np.eye(4).T.ravel(),intrinsics=[[500,0,320],[0,500,240],[0,0,1]])
        k,w,cv=camera(meta); self.assertTrue(np.allclose(cv,CV_FROM_XR))
        meta['pose']=np.diag([2,1,1,1]).T.ravel()
        with self.assertRaises(ValueError): camera(meta)
        meta['pose']=np.eye(4).T.ravel(); meta['intrinsics'][0][0]=float('nan')
        with self.assertRaises(ValueError): camera(meta)

    def test_known_pose_triangulation_and_no_rotation_only_depth(self):
        a=np.array([0.,0.,0.]); b=np.array([1.,0.,0.]); p=np.array([.2,.5,-3.])
        da=(p-a)/np.linalg.norm(p-a); db=(p-b)/np.linalg.norm(p-b)
        np.testing.assert_allclose(intersect_rays(a,da,b,db),p,atol=1e-8)
        self.assertIsNone(intersect_rays(a,da,a,db))
        self.assertIsNone(intersect_rays(a,da,b,da))

    def test_rigid_fit_does_not_hide_scale(self):
        a=np.array([[0.,0.],[2,0],[0,1]]); theta=.7; rot=np.array([[np.cos(theta),-np.sin(theta)],[np.sin(theta),np.cos(theta)]])
        b=a@rot.T+[1,2]; result=rigid(a,b,floor=-1.3)
        self.assertAlmostEqual(result['angle'],theta); self.assertLess(result['error'],1e-8)
        self.assertGreater(rigid(a,b*2)['error'],.3)

    def test_semantic_ransac_floor_alignment_in_rotated_runtime_plan(self):
        theta=.6; tx=1.; tz=2.; floor=-1.4; c,s=np.cos(theta),np.sin(theta); rot=np.array([[c,-s],[s,c]])
        def xr(x,z,y=0):
            q=rot.T@(np.array([x,z])-[tx,tz]); return [q[0],y+floor,q[1]]
        points=np.array([xr(x,z) for x in np.linspace(0,4,15) for z in np.linspace(0,3,15)])
        plan=dict(room=dict(poly=[[0,0],[4,0],[4,3],[0,3]]),items=[dict(id='fridge',kind='fridge',name='Fridge',x=.5,z=.5),dict(id='table',name='Dining table',x=2.5,z=2.)])
        objects=[dict(label=label,position=dict(zip(['x','y','z'],xr(x,z,.7))),confidence=.8,views=4) for label,x,z in [('refrigerator',.5,.5),('dining table',2.5,2.)]]
        result=alignment(objects,plan,points)
        self.assertIsNotNone(result); self.assertAlmostEqual(result['angle'],theta,places=6); self.assertAlmostEqual(result['tx'],tx,places=6); self.assertAlmostEqual(result['floor'],floor,places=6)
        self.assertIsNone(alignment(objects[:1],plan,points))

    def test_floor_and_vertical_wall_ransac(self):
        floor=np.array([[x,-1.5,z] for x in np.linspace(-2,2,15) for z in np.linspace(-3,0,15)])
        wall=np.array([[-2,y,z] for y in np.linspace(-1.5,1,15) for z in np.linspace(-3,0,15)])
        planes=fit_planes(np.vstack([floor,wall])); self.assertIn('floor',[p['kind'] for p in planes]); self.assertIn('wall',[p['kind'] for p in planes])
        self.assertAlmostEqual(next(p['height'] for p in planes if p['kind']=='floor'),-1.5)

    def test_single_wall_or_repeated_plants_do_not_establish_heading(self):
        cloud=np.array([[0,y,z] for y in np.linspace(-1.5,1,15) for z in np.linspace(-3,0,15)])
        plan=dict(room=dict(poly=[[0,0],[4,0],[4,3],[0,3]]),items=[])
        self.assertIsNone(plane_alignment(cloud,plan))
        self.assertIsNone(alignment([dict(label='potted plant',position=dict(x=0,y=0,z=0),confidence=.9,views=10)]*3,plan,cloud))

    def test_imu_mode_never_produces_metric_objects(self):
        rng=np.random.default_rng(1); image=rng.integers(0,256,(240,320,3),dtype=np.uint8); g=Geometry()
        for i in range(3):
            world=np.eye(4); world[0,3]=i*.3
            meta=dict(mode='imu',seq=i,pose=world.T.ravel().tolist(),intrinsics=[[300,0,160],[0,300,120],[0,0,1]])
            d=[dict(label='potted plant',confidence=.8,box=[80,30,180,200],_appearance=[1.]+[0.]*15)]
            r=g.add(image,meta,d); self.assertFalse(r['posed'])
            self.assertFalse(any(v.get('position') for v in g.objects(i)))
        self.assertEqual(len(g.points),0)

    def test_dense_stereo_uses_real_pixel_correspondence(self):
        rng=np.random.default_rng(3); image=rng.integers(0,256,(240,320,3),dtype=np.uint8); right=np.zeros_like(image); right[:,:-12]=image[:,12:]
        k=np.array([[300.,0,160],[0,300,120],[0,0,1]]); world=np.eye(4); world[0,3]=.2
        old=dict(image=image,k=k,cv=CV_FROM_XR,world=np.eye(4))
        xyz,colors=dense_stereo(old,right,k,CV_FROM_XR@np.linalg.inv(world))
        self.assertGreater(len(xyz),100)
        xyz=np.array(xyz); self.assertAlmostEqual(float(np.median(xyz[:,2])),-5.,delta=.2)
        self.assertEqual(len(colors),len(xyz))


if __name__=='__main__': unittest.main(verbosity=2)
