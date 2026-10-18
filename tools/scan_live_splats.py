"""Small bounded-window 3DGS optimizer using gsplat; no fake splat fallback."""
from collections import deque
import time
import cv2
import numpy as np
import torch
from gsplat import rasterization
from scan_live_geometry import camera


class LiveSplats:
    def __init__(self, output):
        self.output=output; self.views=deque(maxlen=8); self.params=None; self.optimizer=None
        self.count=0; self.steps=0; self.revision=0; self.last_export=0; self.error=None

    def add_view(self,image,meta):
        k,_,cv=camera(meta)
        h,w=image.shape[:2]; f=min(1,320/w,240/h); size=(round(w*f),round(h*f)); k[:2]*=f
        image=cv2.resize(image,size)
        self.views.append((torch.tensor(image[:,:,::-1].copy()/255.,device='cuda',dtype=torch.float32),torch.tensor(k[None],device='cuda',dtype=torch.float32),torch.tensor(cv[None],device='cuda',dtype=torch.float32)))

    def update(self,points,colors,steps=4,budget_ms=130):
        start=time.perf_counter()
        if len(points)<16 or not self.views:
            return dict(state='waiting-for-parallax-or-depth',count=0,steps=0,ms=0)
        if self.params is None or len(points)>self.count*1.3+100:
            # Preserve trained Gaussians; append spatially new observations only.
            xyz=np.asarray(points,dtype=np.float32); rgb=np.clip(colors,.01,.99)
            if self.params is not None:
                old=self.params['means'].detach().cpu().numpy()
                from scipy.spatial import cKDTree
                distances,_=cKDTree(old).query(xyz)
                take=distances>.035; xyz=xyz[take]; rgb=rgb[take]
                limit=max(0,20000-len(old)); xyz=xyz[:limit]; rgb=rgb[:limit]
            n=len(xyz)
            if n:
                from scipy.spatial import cKDTree
                nearest=cKDTree(xyz).query(xyz,k=min(4,n))[0]
                scales=np.clip(np.mean(nearest[:,1:],axis=1)*.7,.008,.12)
                new=dict(means=torch.tensor(xyz,device='cuda'),quats=torch.tensor(np.tile([1.,0.,0.,0.],(n,1)),device='cuda',dtype=torch.float32),scales=torch.tensor(np.log(np.repeat(scales[:,None],3,axis=1)),device='cuda',dtype=torch.float32),colors=torch.tensor(np.log(rgb/(1-rgb)),device='cuda',dtype=torch.float32),opacities=torch.full((n,),1.4,device='cuda'))
                if self.params is not None:
                    new={k:torch.cat([self.params[k].detach(),v]) for k,v in new.items()}
                self.params={k:torch.nn.Parameter(v) for k,v in new.items()}; self.count=len(self.params['means'])
                self.optimizer=torch.optim.Adam([{'params':[v],'lr':.0003 if k=='means' else .01} for k,v in self.params.items()])
        if self.params is None: return dict(state='waiting',count=0,steps=0,ms=0)
        loss_value=None; ran=0
        for _ in range(steps):
            image,k,cv=self.views[self.steps%len(self.views)]; h,w=image.shape[:2]
            p=self.params
            rgb,alpha,_=rasterization(p['means'],torch.nn.functional.normalize(p['quats'],dim=-1),p['scales'].exp(),p['opacities'].sigmoid(),p['colors'].sigmoid(),cv,k,w,h,packed=False,near_plane=.05,far_plane=20.,radius_clip=0.)
            # Full photometric loss drives actual means, scales, opacity and color.
            loss=(rgb[0]-image).abs().mean()+.0002*p['scales'].exp().mean()
            if not torch.isfinite(loss): raise RuntimeError('Non-finite Gaussian loss')
            self.optimizer.zero_grad(set_to_none=True); loss.backward(); self.optimizer.step()
            with torch.no_grad(): p['scales'].clamp_(-6.,-1.); p['opacities'].clamp_(-5.,5.)
            self.steps+=1; ran+=1; loss_value=float(loss.detach())
            if (time.perf_counter()-start)*1000>budget_ms: break
        torch.cuda.synchronize()
        if time.monotonic()-self.last_export>2.:
            self.export(); self.last_export=time.monotonic()
        return dict(state='optimizing',count=self.count,steps=self.steps,iterations=ran,loss=loss_value,revision=self.revision,ms=round((time.perf_counter()-start)*1000,2))

    def export(self):
        p=self.params
        if p is None: return
        means=p['means'].detach().cpu().numpy(); scales=p['scales'].detach().exp().cpu().numpy()
        rgba=torch.cat([p['colors'].sigmoid(),p['opacities'].sigmoid()[:,None]],dim=1).detach().cpu().numpy()
        q=torch.nn.functional.normalize(p['quats'],dim=-1).detach().cpu().numpy()
        # Standard 32-byte .splat: xyz, scale xyz, RGBA8, quaternion WXYZ8.
        rows=np.zeros((len(means),32),np.uint8); rows[:,:12]=means.astype('<f4').view(np.uint8).reshape(-1,12)
        rows[:,12:24]=scales.astype('<f4').view(np.uint8).reshape(-1,12)
        rows[:,24:28]=np.clip(rgba*255,0,255).astype(np.uint8); rows[:,28:32]=np.clip(q*128+128,0,255).astype(np.uint8)
        self.output.parent.mkdir(parents=True,exist_ok=True); tmp=self.output.with_suffix('.tmp'); tmp.write_bytes(rows.tobytes()); tmp.replace(self.output); self.revision+=1
