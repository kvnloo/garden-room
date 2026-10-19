"""Real OWLv2 + PlantCV + geometry + gsplat through the authenticated HTTP API.
Uses owner JPEGs and recovered COLMAP poses, NEVER fabricates metric depth/poses.
--record updates tests/fixtures/scan-real.json with actual responses for browser replay.
"""
import base64
import hashlib
import json
import sys
from pathlib import Path
import urllib.request
from PIL import Image
import numpy as np
import cv2
ROOT=Path(__file__).resolve().parents[1]
KEY=(ROOT/'data/.token').read_text().strip()
OUT=ROOT/'work/scan-layout-evidence';OUT.mkdir(parents=True,exist_ok=True)

def api(path,body=None):
    req=urllib.request.Request('http://127.0.0.1:8790'+path,data=json.dumps(body).encode() if body is not None else None,headers={'X-Garden-Key':KEY,'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=90) as r: return json.loads(r.read())

plan=json.loads((OUT/'state.before.json' if (OUT/'state.before.json').exists() else ROOT/'data/state.json').read_text())
plan={k:plan[k] for k in ('room','items')}
health=api('/api/scan_live/health'); assert health['plants']==25
sid=api('/api/scan_live/start',{'plan':plan})['id']
source=ROOT/'refs/20261018_121441.jpg'; raw=source.read_bytes()
with Image.open(source) as image: w,h=image.size
cam=dict(mode='imu',metric=False,width=w,height=h,pose=np.eye(4).T.ravel().tolist(),intrinsics=[[w,0,w/2],[0,w,h/2],[0,0,1]],intrinsicsEstimated=True)
try:
    for seq in range(3): r=api(f'/api/scan_live/{sid}/frame',dict(seq=seq,jpeg=base64.b64encode(raw).decode(),camera=cam))
finally: api(f'/api/scan_live/{sid}/stop',{})
r=api(f'/api/scan_live/{sid}/status')
plants=[d for d in r['detections'] if d['label']=='potted plant']
assert len(plants)>=5
assert all(len(d['identity']['candidates'])==25 for d in plants)
assert all(d['plant']['method'].startswith('PlantCV') for d in plants)
assert r['proposal']['items']==plan['items'] and r['proposal']['selected']==0
matches=[c for c in r['proposal']['changes'] if c['object'] and c['id'] and c.get('after',{}).get('kind')=='plant']
assert len(matches)>=3, 'Appearance-only tentative matches should still be reviewable'
manual=matches[0]; it=manual['after']
review=api(f'/api/scan_live/{sid}/proposal',dict(plan=plan,decisions={manual['object']:dict(itemId=it['id'],x=it['x'],z=it['z'],include=True)}))
assert review['scanId']==sid
poses=json.loads((ROOT/'work/scan_live_evidence/poses.json').read_text())['frames']; replay=[]
points=np.load(ROOT/'work/scan_live_evidence/sparse_points.npz')['xyz']; origin=np.array(poses[0]['pose']).reshape(4,4).T[:3,3].copy()
scale=3/max(.01,np.median(np.linalg.norm(points-origin,axis=1))); points=(points-origin)*scale
posid=api('/api/scan_live/start',{'plan':plan})['id']
try:
    for seq,f in enumerate(poses):
        image=cv2.imread(str(ROOT/'work/scan_live_evidence/highres'/f['name'])); h0,w0=image.shape[:2]; fac=640/max(h0,w0); image=cv2.resize(image,(round(w0*fac),round(h0*fac)));h,w=image.shape[:2]
        k=np.array(f['intrinsics']);k[:2]*=fac
        world=np.array(f['pose']).reshape(4,4).T.copy();world[:3,3]=(world[:3,3]-origin)*scale
        projected=(k@(np.diag([1,-1,-1,1])@np.linalg.inv(world))[:3]@np.c_[points,np.ones(len(points))].T).T
        depth=[]
        for pt,p in zip(points,projected):
            uv=p[:2]/p[2]
            if p[2]>.1 and 0<=uv[0]<w and 0<=uv[1]<h: depth.append(dict(uv=(uv/[w,h]).tolist(),point=pt.tolist()))
        camera=dict(mode='offline_colmap',metric=False,width=w,height=h,pose=world.T.ravel().tolist(),intrinsics=k.tolist(),depthPoints=depth,scaleNote='Arbitrary COLMAP units normalized to median depth 3; not metres')
        ok,jpeg=cv2.imencode('.jpg',image,[cv2.IMWRITE_JPEG_QUALITY,80]); assert ok
        posed=api(f'/api/scan_live/{posid}/frame',dict(seq=seq,jpeg=base64.b64encode(jpeg).decode(),camera=camera))
        assert not posed['metric'] and posed['proposal']['selected']==0
        replay.append(dict(source=f['name'],camera=camera,detections=posed['detections'],geometry=posed['geometry'],proposal=posed['proposal']))
finally: api(f'/api/scan_live/{posid}/stop',{})
assert replay[-1]['geometry']['points']>0
assert any(h['id']==sid and h['state']=='stopped' for h in api('/api/scan_live/history'))
fixture=dict(provenance={'description':'Actual stationary 2D owner photograph sequence + separately recovered nonmetric COLMAP sequence. No physical XR scan exists yet. Positions MUST NOT be called measured metres.', 'image':source.name,'sha256':hashlib.sha256(raw).hexdigest(),'model':health['model'],'device':health['device'],'stationaryFrames':3},plan=plan,scan=r,stationaryCamera=cam,posedReplay=replay)
(OUT/'real-pipeline.json').write_text(json.dumps(fixture,indent=2))
if '--record' in sys.argv:
    target=ROOT/'tests/fixtures/scan-real.json';target.parent.mkdir(exist_ok=True);target.write_text(json.dumps(fixture,indent=2))
summary=dict(realPlantDetections=len(plants),tentativePlantMatches=len(matches),metric=False,automaticChanges=r['proposal']['selected'],posedFrames=len(replay),triangulatedPoints=replay[-1]['geometry']['points'],historyReadable=True,scanId=sid)
(OUT/'pipeline-summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2))
