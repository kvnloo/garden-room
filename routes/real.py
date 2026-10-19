"""Camera-conditioned Real jobs. Auth is enforced by server.try_routes callers.

Only immutable, content-addressed captures are accepted. GPU/network work runs outside
this stdlib web process. State is never read or modified by this route.
"""
import array
import base64
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import struct
import subprocess
import threading
import tempfile
import time
import zlib

ROOT = Path(__file__).resolve().parents[1]
STORE = ROOT / 'data/renders/real'
PYTHON = '$PRIVATE_DATA'
LOCK = threading.Lock()
ACTIVE = {}
PREVIEW = None
MAX_JOBS = 3
PIPELINE = 3
PREVIEW_ENV = 'REAL_RESEARCH_PREVIEW'
SHARP_LICENSE = 'Apple SHARP AMLR weights: research-only; product development/commercial use excluded'
SHELL_LICENSE = 'No ML lift weights; generated RGB remains subject to applicable OpenAI output terms'


def real_backend(value=None):
    value = os.environ.get('GARDEN_REAL_BACKEND', 'shell') if value is None else value
    if value in ('shell', 'procedural-depth-shell'):
        return 'procedural-depth-shell'
    if value == 'sharp-research':
        return value
    raise ValueError('GARDEN_REAL_BACKEND must be shell or sharp-research')


def backend_metadata(backend):
    shell = backend == 'procedural-depth-shell'
    return {'backend': backend, 'productionSafe': shell,
            'license': SHELL_LICENSE if shell else SHARP_LICENSE,
            'geometryPrior': 'captured procedural' if shell else 'SHARP research prediction with procedural alignment',
            'walkValidity': {'angleDeg': 15, 'distanceM': .3},
            'limitation': 'Production-safe lift only; RGB subject to OpenAI output terms. No claim of model semantic accuracy, photographic depth recovery, or unseen surfaces.' if shell else SHARP_LICENSE}


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


def id_pixels(path):
    """Read the browser's 8-bit RGB/RGBA item-ID PNG without web-process ML deps."""
    raw = path.read_bytes()
    if raw[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('Expected item-ID PNG')
    offset, compressed, header = 8, bytearray(), None
    while offset + 12 <= len(raw):
        size = int.from_bytes(raw[offset:offset+4], 'big')
        kind = raw[offset+4:offset+8]
        chunk = raw[offset+8:offset+8+size]
        if len(chunk) != size or offset+12+size > len(raw):
            raise ValueError('Truncated item-ID PNG')
        if kind == b'IHDR': header = struct.unpack('>IIBBBBB', chunk)
        if kind == b'IDAT': compressed.extend(chunk)
        offset += 12+size
        if kind == b'IEND': break
    if header is None:
        raise ValueError('Missing item-ID PNG header')
    w, h, bits, color, compression, filtering, interlace = header
    if not (1 <= w <= 1280 and 1 <= h <= 1280 and bits == 8 and color in (2, 6)
            and compression == filtering == interlace == 0):
        raise ValueError('Expected noninterlaced 8-bit RGB item IDs')
    channels = 3 if color == 2 else 4
    stride = w*channels
    decoded = zlib.decompressobj().decompress(bytes(compressed), (stride+1)*h+1)
    if len(decoded) != (stride+1)*h:
        raise ValueError('Invalid item-ID PNG data length')
    previous = bytearray(stride)
    for y in range(h):
        start = y*(stride+1)
        mode, row = decoded[start], bytearray(decoded[start+1:start+1+stride])
        if mode not in range(5): raise ValueError('Invalid PNG filter')
        for i in range(stride):
            left = row[i-channels] if i >= channels else 0
            up = previous[i]
            corner = previous[i-channels] if i >= channels else 0
            if mode == 1: predictor = left
            elif mode == 2: predictor = up
            elif mode == 3: predictor = (left+up)//2
            elif mode == 4:
                p = left+up-corner
                distances = (abs(p-left), abs(p-up), abs(p-corner))
                predictor = (left, up, corner)[distances.index(min(distances))]
            else: predictor = 0
            row[i] = (row[i]+predictor) & 255
        for x in range(w):
            i = x*channels
            label = row[i]+256*row[i+1]+65536*row[i+2]
            if channels == 4 and row[i+3] == 0: label = 0
            yield w, h, x, y, label
        previous = row


def visible_plants(directory):
    capture = read(directory/'capture.json', {})
    layout = read(directory/'layout.json', {})
    items = {item['id']: item for item in layout.get('items', []) if item.get('kind') == 'plant'}
    labels = {obj['label']: items[obj['id']] for obj in capture.get('objects', [])
              if obj.get('id') in items and isinstance(obj.get('label'), int) and obj['label'] > 0}
    stats = {}
    for w, h, x, y, label in id_pixels(directory/'ids.png'):
        if (w, h) != (capture.get('depth', {}).get('width'), capture.get('depth', {}).get('height')):
            raise ValueError('Item-ID and camera depth dimensions differ')
        if label not in labels: continue
        s = stats.setdefault(label, [0, w, h, 0, 0, 0, 0])
        s[0] += 1; s[1] = min(s[1], x); s[2] = min(s[2], y)
        s[3] = max(s[3], x+1); s[4] = max(s[4], y+1); s[5] += x+.5; s[6] += y+.5
    return [{'id': item['id'], 'name': item.get('name', item['id']),
             'bbox': [s[1]/w, s[2]/h, s[3]/w, s[4]/h],
             'centroid': [s[5]/s[0]/w, s[6]/s[0]/h], 'pixels': s[0]}
            for label, item in labels.items() if (s := stats.get(label)) and s[0] > 20]


def cached_visible_plants(directory):
    """Persist derived legacy inventory; never decode all old PNGs every poll."""
    signature = {name: [s.st_mtime_ns, s.st_size]
                 for name in ('capture.json', 'layout.json', 'ids.png')
                 for s in [(directory/name).stat()]}
    cache = read(directory/'visible-plants.json', {})
    if cache.get('signature') == signature and isinstance(cache.get('plants'), list):
        return cache['plants']
    plants = visible_plants(directory)
    # Inputs/photos stay immutable; only this rebuildable derivative is added.
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', dir=directory, prefix='.visible-', delete=False) as f:
            tmp = Path(f.name)
            json.dump({'signature': signature, 'plants': plants}, f, allow_nan=False)
        tmp.replace(directory/'visible-plants.json')
    except OSError:
        pass  # Read-only artifact stores can still return the computed inventory.
    finally:
        if tmp is not None: tmp.unlink(missing_ok=True)
    return plants


def safe_job(rev, rid):
    if not re.fullmatch('[a-f0-9]{24}', rev) or not re.fullmatch('[a-f0-9]{24}', rid):
        return None
    parent, directory = STORE/rev, STORE/rev/rid
    if parent.is_symlink() or directory.is_symlink(): return None
    if not directory.resolve().is_relative_to(STORE.resolve()): return None
    return directory


def scene_for(rev):
    if (STORE/rev).is_symlink(): return {'revision': rev, 'views': [], 'count': 0}
    scene = read(STORE/rev/'scene.json', {'revision': rev, 'views': [], 'count': 0})
    for rid in scene.get('views', []):
        d = safe_job(rev, rid)
        if d is None or (d/'deleted.json').exists():
            return {'revision': rev, 'views': [], 'count': 0}
    return scene


def job_record(d):
    s, c = read(d/'status.json', {}), read(d/'capture.json', {})
    for key, value in backend_metadata(s.get('backend', c.get('backend', 'sharp-research'))).items():
        s.setdefault(key, value)
    provenance = read(d/'provenance.json', {}).get('real.png', {})
    plants = provenance.get('visiblePlants', c.get('visiblePlants'))
    if plants is None:
        try: plants = cached_visible_plants(d)
        except (OSError, ValueError, KeyError, struct.error, zlib.error): plants = []
    return {'id': d.name, 'revision': d.parent.name,
            'base': f'/renders/real/{d.parent.name}/{d.name}/', 'camera': c.get('camera'),
            'plants': plants, 'status': s, 'created': s.get('created', (d/'real.png').stat().st_mtime if (d/'real.png').is_file() else 0)}


def validate(data):
    layout, camera, depth = data['layout'], data['camera'], data['depth']
    if not isinstance(layout.get('items'), list) or len(layout['items']) > 200 or not layout.get('room', {}).get('poly'):
        raise ValueError('Invalid layout')
    items = layout['items']
    if any(not isinstance(item, dict) or not isinstance(item.get('id'), str) for item in items):
        raise ValueError('Invalid layout item IDs')
    item_ids = {item['id'] for item in items}
    objects = data.get('objects')
    if (len(item_ids) != len(items) or not isinstance(objects, list) or len(objects) != len(items)
            or any(not isinstance(obj, dict) or not isinstance(obj.get('label'), int)
                   or not isinstance(obj.get('id'), str) or isinstance(obj['label'], bool)
                   or not 0 < obj['label'] <= 0xffffff for obj in objects)
            or {obj.get('id') for obj in objects} != item_ids
            or len({obj['label'] for obj in objects}) != len(objects)):
        raise ValueError('Expected complete unique item-ID map')
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
    if os.environ.get(PREVIEW_ENV, '').lower() not in ('1', 'true', 'yes'):
        return
    if PREVIEW is None or PREVIEW.poll() is not None:
        env = {k:v for k,v in os.environ.items() if k not in ('PYTHONPATH','PYTHONHOME')}
        STORE.mkdir(parents=True, exist_ok=True)
        with open(STORE/'preview-worker.log','ab') as log:
            PREVIEW = subprocess.Popen([PYTHON, str(ROOT/'tools/real_preview.py')], env=env, stdout=log, stderr=log)


def run_job(d):
    env = {k:v for k,v in os.environ.items() if k not in ('PYTHONPATH','PYTHONHOME')}
    # Preserve the backend selected when this immutable capture was queued.
    backend = read(d/'capture.json', {}).get('backend')
    if backend is not None:
        env['GARDEN_REAL_BACKEND'] = backend
    try:
        with open(d/'render.log','ab') as log:
            result = subprocess.run([PYTHON, str(ROOT/'tools/render_real.py'), str(d), '--camera'], env=env, stdout=log, stderr=log, timeout=900)
        if result.returncode:
            s = read(d/'status.json', {})
            s.update(state='alignment-rejected' if s.get('hq') else 'failed', error='Real worker failed; see render.log', rc=result.returncode)
            (d/'status.json').write_text(json.dumps(s))
    except Exception as exc:
        s = read(d/'status.json', {})
        s.update(state='alignment-rejected' if s.get('hq') else 'failed', error=str(exc))
        (d/'status.json').write_text(json.dumps(s))
    finally:
        with LOCK:
            ACTIVE.pop(d.name, None)


def handle(h, method, path):
    if not path.startswith('/api/real/'):
        return False
    STORE.mkdir(parents=True, exist_ok=True)
    if method == 'GET' and path == '/api/real/photos':
        photos = []
        for parent in STORE.iterdir():
            if not re.fullmatch('[a-f0-9]{24}', parent.name) or parent.is_symlink() or not parent.is_dir(): continue
            for child in parent.iterdir():
                d = safe_job(parent.name, child.name)
                if d is None or not d.is_dir() or (d/'deleted.json').exists() or not (d/'real.png').is_file(): continue
                photos.append(job_record(d))
        photos.sort(key=lambda shot: (shot['created'], shot['revision'], shot['id']), reverse=True)
        h.send_json(200, {'photos': photos})
        return True
    match = re.fullmatch(r'/api/real/photo/([a-f0-9]{24})/([a-f0-9]{24})/delete', path)
    if method == 'POST' and match:
        rev, rid = match.groups()
        with LOCK:
            d = safe_job(rev, rid)
            if d is None or not d.is_dir():
                h.send_json(404, {'error': 'No such photo'})
                return True
            with open(d.parent/'publication.lock', 'a') as publication:
                fcntl.flock(publication, fcntl.LOCK_EX)
                if not (d/'deleted.json').exists():
                    with tempfile.NamedTemporaryFile(mode='w', dir=d, prefix='.deleted-', delete=False) as output:
                        output.write(canonical({'id': rid, 'revision': rev, 'deleted': time.time()}))
                        tmp = Path(output.name)
                    tmp.replace(d/'deleted.json')
                scene = read(d.parent/'scene.json', {})
                if rid in scene.get('views', []):
                    tmp = d.parent/'scene.delete.tmp'
                    tmp.write_text(canonical({'revision':rev, 'views':[], 'count':0}))
                    tmp.replace(d.parent/'scene.json')
            # Retain immutable inputs/images, including while a worker is reading them.
            # Tombstones govern all publication paths and survive service restarts.
        h.send_json(200, {'ok': True, 'id': rid, 'revision': rev, 'deleted': True})
        return True
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
            if data.get('explicit') is not True:
                raise ValueError('Camera photos require explicit: true; automatic capture is disabled')
            layout, camera, raw = validate(data)
            backend = real_backend()
            rev = revision(layout)
            # Quantize only for cache lookup, never for the actual camera/render.
            pose = {k:[round(x,3) for x in camera[k]] for k in ('position','quaternion')}
            pose.update(fov=round(camera['fov'],2), aspect=round(camera['aspect'],3))
            rid = hashlib.sha256(canonical({'revision':rev,'pose':pose,'pipeline':PIPELINE,'backend':backend}).encode()).hexdigest()[:24]
            if data.get('retry'):
                rid=hashlib.sha256((rid+'retry-1').encode()).hexdigest()[:24]
            d = STORE/rev/rid
            with LOCK:
                if safe_job(rev, rid) is None:
                    raise ValueError('Unsafe job path')
                if (d/'deleted.json').exists():
                    return h.send_json(410, {'error': 'Photo deleted', 'id': rid, 'revision': rev}) or True
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
                capture = {k:data[k] for k in ('camera','depth','objects','captureMs') if k in data} | {'depth':{k:v for k,v in data['depth'].items() if k!='data'}, 'revision':rev, 'pipeline':PIPELINE, 'backend':backend, 'explicit':True}
                (d/'capture.json').write_text(canonical(capture))
                (d/'layout.json').write_text(canonical(layout))
                capture['visiblePlants'] = visible_plants(d)
                (d/'capture.json').write_text(canonical(capture))
                (d/'status.json').write_text(json.dumps({'state':'queued','pipeline':PIPELINE,'explicit':True,'revision':rev,'id':rid,'created':time.time(),
                                                        **backend_metadata(backend),'timings':{'captureMs':data.get('captureMs')}}))
                ACTIVE[rid] = True
                start_preview()
                threading.Thread(target=run_job,args=(d,),daemon=True).start()
            h.send_json(202, {'id':rid,'revision':rev,'cached':False})
        except (ValueError,KeyError,TypeError,OverflowError,struct.error,zlib.error) as exc:
            h.send_json(400, {'error':str(exc)})
        return True
    match = re.fullmatch(r'/api/real/([a-f0-9]{24})/(views|scene)', path)
    if method == 'GET' and match:
        rev, kind = match.groups()
        d = STORE/rev
        if kind == 'views':
            views = []
            if d.is_dir() and not d.is_symlink():
                for child in sorted(d.iterdir()):
                    if safe_job(rev, child.name) is not None and child.is_dir() and not (child/'deleted.json').exists():
                        views.append(job_record(child))
            views.sort(key=lambda shot: shot['created'], reverse=True)
            h.send_json(200, {'revision':rev,'views':views,'scene':scene_for(rev)})
        else:
            h.send_json(200, scene_for(rev))
        return True
    h.send_json(404, {'error':'No such Real route'})
    return True
