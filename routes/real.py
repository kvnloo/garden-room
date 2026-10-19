"""Camera-conditioned Real jobs. Auth is enforced by server.try_routes callers.

Only immutable, content-addressed captures are accepted. GPU/network work runs outside
this stdlib web process. State is never read or modified by this route.
"""
import array
import base64
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
STORE = ROOT / 'data/renders/real'
PYTHON = '$PRIVATE_DATA'
LOCK = threading.Lock()
ACTIVE = {}
PREVIEW = None
MAX_JOBS = 3


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def revision(layout):
    # Scores, inferred supports and care metadata must not invalidate geometry.
    keys = ('id','kind','name','src','family','pot','x','z','rot','w','d','h','potD','potH','height','attach','hinge','box')
    return hashlib.sha256(canonical({'room': layout['room'], 'items': [
        {k: item[k] for k in keys if k in item} for item in layout['items']],
        'fridgeOpen': bool(layout.get('fridgeOpen', False))}).encode()).hexdigest()[:24]


def read(path, default=None):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def validate(data):
    layout, camera, depth = data['layout'], data['camera'], data['depth']
    if not isinstance(layout.get('items'), list) or len(layout['items']) > 200 or not layout.get('room', {}).get('poly'):
        raise ValueError('Invalid layout')
    for key, length in (('matrixWorld',16), ('position',3), ('quaternion',4)):
        if len(camera[key]) != length or not all(isinstance(x,(int,float)) and math.isfinite(x) for x in camera[key]):
            raise ValueError('Invalid camera '+key)
    if not (10 <= camera['fov'] <= 130 and 0.2 <= camera['aspect'] <= 5):
        raise ValueError('Invalid intrinsics')
    width, height = depth['width'], depth['height']
    if not isinstance(width,int) or not isinstance(height,int) or not (64 <= width <= 1280 and 64 <= height <= 1280):
        raise ValueError('Invalid depth size')
    if abs(width/height-camera['aspect']) > .01:
        raise ValueError('Capture aspect mismatch')
    raw = base64.b64decode(depth['data'], validate=True)
    if len(raw) != width*height*4 or depth.get('encoding') != 'float32-le-meters-camera-z':
        raise ValueError('Expected metric float32 depth')
    values=array.array('f');values.frombytes(raw)
    import sys
    if sys.byteorder!='little':values.byteswap()
    if any(not math.isfinite(x) or x<0 or x>100 for x in values):
        raise ValueError('Depth must be finite metres in [0,100]')
    if sum(x>.05 for x in values)<width*height*.03:
        raise ValueError('Camera has too little visible room geometry')
    # All numbers and finite JSON are checked before disk or subprocess side effects.
    canonical(data)
    return layout, camera, raw


def start_preview():
    global PREVIEW
    if PREVIEW is None or PREVIEW.poll() is not None:
        env = {k:v for k,v in os.environ.items() if k not in ('PYTHONPATH','PYTHONHOME')}
        STORE.mkdir(parents=True, exist_ok=True)
        with open(STORE/'preview-worker.log','ab') as log:
            PREVIEW = subprocess.Popen([PYTHON, str(ROOT/'tools/real_preview.py')], env=env, stdout=log, stderr=log)


def run_job(d):
    env = {k:v for k,v in os.environ.items() if k not in ('PYTHONPATH','PYTHONHOME')}
    try:
        with open(d/'render.log','ab') as log:
            result = subprocess.run([PYTHON, str(ROOT/'tools/render_real.py'), str(d), '--camera'], env=env, stdout=log, stderr=log, timeout=900)
        if result.returncode:
            s = read(d/'status.json', {})
            s.update(state='failed', error='Real worker failed; see render.log', rc=result.returncode)
            (d/'status.json').write_text(json.dumps(s))
    except Exception as exc:
        (d/'status.json').write_text(json.dumps({'state':'failed','error':str(exc)}))
    finally:
        with LOCK:
            ACTIVE.pop(d.name, None)


def handle(h, method, path):
    if not path.startswith('/api/real/'):
        return False
    STORE.mkdir(parents=True, exist_ok=True)
    if method == 'POST' and path == '/api/real/layout':
        try:
            data = h.body()
            rev = revision(data['layout'])
            h.send_json(200, {'revision':rev})
        except (ValueError,KeyError,TypeError):
            h.send_json(400, {'error':'Invalid layout'})
        return True
    if method == 'POST' and path == '/api/real/view':
        try:
            data = h.body()
            layout, camera, raw = validate(data)
            rev = revision(layout)
            # Quantize only for cache lookup, never for the actual camera/render.
            pose = {k:[round(x,3) for x in camera[k]] for k in ('position','quaternion')}
            pose.update(fov=round(camera['fov'],2), aspect=round(camera['aspect'],3))
            rid = hashlib.sha256(canonical({'revision':rev,'pose':pose,'pipeline':2}).encode()).hexdigest()[:24]
            if data.get('retry'):
                rid=hashlib.sha256((rid+'retry-1').encode()).hexdigest()[:24]
            d = STORE/rev/rid
            with LOCK:
                previous = read(d/'status.json', {})
                if previous:
                    unfinished=previous.get('state') in ('queued','generating','preview','photoreal','splatting')
                    if unfinished and rid not in ACTIVE and len(ACTIVE)<MAX_JOBS:
                        # A service restart must not leave a permanently cached pending job.
                        # Resume its original immutable capture, not this rounded-cache pose.
                        ACTIVE[rid]=True;start_preview()
                        threading.Thread(target=run_job,args=(d,),daemon=True).start()
                        return h.send_json(202, {'id':rid,'revision':rev,'cached':True,'resumed':True,'status':previous}) or True
                    return h.send_json(200, {'id':rid,'revision':rev,'cached':True,'status':previous}) or True
                if len(ACTIVE) >= MAX_JOBS:
                    return h.send_json(429, {'error':'Real queue full; current splats remain interactive'}) or True
                d.mkdir(parents=True, exist_ok=True)
                for key in ('view','ids'):
                    uri = data.get(key,'')
                    if not uri.startswith('data:image/'):
                        raise ValueError('Missing '+key+' render')
                    image = base64.b64decode(uri.split(',',1)[1],validate=True)
                    if len(image) > 6_000_000:
                        raise ValueError('Render too large')
                    (d/('view.jpg' if key=='view' else 'ids.png')).write_bytes(image)
                (d/'depth.f32').write_bytes(raw)
                (d/'capture.json').write_text(canonical({k:data[k] for k in ('camera','depth','objects','captureMs') if k in data} | {'depth':{k:v for k,v in data['depth'].items() if k!='data'}, 'revision':rev}))
                (d/'layout.json').write_text(canonical(layout))
                (d/'status.json').write_text(json.dumps({'state':'queued','revision':rev,'id':rid,'created':time.time(),'timings':{'captureMs':data.get('captureMs')}}))
                ACTIVE[rid] = True
                start_preview()
                threading.Thread(target=run_job,args=(d,),daemon=True).start()
            h.send_json(202, {'id':rid,'revision':rev,'cached':False})
        except (ValueError,KeyError,TypeError,OverflowError) as exc:
            h.send_json(400, {'error':str(exc)})
        return True
    match = re.fullmatch(r'/api/real/([a-f0-9]{24})/(views|scene)', path)
    if method == 'GET' and match:
        rev, kind = match.groups()
        d = STORE/rev
        if kind == 'views':
            views = []
            if d.exists():
                for child in sorted(d.iterdir()):
                    if child.is_dir():
                        s = read(child/'status.json', {})
                        c = read(child/'capture.json', {})
                        views.append({'id':child.name,'status':s,'camera':c.get('camera'),
                                      'base':f'/renders/real/{rev}/{child.name}/'})
            h.send_json(200, {'revision':rev,'views':views,'scene':read(d/'scene.json')})
        else:
            h.send_json(200, read(d/'scene.json', {'revision':rev,'views':[],'count':0}))
        return True
    h.send_json(404, {'error':'No such Real route'})
    return True
