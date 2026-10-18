"""Exercise the actual authenticated phone->route->GPU path on owner photographs.
No state PUTs, assignments, fake detections, or invented camera poses. COLMAP
reconstruction has arbitrary scale; offline 3D is explicitly nonmetric.
"""
import base64
from collections import Counter
import json
from pathlib import Path
import time
import urllib.request
import numpy as np
import cv2
from PIL import Image, ImageDraw
ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'work/scan_live_evidence'; OUT.mkdir(parents=True,exist_ok=True)
KEY=(ROOT/'data/.token').read_text().strip()
base='http://127.0.0.1:8790'
def api(path,body=None):
    request=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers={'X-Garden-Key':KEY,'Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=90) as response: return json.loads(response.read())
plan=json.loads((ROOT/'data/state.json').read_text()) if (ROOT/'data/state.json').exists() else dict(items=[],room=dict(poly=[]))
plan=dict(items=plan.get('items',[]),room=dict(poly=plan.get('room',{}).get('poly',[])))
for attempt in range(20):
    try:
        print('health',api('/api/scan_live/health'),flush=True); break
    except Exception:
        if attempt==19: raise
        time.sleep(1)
rows=[]; annotated=[]
# Recognition benchmark includes all fourteen photographs. Separate scan per
# photo avoids implying these large angle changes are a smooth camera track.
for source in sorted((ROOT/'refs').glob('20261018_*.jpg')):
    start=api('/api/scan_live/start',dict(plan=plan)); sid=start['id']
    image=cv2.imread(str(source)); h,w=image.shape[:2]; ok,jpeg=cv2.imencode('.jpg',image,[cv2.IMWRITE_JPEG_QUALITY,80])
    cam=dict(mode='imu',width=w,height=h,pose=np.eye(4).T.ravel().tolist(),intrinsics=[[w,0,w/2],[0,w,h/2],[0,0,1]])
    t=time.perf_counter(); r=api(f'/api/scan_live/{sid}/frame',dict(seq=0,jpeg=base64.b64encode(jpeg).decode(),camera=cam)); r['roundTripMs']=(time.perf_counter()-t)*1000
    r['image']=source.name; rows.append(r)
    rgb=Image.fromarray(cv2.cvtColor(image,cv2.COLOR_BGR2RGB)); draw=ImageDraw.Draw(rgb)
    for d in r['detections']:
        b=d['box']; draw.rectangle(b,outline='#00ff88',width=2); draw.text((b[0]+2,max(0,b[1]-12)),f"{d['label']} {d['confidence']:.2f}",fill='#ff5588',stroke_width=1,stroke_fill='black')
    draw.rectangle((0,0,w,18),fill='black'); draw.text((5,3),source.name+' | actual OWLv2 inference',fill='white')
    rgb.thumbnail((480,360)); annotated.append(rgb); rgb.save(OUT/(source.stem+'-detections.jpg'))
    api(f'/api/scan_live/{sid}/stop',{})
    print(source.name,[(d['label'],d['confidence']) for d in r['detections']],r['timings'],flush=True)
(OUT/'recognition.json').write_text(json.dumps(rows,indent=2))
sheet=Image.new('RGB',(480*3,390*((len(annotated)+2)//3)),(15,20,17))
for i,image in enumerate(annotated): sheet.paste(image,((i%3)*480,(i//3)*390))
sheet.save(OUT/'detections-contact.jpg')
poses=json.loads((OUT/'poses.json').read_text()); points=np.load(OUT/'sparse_points.npz')['xyz']
frames=poses['frames']; centers=np.array([np.array(f['pose']).reshape(4,4).T[:3,3] for f in frames]); center=centers[0]
scale=3/max(.01,np.median(np.linalg.norm(points-center,axis=1))); points=(points-center)*scale
start=api('/api/scan_live/start',dict(plan=plan)); sid=start['id']; posed=[]; posed_start=time.perf_counter()
for seq in range(max(12,len(frames)*3)):
    f=frames[seq%len(frames)]; image=cv2.imread(str(OUT/'highres'/f['name'])); h0,w0=image.shape[:2]; fac=640/max(h0,w0); image=cv2.resize(image,(round(w0*fac),round(h0*fac))); h,w=image.shape[:2]
    k=np.array(f['intrinsics']); k[:2]*=fac; world=np.array(f['pose']).reshape(4,4).T; world[:3,3]=(world[:3,3]-center)*scale
    cv=np.diag([1,-1,-1,1])@np.linalg.inv(world); proj=(k@cv[:3]@np.c_[points,np.ones(len(points))].T).T
    depth_points=[]
    for pt,p in zip(points,proj):
        uv=p[:2]/p[2]
        if p[2]>.1 and 0<=uv[0]<w and 0<=uv[1]<h: depth_points.append(dict(uv=(uv/[w,h]).tolist(),point=pt.tolist()))
    cam=dict(mode='offline_colmap',metric=False,width=w,height=h,pose=world.T.ravel().tolist(),intrinsics=k.tolist(),depthPoints=depth_points)
    ok,jpeg=cv2.imencode('.jpg',image,[cv2.IMWRITE_JPEG_QUALITY,80]); t=time.perf_counter()
    r=api(f'/api/scan_live/{sid}/frame',dict(seq=seq,jpeg=base64.b64encode(jpeg).decode(),camera=cam)); r['roundTripMs']=(time.perf_counter()-t)*1000; r['image']=f['name']; posed.append(r)
    print('posed',seq,f['name'],r['geometry'],r['splat'],flush=True)
    if r['splat']['state']=='error': raise RuntimeError(r['splat'])
    time.sleep(.2)
posed_seconds=time.perf_counter()-posed_start
(OUT/'posed.json').write_text(json.dumps(dict(id=sid,metric=False,scaleNote='COLMAP arbitrary scale, normalized to median depth 3 units; NOT measured metres',registered=len(frames),sparsePoints=len(points),frames=posed),indent=2))
api(f'/api/scan_live/{sid}/stop',{})
assert api(f'/api/scan_live/{sid}/status')['state']=='stopped'
# Verify the exact persisted targets are readable after the worker session ends.
request=urllib.request.Request(base+f'/api/scan_live/{sid}/splat',headers={'X-Garden-Key':KEY})
with urllib.request.urlopen(request) as response: splat=response.read()
assert len(splat)>0 and len(splat)%32==0
(OUT/'evidence.splat').write_bytes(splat)
metrics={stage:dict(median=float(np.median([r['timings'][stage] for r in rows])),p95=float(np.quantile([r['timings'][stage] for r in rows],.95))) for stage in rows[0]['timings']}
summary=dict(posedReplaySeconds=posed_seconds,posedReplayFps=len(posed)/posed_seconds,photos=len(rows),counts=dict(Counter(d['label'] for r in rows for d in r['detections'])),latencyMs=metrics,posedLatencyMs={stage:float(np.median([r['timings'][stage] for r in posed[1:]])) for stage in posed[0]['timings']},splatGaussians=len(splat)//32,splatBytes=len(splat),viewer=f'/scan-live-view.html?s={sid}',colmapRegistered=len(frames),colmapPoints=len(points),metric=False)
(OUT/'summary.json').write_text(json.dumps(summary,indent=2)); print(json.dumps(summary,indent=2),flush=True)
