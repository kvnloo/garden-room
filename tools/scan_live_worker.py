#!/usr/bin/env python3
"""Private persistent GPU scanner. Unix socket; authenticated HTTP proxy owns access.
One inference in flight, bounded sessions/images/views/Gaussians; never changes plan.
"""
import argparse
import base64
import io
import json
import os
from pathlib import Path
import re
import secrets
import socket
import socketserver
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
ROOT=Path(__file__).resolve().parents[1]
os.environ.setdefault('HF_HOME',str(ROOT/'work/models/hf'))
os.environ.setdefault('TORCH_EXTENSIONS_DIR',str(ROOT/'work/models/torch_extensions'))
os.environ.setdefault('TORCH_CUDA_ARCH_LIST','8.6')
os.environ.setdefault('MAX_JOBS','4')
os.environ.setdefault('TOKENIZERS_PARALLELISM','false')
import cv2
import numpy as np
from PIL import Image
import torch
from transformers import Owlv2Processor, Owlv2ForObjectDetection
from plantcv import plantcv as pcv
from scan_live_geometry import Geometry, alignment, transform, camera
from scan_live_splats import LiveSplats
LABELS=['dining table','glass table','refrigerator','china cabinet','potted plant','floor lamp','window','door']
MODEL='google/owlv2-base-patch16-ensemble'
DATA=ROOT/'data/scan_live'
LOCK=threading.Lock()


def appearance(image,mask=None):
    hsv=cv2.cvtColor(image,cv2.COLOR_BGR2HSV)
    hist=cv2.calcHist([hsv],[0],mask,[16],[0,180]).ravel()
    return hist/max(1e-6,np.linalg.norm(hist))


class Detector:
    def __init__(self):
        torch.set_num_threads(4); cv2.setNumThreads(2)
        self.processor=Owlv2Processor.from_pretrained(MODEL)
        self.model=Owlv2ForObjectDetection.from_pretrained(MODEL).to('cuda').eval()
        # Cache text embeddings once; OWLv2's full forward is used for compatibility.
        self.text=['a photo of a '+v for v in LABELS]
        self.plants=json.loads((ROOT/'public/plants.json').read_text()); self.templates={}
        for plant in self.plants:
            image=cv2.imread(str(ROOT/'public'/plant['src']),cv2.IMREAD_UNCHANGED)
            if image is not None:
                mask=(image[:,:,3]>20).astype(np.uint8)*255 if image.shape[2]==4 else None
                self.templates[plant['id']]=appearance(image[:,:,:3],mask)

    def detect(self,image):
        rgb=cv2.cvtColor(image,cv2.COLOR_BGR2RGB)
        inputs=self.processor(text=[self.text],images=Image.fromarray(rgb),return_tensors='pt').to('cuda')
        with torch.inference_mode(): outputs=self.model(**inputs)
        raw=self.processor.post_process_grounded_object_detection(outputs,target_sizes=torch.tensor([image.shape[:2]],device='cuda'),threshold=.14)[0]
        boxes=raw['boxes'].detach().cpu().numpy(); scores=raw['scores'].detach().cpu().numpy(); labels=raw['labels'].detach().cpu().numpy()
        h,w=image.shape[:2]; detections=[]
        # Class-aware NMS, with table synonyms merged to avoid duplicate landmarks.
        for idx in np.argsort(-scores):
            box=np.clip(boxes[idx],[0,0,0,0],[w-1,h-1,w,h]); label=LABELS[int(labels[idx])]
            if label=='glass table': label='dining table'
            threshold={'potted plant':.23,'floor lamp':.25,'door':.23,'window':.20,'dining table':.22,'china cabinet':.25,'refrigerator':.30}[label]
            if scores[idx]<threshold: continue
            if min(box[2:]-box[:2])<12 or np.prod(box[2:]-box[:2])>.88*w*h: continue
            duplicate=False
            for d in detections:
                if d['label']!=label: continue
                b=np.array(d['box']); overlap=np.prod(np.maximum(0,np.minimum(box[2:],b[2:])-np.maximum(box[:2],b[:2])))
                iou=overlap/(np.prod(box[2:]-box[:2])+np.prod(b[2:]-b[:2])-overlap+1e-6)
                containment=overlap/(min(np.prod(box[2:]-box[:2]),np.prod(b[2:]-b[:2]))+1e-6)
                if iou>.4 or containment>.85: duplicate=True; break
            if duplicate: continue
            x0,y0,x1,y1=box.astype(int); crop=image[y0:y1,x0:x1]
            detections.append(dict(label=label,confidence=round(float(scores[idx]),3),box=box.tolist(),_appearance=appearance(crop).tolist()))
            if len(detections)>=24: break
        return detections

    def plant_measure(self,image,d,plan,t):
        x0,y0,x1,y1=np.array(d['box']).astype(int); crop=image[y0:y1,x0:x1]
        if crop.size==0: return
        rgb=cv2.cvtColor(crop,cv2.COLOR_BGR2RGB)
        # PlantCV supplies the LAB segmentation and connected-mask size analysis.
        a=pcv.rgb2gray_lab(rgb_img=rgb,channel='a')
        mask=pcv.threshold.binary(gray_img=a,threshold=126,object_type='dark')
        hsv=cv2.cvtColor(crop,cv2.COLOR_BGR2HSV)
        mask[(hsv[:,:,1]<35)|(hsv[:,:,2]<25)]=0
        mask=cv2.morphologyEx(mask,cv2.MORPH_OPEN,np.ones((3,3),np.uint8))
        label='live_plant'; pcv.outputs.clear()
        pcv.analyze.size(img=rgb,labeled_mask=(mask>0).astype(np.int32),n_labels=1,label=label)
        ys,xs=np.where(mask>0)
        measurements=dict(method='PlantCV LAB green mask + OpenCV colour',projectedLeafAreaPx=int(len(xs)),segmentationFraction=round(float(np.mean(mask>0)),3),warning='Visible projected foliage, not total leaf area; lighting-dependent colour, not a diagnosis')
        if len(xs):
            r,g,b=rgb[mask>0].astype(float).T; total=r+g+b+1e-5
            measurements.update(widthPx=int(xs.max()-xs.min()+1),heightPx=int(ys.max()-ys.min()+1),excessGreen=float(np.mean((2*g-r-b)/total)),yellowFraction=float(np.mean((hsv[:,:,0][mask>0]<35)&(hsv[:,:,0][mask>0]>15))))
            if d.get('size'):
                sx=d['size']['w']/max(1,x1-x0); sy=d['size']['h']/max(1,y1-y0)
                measurements.update(widthM=measurements['widthPx']*sx,heightM=measurements['heightPx']*sy,projectedLeafAreaM2=len(xs)*sx*sy,uncertainty='camera-plane estimate; occlusion and depth variation')
        d['plant']=measurements
        hist=appearance(crop,mask if len(xs) else None); candidates=[]
        pos=transform(t,[d['position'][k] for k in ['x','y','z']]) if t and d.get('position') else None
        items={it['id']:it for it in plan.get('items',[]) if it.get('kind')=='plant'}
        for plant in self.plants:
            similarity=float(hist@self.templates.get(plant['id'],np.zeros(16)))
            it=items.get(plant['id']); distance=float(np.hypot(pos['x']-it['x'],pos['z']-it['z'])) if pos and it else None
            score=similarity*.6+(max(0,1-distance/1.5)*.4 if distance is not None else 0)
            candidates.append(dict(id=plant['id'],name=plant['name'],appearanceSimilarity=round(similarity,3),distanceM=distance,score=score))
        candidates.sort(key=lambda c:-c['score']); best=candidates[0]
        confident=pos is not None and best['distanceM'] is not None and best['distanceM']<.65 and best['appearanceSimilarity']>.65 and best['score']-candidates[1]['score']>.08
        d['identity']=dict(status='suggested' if confident else 'unsure',id=best['id'] if confident else None,candidates=candidates[:3])


class Scan:
    def __init__(self,id,plan):
        self.id=id; self.plan=validate_plan(plan); self.geometry=Geometry(); self.seq=-1; self.last=time.monotonic(); self.alignment=None
        self.dir=DATA/id; self.dir.mkdir(parents=True,exist_ok=True,mode=0o700)
        self.splats=LiveSplats(self.dir/'live.splat'); self.result=dict(id=id,state='ready',detections=[],corrections=[],alignment=None)

    def frame(self,body,detector):
        start=time.perf_counter(); seq=body.get('seq')
        if not isinstance(seq,int) or seq<=self.seq: raise ValueError('Frame sequence must increase')
        meta=body.get('camera',{}); meta['seq']=seq
        if meta.get('mode') not in ('webxr','imu','offline_colmap'): raise ValueError('Unknown pose source')
        # Decode only after reading JPEG dimensions; protect against decompression bombs.
        raw=base64.b64decode(body.get('jpeg',''),validate=True)
        if len(raw)>600000: raise ValueError('JPEG too large')
        with Image.open(io.BytesIO(raw)) as header:
            w,h=header.size
            if max(w,h)>1024 or min(w,h)<64 or header.format!='JPEG': raise ValueError('Use a JPEG between 64 and 1024 px')
        image=cv2.imdecode(np.frombuffer(raw,np.uint8),cv2.IMREAD_COLOR)
        if image is None: raise ValueError('JPEG could not be decoded')
        if meta.get('width')!=w or meta.get('height')!=h: raise ValueError('Camera/image dimensions differ')
        k,world,cv=camera(meta)
        dist=np.asarray(meta.get('distortion',[0]*5),dtype=float)
        if dist.shape not in [(4,),(5,),(8,)] or not np.isfinite(dist).all(): raise ValueError('Invalid distortion')
        if np.any(dist): image=cv2.undistort(image,k,dist)
        self.plan=validate_plan(body['plan']) if 'plan' in body else self.plan
        t0=time.perf_counter(); ds=detector.detect(image); t1=time.perf_counter()
        geom=self.geometry.add(image,meta,ds); objects=self.geometry.objects(seq); t2=time.perf_counter()
        prior=body.get('alignment')
        if prior is not None:
            if not isinstance(prior,dict) or not all(isinstance(prior.get(k),(int,float)) and np.isfinite(prior[k]) for k in ['angle','tx','tz','floor']): raise ValueError('Invalid prior alignment')
        metric=meta.get('mode')=='webxr'
        self.alignment=alignment(objects,self.plan,self.geometry.points,prior or self.alignment) if metric else None
        by_id={d['id']:d for d in objects}
        for d in ds:
            track=by_id.get(d['id'])
            if track and track['label']=='potted plant': detector.plant_measure(image,track,self.plan,self.alignment)
        t3=time.perf_counter()
        if geom['posed']:
            self.splats.add_view(image,meta)
            try: splat=self.splats.update(self.geometry.points,self.geometry.colors)
            except Exception as e:
                self.splats.error=f'{type(e).__name__}: {str(e)[:300]}'; splat=dict(state='error',error=self.splats.error)
        else: splat=dict(state='unavailable-rotation-only',count=0)
        t4=time.perf_counter()
        corrections=[]
        for d in objects:
            d['metric']=metric
            if d.get('position') and self.alignment:
                d['planPosition']=transform(self.alignment,[d['position'][k] for k in ['x','y','z']])
                it=None
                if d.get('identity',{}).get('id'): it=next((it for it in self.plan['items'] if it['id']==d['identity']['id']),None)
                else:
                    regex={'dining table':'table','refrigerator':'fridge|refrigerator','china cabinet':'china|cabinet|hutch'}.get(d['label'])
                    matches=[it for it in self.plan['items'] if regex and re.search(regex,it.get('name','')+' '+it.get('kind',''),re.I)]
                    if len(matches)==1: it=matches[0]
                if it and not it.get('locked') and d['views']>=3:
                    p=d['planPosition']; delta=float(np.hypot(p['x']-it['x'],p['z']-it['z']))
                    props={}
                    estimate=d.get('plant',{}).get('heightM')
                    if it.get('kind')=='plant' and isinstance(estimate,(int,float)) and .1<estimate<3.5 and abs(estimate-it.get('height',estimate))>.08:
                        props['height']=estimate
                    if (.07<delta<1.5) or (props and delta<.5):
                        corrections.append(dict(id=it['id'],object=d['id'],name=it.get('name',it['id']),x=p['x'],z=p['z'],distanceM=delta,reason='triangulated position / visible foliage height estimate; confirm before applying',props=props))
        splat.update(url=f'/api/scan_live/{self.id}/splat' if self.splats.output.exists() else None,revision=self.splats.revision)
        self.seq=seq; self.last=time.monotonic()
        timings=dict(detection=round((t1-t0)*1000,2),geometry=round((t2-t1)*1000,2),plantsAlignment=round((t3-t2)*1000,2),splat=round((t4-t3)*1000,2),total=round((t4-start)*1000,2))
        self.result=dict(id=self.id,state='scanning',seq=seq,detections=objects,corrections=corrections,alignment=self.alignment,geometry=geom,splat=splat,timings=timings,metric=metric,cameraMode=meta['mode'],message='Move sideways slowly for triangulation' if geom['posed'] else '2D camera only: orientation has no metric translation; use AR camera access for 3D')
        tmp=self.dir/'latest.tmp'; tmp.write_text(json.dumps(self.result,allow_nan=False)); tmp.replace(self.dir/'latest.json')
        return self.result


def validate_plan(plan):
    if not isinstance(plan,dict): raise ValueError('Plan required')
    items=plan.get('items',[]); room=plan.get('room',{}); poly=room.get('poly',[])
    if not isinstance(items,list) or len(items)>100 or len(poly)>30: raise ValueError('Plan too large')
    for it in items:
        if not isinstance(it.get('id'),str) or len(it['id'])>100 or not all(isinstance(it.get(k),(int,float)) and np.isfinite(it[k]) for k in ['x','z']): raise ValueError('Invalid item')
    if any(len(p)!=2 or not np.isfinite(p).all() for p in poly): raise ValueError('Invalid room polygon')
    return plan


class UnixHTTPServer(socketserver.ThreadingMixIn,HTTPServer):
    address_family=socket.AF_UNIX
    daemon_threads=True
    def server_bind(self):
        socketserver.TCPServer.server_bind(self)
        self.server_name='localhost'; self.server_port=0


class Handler(BaseHTTPRequestHandler):
    def log_message(self,*_): pass
    def send(self,code,payload,content='application/json'):
        raw=json.dumps(payload,allow_nan=False).encode() if content=='application/json' else payload
        self.send_response(code); self.send_header('Content-Type',content); self.send_header('Content-Length',str(len(raw))); self.end_headers(); self.wfile.write(raw)
    def do_GET(self): self.dispatch('GET')
    def do_POST(self): self.dispatch('POST')
    def dispatch(self,method):
        if not LOCK.acquire(blocking=False): return self.send(429,dict(error='GPU busy; drop this keyframe',retryMs=500))
        try:
            scans=self.server.scans
            stale=[id for id,s in scans.items() if time.monotonic()-s.last>900]
            for id in stale: del scans[id]
            if method=='GET' and self.path=='/health': return self.send(200,dict(ok=True,model=MODEL,device=torch.cuda.get_device_name(),sessions=len(scans),plants=len(self.server.detector.plants)))
            body={}
            if method=='POST':
                n=int(self.headers.get('Content-Length','0'))
                if n<2 or n>1200000: return self.send(413,dict(error='Request too large or empty'))
                body=json.loads(self.rfile.read(n))
            if method=='POST' and self.path=='/start':
                if len(scans)>=3: return self.send(429,dict(error='Three scan sessions already active; stop one first'))
                id=secrets.token_hex(12); scans[id]=Scan(id,body.get('plan',{})); return self.send(200,dict(id=id,targetFps=3,maxDimension=640,model=MODEL))
            match=re.fullmatch(r'/([0-9a-f]{24})/(frame|status|stop|splat)',self.path)
            if not match or match[1] not in scans: return self.send(404,dict(error='Scan session not found'))
            s=scans[match[1]]; action=match[2]
            if method=='GET' and action=='status': return self.send(200,s.result)
            if method=='GET' and action=='splat':
                if not s.splats.output.exists(): return self.send(409,dict(error='Splat needs depth or multiple translated views'))
                return self.send(200,s.splats.output.read_bytes(),'application/octet-stream')
            if method=='POST' and action=='stop':
                s.splats.export(); s.result['state']='stopped'
                if 'splat' in s.result: s.result['splat']['revision']=s.splats.revision
                tmp=s.dir/'latest.tmp'; tmp.write_text(json.dumps(s.result,allow_nan=False)); tmp.replace(s.dir/'latest.json')
                del scans[s.id]; return self.send(200,dict(ok=True,id=s.id,state='stopped'))
            if method=='POST' and action=='frame': return self.send(200,s.frame(body,self.server.detector))
            return self.send(405,dict(error='Method not allowed'))
        except (ValueError,KeyError,TypeError) as e: self.send(400,dict(error=str(e)[:200]))
        except Exception as e:
            import traceback; traceback.print_exc()
            self.send(500,dict(error=f'{type(e).__name__}: {str(e)[:250]}'))
        finally: LOCK.release()


def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--socket',default=str(ROOT/'work/scan-live.sock')); args=ap.parse_args()
    os.umask(0o077); DATA.mkdir(parents=True,exist_ok=True)
    detector=Detector()
    # Complete both real CUDA paths before announcing health. A first-run JIT
    # build must not occupy the first phone frame behind a 15-second proxy timeout.
    detector.detect(np.zeros((480,640,3),np.uint8))
    from gsplat import rasterization
    means=torch.tensor([[0.,0.,2.]],device='cuda',requires_grad=True)
    quats=torch.tensor([[1.,0.,0.,0.]],device='cuda')
    scales=torch.full((1,3),.05,device='cuda',requires_grad=True)
    rgb,_,_=rasterization(means,quats,scales,torch.tensor([.8],device='cuda'),torch.tensor([[.4,.7,.2]],device='cuda'),torch.eye(4,device='cuda')[None],torch.tensor([[[100.,0.,32.],[0.,100.,32.],[0.,0.,1.]]],device='cuda'),64,64)
    rgb.mean().backward(); torch.cuda.synchronize()
    del means,quats,scales,rgb
    path=Path(args.socket); path.parent.mkdir(parents=True,exist_ok=True)
    if path.exists(): path.unlink()
    server=UnixHTTPServer(str(path),Handler); path.chmod(0o600); server.detector=detector; server.scans={}
    print(json.dumps(dict(state='ready',model=MODEL,socket=str(path))),flush=True)
    try: server.serve_forever()
    finally: server.server_close(); path.unlink(missing_ok=True)


if __name__=='__main__': main()
