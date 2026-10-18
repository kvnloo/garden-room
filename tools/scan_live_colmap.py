"""Recover actual photo poses for private live-scanner evidence (scale is unknown)."""
from pathlib import Path
import json, time
import numpy as np
from PIL import Image
import pycolmap as p
ROOT=Path(__file__).resolve().parents[1]
out=ROOT/'work/scan_live_evidence'; images=out/'highres'; images.mkdir(parents=True,exist_ok=True)
for source in sorted((ROOT/'refs').glob('20261018_*.jpg')):
    target=images/source.name
    if not target.exists():
        im=Image.open(source); im.thumbnail((1600,1600)); im.convert('RGB').save(target,quality=90)
db=out/'colmap_highres.db'; sparse=out/'sparse_highres'; sparse.mkdir(exist_ok=True)
t=time.perf_counter()
if not db.exists():
    opts=p.FeatureExtractionOptions(); opts.sift.max_num_features=4096; opts.num_threads=4
    p.extract_features(db,images,camera_mode=p.CameraMode.AUTO,extraction_options=opts,device=p.Device.cpu)
    match=p.FeatureMatchingOptions(); match.num_threads=4
    p.match_exhaustive(db,matching_options=match,device=p.Device.cpu)
if not (sparse/'0/images.bin').exists():
    opts=p.IncrementalPipelineOptions(); opts.num_threads=4
    opts.mapper.init_min_num_inliers=40
    opts.mapper.init_min_tri_angle=4
    opts.mapper.abs_pose_min_num_inliers=20
    opts.min_model_size=3
    models=p.incremental_mapping(db,images,sparse,options=opts)
else: models={0:p.Reconstruction(sparse/'0')}
model=max(models.values(),key=lambda m:m.num_reg_images())
# COLMAP world is arbitrary; change basis globally to a right-handed y-up frame is
# not needed for image reprojection. Camera conversion CV -> XR is diag(1,-1,-1).
frames=[]
for image in model.images.values():
    cam=model.cameras[image.camera_id]; c2w=np.linalg.inv(image.cam_from_world().matrix() if False else np.vstack([image.cam_from_world().matrix(),[0,0,0,1]]))
    xr=c2w@np.diag([1,-1,-1,1]); k=cam.calibration_matrix()
    frames.append(dict(name=image.name,pose=xr.T.ravel().tolist(),intrinsics=k.tolist(),width=cam.width,height=cam.height,mode='offline_colmap',metric=False))
frames.sort(key=lambda f:f['name'])
(out/'poses.json').write_text(json.dumps(dict(frames=frames,points=model.num_points3D(),seconds=time.perf_counter()-t,metric=False),indent=2))
np.savez(out/'sparse_points.npz',xyz=np.array([v.xyz for v in model.points3D.values()]),rgb=np.array([v.color for v in model.points3D.values()]))
print(json.dumps(dict(registered=len(frames),points=model.num_points3D(),seconds=time.perf_counter()-t)),flush=True)
