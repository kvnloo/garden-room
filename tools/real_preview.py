#!/usr/bin/env python3
"""Lazy SD-Turbo + SD2.1 depth ControlNet, loopback Unix socket only.

Resident GPU weights move to CPU after 45 idle seconds or before SHARP admission.
The GPU file lock serializes Real GPU stages, not the independent scan worker;
admission checks free VRAM rather than killing/restarting the scan worker.
"""
import gc
import json
import os
from pathlib import Path
import socketserver
import time
from http.server import BaseHTTPRequestHandler
import fcntl

ROOT = Path(__file__).resolve().parents[1]
SOCKET = ROOT/'work/real-preview.sock'
CACHE = '$PRIVATE_DATA'
os.environ.setdefault('HF_HOME', CACHE)
PIPE = None
PIPE_DEVICE = 'cpu'
LAST = 0
PROMPT = ('real interior smartphone photograph, beige painted walls, white chair rail and wainscoting, '
          'beige textured carpet, white refrigerator, dark antique carved wood glass china cabinet, '
          'dark brown dining table, black metal glass tables, realistic potted houseplants, '
          'natural north window daylight, dark burgundy curtains, accurate existing composition')


def unload():
    global PIPE_DEVICE
    if PIPE is not None:
        PIPE.to('cpu');PIPE_DEVICE='cpu'
    gc.collect()
    import torch
    torch.cuda.empty_cache()


def preview(d):
    global PIPE, PIPE_DEVICE, LAST
    import numpy as np
    import torch
    from PIL import Image
    from diffusers import ControlNetModel, StableDiffusionControlNetImg2ImgPipeline
    t = time.perf_counter()
    free, _ = torch.cuda.mem_get_info()
    if PIPE is None:
        if free < 6_000_000_000:
            raise RuntimeError('Preview waiting: less than 6 GB free VRAM (scan worker kept running)')
        control = ControlNetModel.from_pretrained('thibaud/controlnet-sd21-depth-diffusers', torch_dtype=torch.float16, use_safetensors=False)
        PIPE = StableDiffusionControlNetImg2ImgPipeline.from_pretrained('stabilityai/sd-turbo',controlnet=control,
            torch_dtype=torch.float16,variant='fp16',safety_checker=None,requires_safety_checker=False).to('cuda')
        PIPE.set_progress_bar_config(disable=True)
        PIPE_DEVICE='cuda'
    elif PIPE_DEVICE!='cuda':
        if free<6_000_000_000:raise RuntimeError('Preview waiting for 6 GB free VRAM')
        PIPE.to('cuda');PIPE_DEVICE='cuda'
    loaded = time.perf_counter()
    c = json.loads((d/'capture.json').read_text())
    w,h = c['depth']['width'],c['depth']['height']
    depth = np.fromfile(d/'depth.f32',dtype='<f4').reshape(h,w)
    valid = (depth > .05) & (depth < 40) & np.isfinite(depth)
    near,far = np.percentile(depth[valid],[2,98])
    control = np.where(valid, 1-(depth-near)/max(far-near,.1),0).clip(0,1)
    control = Image.fromarray((control*255).astype('uint8')).convert('RGB')
    image = Image.open(d/'view.jpg').convert('RGB')
    # Phone portrait at ~0.2 MP; preserve aspect in multiples of eight.
    scale = min(512/w,768/h,1)
    size = (max(64,round(w*scale/8)*8),max(64,round(h*scale/8)*8))
    image = image.resize(size); control = control.resize(size)
    with torch.inference_mode():
        result = PIPE(prompt=PROMPT,image=image,control_image=control,width=size[0],height=size[1],
            num_inference_steps=4,strength=.5,guidance_scale=0.,controlnet_conditioning_scale=.85,
            generator=torch.Generator('cuda').manual_seed(442)).images[0]
    torch.cuda.synchronize()
    inferred = time.perf_counter()
    result.resize((w,h),Image.Resampling.LANCZOS).save(d/'preview.png')
    LAST = time.monotonic()
    return {'model':'stabilityai/sd-turbo','controlnet':'thibaud/controlnet-sd21-depth-diffusers',
            'loadMs':round((loaded-t)*1000,1),'inferenceMs':round((inferred-loaded)*1000,1),
            'totalMs':round((time.perf_counter()-t)*1000,1),'size':size}


class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):
        pass

    def do_POST(self):
        try:
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))))
            if self.path == '/unload':
                unload(); result={'ok':True}
            elif self.path == '/preview':
                d = Path(body['directory']).resolve()
                if not d.is_relative_to((ROOT/'data/renders/real').resolve()):
                    raise ValueError('Bad directory')
                with open(ROOT/'work/real-gpu.lock','w') as lock:
                    fcntl.flock(lock,fcntl.LOCK_EX)
                    result=preview(d)
            else:
                raise ValueError('Unknown route')
            code=200
        except Exception as exc:
            result={'error':str(exc)};code=503
            unload()
        raw=json.dumps(result).encode()
        self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)


class Server(socketserver.UnixStreamServer):
    allow_reuse_address = True


if __name__ == '__main__':
    SOCKET.parent.mkdir(exist_ok=True)
    # Exclusive lifetime lease prevents a second web process stealing a live socket.
    with open(ROOT/'work/real-preview.lock','w') as lease:
        try:
            fcntl.flock(lease,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit(0)
        SOCKET.unlink(missing_ok=True)
        server=Server(str(SOCKET),Handler);os.chmod(SOCKET,0o600);server.timeout=2
        while True:
            server.handle_request()
            if PIPE is not None and PIPE_DEVICE=='cuda' and time.monotonic()-LAST>45:
                unload()
