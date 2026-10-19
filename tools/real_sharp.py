#!/usr/bin/env python3
"""SHARP at capture intrinsics, robust metric alignment and confidence voxel fusion.

Run in the existing SHARP venv. An uncalibrated candidate is retained for diagnosis,
never published into scene.json. World axes are the planner's x/y-up/z, metres.
"""
import fcntl
import json
import math
from pathlib import Path
import sys
import time
import numpy as np
from plyfile import PlyData, PlyElement
from scipy.spatial.transform import Rotation

CHECKPOINT='$PRIVATE_DATA'
ROOT=Path(__file__).resolve().parents[1]
MAX_VIEW=450_000
MAX_SCENE=900_000


def robust_fit(x,y):
    """RANSAC followed by Huber IRLS; never hide outliers in reported residuals."""
    good=np.isfinite(x)&np.isfinite(y)&(x>.05)&(y>.05)&(x<50)&(y<40)
    x,y=x[good].astype('float64'),y[good].astype('float64')
    if len(x)<300:
        raise ValueError('Not enough depth correspondences')
    rng=np.random.default_rng(771)
    if len(x)>30000:
        idx=rng.choice(len(x),30000,replace=False);x,y=x[idx],y[idx]
    best=None
    for _ in range(140):
        a,b=rng.choice(len(x),2,replace=False)
        if abs(x[a]-x[b])<.15:continue
        scale=(y[a]-y[b])/(x[a]-x[b]);shift=y[a]-scale*x[a]
        if not .05<scale<20:continue
        residual=np.abs(scale*x+shift-y)
        score=np.mean(residual<.25)
        if best is None or score>best[0]:best=(score,scale,shift)
    if best is None:raise ValueError('No positive metric fit')
    A=np.column_stack((x,np.ones(len(x))))
    theta=np.array(best[1:])
    # Refine the consensus, not all samples: window/exterior predictions have
    # high-leverage depths and can drag even a Huber fit toward zero scale.
    consensus=np.abs(A@theta-y)<.3
    for _ in range(12):
        r=A@theta-y
        weights=np.where(consensus,np.minimum(1.,.08/np.maximum(np.abs(r),1e-6)),0.)
        theta=np.linalg.lstsq(A*weights[:,None]**.5,y*weights**.5,rcond=None)[0]
    residual=np.abs(A@theta-y)
    scale,shift=theta
    report={'scale':float(scale),'shiftM':float(shift),'samples':len(x),
            'medianM':float(np.median(residual)),'p90M':float(np.percentile(residual,90)),
            'rmseM':float(np.sqrt(np.mean(residual**2))), 'inlierFraction':float(np.mean(residual<.25))}
    report['accepted']=bool(.05<scale<20 and report['medianM']<.25 and report['p90M']<.9 and report['inlierFraction']>.55)
    return report


def ply_write(path,vertices):
    PlyData([PlyElement.describe(vertices,'vertex')],text=False).write(str(path))


def align(vertices,capture):
    w,h=capture['depth']['width'],capture['depth']['height']
    d=np.fromfile(Path(capture['_directory'])/'depth.f32',dtype='<f4').reshape(h,w)
    xyz=np.column_stack([vertices[k] for k in ('x','y','z')])
    f=h/(2*math.tan(math.radians(capture['camera']['fov'])/2))
    z=xyz[:,2]
    u=np.rint(xyz[:,0]/np.maximum(z,1e-6)*f+w/2).astype('int32')
    v=np.rint(xyz[:,1]/np.maximum(z,1e-6)*f+h/2).astype('int32')
    valid=(z>.05)&(z<50)&(u>=0)&(v>=0)&(u<w)&(v<h)&(vertices['opacity']>-2)
    inds=np.flatnonzero(valid)
    zbuffer=np.full(w*h,np.inf,dtype='float32')
    np.minimum.at(zbuffer,v[inds]*w+u[inds],z[inds])
    # Avoid procedural discontinuities; their image correspondence is ambiguous.
    dx=np.abs(d-np.roll(d,1,axis=1));dy=np.abs(d-np.roll(d,1,axis=0))
    good=np.isfinite(zbuffer)&(d.ravel()>.1)&(d.ravel()<35)&((dx+dy).ravel()<.15)
    # A procedural window is a flat glass proxy, not measured depth of the trees
    # visible outside in the generated photograph. Never calibrate against it.
    layout=json.loads((Path(capture['_directory'])/'layout.json').read_text())
    room=layout['room'];window=room.get('window')
    excluded=0;glass=np.zeros((h,w),dtype=bool)
    if window:
        matrix=np.array(capture['camera']['matrixWorld']).reshape(4,4,order='F')
        yy,xx=np.mgrid[:h,:w]
        local=np.stack(((xx-w/2)/f*d,-(yy-h/2)/f*d,-d),axis=-1)
        world=local@matrix[:3,:3].T+matrix[:3,3]
        edge=window['edge'];p=np.array(room['poly'][edge]);q=np.array(room['poly'][(edge+1)%len(room['poly'])]);direction=(q-p)/np.linalg.norm(q-p)
        delta=world[:,:,[0,2]]-p;along=delta@direction
        wallDist=np.abs(delta[:,:,0]*direction[1]-delta[:,:,1]*direction[0])
        glass=(wallDist<.16)&(along>window['t0']-.04)&(along<window['t1']+.04)&(world[:,:,1]>window['sill']-.04)&(world[:,:,1]<window['top']+.04)
        excluded=int((good&glass.ravel()).sum());good&=~glass.ravel()
    fit=robust_fit(zbuffer[good],d.ravel()[good]);fit['excludedWindowPixels']=excluded
    fit['scope']='All valid low-gradient room surfaces excluding transparent window/exterior depth proxy'
    if not fit['accepted']:
        return None,fit
    a,b=fit['scale'],fit['shiftM']
    # Only reliable points near the metric procedural surface enter the fused scene.
    proc=d[v[inds],u[inds]]
    err=np.abs(a*z[inds]+b-proc)
    is_window=glass[v[inds],u[inds]] if window else np.zeros(len(inds),dtype=bool)
    # Bounded residual depth anchoring reduces double surfaces between independently
    # generated views. Transparent window colour lives on the known glass proxy;
    # it does not claim a reconstructed outdoor world.
    confidence=np.exp(-np.where(is_window,0,err)/.35)*(1/(1+np.exp(-vertices['opacity'][inds])))
    confidence*=1/(1+(xyz[inds,0]/z[inds])**2+(xyz[inds,1]/z[inds])**2)
    keep=(proc>.05)&(proc<35)&(a*z[inds]+b>.05)&((err<.65)|is_window)
    inds,confidence,proc,is_window=inds[keep],confidence[keep],proc[keep],is_window[keep]
    # Spatially stratified retained sample, not the first raster rows.
    if len(inds)>MAX_VIEW:
        rng=np.random.default_rng(22)
        p=np.maximum(confidence,.001);p=p/p.sum()
        choice=rng.choice(len(inds),MAX_VIEW,replace=False,p=p)
        inds,confidence,proc,is_window=inds[choice],confidence[choice],proc[choice],is_window[choice]
    out=vertices[inds].copy();xyz=xyz[inds].astype('float64');z=xyz[:,2]
    weight=np.where(is_window,1.,.65)
    effective_a=(1-weight)*a
    effective_b=(1-weight)*b+weight*proc
    ratio=effective_a+effective_b/z
    local=xyz*ratio[:,None]
    # Non-uniform depth correction changes covariance, not only Gaussian centres.
    J=np.zeros((len(out),3,3));J[:,0,0]=ratio;J[:,1,1]=ratio;J[:,2,2]=np.maximum(effective_a,.02)
    J[:,0,2]=-effective_b*xyz[:,0]/z**2;J[:,1,2]=-effective_b*xyz[:,1]/z**2
    quats=np.column_stack([out[f'rot_{i}'] for i in (1,2,3,0)])
    rot=Rotation.from_quat(quats).as_matrix()
    scales=np.exp(np.column_stack([out[f'scale_{i}'] for i in range(3)]).clip(-15,3))
    cov=(rot*scales[:,None,:]**2)@rot.transpose(0,2,1)
    matrix=np.array(capture['camera']['matrixWorld']).reshape(4,4,order='F')
    worldrot=matrix[:3,:3]@np.diag([1,-1,-1]) # OpenCV -> Three camera
    cov=worldrot@(J@cov@J.transpose(0,2,1))@worldrot.T
    vals,vecs=np.linalg.eigh(cov)
    vecs[:,:,2]*=np.linalg.det(vecs)[:,None]
    q=Rotation.from_matrix(vecs).as_quat()
    world=local@worldrot.T+matrix[:3,3]
    for i,k in enumerate(('x','y','z')):out[k]=world[:,i]
    for i in range(3):out[f'scale_{i}']=np.log(np.sqrt(vals[:,i].clip(1e-12)))
    for i,j in enumerate((3,0,1,2)):out[f'rot_{i}']=q[:,j]
    fit.update(retained=len(out),meanConfidence=float(confidence.mean()),residualAnchorWeight=.65,
               windowUsesGlassProxy=True,postAnchorMedianM=float(np.median(np.abs(local[:,2]-proc))))
    return (out,confidence),fit


def write_splat(path,points):
    """32-byte standard .splat for bounded mobile transfer (SH degree zero)."""
    dtype=np.dtype([('pos','<f4',(3,)),('scale','<f4',(3,)),('color','u1',(4,)),('quat','u1',(4,))])
    packed=np.empty(len(points),dtype=dtype)
    packed['pos']=np.column_stack([points[k] for k in ('x','y','z')])
    packed['scale']=np.exp(np.column_stack([points[f'scale_{i}'] for i in range(3)]))
    packed['color'][:,:3]=np.clip((.5+.28209479177387814*np.column_stack([points[f'f_dc_{i}'] for i in range(3)]))*255,0,255).astype('u1')
    packed['color'][:,3]=(255/(1+np.exp(-points['opacity'].clip(-20,20)))).astype('u1')
    packed['quat']=np.clip(128+128*np.column_stack([points[f'rot_{i}'] for i in range(4)]),0,255).astype('u1')
    packed.tofile(path)


def fuse(directory):
    t=time.perf_counter();parent=directory.parent
    with open(parent/'fusion.lock','w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        batches=[];weights=[];views=[]
        for d in sorted(parent.iterdir()):
            if not (d/'aligned.ply').exists():continue
            report=json.loads((d/'alignment.json').read_text())
            if not report.get('accepted'):continue
            points=PlyData.read(str(d/'aligned.ply'))['vertex'].data.copy()
            batches.append(points);weights.append(np.load(d/'confidence.npy'));views.append(d.name)
        if not batches:return None
        points=np.concatenate(batches);score=np.concatenate(weights)
        xyz=np.column_stack([points[k] for k in ('x','y','z')])
        # Best depth-consistent source per 4 mm room voxel. Quantized confidence,
        # then deterministic view ordering keeps cache rebuilds reproducible.
        voxel=np.floor(xyz/.004).astype('int32')
        order=np.argsort(-score,kind='stable')
        _,first=np.unique(voxel[order],axis=0,return_index=True)
        chosen=order[first]
        if len(chosen)>MAX_SCENE:chosen=chosen[np.argsort(-score[chosen])[:MAX_SCENE]]
        points=points[chosen]
        version='-'.join(views)
        import hashlib
        tag=hashlib.sha256(version.encode()+points.tobytes()).hexdigest()[:12]
        name=f'fused-{tag}.splat';ply_write(parent/f'fused-{tag}.ply',points)
        write_splat(parent/(name+'.tmp'),points);(parent/(name+'.tmp')).replace(parent/name)
        scene={'revision':parent.name,'views':views,'count':len(points),'limit':MAX_SCENE,
               'bytes':(parent/name).stat().st_size,'url':f'/renders/real/{parent.name}/{name}',
               'seconds':round(time.perf_counter()-t,3),'dedupVoxelM':.004,'created':time.time()}
        tmp=parent/'scene.json.tmp';tmp.write_text(json.dumps(scene));tmp.replace(parent/'scene.json')
        return scene


def main():
    d=Path(sys.argv[1]).resolve()
    if '--fuse-only' in sys.argv:
        print(json.dumps(fuse(d)));return
    import torch
    from PIL import Image
    from sharp.models import create_predictor,PredictorParams
    from sharp.cli.predict import predict_image
    from sharp.utils.gaussians import save_ply
    c=json.loads((d/'capture.json').read_text());c['_directory']=str(d)
    timings={};start=time.perf_counter()
    if '--align-only' in sys.argv:
        timings=json.loads((d/'alignment.json').read_text()).get('timings',{}) if (d/'alignment.json').exists() else {}
    else:
        with open(ROOT/'work/real-gpu.lock','w') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX)
            admitted=time.perf_counter()
            free,_=torch.cuda.mem_get_info()
            if free<5_500_000_000:raise RuntimeError('SHARP requires 5.5 GB free VRAM; scan worker left untouched')
            predictor=create_predictor(PredictorParams())
            predictor.load_state_dict(torch.load(CHECKPOINT,weights_only=True,map_location='cpu'));predictor.eval().to('cuda')
            loaded=time.perf_counter()
            image=np.asarray(Image.open(d/'real.png').convert('RGB'))
            h,w=image.shape[:2];f=h/(2*math.tan(math.radians(c['camera']['fov'])/2))
            gaussians=predict_image(predictor,image,f,torch.device('cuda'))
            torch.cuda.synchronize();inferred=time.perf_counter()
            save_ply(gaussians,f,(h,w),d/'sharp.ply')
            del gaussians,predictor;torch.cuda.empty_cache()
        timings.update(gpuQueueMs=(admitted-start)*1000,sharpLoadMs=(loaded-admitted)*1000,sharpInferenceMs=(inferred-loaded)*1000,sharpMs=(time.perf_counter()-start)*1000)
    t=time.perf_counter()
    vertices=PlyData.read(str(d/'sharp.ply'))['vertex'].data
    result,report=align(vertices,c)
    timings['alignmentMs']=(time.perf_counter()-t)*1000
    report['timings']=timings
    (d/'alignment.json').write_text(json.dumps(report,indent=2))
    if result is not None:
        points,confidence=result
        ply_write(d/'aligned.ply',points);np.save(d/'confidence.npy',confidence)
        report['scene']=fuse(d)
    if '--align-only' in sys.argv:
        state=json.loads((d/'status.json').read_text())
        state.update(state='ready' if report['accepted'] else 'alignment-rejected',alignment=report,
                     timings=state.get('timings',{})|timings)
        tmp=d/'status.realign.tmp';tmp.write_text(json.dumps(state));tmp.replace(d/'status.json')
    print(json.dumps(report))


if __name__=='__main__':main()
