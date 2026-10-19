"""Turn a garden_room render request into a photoreal image + a 360 look-around panorama.

Run with the ComfyUI venv (has the ChatGPT-subscription gpt-image-2 route):
  env -u PYTHONPATH -u PYTHONHOME $PRIVATE_DATA tools/render_real.py data/renders/<id> [--pano-only|--image-only|--splat-only]
Inputs in the request dir: view.jpg (3D screenshot), top.jpg (top view), layout.json.
Camera outputs: real.png, coarse.splat, fine.splat, provenance.json, status.json.
Camera lift defaults to a CPU procedural depth shell. GARDEN_REAL_BACKEND=sharp-research
explicitly selects Apple SHARP AMLR research weights, which exclude product development.
"""
import base64, hashlib, importlib.util, io, json, os, shutil, subprocess, sys, time, threading
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('real_route_helpers', ROOT/'routes/real.py')
route_helpers = importlib.util.module_from_spec(spec); spec.loader.exec_module(route_helpers)


def generate_image(prompt, images, **kwargs):
    # Import subscription/torch dependencies only when a generation is requested.
    spec = importlib.util.spec_from_file_location('codex_image', '$PRIVATE_DATA')
    codex = importlib.util.module_from_spec(spec); spec.loader.exec_module(codex)
    return codex.generate(prompt, images, **kwargs)

SHARP = "$PRIVATE_DATA"
SHARP_CKPT = "$PRIVATE_DATA"
ROOM_REFS = ["20261018_121323.jpg", "20261018_121353.jpg"]  # dining room as it is today


def b64(img, max_side=1280):
    im = img if isinstance(img, Image.Image) else Image.open(img).convert("RGBA")
    im = im.copy(); im.thumbnail((max_side, max_side))
    buf = io.BytesIO(); im.save(buf, "PNG"); return base64.b64encode(buf.getvalue()).decode()


def describe(layout):
    names = [i["name"] for i in layout.get("items", []) if i.get("kind") == "plant"]
    lights = [i["name"] for i in layout.get("items", []) if i.get("kind") in ("led", "stake", "lamp5", "ring")]
    return f"{len(names)} potted plants ({', '.join(names)}); grow lights: {', '.join(lights)}"


STATUS_LOCK = threading.Lock()


def status(d, **kw):
    with STATUS_LOCK:
        s = json.loads((d / "status.json").read_text()) if (d / "status.json").exists() else {}
        s.update(kw)
        tmp=d/'status.worker.tmp';tmp.write_text(json.dumps(s));tmp.replace(d/'status.json')


def camera_inputs(d, capture, layout):
    """Freeze ordered conditioning inputs and the exact visible instance inventory."""
    import re
    import numpy as np
    width, height = capture['depth']['width'], capture['depth']['height']
    depth = np.fromfile(d/'depth.f32', dtype='<f4').reshape(height, width)
    valid = np.isfinite(depth) & (depth > .05) & (depth < 40)
    if not valid.any(): raise ValueError('No valid camera depth for layout guide')
    near, far = np.percentile(depth[valid], [2, 98])
    intensity = (1-(depth-near)/max(float(far-near), .1)).clip(0, 1)
    guide = np.where(valid, .05+.95*intensity, 0)  # reserve black for absent geometry
    Image.fromarray((guide*255).astype('uint8')).convert('RGB').save(d/'depth-guide.png')
    plants = route_helpers.visible_plants(d)
    by_id = {item['id']: item for item in layout['items']}
    sources = [(d/'view.jpg', 'beauty', {}), (d/'depth-guide.png', 'depth-layout', {})]
    sources += [(ROOT/'refs'/name, 'room-identity-style', {}) for name in ROOM_REFS]
    for plant in plants:
        src = by_id[plant['id']].get('src', '')
        match = re.fullmatch(r'/?plants/(p[0-9]{2})\.webp', src)
        if match is None:
            raise ValueError('Visible plant has no safe inventory cutout: '+plant['id'])
        path = ROOT/'public/plants'/(match[1]+'.webp')
        if path.is_symlink() or not path.is_file():
            raise ValueError('Visible plant cutout unavailable: '+plant['id'])
        sources.append((path, 'plant-cutout', {'plantId': plant['id'], 'bbox': plant['bbox']}))
    images, records = [], []
    for index, (path, role, extra) in enumerate(sources, 1):
        encoded = b64(path)
        images.append(encoded)
        records.append({'image': index, 'role': role, 'path': str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else path.name,
                        'sha256': hashlib.sha256(base64.b64decode(encoded)).hexdigest(),
                        'sourceSha256': hashlib.sha256(path.read_bytes()).hexdigest(), **extra})
    prompt = (
        'Convert image 1, the authoritative beauty render, into a photoreal smartphone photograph of this exact room and camera. '
        'Preserve camera framing, perspective, object silhouettes, positions, sizes, overlaps, crop, empty space and visible plant count. '
        'Image 2 is the camera-Z depth visualization and LAYOUT GUIDE, brighter means nearer; black means no measured surface. '
        'Respect its occlusions and spatial layout. Images 3 and 4 are private photographs of this room for furniture identity, '
        'materials and style only; their older arrangement must not override images 1 and 2. '
        'The remaining images are INDIVIDUAL plant and pot identity cutouts, one for EVERY visible instance listed below. '
        'Use each assigned cutout at its listed normalized bounding box [left, top, right, bottom], origin top left, values in [0,1]. '
        'Keep the precise leaf shapes, pot colors and existing pot patterns shown by that cutout. '
        'No hallucinated decor, added furniture, invented pot patterns, extra plants, missing plants, labels, text, people or collages. '
        'No purple spill, purple bands or invented colored grow-light reflections on pots or furniture. '
        'Keep daylight and grow lights natural and restrained. Preserve cutaway/open geometry if present; do not invent hidden walls or ceilings. '
        f'Output exactly {width}:{height}. Exact camera, in metres, with vertical FOV in degrees: '
        + json.dumps(capture['camera'], sort_keys=True) + '. Visible plants: '
        + json.dumps([dict(plant, image=5+i) for i, plant in enumerate(plants)], sort_keys=True)
        + '. The planning render and depth guide remain authoritative when room reference photos disagree.')
    provenance = {'pipeline': 3, 'inputs': records, 'visiblePlants': plants,
                  'depthGuide': {'nearM': float(near), 'farM': float(far), 'brighter': 'nearer', 'invalid': 'black'},
                  'captureSha256': hashlib.sha256((d/'capture.json').read_bytes()).hexdigest(),
                  'layoutSha256': hashlib.sha256((d/'layout.json').read_bytes()).hexdigest(),
                  'depthSha256': hashlib.sha256((d/'depth.f32').read_bytes()).hexdigest(),
                  'idsSha256': hashlib.sha256((d/'ids.png').read_bytes()).hexdigest()}
    return prompt, images, provenance


def check_consistency(d, capture, filename='real.png'):
    """Independent gross foliage-loss guard; deliberately not called object counting."""
    import numpy as np
    import cv2
    image=np.asarray(Image.open(d/filename).convert('RGB'))
    ids=np.asarray(Image.open(d/'ids.png').convert('RGB'))
    labels=ids[:,:,0].astype('int32')+256*ids[:,:,1].astype('int32')+65536*ids[:,:,2].astype('int32')
    hsv=cv2.cvtColor(image,cv2.COLOR_RGB2HSV)
    green=(hsv[:,:,0]>22)&(hsv[:,:,0]<100)&(hsv[:,:,1]>35)&(hsv[:,:,2]>25)
    checks=[]
    for obj in capture.get('objects',[]):
        if obj.get('kind')!='plant':continue
        mask=(labels==obj['label']).astype('uint8')
        area=int(mask.sum())
        if area<=20:continue
        mask=cv2.dilate(mask,np.ones((17,17),dtype='uint8'))>0
        fraction=float(green[mask].mean())
        checks.append({'id':obj['id'],'visiblePixels':area,'greenSupport':fraction,'supported':fraction>.025})
    supported=sum(x['supported'] for x in checks)/max(1,len(checks))
    return {'method':'ID-pass foliage colour support (weak gross-drift proxy, not count verification)',
            'objects':checks,'supportedFraction':supported,'accepted':not checks or supported>=.5,
            'limitation':'Cannot certify species, counts, furniture identity or geometry from colour alone'}


def camera_pipeline(d):
    """Exact-view image generation; no invented panoramas or uncalibrated world."""
    import concurrent.futures
    import http.client
    import socket
    import numpy as np
    import cv2
    capture = json.loads((d / 'capture.json').read_text())
    backend = route_helpers.real_backend(capture.get('backend'))
    layout = json.loads((d / 'layout.json').read_text())
    width, height = capture['depth']['width'], capture['depth']['height']
    timings = {'captureMs': json.loads((d/'status.json').read_text()).get('timings',{}).get('captureMs')}
    started = time.perf_counter()
    preview_enabled = os.environ.get('REAL_RESEARCH_PREVIEW', '').lower() in ('1', 'true', 'yes')
    if (d/'deleted.json').exists(): return

    def generate():
        if (d/'real.png').exists() and (d/'provenance.json').exists():
            previous=route_helpers.read(d/'provenance.json', {}).get('real.png')
            if previous:return previous
        if not (d/'real.png').exists() and (d/'real.raw.png').exists():
            # A process may have stopped between the raw save and final HQ resize.
            with Image.open(d/'real.raw.png') as recovered:
                recovered.resize((width,height),Image.Resampling.LANCZOS).save(d/'real.tmp.png')
            (d/'real.tmp.png').replace(d/'real.png')
        if (d/'real.png').exists():
            # An interrupted provenance write must never repurchase an existing HQ.
            return {**route_helpers.read(d/'conditioning.json', {}),
                    'route': 'recovered durable HQ; original generation receipt unavailable', 'seconds': 0,
                    'sha256': hashlib.sha256((d/'real.png').read_bytes()).hexdigest(),
                    'visiblePlants': route_helpers.visible_plants(d), 'provenanceGap': True}
        prompt, inputs, conditioning = camera_inputs(d, capture, layout)
        (d/'conditioning.json').write_text(json.dumps({'prompt':prompt, **conditioning}, indent=2))
        t = time.perf_counter()
        image = generate_image(prompt, inputs, timeout=360)
        raw_size = image.size
        image.save(d/'real.raw.png')
        image.resize((width,height),Image.Resampling.LANCZOS).save(d/'real.tmp.png')
        (d/'real.tmp.png').replace(d/'real.png')
        return {'route':'ChatGPT subscription image_generation (gpt-image-2)', 'prompt':prompt,
                'rawSize':raw_size,'size':[width,height],'seconds':time.perf_counter()-t,
                'sha256':hashlib.sha256((d/'real.png').read_bytes()).hexdigest(), **conditioning}

    class UnixConnection(http.client.HTTPConnection):
        def connect(self):
            self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
            self.sock.settimeout(self.timeout);self.sock.connect(str(ROOT/'work/real-preview.sock'))

    def preview_call(route):
        for _ in range(100):
            if (ROOT/'work/real-preview.sock').exists():break
            time.sleep(.1)
        c=UnixConnection('localhost',timeout=180)
        try:
            c.request('POST',route,body=json.dumps({'directory':str(d)}),headers={'Content-Type':'application/json'})
            r=c.getresponse();data=json.loads(r.read())
            if r.status!=200:raise RuntimeError(data.get('error','Preview unavailable'))
            return data
        finally:c.close()

    def make_preview():
        try:
            previous=json.loads((d/'status.json').read_text())
            preview=previous.get('previewModel') if (d/'preview.png').exists() else None
            if preview is None:preview=preview_call('/preview')
            check=check_consistency(d,capture,'preview.png')
            (d/'preview-consistency.json').write_text(json.dumps(check,indent=2))
            timings['previewMs']=preview['totalMs'];timings['previewElapsedMs']=(time.perf_counter()-started)*1000
            # HQ may finish before a cold model load. Never downgrade it to preview.
            current=json.loads((d/'status.json').read_text())
            status(d,state=current['state'] if current.get('hq') or current.get('state')=='needs-review' else 'preview',
                   preview=check['accepted'],previewModel=preview,previewConsistency=check,timings=timings.copy())
        except Exception as exc:
            status(d,previewError=str(exc),timings=timings.copy())

    status(d,state='generating',preview=False,previewEnabled=preview_enabled,timings=timings,
           **route_helpers.backend_metadata(backend))
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        pending_preview=pool.submit(make_preview) if preview_enabled else None
        provenance=generate()
        timings['hqMs']=provenance['seconds']*1000
        timings['hqElapsedMs']=(time.perf_counter()-started)*1000
        (d/'provenance.json').write_text(json.dumps({'real.png':provenance},indent=2))
        # A durable photo remains available even when checks or Gaussian lifting fail.
        status(d,state='photoreal',hq=True,visiblePlants=provenance.get('visiblePlants', []),timings=timings.copy())
        if (d/'deleted.json').exists(): return
        consistency=check_consistency(d,capture)
        (d/'consistency.json').write_text(json.dumps(consistency,indent=2))
        if not consistency['accepted']:
            status(d,state='needs-review',hq=True,consistency=consistency,timings=timings.copy(),
                   error='Generated view lost foliage at most expected plant positions. Tap Real status to regenerate; image not fused.')
            return
        # Publish HQ immediately even if the local GPU preview is still cold.
        status(d,state='photoreal',hq=True,consistency=consistency,timings=timings.copy())
        if pending_preview is not None: pending_preview.result()
    try:
        if (d/'deleted.json').exists(): return
        if preview_enabled:
            try: preview_call('/unload')
            except Exception as exc: status(d,previewError=str(exc))
        status(d,state='splatting',hq=True,timings=timings)
        if backend == 'sharp-research':
            print(route_helpers.SHARP_LICENSE, file=sys.stderr)
            env={k:v for k,v in os.environ.items() if k not in ('PYTHONPATH','PYTHONHOME')}
            command = ['$PRIVATE_DATA', str(ROOT/'tools/real_sharp.py'),str(d)]
            if (d/'sharp.ply').exists(): command.append('--align-only')
            subprocess.run(command,check=True,env=env,timeout=300)
            alignment=json.loads((d/'alignment.json').read_text())
        else:
            spec=importlib.util.spec_from_file_location('real_depth_shell',ROOT/'tools/real_depth_shell.py')
            shell=importlib.util.module_from_spec(spec);spec.loader.exec_module(shell)
            alignment=shell.run(d)
            if alignment is None: return
        timings.update(alignment['timings'])
        state='ready' if alignment['accepted'] else 'alignment-rejected'
        status(d,state=state,hq=True,alignment=alignment,timings=timings,
               elapsedMs=(time.perf_counter()-started)*1000)
    except Exception as exc:
        status(d,state='alignment-rejected',hq=True,error=str(exc),timings=timings)


def main():
    d = Path(sys.argv[1]).resolve(); mode = sys.argv[2] if len(sys.argv) > 2 else ""
    captured = (d/'capture.json').is_file() and (d/'depth.f32').is_file()
    if mode == '--camera' or (captured and mode in ('', '--splat-only')):
        if mode == '--splat-only' and not (d/'real.png').is_file():
            raise ValueError('--splat-only requires an existing HQ real.png')
        return camera_pipeline(d)
    backend = route_helpers.real_backend()
    if backend != 'sharp-research' and mode != '--image-only':
        raise ValueError('Default depth shell requires capture.json and exact captured depth.f32')
    if backend == 'sharp-research':
        print(route_helpers.SHARP_LICENSE, file=sys.stderr)
        status(d, **route_helpers.backend_metadata(backend))
    layout = json.loads((d / "layout.json").read_text())
    note = json.loads((d / "status.json").read_text()).get("note", "") if (d / "status.json").exists() else ""
    refs = [b64(ROOT / "refs" / r) for r in ROOM_REFS]
    sheet = b64(ROOT / "work" / "cutouts_sheet2.jpg")
    prov = json.loads((d / "provenance.json").read_text()) if (d / "provenance.json").exists() else {}
    base = ("Photograph of the owner's real dining room (about 12x12 ft, five walls: one corner is cut by a short angled wall holding an "
            "arched kitchen doorway; beige walls, white wainscoting, tray ceiling, black wrought-iron chandelier, beige carpet, window with "
            "dark curtains, white top-freezer fridge in the corner, dark wood glass-front china cabinet, the dark dining table pushed against "
            "the window wall and used as a plant shelf with pots on top, two small black-framed glass tables). Images 1-2 are the real room today. "
            "Image 3 is a 3D planning render of the NEW arrangement: keep every object exactly where it is in image 3 and the top-view "
            "plan in image 4. Image 5 shows the real plants and pots; reuse those exact plants and pots. "
            f"Contents: {describe(layout)}. Fridge door area stays clear. Natural daylight from the window, grow lights glowing softly. "
            "Photorealistic, true-to-life smartphone photo, no text, no labels, no people. " + (f"Owner note: {note}" if note else ""))
    status(d, state="rendering")
    if mode not in ("--pano-only", "--splat-only"):
        t = time.time()
        img = generate_image(base + " Same camera angle as image 3.", [*refs, b64(d / "view.jpg"), b64(d / "top.jpg"), sheet], size="1536x1024")
        img.save(d / "real.png")
        prov["real.png"] = {"route": "chatgpt-subscription image_generation (gpt-image-2)", "prompt": base, "size": img.size,
                            "seconds": round(time.time() - t, 1), "sha256": hashlib.sha256((d / "real.png").read_bytes()).hexdigest()}
        (d / "provenance.json").write_text(json.dumps(prov, indent=1))
    if mode not in ("--image-only", "--splat-only"):
        t = time.time()
        real = [b64(d / "real.png")] if (d / "real.png").exists() else []
        pano_prompt = (base + " Output a seamless 360-degree equirectangular panorama (2:1, full horizontal wrap, horizon at the "
                       "vertical middle) taken from the middle of the room at standing eye height, so the left and right edges join.")
        img = generate_image(pano_prompt, [*refs, b64(d / "view.jpg"), b64(d / "top.jpg"), sheet, *real], size="1536x768")
        w, h = img.size
        if abs(w / h - 2) > 0.02:  # crop to exactly 2:1 around the centre
            if w / h > 2: nw = 2 * h; img = img.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
            else: nh = w // 2; img = img.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
        img.save(d / "pano.png")
        prov["pano.png"] = {"route": "chatgpt-subscription image_generation (gpt-image-2)", "prompt": pano_prompt, "raw_size": (w, h),
                            "size": img.size, "seconds": round(time.time() - t, 1), "sha256": hashlib.sha256((d / "pano.png").read_bytes()).hexdigest()}
        (d / "provenance.json").write_text(json.dumps(prov, indent=1))
    if mode != "--image-only" and (d / "real.png").exists():  # SHARP: photo -> metric 3D Gaussian splat (~25 s on the 3080 Ti)
        t = time.time(); tmp = d / "_sharp_in"; tmp.mkdir(exist_ok=True); (tmp / "real.png").write_bytes((d / "real.png").read_bytes())
        status(d, state="splatting")
        subprocess.run([SHARP, "predict", "-i", str(tmp), "-o", str(d / "_sharp_out"), "-c", SHARP_CKPT], check=True,
                       env={k: v for k, v in os.environ.items() if k not in ("PYTHONPATH", "PYTHONHOME")})
        (d / "_sharp_out" / "real.ply").replace(d / "world.ply"); shutil.rmtree(tmp); shutil.rmtree(d / "_sharp_out")
        prov["world.ply"] = {"route": "apple/ml-sharp predict (local GPU)", "checkpoint": SHARP_CKPT, "input": "real.png",
                             "seconds": round(time.time() - t, 1), "size": (d / "world.ply").stat().st_size}
        (d / "provenance.json").write_text(json.dumps(prov, indent=1))
    status(d, state="done")
    print(json.dumps({k: {kk: v.get(kk) for kk in ("size", "seconds")} for k, v in prov.items()}))


if __name__ == "__main__":
    main()
