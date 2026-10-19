#!/usr/bin/env python3
"""Research-only SHARP camera lift, metric alignment and progressive single views.

Run in the existing SHARP venv. An uncalibrated candidate is retained for diagnosis,
never published into scene.json. World axes are the planner's x/y-up/z, metres.
Apple AMLR weights exclude product development/commercial products. NOT production safe.
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
COARSE_VIEW=50_000
LICENSE = 'Apple SHARP AMLR weights: research-only; product development/commercial use excluded'
WALK_VALIDITY = {'angleDeg': 15, 'distanceM': .3}
WINDOW_DEPTH_TOLERANCE = .025


def quality_filter(points, confidence, focal, depths=None):
    """Reject transparent, weak, stretched, nonfinite and oversized Gaussians."""
    xyz = np.column_stack([points[k] for k in ('x', 'y', 'z')])
    logscale = np.column_stack([points[f'scale_{i}'] for i in range(3)])
    quat = np.column_stack([points[f'rot_{i}'] for i in range(4)])
    colors = np.column_stack([points[f'f_dc_{i}'] for i in range(3)])
    z = xyz[:, 2] if depths is None else np.asarray(depths)
    scales = np.exp(logscale.clip(-20, 10))
    finite = (np.isfinite(xyz).all(axis=1) & np.isfinite(logscale).all(axis=1)
              & np.isfinite(quat).all(axis=1) & np.isfinite(colors).all(axis=1)
              & np.isfinite(points['opacity']) & np.isfinite(confidence) & (np.linalg.norm(quat, axis=1) > 1e-6))
    checks = {'nonfinite': finite, 'opacity': points['opacity'] >= math.log(.12/.88),
              'confidence': confidence >= .08,
              'stretch': scales.max(axis=1)/np.maximum(scales.min(axis=1), 1e-9) <= 30,
              'projectedSize': (z > .05) & (focal*scales.max(axis=1)/np.maximum(z, .001) <= 24)}
    keep = np.logical_and.reduce(list(checks.values()))
    return keep, {'input': len(points), 'retained': int(keep.sum()),
                  'rejectedByReason': {key: int((~value).sum()) for key, value in checks.items()},
                  'thresholds': {'minOpacity': .12, 'minConfidence': .08, 'maxStretch': 30, 'maxProjectedSigmaPx': 24}}


def residual_stats(residual):
    residual = np.abs(np.asarray(residual))
    if not len(residual): return {'samples': 0, 'medianM': None, 'p90M': None, 'rmseM': None}
    return {'samples': len(residual), 'medianM': float(np.median(residual)),
            'p90M': float(np.percentile(residual, 90)), 'rmseM': float(np.sqrt(np.mean(residual**2)))}


def region_correction(predicted, target, good, width, height, grid=8):
    """Bounded robust medians per image region, learned only on known room depth."""
    yy, xx = np.mgrid[:height, :width]
    region = (yy*grid//height)*grid+(xx*grid//width)
    offsets = np.zeros(grid*grid, dtype='float64')
    regions = []
    for i in range(grid*grid):
        sample = (target-predicted)[good & (region.ravel() == i)]
        if len(sample) < 8: continue
        median = float(np.median(sample))
        mad = float(np.median(np.abs(sample-median)))
        consensus = sample[np.abs(sample-median) <= max(.04, 3*1.4826*mad)]
        offsets[i] = np.clip(np.median(consensus), -.2, .2)
        regions.append({'row': i//grid, 'column': i%grid, 'samples': len(sample),
                        'offsetM': float(offsets[i]), 'madM': mad})
    return offsets[region], {'method': 'bounded per-region robust median residual; same-view surface anchoring',
                              'grid': [grid, grid], 'maxCorrectionM': .2, 'regions': regions}


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


def window_proxy(dtype,capture,depth,mask,focal):
    """Reproject HQ pixels onto the bounded, known window plane, never outdoors."""
    from PIL import Image
    directory=Path(capture['_directory'])
    if not (directory/'real.png').is_file() or not mask.any():return np.empty(0,dtype=dtype)
    room=json.loads((directory/'layout.json').read_text())['room'];window=room['window']
    p=np.asarray(room['poly'][window['edge']],dtype='float64')
    q=np.asarray(room['poly'][(window['edge']+1)%len(room['poly'])],dtype='float64')
    direction=(q-p)/np.linalg.norm(q-p)
    normal=np.array([-direction[1],0,direction[0]])
    matrix=np.asarray(capture['camera']['matrixWorld']).reshape(4,4,order='F')
    height,width=depth.shape
    if (directory/'ids.png').is_file():
        ids=np.asarray(Image.open(directory/'ids.png').convert('RGB'))
        # Every nonzero item-ID is foreground inventory, including foliage that
        # touches the glass. It must never be painted again on the window plane.
        mask=mask & (ids[:,:,:3]==0).all(axis=2)
    step=max(1,math.ceil(math.sqrt(int(mask.sum())/20000)))
    yy,xx=np.mgrid[:height:step,:width:step]
    valid=mask[yy,xx]
    yy,xx=yy[valid],xx[valid]
    rays=np.column_stack(((xx+.5-width/2)/focal,-(yy+.5-height/2)/focal,-np.ones(len(xx))))@matrix[:3,:3].T
    denominator=rays@normal
    origin=matrix[:3,3]
    plane=np.array([p[0],0,p[1]])
    t=np.divide((plane-origin)@normal,denominator,out=np.full(len(xx),np.nan),where=np.abs(denominator)>1e-6)
    world=origin+rays*t[:,None]
    along=(world[:,[0,2]]-p)@direction
    keep=(np.isfinite(world).all(axis=1)&(t>.05)&(t<35)&(np.abs(t-depth[yy,xx])<WINDOW_DEPTH_TOLERANCE)
          &(along>=window['t0'])&(along<=window['t1'])&(world[:,1]>=window['sill'])&(world[:,1]<=window['top']))
    world,t,xx,yy=world[keep],t[keep],xx[keep],yy[keep]
    result=np.zeros(len(world),dtype=dtype)
    for i,k in enumerate(('x','y','z')):result[k]=world[:,i]
    rgb=np.asarray(Image.open(directory/'real.png').convert('RGB').resize((width,height)))[yy,xx]
    for i in range(3):result[f'f_dc_{i}']=(rgb[:,i]/255-.5)/.28209479177387814
    result['opacity']=4.6
    sigma=np.maximum(t/focal*step*.85,.001)
    for i in (0,1):result[f'scale_{i}']=np.log(sigma)
    result['scale_2']=np.log(np.maximum(sigma/15,.0001))
    horizontal=np.array([direction[0],0,direction[1]])
    vertical=np.array([0,1,0])
    basis=np.column_stack((horizontal,vertical,np.cross(horizontal,vertical)))
    quat=Rotation.from_matrix(basis).as_quat()
    for i,j in enumerate((3,0,1,2)):result[f'rot_{i}']=quat[j]
    return result


def stratified_indices(points,limit):
    """Deterministic spatial round-robin; coarse points are a subset of fine."""
    if len(points)<=limit:return np.arange(len(points))
    xyz=np.column_stack([points[k] for k in ('x','y','z')]).astype('float64')
    low=xyz.min(axis=0);span=np.maximum(xyz.max(axis=0)-low,1e-6)
    cells=np.floor((xyz-low)/span*15).astype('int64').clip(0,15)
    key=cells[:,0]+16*cells[:,1]+256*cells[:,2]
    # Rank within each cell, then visit every occupied cell before a second point.
    ordered=np.argsort(key,kind='stable')
    sorted_key=key[ordered]
    starts=np.maximum.accumulate(np.where(np.r_[True,sorted_key[1:]!=sorted_key[:-1]],np.arange(len(points)),0))
    rank=np.arange(len(points))-starts
    round_robin=np.lexsort((sorted_key,rank))
    return ordered[round_robin[:limit]]


def update_status(directory,**fields):
    path=directory/'status.json'
    state=json.loads(path.read_text()) if path.exists() else {}
    state.update(fields)
    tmp=directory/'status.sharp.tmp';tmp.write_text(json.dumps(state));tmp.replace(path)


def publish_progressive(directory,points,coarse_limit=COARSE_VIEW):
    """Publish coarse first, then fine, with no implicit multi-source fusion."""
    if (directory/'deleted.json').exists():return None
    if len(points)>MAX_VIEW:points=points[stratified_indices(points,MAX_VIEW)]
    metadata={'source':directory.name,'sources':[directory.name],'mode':'single-view',
              'license':LICENSE,'productionSafe':False,'walkValidity':WALK_VALIDITY.copy()}
    for stage,subset in [('coarse',points[stratified_indices(points,coarse_limit)]),('fine',points)]:
        if (directory/'deleted.json').exists():return None
        path=directory/(stage+'.splat')
        tmp=directory/(stage+'.splat.tmp');write_splat(tmp,subset);tmp.replace(path)
        metadata[stage]={'url':f'/renders/real/{directory.parent.name}/{directory.name}/{path.name}',
                         'count':len(subset),'bytes':path.stat().st_size}
        update_status(directory,splat=metadata.copy())
        # Keep legacy scene consumers usable while advertising exactly one source.
        scene={'revision':directory.parent.name,'views':[directory.name],**metadata[stage],
               'splat':metadata.copy(),'productionSafe':False,'license':LICENSE,
               'walkValidity':WALK_VALIDITY.copy(),'created':time.time()}
        with open(directory.parent/'publication.lock','a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX)
            if (directory/'deleted.json').exists():return None
            tmp=directory.parent/'scene.single.tmp';tmp.write_text(json.dumps(scene));tmp.replace(directory.parent/'scene.json')
    return metadata


def align(vertices,capture):
    w,h=capture['depth']['width'],capture['depth']['height']
    d=np.fromfile(Path(capture['_directory'])/'depth.f32',dtype='<f4').reshape(h,w)
    xyz=np.column_stack([vertices[k] for k in ('x','y','z')])
    f=h/(2*math.tan(math.radians(capture['camera']['fov'])/2))
    z=xyz[:,2]
    # Nonfinite predictions are rejected before integer projection or covariance math.
    projected_x=np.nan_to_num(xyz[:,0]/np.maximum(z,1e-6)*f+w/2, nan=-1, posinf=-1, neginf=-1)
    projected_y=np.nan_to_num(xyz[:,1]/np.maximum(z,1e-6)*f+h/2, nan=-1, posinf=-1, neginf=-1)
    u=np.rint(projected_x.clip(-1, w)).astype('int32')
    v=np.rint(projected_y.clip(-1, h)).astype('int32')
    quality,input_filters=quality_filter(vertices,np.ones(len(vertices)),f)
    valid=quality&(z>.05)&(z<50)&(u>=0)&(v>=0)&(u<w)&(v<h)
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
        local=np.stack(((xx+.5-w/2)/f*d,-(yy+.5-h/2)/f*d,-d),axis=-1)
        world=local@matrix[:3,:3].T+matrix[:3,3]
        edge=window['edge'];p=np.array(room['poly'][edge]);q=np.array(room['poly'][(edge+1)%len(room['poly'])]);direction=(q-p)/np.linalg.norm(q-p)
        delta=world[:,:,[0,2]]-p;along=delta@direction
        wallDist=np.abs(delta[:,:,0]*direction[1]-delta[:,:,1]*direction[0])
        glass=(wallDist<WINDOW_DEPTH_TOLERANCE)&(along>window['t0']-.04)&(along<window['t1']+.04)&(world[:,:,1]>window['sill']-.04)&(world[:,:,1]<window['top']+.04)
        if (Path(capture['_directory'])/'ids.png').is_file():
            from PIL import Image
            ids=np.asarray(Image.open(Path(capture['_directory'])/'ids.png').convert('RGB'))
            glass &= (ids[:,:,:3]==0).all(axis=2)
        excluded=int((good&glass.ravel()).sum());good&=~glass.ravel()
    try:
        fit=robust_fit(zbuffer[good],d.ravel()[good])
    except ValueError as exc:
        return None, {'accepted': False, 'error': str(exc), 'filters': {'input': input_filters},
                      'productionSafe': False, 'license': LICENSE}
    fit['excludedWindowPixels']=excluded
    fit.update(productionSafe=False,license=LICENSE,walkValidity=WALK_VALIDITY.copy(),filters={'input':input_filters})
    fit['preCorrection']=residual_stats(fit['scale']*zbuffer[good]+fit['shiftM']-d.ravel()[good])
    fit['preCorrection'].update(scope='global metric fit on calibration correspondences, not held-out accuracy',independentAccuracy=False)
    fit['scope']='All valid low-gradient room surfaces excluding transparent window/exterior depth proxy'
    if not fit['accepted']:
        return None,fit
    a,b=fit['scale'],fit['shiftM']
    predicted=a*zbuffer.astype('float64')+b
    correction,correction_report=region_correction(predicted,d.ravel(),good,w,h)
    fit['residualCorrection']=correction_report
    # Only reliable points near the metric procedural surface enter the fused scene.
    proc=d[v[inds],u[inds]]
    local_b=b+correction[v[inds],u[inds]]
    err=np.abs(a*z[inds]+local_b-proc)
    is_window=glass[v[inds],u[inds]] if window else np.zeros(len(inds),dtype=bool)
    # Bounded residual depth anchoring reduces double surfaces between independently
    # generated views. Transparent window colour lives on the known glass proxy;
    # it does not claim a reconstructed outdoor world.
    confidence=np.exp(-np.where(is_window,0,err)/.35)*(1/(1+np.exp(-vertices['opacity'][inds])))
    confidence*=1/(1+(xyz[inds,0]/z[inds])**2+(xyz[inds,1]/z[inds])**2)
    keep=(proc>.05)&(proc<35)&(a*z[inds]+local_b>.05)&((err<.65)|is_window)&(confidence>=.08)
    inds,confidence,proc,is_window,local_b=inds[keep],confidence[keep],proc[keep],is_window[keep],local_b[keep]
    if len(inds)>MAX_VIEW:
        choice=stratified_indices(vertices[inds],MAX_VIEW)
        inds,confidence,proc,is_window,local_b=inds[choice],confidence[choice],proc[choice],is_window[choice],local_b[choice]
    if not len(inds):
        fit.update(accepted=False,error='No reliable Gaussians survived filtering')
        return None,fit
    out=vertices[inds].copy();xyz=xyz[inds].astype('float64');z=xyz[:,2]
    weight=np.where(is_window,1.,.65)
    effective_a=(1-weight)*a
    effective_b=(1-weight)*local_b+weight*proc
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
    final_keep,output_filters=quality_filter(out,confidence,f,depths=local[:,2])
    fit['filters']['output']=output_filters
    # Report on the same calibration pixels as the pre-correction metric. These
    # post values include procedural anchoring and cannot establish accuracy.
    corrected=predicted[good]+correction.ravel()[good]
    anchored=.35*corrected+.65*d.ravel()[good]
    fit['postCorrection']=residual_stats(anchored-d.ravel()[good])
    fit['postCorrection'].update(scope='same calibration pixels after regional correction and procedural anchoring',independentAccuracy=False)
    out,confidence=out[final_keep],confidence[final_keep]
    proxy=window_proxy(vertices.dtype,capture,d,glass,f) if window else np.empty(0,dtype=vertices.dtype)
    if len(proxy):
        out=np.concatenate([out,proxy]);confidence=np.concatenate([confidence,np.full(len(proxy),.8)])
    fit.update(retained=len(out),meanConfidence=float(confidence.mean()) if len(confidence) else 0,residualAnchorWeight=.65,
               windowUsesGlassProxy=bool(window),windowProxyCount=len(proxy),
               windowProxy={'surface':'known bounded window plane','source':'HQ photo only',
                            'depthToleranceM':WINDOW_DEPTH_TOLERANCE,'foregroundItemIdsExcluded':True},
               postAnchorMedianM=fit['postCorrection']['medianM'])
    if not len(out):fit.update(accepted=False,error='No reliable output Gaussians')
    return ((out,confidence) if len(out) else None),fit


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
            if d.is_symlink() or (d/'deleted.json').exists() or not (d/'aligned.ply').exists():continue
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
               'seconds':round(time.perf_counter()-t,3),'dedupVoxelM':.004,'created':time.time(),
               'productionSafe':False,'license':LICENSE,'walkValidity':WALK_VALIDITY.copy()}
        # Deletion and both publishers serialize their final manifest update.
        with open(parent/'publication.lock','a') as publication:
            fcntl.flock(publication,fcntl.LOCK_EX)
            if any((parent/view/'deleted.json').exists() for view in views):return None
            tmp=parent/'scene.json.tmp';tmp.write_text(json.dumps(scene));tmp.replace(parent/'scene.json')
        return scene


def main():
    d=Path(sys.argv[1]).resolve()
    if '--fuse-only' in sys.argv:
        print(json.dumps(fuse(d)));return
    if (d/'deleted.json').exists():return
    c=json.loads((d/'capture.json').read_text());c['_directory']=str(d)
    timings={};start=time.perf_counter()
    if '--align-only' in sys.argv:
        timings=json.loads((d/'alignment.json').read_text()).get('timings',{}) if (d/'alignment.json').exists() else {}
    else:
        import torch
        from PIL import Image
        from sharp.models import create_predictor,PredictorParams
        from sharp.cli.predict import predict_image
        from sharp.utils.gaussians import save_ply
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
    if result is not None:
        points,confidence=result
        ply_write(d/'aligned.ply',points);np.save(d/'confidence.npy',confidence)
        report['splat']=publish_progressive(d,points)
    (d/'alignment.json').write_text(json.dumps(report,indent=2))
    if result is not None and '--fuse' in sys.argv:
        report['scene']=fuse(d)
        (d/'alignment.json').write_text(json.dumps(report,indent=2))
    state=json.loads((d/'status.json').read_text()) if (d/'status.json').exists() else {}
    update_status(d,state='ready' if report['accepted'] else 'alignment-rejected',alignment=report,
                  timings=state.get('timings',{})|timings,productionSafe=False,license=LICENSE,
                  walkValidity=WALK_VALIDITY.copy())
    print(json.dumps(report))


if __name__=='__main__':main()
