"""Deterministic proposal safety/identity tests; no GPU or owner writes."""
import importlib.util
import json
import unittest
from pathlib import Path
from copy import deepcopy
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('layout',ROOT/'tools/scan_live_layout.py')
layout=importlib.util.module_from_spec(spec); spec.loader.exec_module(layout)
T=dict(angle=0,tx=1,tz=1,floor=0)

def plant(id,x,z): return dict(id=id,name=id,kind='plant',x=x,z=z,w=.2,d=.2,h=.7,potD=.2,potH=.2,height=.5,rot=0)
def detection(id,x,z,apps=None): return dict(id=id,label='potted plant',position=dict(x=x-1,y=.4,z=z-1),metric=True,views=4,confidence=.85,size=dict(w=.2,h=.7,d=None),plant=dict(heightM=.5,widthM=.2),identity=dict(candidates=[dict(id=k,appearanceSimilarity=v) for k,v in (apps or {'p01':.98,'p02':.2}).items()]))

class LayoutTests(unittest.TestCase):
    def setUp(self): self.plan=dict(room=dict(poly=[[0,0],[4,0],[4,4],[0,4]]),items=[plant('p01',1,1),plant('p02',3,3)])
    def proposal(self,ds,**kwargs): return layout.build_proposal(self.plan,ds,metric=True,alignment=T,**kwargs)
    def test_transform_and_matched_plant_full_layout(self):
        before=deepcopy(self.plan); p=self.proposal([detection('o1',1.12,1.07)])
        self.assertEqual(p['selected'],1); self.assertEqual(p['items'][0]['x'],1.12); self.assertEqual(p['items'][1],self.plan['items'][1]); self.assertEqual(p['notSeen'],1); self.assertEqual(self.plan,before)
    def test_nonmetric_never_becomes_room_coordinates(self):
        for metric,t in [(False,T),(True,None),(False,None)]:
            p=layout.build_proposal(self.plan,[detection('o1',1.12,1)],metric,t)
            self.assertEqual(p['selected'],0); self.assertEqual(p['items'],self.plan['items']); self.assertTrue(p['warnings'])
    def test_manual_nonmetric_position_requires_explicit_review(self):
        p=layout.build_proposal(self.plan,[detection('o1',1.12,1)],False,None,decisions={'o1':dict(itemId='p01',x=1.15,z=1.1,include=True)})
        self.assertEqual(p['selected'],1); self.assertTrue(p['changes'][0]['manualPosition']); self.assertFalse(p['metric'])
    def test_bounds_and_fridge_swing_block_changes(self):
        for x,z in [(.01,1),(2.2,2.2)]:
            self.plan['items'].append(dict(id='fridge',kind='fridge',name='Fridge',x=2.2,z=1.5,w=.8,d=.8,h=1.7,rot=0,locked=True))
            p=self.proposal([detection('o1',x,z)],decisions={'o1':dict(itemId='p01',include=True)})
            self.assertEqual(p['selected'],0); self.assertFalse(p['changes'][0]['allowed']); self.assertTrue(p['changes'][0]['reasons'])
            self.plan['items'].pop()
    def test_moving_fridge_cannot_swing_into_unseen_plant(self):
        self.plan['items']=[plant('p01',2,1.9),dict(id='fridge',kind='fridge',name='Fridge',x=1,z=1,w=.8,d=.8,h=1.7,rot=0)]
        d=detection('fridge-seen',2,1);d['label']='refrigerator'
        p=self.proposal([d],decisions={'fridge-seen':dict(itemId='fridge',include=True)})
        self.assertEqual(p['selected'],0);self.assertEqual(p['items'],self.plan['items'])
        self.assertIn('Fridge door swing would reach p01',p['changes'][0]['reasons'])
    def test_composed_fridge_and_plant_moves_cannot_conflict(self):
        self.plan['items']=[plant('p01',3,3),dict(id='fridge',kind='fridge',name='Fridge',x=1,z=1,w=.8,d=.8,h=1.7,rot=0)]
        d=detection('fridge-seen',2,1);d['label']='refrigerator'
        ds=[d,detection('plant-seen',2,1.9)]
        p=self.proposal(ds,decisions={'fridge-seen':dict(itemId='fridge',include=True),'plant-seen':dict(itemId='p01',include=True)})
        self.assertEqual(p['selected'],0);self.assertEqual(p['items'],self.plan['items'])
    def test_locked_items_and_exclusions_preserved(self):
        self.plan['items'][0]['locked']=True; self.assertEqual(self.proposal([detection('o1',1.1,1)])['selected'],0)
        self.plan['items'][0]['locked']=False
        self.assertEqual(self.proposal([detection('o1',1.1,1)],decisions={'o1':{'include':False}})['selected'],0)
    def test_global_assignment_no_duplicate_ids(self):
        ds=[detection('o1',1.1,1),detection('o2',3.1,3,{'p01':.85,'p02':.95})]
        p=self.proposal(ds); ids=[c['id'] for c in p['changes'] if c['object'] and c['id']]
        self.assertEqual(len(set(ids)),2); self.assertEqual(p['selected'],2)
    def test_spatial_track_duplicates_collapsed(self):
        self.assertEqual(len([c for c in self.proposal([detection('o1',1.1,1),detection('o2',1.12,1)])['changes'] if c['object']]),1)
    def test_unknown_uses_measured_conservative_size(self):
        d=detection('o-new',2.2,2.1,{'p01':.1,'p02':.1}); p=self.proposal([d]); c=p['changes'][0]
        self.assertEqual(c['status'],'new'); self.assertEqual(c['name'],'Unknown plant'); self.assertTrue(c['included']); self.assertEqual(len(p['items']),3); self.assertEqual(c['after']['w'],.2)
        d['views']=1; self.assertEqual(self.proposal([d])['selected'],0)
    def test_furniture_all_existing_types(self):
        for label,kind in [('refrigerator','fridge'),('china cabinet','china'),('dining table','table'),('glass table','glass'),('floor lamp','lamp5')]:
            self.plan['items']=[dict(id=kind,name=kind,kind=kind,x=1,z=1,w=.5,d=.5,h=1,rot=0)]
            d=detection('o1',1.1,1);d['label']=label
            self.assertEqual(self.proposal([d])['changes'][0]['id'],kind)
    def test_ar_rotation_not_old_plan_position(self):
        d=detection('o1',1.1,1); d['position']=dict(x=.1,y=.2,z=0);d['planPosition']=dict(x=100,z=100)
        p=layout.room_position(d,True,dict(angle=1.5707963267948966,tx=1,tz=1,floor=.1))
        self.assertAlmostEqual(p['x'],1);self.assertAlmostEqual(p['z'],1.1);self.assertAlmostEqual(p['y'],.1)

if __name__=='__main__': unittest.main(verbosity=2)
