"""Turn a garden_room render request into a photoreal image + a 360 look-around panorama.

Run with the ComfyUI venv (has the ChatGPT-subscription gpt-image-2 route):
  env -u PYTHONPATH -u PYTHONHOME $PRIVATE_DATA tools/render_real.py data/renders/<id> [--pano-only|--image-only|--splat-only]
Inputs in the request dir: view.jpg (3D screenshot), top.jpg (top view), layout.json.
Outputs: real.png, pano.png (2:1 equirect), world.ply (SHARP 3DGS), provenance.json, status.json.
"""
import base64, hashlib, importlib.util, io, json, os, shutil, subprocess, sys, time, threading
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("codex_image", "$PRIVATE_DATA")
codex = importlib.util.module_from_spec(spec); spec.loader.exec_module(codex)

SHARP = "$PRIVATE_DATA"
SHARP_CKPT = "$PRIVATE_DATA"
ROOM_REFS = ["20261018_121323.jpg", "20261018_121353.jpg"]  # dining room as it is today


def b64(img, max_side=1280):
    im = img if isinstance(img, Image.Image) else Image.open(img).convert("RGB")
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
        if area<30:continue
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
    layout = json.loads((d / 'layout.json').read_text())
    width, height = capture['depth']['width'], capture['depth']['height']
    timings = {'captureMs': json.loads((d/'status.json').read_text()).get('timings',{}).get('captureMs')}
    started = time.perf_counter()
    refs = [b64(ROOT/'refs'/name) for name in ROOM_REFS]
    sheet = b64(ROOT/'work/cutouts_sheet2.jpg')
    prompt = ("Render image 1 as a photoreal smartphone interior photo, NOT a new design. IMAGE 1 IS THE EXACT CAMERA AND LAYOUT: "
        "keep its framing, perspective, object silhouettes, positions, sizes, number, overlaps, crop and empty spaces precisely. "
        "Do not move the camera, do not invent a ceiling, walls or furniture outside its visible geometry; if this is an open "
        "cutaway dollhouse view preserve the cutaway. Images 2 and 3 are MATERIAL/IDENTITY references of the same real room "
        "before rearrangement, NOT layout references. Image 4 is the actual plants and pots inventory. "
        "Beige painted walls, white chair rail and wainscoting, beige carpet, burgundy curtains, white top-freezer refrigerator, "
        "ornate dark wood glass-front china hutch, dark rectangular dining table, small black metal/glass tables. "
        "Use the real plant shapes and pot colours in image 4, no generic replacement plants. North window diffuse daylight, "
        "soft grow lights. No people, no labels, no text, no collages, no duplicate plants. "
        f"Output exactly the same aspect as image 1 ({width}:{height}). Layout inventory: {describe(layout)}. "
        f"Exact camera vertical FOV {capture['camera']['fov']} degrees; all positions in metres. "
        "The source planning render is authoritative even when reference photos differ.")

    def generate():
        if (d/'real.png').exists() and (d/'provenance.json').exists():
            previous=json.loads((d/'provenance.json').read_text()).get('real.png')
            if previous:return previous
        t = time.perf_counter()
        image = codex.generate(prompt, [b64(d/'view.jpg'), *refs, sheet], timeout=360)
        raw_size = image.size
        image.save(d/'real.raw.png')
        image.resize((width,height),Image.Resampling.LANCZOS).save(d/'real.png')
        return {'route':'ChatGPT subscription image_generation (gpt-image-2)', 'prompt':prompt,
                'rawSize':raw_size,'size':[width,height],'seconds':time.perf_counter()-t,
                'sha256':hashlib.sha256((d/'real.png').read_bytes()).hexdigest()}

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

    status(d,state='generating',timings=timings)
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        pending_preview=pool.submit(make_preview)
        provenance=generate()
        timings['hqMs']=provenance['seconds']*1000
        timings['hqElapsedMs']=(time.perf_counter()-started)*1000
        (d/'provenance.json').write_text(json.dumps({'real.png':provenance},indent=2))
        consistency=check_consistency(d,capture)
        (d/'consistency.json').write_text(json.dumps(consistency,indent=2))
        if not consistency['accepted']:
            status(d,state='needs-review',hq=False,consistency=consistency,timings=timings.copy(),
                   error='Generated view lost foliage at most expected plant positions. Tap Real status to regenerate; image not fused.')
            return
        # Publish HQ immediately even if the local GPU preview is still cold.
        status(d,state='photoreal',hq=True,consistency=consistency,timings=timings.copy())
        pending_preview.result()
    try:
        preview_call('/unload')
        status(d,state='splatting',hq=True,timings=timings)
        env={k:v for k,v in os.environ.items() if k not in ('PYTHONPATH','PYTHONHOME')}
        subprocess.run(['$PRIVATE_DATA',
            str(ROOT/'tools/real_sharp.py'),str(d)],check=True,env=env,timeout=300)
        alignment=json.loads((d/'alignment.json').read_text())
        timings.update(alignment['timings'])
        state='ready' if alignment['accepted'] else 'alignment-rejected'
        status(d,state=state,hq=True,alignment=alignment,timings=timings,
               elapsedMs=(time.perf_counter()-started)*1000)
    except Exception as exc:
        status(d,state='alignment-rejected',hq=True,error=str(exc),timings=timings)


def main():
    d = Path(sys.argv[1]).resolve(); mode = sys.argv[2] if len(sys.argv) > 2 else ""
    if mode == '--camera':
        return camera_pipeline(d)
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
        img = codex.generate(base + " Same camera angle as image 3.", [*refs, b64(d / "view.jpg"), b64(d / "top.jpg"), sheet], size="1536x1024")
        img.save(d / "real.png")
        prov["real.png"] = {"route": "chatgpt-subscription image_generation (gpt-image-2)", "prompt": base, "size": img.size,
                            "seconds": round(time.time() - t, 1), "sha256": hashlib.sha256((d / "real.png").read_bytes()).hexdigest()}
        (d / "provenance.json").write_text(json.dumps(prov, indent=1))
    if mode not in ("--image-only", "--splat-only"):
        t = time.time()
        real = [b64(d / "real.png")] if (d / "real.png").exists() else []
        pano_prompt = (base + " Output a seamless 360-degree equirectangular panorama (2:1, full horizontal wrap, horizon at the "
                       "vertical middle) taken from the middle of the room at standing eye height, so the left and right edges join.")
        img = codex.generate(pano_prompt, [*refs, b64(d / "view.jpg"), b64(d / "top.jpg"), sheet, *real], size="1536x768")
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
