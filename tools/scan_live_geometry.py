"""Metre-preserving posed geometry. XR uses y up, camera looks down -Z.
No assumed depth for monocular boxes and no invented translation for IMU fallback.
"""
import itertools
import math
from collections import deque
import cv2
import numpy as np

CV_FROM_XR = np.diag([1., -1., -1., 1.])


def camera(meta):
    k = np.asarray(meta['intrinsics'], dtype=np.float64).reshape(3, 3)
    world = np.asarray(meta['pose'], dtype=np.float64).reshape(4, 4).T
    if not np.isfinite(k).all() or not np.isfinite(world).all():
        raise ValueError('Non-finite camera')
    if min(k[0, 0], k[1, 1]) < 20 or not np.allclose(world[3], [0, 0, 0, 1], atol=1e-4):
        raise ValueError('Invalid intrinsics or transform')
    r = world[:3, :3]
    if not np.allclose(r.T @ r, np.eye(3), atol=.02) or not np.isclose(np.linalg.det(r), 1, atol=.02):
        raise ValueError('Pose rotation is not rigid')
    return k, world, CV_FROM_XR @ np.linalg.inv(world)


def ray(k, world, uv):
    direction = world[:3, :3] @ np.array([(uv[0]-k[0, 2])/k[0, 0], -(uv[1]-k[1, 2])/k[1, 1], -1.])
    return world[:3, 3], direction / np.linalg.norm(direction)


def intersect_rays(a, da, b, db, max_error=.15):
    if np.linalg.norm(a-b) < .06 or abs(da @ db) > math.cos(math.radians(1.5)):
        return None
    ts, *_ = np.linalg.lstsq(np.column_stack([da, -db]), b-a, rcond=None)
    if min(ts) < .1 or max(ts) > 15:
        return None
    pa, pb = a + ts[0]*da, b + ts[1]*db
    if np.linalg.norm(pa-pb) > max_error:
        return None
    return (pa+pb)/2


def transform(t, xyz):
    c, s = math.cos(t['angle']), math.sin(t['angle'])
    x, y, z = xyz
    return dict(x=float(c*x-s*z+t['tx']), y=float(y-t['floor']), z=float(s*x+c*z+t['tz']))


def rigid(a, b, floor=0):
    a, b = np.asarray(a), np.asarray(b)
    ac, bc = a.mean(axis=0), b.mean(axis=0)
    h = (a-ac).T @ (b-bc)
    u, _, vt = np.linalg.svd(h)
    r = vt.T @ u.T
    if np.linalg.det(r) < 0:
        vt[-1] *= -1
        r = vt.T @ u.T
    translation = bc-r@ac
    errors = np.linalg.norm((r@a.T).T+translation-b, axis=1)
    return dict(angle=float(math.atan2(r[1, 0],r[0, 0])),tx=float(translation[0]),tz=float(translation[1]),floor=float(floor),error=float(np.sqrt(np.mean(errors**2))))


def alignment(objects, plan, points, previous=None):
    """RANSAC unique semantic landmarks then robust point-to-wall ICP.
    Two furniture labels minimum; repeated plants never establish room heading.
    """
    pairs=[]
    categories={'refrigerator':r'fridge|refrigerator','china cabinet':r'china|cabinet|hutch','dining table':r'table','glass table':r'table'}
    import re
    used=set()
    for label, regex in categories.items():
        ds=[d for d in objects if d['label']==label and d.get('position') and d.get('views',0)>=3 and d.get('confidence',0)>=.3]
        items=[it for it in plan.get('items',[]) if re.search(regex,str(it.get('name',''))+' '+str(it.get('kind','')),re.I)]
        if len(ds)!=1 or len(items)!=1 or items[0]['id'] in used:
            continue
        d,it=ds[0],items[0]; used.add(it['id']); p=d['position']
        pairs.append(([p['x'],p['z']],[it['x'],it['z']],it['id']))
    best=None; nbest=0
    for i,j in itertools.combinations(range(len(pairs)),2):
        a=np.array([pairs[k][0] for k in [i,j]]); b=np.array([pairs[k][1] for k in [i,j]])
        if np.linalg.norm(a[1]-a[0])<.7 or abs(np.linalg.norm(a[1]-a[0])-np.linalg.norm(b[1]-b[0]))>.55:
            continue
        t=rigid(a,b)
        c,s=np.cos(t['angle']),np.sin(t['angle']); rot=np.array([[c,-s],[s,c]])
        errors=[np.linalg.norm(rot@p[0]+[t['tx'],t['tz']]-p[1]) for p in pairs]
        inliers=[k for k,e in enumerate(errors) if e<.4]
        if len(inliers)>nbest:
            nbest=len(inliers); best=rigid([pairs[k][0] for k in inliers],[pairs[k][1] for k in inliers])
    if best is None:
        best=dict(previous) if previous else plane_alignment(points, plan)
    if best is None:
        return None
    xyz=np.asarray(points).reshape(-1,3) if len(points) else np.empty((0,3))
    planes=fit_planes(xyz)
    floors=[p for p in planes if p['kind']=='floor']
    if floors:
        best['floor']=float(floors[0]['height'])
    elif previous:
        best['floor']=previous['floor']
    else:
        # Object positions alone do not establish a reliable floor.
        return None
    walls=[p for p in planes if p['kind']=='wall']
    poly=np.asarray(plan.get('room',{}).get('poly',[]))
    if len(walls)>=2 and len(poly)>2:
        from scipy.optimize import least_squares
        cloud=np.vstack([p['points'] for p in walls])[:,[0,2]][::3]
        a,b=poly,np.roll(poly,-1,axis=0); ab=b-a
        def residual(params):
            angle,tx,tz=params; c,s=np.cos(angle),np.sin(angle)
            q=cloud@np.array([[c,s],[-s,c]])+[tx,tz]
            delta=q[:,None,:]-a[None,:,:]
            u=np.clip(np.sum(delta*ab,axis=2)/np.maximum(np.sum(ab*ab,axis=1),1e-6),0,1)
            dist=np.linalg.norm(delta-u[:,:,None]*ab,axis=2)
            return np.min(dist,axis=1)
        initial=np.array([best['angle'],best['tx'],best['tz']])
        fit=least_squares(residual,initial,loss='soft_l1',f_scale=.1,max_nfev=15,bounds=(initial-[.12,.25,.25],initial+[.12,.25,.25]))
        if np.median(residual(fit.x))<.2:
            best.update(angle=float(fit.x[0]),tx=float(fit.x[1]),tz=float(fit.x[2]),wallError=float(np.median(residual(fit.x))))
    if best.get('error',0)>.35:
        return None
    best.update(source='landmark-ransac+wall-icp' if nbest else best.get('source','tracked-prior+wall-icp'),landmarks=nbest,planes=[{k:v for k,v in p.items() if k!='points'} for p in planes])
    return best


def plane_alignment(points, plan):
    """Multi-start robust wall ICP, refusing ambiguous rectangular-room fits."""
    from scipy.optimize import least_squares
    if len(points)<100: return None
    xyz=np.asarray(points).reshape(-1,3); planes=fit_planes(xyz)
    floors=[p for p in planes if p['kind']=='floor']; walls=[p for p in planes if p['kind']=='wall']
    poly=np.asarray(plan.get('room',{}).get('poly',[]),dtype=float)
    if not floors or len(walls)<3 or len(poly)<3: return None
    cloud=np.vstack([p['points'] for p in walls])[:,[0,2]][::4]
    if len(cloud)>300: cloud=cloud[np.linspace(0,len(cloud)-1,300).astype(int)]
    a,b=poly,np.roll(poly,-1,axis=0); ab=b-a
    def residual(params):
        angle,tx,tz=params; c,s=np.cos(angle),np.sin(angle)
        q=cloud@np.array([[c,s],[-s,c]])+[tx,tz]
        delta=q[:,None,:]-a[None,:,:]; u=np.clip(np.sum(delta*ab,axis=2)/np.maximum(np.sum(ab*ab,axis=1),1e-6),0,1)
        return np.min(np.linalg.norm(delta-u[:,:,None]*ab,axis=2),axis=1)
    fits=[]
    for yaw in np.linspace(-math.pi,math.pi,16,endpoint=False):
        c,s=np.cos(yaw),np.sin(yaw); center=cloud.mean(axis=0)@np.array([[c,s],[-s,c]])
        initial=np.r_[yaw,poly.mean(axis=0)-center]
        fit=least_squares(residual,initial,loss='soft_l1',f_scale=.08,max_nfev=35)
        error=float(np.sqrt(np.mean(np.minimum(residual(fit.x),.5)**2)))
        if error<.15: fits.append((error,fit.x))
    fits.sort(key=lambda p:p[0])
    if not fits: return None
    err,best=fits[0]
    for other,p in fits[1:]:
        angle=abs(math.atan2(math.sin(p[0]-best[0]),math.cos(p[0]-best[0])))
        if other<err+.025 and (angle>.2 or np.linalg.norm(p[1:]-best[1:])>.4): return None
    return dict(angle=float(best[0]),tx=float(best[1]),tz=float(best[2]),floor=float(floors[0]['height']),error=err,source='plane-ransac+wall-icp')


def fit_planes(points):
    if len(points)<30:
        return []
    rng=np.random.default_rng(7); cloud=np.array(points,dtype=float); found=[]
    for _ in range(4):
        if len(cloud)<25: break
        best=None
        for __ in range(80):
            a,b,c=cloud[rng.choice(len(cloud),3,replace=False)]
            n=np.cross(b-a,c-a); length=np.linalg.norm(n)
            if length<1e-6: continue
            n/=length
            if not (abs(n[1])>.96 or abs(n[1])<.15): continue
            inliers=abs((cloud-a)@n)<.045
            if inliers.sum()<max(20,len(cloud)*.08): continue
            if best is None or inliers.sum()>best[0].sum(): best=(inliers,n,a)
        if best is None: break
        mask,n,a=best; pts=cloud[mask]
        kind='floor' if abs(n[1])>.96 else 'wall'
        # A horizontal table top is not a floor: floor must be the low surface.
        if kind=='wall' or np.median(pts[:,1])<=np.quantile(points[:,1],.2)+.06:
            found.append(dict(kind=kind,normal=n.tolist(),height=float(np.median(pts[:,1])),count=len(pts),points=pts.tolist()))
        cloud=cloud[~mask]
    return found


def dense_stereo(old, image, k, cv):
    """Bounded posed SGBM depth, LR and photometric checked; no depth network."""
    if image.shape != old['image'].shape: return [], []
    h,w=image.shape[:2]; factor=min(1,320/w); size=(round(w*factor),round(h*factor)); width,height=size
    ka=old['k'].copy(); kb=k.copy(); ka[:2]*=factor; kb[:2]*=factor
    relative=cv@np.linalg.inv(old['cv']); rotation=relative[:3,:3]; translation=relative[:3,3]
    if np.linalg.norm(translation)<.08: return [], []
    try:
        ra,rb,pa,pb,q,_,_=cv2.stereoRectify(ka,np.zeros(5),kb,np.zeros(5),size,rotation,translation,flags=cv2.CALIB_ZERO_DISPARITY,alpha=0)
        ma=cv2.initUndistortRectifyMap(ka,np.zeros(5),ra,pa,size,cv2.CV_32FC1); mb=cv2.initUndistortRectifyMap(kb,np.zeros(5),rb,pb,size,cv2.CV_32FC1)
        ia=cv2.remap(cv2.resize(old['image'],size),*ma,cv2.INTER_LINEAR); ib=cv2.remap(cv2.resize(image,size),*mb,cv2.INTER_LINEAR)
        ga=cv2.cvtColor(ia,cv2.COLOR_BGR2GRAY); gb=cv2.cvtColor(ib,cv2.COLOR_BGR2GRAY)
        minimum=-64; count=128
        def match(a,b):
            matcher=cv2.StereoSGBM_create(minDisparity=minimum,numDisparities=count,blockSize=5,P1=8*25,P2=32*25,disp12MaxDiff=1,uniquenessRatio=12,speckleWindowSize=60,speckleRange=2)
            return matcher.compute(a,b).astype(np.float32)/16
        da=match(ga,gb); db=match(gb,ga); yy,xx=np.indices(da.shape); xr=np.rint(xx-da).astype(int); xr=np.clip(xr,0,width-1)
        valid=(da>minimum)&(abs(da)>1)&(abs(da+db[yy,xr])<1.5)&(abs(ga.astype(float)-gb[yy,xr])<30)
        texture=cv2.Laplacian(ga,cv2.CV_32F); valid &= abs(texture)>5
        xyz=cv2.reprojectImageTo3D(da,q); valid &= xyz[:,:,2]>.2; xyz=xyz@ra
        world=np.linalg.inv(old['cv']); xyz=xyz@world[:3,:3].T+world[:3,3]
        distance=np.linalg.norm(xyz-world[:3,3],axis=2); valid &= (distance>.2)&(distance<12)&np.isfinite(xyz).all(axis=2)
        pts=xyz[valid]; colors=ia[valid][:,::-1]/255.
        if len(pts)>3500:
            take=np.linspace(0,len(pts)-1,3500).astype(int); pts=pts[take]; colors=colors[take]
        return pts.tolist(),colors.tolist()
    except cv2.error:
        return [], []


class Geometry:
    def __init__(self):
        self.frames=deque(maxlen=8); self.points=np.empty((0,3)); self.colors=np.empty((0,3)); self.orb=cv2.ORB_create(nfeatures=1600); self.next_id=0; self.tracks=[]

    def add(self,image,meta,detections):
        k,world,cv=camera(meta); gray=cv2.cvtColor(image,cv2.COLOR_BGR2GRAY)
        keys,desc=self.orb.detectAndCompute(gray,None)
        uv=np.array([v.pt for v in keys],dtype=np.float32).reshape(-1,2)
        valid=meta.get('mode') in ('webxr','offline_colmap')
        xyz=[]; rgb=[]; matches_count=0
        if valid and desc is not None:
            for old in reversed(self.frames):
                if old['desc'] is None or np.linalg.norm(world[:3,3]-old['world'][:3,3])<.07: continue
                knn=cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(old['desc'],desc,k=2)
                matches=[a for pair in knn if len(pair)==2 for a,b in [pair] if a.distance<.72*b.distance]
                if len(matches)<12: continue
                pa=np.array([old['uv'][m.queryIdx] for m in matches]); pb=np.array([uv[m.trainIdx] for m in matches])
                # RANSAC removes moving leaves / wrong correspondences before triangulation.
                _,mask=cv2.findFundamentalMat(pa,pb,cv2.FM_RANSAC,1.5,.995)
                if mask is None: continue
                pa,pb=pa[mask.ravel()>0],pb[mask.ravel()>0]
                h=cv2.triangulatePoints(old['k']@old['cv'][:3],k@cv[:3],pa.T,pb.T)
                good=abs(h[3])>1e-8; pts=(h[:3,good]/h[3,good]).T; pa,pb=pa[good],pb[good]
                for pt,aa,bb in zip(pts,pa,pb):
                    proj1=old['k']@old['cv'][:3]@np.r_[pt,1]; proj2=k@cv[:3]@np.r_[pt,1]
                    if not(.1<proj1[2]<15 and .1<proj2[2]<15): continue
                    if max(np.linalg.norm(proj1[:2]/proj1[2]-aa),np.linalg.norm(proj2[:2]/proj2[2]-bb))>2.5: continue
                    _,da=ray(old['k'],old['world'],aa); _,db=ray(k,world,bb)
                    if abs(da@db)>math.cos(math.radians(1.5)): continue
                    x,y=np.round(bb).astype(int); x=np.clip(x,0,image.shape[1]-1); y=np.clip(y,0,image.shape[0]-1)
                    xyz.append(pt); rgb.append(image[y,x,::-1]/255.)
                matches_count=len(pa)
                if meta['seq'] % 4 == 1:
                    dense, dense_colors = dense_stereo(old, image, k, cv)
                    xyz.extend(dense); rgb.extend(dense_colors)
                break
        for dp in meta.get('depthPoints',[])[:600]:
            pt=np.asarray(dp.get('point',[])); uvp=dp.get('uv',[])
            if pt.shape==(3,) and len(uvp)==2 and np.isfinite(pt).all() and .1<np.linalg.norm(pt-world[:3,3])<12:
                x,y=np.clip((np.array(uvp)*[image.shape[1],image.shape[0]]).astype(int),[0,0],[image.shape[1]-1,image.shape[0]-1]); xyz.append(pt); rgb.append(image[y,x,::-1]/255.)
        for plane in meta.get('planes',[])[:16]:
            # XR plane polygons supply exact posed geometry, not image-derived guesses.
            for pt in plane.get('points',[])[:80]:
                if valid and len(pt)==3 and np.isfinite(pt).all(): xyz.append(pt); rgb.append([.55,.55,.5])
        if xyz:
            self.points=np.vstack([self.points,xyz]); self.colors=np.vstack([self.colors,rgb])
            _,idx=np.unique(np.round(self.points/.025).astype(int),axis=0,return_index=True)
            idx=idx[-18000:]; self.points=self.points[idx]; self.colors=self.colors[idx]
        self._objects(detections,k,world,meta,valid)
        self.frames.append(dict(k=k,world=world,cv=cv,uv=uv,desc=desc,image=image))
        return dict(features=len(uv),inliers=matches_count,points=len(self.points),newPoints=len(xyz),posed=valid)

    def _objects(self,detections,k,world,meta,valid):
        assigned=set()
        for d in detections:
            box=np.array(d['box']); uv=(box[:2]+box[2:])/2
            origin,direction=ray(k,world,uv); appearance=np.array(d.pop('_appearance',[0]*16))
            candidates=[]
            for track in self.tracks:
                if track['label']!=d['label'] or track['id'] in assigned: continue
                old=track['observations'][-1]; score=float(np.dot(appearance,old['appearance']))
                if track.get('position'):
                    p=k@(CV_FROM_XR@np.linalg.inv(world))[:3]@np.r_[[track['position'][key] for key in ['x','y','z']],1]
                    if p[2]<=0: continue
                    miss=np.linalg.norm(p[:2]/p[2]-uv)/max(30,box[2]-box[0])
                    if miss>1.8: continue
                    score-=miss*.4
                else:
                    angle=np.arccos(np.clip(direction@old['direction'],-1,1))
                    if angle>.45: continue
                    score-=angle
                candidates.append((score,track))
            track=max(candidates,key=lambda t:t[0])[1] if candidates and max(t[0] for t in candidates)>.2 else None
            if track is None:
                self.next_id+=1; track=dict(id=f'o{self.next_id}',label=d['label'],observations=deque(maxlen=12),views=0); self.tracks.append(track)
            assigned.add(track['id']); observations=track['observations']
            points=[]
            if valid:
                for old in observations:
                    if not old['valid']: continue
                    pt=intersect_rays(old['origin'],old['direction'],origin,direction)
                    if pt is not None: points.append(pt)
                # Surface cloud inside middle 60% of box improves localization for
                # camera panning without enough baseline between centroids.
                if len(self.points):
                    p=(k@(CV_FROM_XR@np.linalg.inv(world))[:3]@np.c_[self.points,np.ones(len(self.points))].T).T
                    xy=p[:,:2]/np.maximum(p[:,2:3],1e-6); margin=(box[2:]-box[:2])*.2
                    inside=(p[:,2]>.1)&np.all(xy>box[:2]+margin,axis=1)&np.all(xy<box[2:]-margin,axis=1)
                    if inside.sum()>=5: points.append(np.median(self.points[inside],axis=0))
            if points:
                pt=np.median(points,axis=0)
                if np.linalg.norm(pt-origin)<12:
                    oldp=np.array([track['position'][key] for key in ['x','y','z']]) if track.get('position') else pt
                    pt=.7*oldp+.3*pt; track['position']=dict(zip(['x','y','z'],map(float,pt)))
                    depth=float((CV_FROM_XR@np.linalg.inv(world)@np.r_[pt,1])[2])
                    track['size']=dict(w=float((box[2]-box[0])*depth/k[0,0]),h=float((box[3]-box[1])*depth/k[1,1]),d=None)
                    track['positionMethod']='multi-view-centroid/surface'; track['uncertainty']='Unvalidated multi-view centroid / surface estimate'
                    from scipy.spatial.transform import Rotation
                    track['viewQuaternion']=Rotation.from_matrix(world[:3,:3]).as_quat().tolist()
            observations.append(dict(origin=origin,direction=direction,appearance=appearance,valid=valid))
            track.update({key:value for key,value in d.items() if key!='id'}); track['views']+=1; track['lastSeen']=meta['seq']; d['id']=track['id']
        self.tracks=[t for t in self.tracks if meta['seq']-t.get('lastSeen',0)<24][-80:]

    def objects(self,seq):
        return [{k:v for k,v in t.items() if k!='observations'} for t in self.tracks if seq-t.get('lastSeen',0)<8]
