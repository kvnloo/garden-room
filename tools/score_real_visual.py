#!/usr/bin/env python3
"""Private visual evidence scorer. HQ is a generated target, NOT ground-truth reality.
Run with ComfyUI Python: tools/score_real_visual.py ARTIFACT_DIR [--judge]
Never generates images. ChatGPT judge is opt-in, cached, max one call per pose.
"""
import argparse, hashlib, json, math, os, subprocess, sys
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from skimage.metrics import structural_similarity
import torch
import lpips
ROOT=Path(__file__).resolve().parents[1]

def image(p,size=None):
    im=Image.open(p).convert('RGB')
    if size:im=im.resize(size,Image.Resampling.LANCZOS)
    return np.asarray(im)

def ids(p):
    a=np.asarray(Image.open(p).convert('RGB')).astype('int32')
    return a[:,:,0]+256*a[:,:,1]+65536*a[:,:,2]

def plant_support(rgb,labels,objects):
    hsv=cv2.cvtColor(rgb,cv2.COLOR_RGB2HSV)
    green=(hsv[:,:,0]>22)&(hsv[:,:,0]<100)&(hsv[:,:,1]>35)&(hsv[:,:,2]>25)
    checks=[]
    for obj in objects:
        if obj.get('kind')!='plant':continue
        mask=(labels==obj['label']).astype('uint8');area=int(mask.sum())
        if area<20:continue
        ys,xs=np.where(mask);region=cv2.dilate(mask,np.ones((17,17),dtype='uint8'))>0
        support=float(green[region].mean());gys,gxs=np.where(green&region)
        checks.append({'id':obj['id'],'pixels':area,'bbox':[int(xs.min()),int(ys.min()),int(xs.max()),int(ys.max())],
                       'greenSupport':support,'supported':support>.025,
                       'supportCentroidErrorPx':float(math.hypot(gxs.mean()-xs.mean(),gys.mean()-ys.mean())) if len(gxs) else None})
    return {'method':'item-ID expected positions + green-support proxy; NOT a semantic plant detector',
            'expectedVisible':len(checks),'supported':sum(c['supported'] for c in checks),'objects':checks}

def depth_score(points,camera,proc):
    h,w=proc.shape;m=np.array(camera['matrixWorld']).reshape(4,4,order='F')
    local=(points-m[:3,3])@m[:3,:3];z=-local[:,2]
    f=h/(2*math.tan(math.radians(camera['fov'])/2));fx=w/(2*math.tan(math.radians(camera['fov'])/2)*camera['aspect'])
    # Raster coordinates have pixel centres at n+.5; floor selects that pixel.
    u=np.floor(local[:,0]/np.maximum(z,1e-6)*fx+w/2).astype('int32')
    v=np.floor(-local[:,1]/np.maximum(z,1e-6)*f+h/2).astype('int32')
    good=(z>.05)&(u>=0)&(v>=0)&(u<w)&(v<h)
    projected=np.full(h*w,np.inf,dtype='float32');np.minimum.at(projected,v[good]*w+u[good],z[good]);projected=projected.reshape(h,w)
    valid=np.isfinite(projected)&(proc>.05);delta=np.abs(projected[valid]-proc[valid])
    return {'method':'nearest projected Gaussian-centre Z, not alpha-composited rendered depth',
            'samples':int(valid.sum()),'coverageFraction':float(valid.sum()/max(1,(proc>.05).sum())),
            'medianM':float(np.median(delta)) if len(delta) else None,'p90M':float(np.percentile(delta,90)) if len(delta) else None}

def score(out,judge=False):
    torch.set_num_threads(4)
    metric=lpips.LPIPS(net='alex',verbose=False).eval()
    records=json.loads((out/'records.json').read_text());rows=[];tiles=[]
    assert len(records)==6,'Expected all six fixed poses'
    for record in records:
        d=out/record['name'];cap=json.loads((d/'capture.json').read_text());w,h=cap['depth']['width'],cap['depth']['height']
        if not (d/'real.png').exists():
            rows.append({'pose':record['name'],'error':'HQ unavailable','status':record.get('view',{}).get('status')});continue
        reference=image(d/'real.png',(w,h));labels=ids(d/'ids.png');proc=np.fromfile(d/'depth.f32',dtype='<f4').reshape(h,w)
        imgs=[('procedural','procedural.jpg'),('preview','preview.png'),('HQ target','real.png')]
        if (d/'photo-pinned.png').exists():imgs.append(('pinned photo','photo-pinned.png'))
        imgs += [(f'splat {deg}°',f'splat-{deg}.png') for deg in [0,5,15,30]]
        points=None
        scene=Path(record.get('sceneLocal','/nonexistent'))
        if not scene.exists():
            url=(record.get('view',{}).get('status',{}).get('splat',{}).get('fine') or record.get('scene') or {}).get('url')
            if url:
                source=ROOT/'data'/url.lstrip('/')
                if source.exists():
                    import shutil
                    scene=out/source.name
                    if not scene.exists():shutil.copyfile(source,scene)
        if scene.exists():points=np.fromfile(scene,dtype=np.dtype([('pos','<f4',(3,)),('rest','u1',(20,))]))['pos']
        row={'pose':record['name'],'timings':record.get('view',{}).get('status',{}).get('timings'),
             'alignment':json.loads((d/'alignment.json').read_text()) if (d/'alignment.json').exists() else None,'images':{}}
        tile=Image.new('RGB',(len(imgs)*206,500),(18,22,18));draw=ImageDraw.Draw(tile);draw.text((8,4),record['name'],fill='white')
        for i,(name,filename) in enumerate(imgs):
            p=d/filename
            if not p.exists():draw.text((i*206+4,40),'Unavailable',fill='white');continue
            rgb=image(p,(w,h));a=rgb.astype('float32')/255;b=reference.astype('float32')/255
            mse=float(np.mean((a-b)**2));ssim=float(structural_similarity(rgb,reference,data_range=255,channel_axis=2))
            # Compare neural features at reduced phone-like resolution on CPU.
            small=cv2.resize(a,(192,424));target=cv2.resize(b,(192,424))
            tensor=lambda x:torch.from_numpy(x.copy()).permute(2,0,1).unsqueeze(0)*2-1
            with torch.no_grad():distance=float(metric(tensor(small),tensor(target)).item())
            geom=proc>.05;black=np.max(rgb,axis=2)<24
            result={'psnrDb':float(-10*np.log10(mse)) if mse>0 else None,'identicalToTarget':mse==0,'ssim':ssim,'lpipsAlex':distance,
                    'blackHoleFraction':float((black&geom).sum()/max(1,geom.sum())),
                    'blackThreshold':24,'comparedTo':'generated HQ at capture pose; offset comparisons are drift diagnostics, NOT novel-view ground truth'}
            offset=next((s for s in record.get('shots',[]) if name==f"splat {s['degrees']}°"),None)
            local_labels=labels
            if offset:
                deg=offset['degrees'];pd=d/f'offset-{deg}-depth.f32';pi=d/f'offset-{deg}-ids.png'
                if pi.exists():local_labels=ids(pi)
                if pd.exists():
                    offset_proc=np.fromfile(pd,dtype='<f4').reshape(h,w)
                    result['blackHoleFraction']=float((black&(offset_proc>.05)).sum()/max(1,(offset_proc>.05).sum()))
                    if points is not None:result['depth']=depth_score(points,offset['camera'],offset_proc)
            result['plantPositionSupport']=plant_support(rgb,local_labels,cap['objects'])
            row['images'][name]=result
            thumb=Image.fromarray(rgb);thumb.thumbnail((202,445));tile.paste(thumb,(i*206+2,40))
            caption=f"{name}\nSSIM {ssim:.3f} LP {distance:.3f}\nholes {result['blackHoleFraction']:.1%}"
            draw.multiline_text((i*206+3,488-37),caption,fill='white',spacing=1)
        tile.save(d/'contact.jpg',quality=90);tiles.append(tile)
        if judge:
            cache=d/'judge.json'
            if not cache.exists():
                env={k:v for k,v in os.environ.items() if k not in ('PYTHONPATH','PYTHONHOME')}
                refs=ROOT/'work/cutouts_sheet2.jpg'
                expected=plant_support(reference,labels,cap['objects'])['objects']
                names={it['id']:it.get('name',it['id']) for it in cap['layout']['items']}
                inventory=[{'id':p['id'],'name':names.get(p['id']),'bboxNormalized':[round(p['bbox'][0]/w,3),round(p['bbox'][1]/h,3),round(p['bbox'][2]/w,3),round(p['bbox'][3]/h,3)]} for p in expected]
                brief=('Override the default single plant task: Image 1 is the owner plant/pot inventory; Image 2 is a labelled sheet of one camera pose. Columns left to right: '+', '.join(name for name,_ in imgs)+'. An unavailable preview means it was removed from the default path, not a black rendered image. Pinned photo is the unchanged cached generated HQ overlay, not improved generation. Judge each available column separately: realism 0-10 and faithfulness 0-10 to inventory and procedural layout; diagnose holes, invented pot patterns, pink smears, softness and double edges. Reply JSON with score, columns:[{name,realism,faithfulness,estimatedVisiblePlants,missingIds,uncertainty}], matches, fixes. Count only when discernible; say uncertain rather than inventing exact counts. Do not treat generated HQ as ground truth. Note top/overview intentionally show cutaways. Expected item-ID visible plant inventory and normalized capture-position boxes: '+json.dumps(inventory))
                cmd=[sys.executable,str(ROOT/'tools/judge.py'),str(refs),str(d/'contact.jpg'),'--brief',brief]
                done=subprocess.run(cmd,capture_output=True,text=True,env=env,timeout=550)
                (d/'judge.stderr.txt').write_text(done.stderr)
                if done.returncode:row['judgeError']=done.stderr[-2000:]
                else:
                    try:cache.write_text(json.dumps(json.loads(done.stdout),indent=2))
                    except ValueError:(d/'judge.invalid.txt').write_text(done.stdout);row['judgeError']='No valid JSON verdict'
            if cache.exists():row['judge']=json.loads(cache.read_text())
        rows.append(row)
        (out/'metrics.json').write_text(json.dumps({'methodNotes':['HQ is generated, not real ground truth','Offset photo comparisons conflate expected parallax and defects','Black threshold can include legitimately dark furniture; conservative diagnostic, not true alpha coverage','Plant ID pass supplies expected count/positions; colour support does NOT certify count/species','Depth is projected Gaussian-centre depth, not renderer depth'], 'poses':rows},indent=2,allow_nan=False))
        print(record['name'], {k:{m:round(v[m],3) if v[m] is not None else None for m in ['psnrDb','ssim','lpipsAlex','blackHoleFraction']} for k,v in row['images'].items()},flush=True)
    if tiles:
        sheet=Image.new('RGB',(tiles[0].width,sum(t.height for t in tiles)),(18,22,18));y=0
        for tile in tiles:sheet.paste(tile,(0,y));y+=tile.height
        sheet.save(out/'contact-sheet.jpg',quality=90)
    return rows

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('directory',type=Path);parser.add_argument('--judge',action='store_true');args=parser.parse_args();score(args.directory,args.judge)
