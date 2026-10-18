"""Turn a garden_room render request into a photoreal image + a 360 look-around panorama.

Run with the ComfyUI venv (has the ChatGPT-subscription gpt-image-2 route):
  env -u PYTHONPATH -u PYTHONHOME $PRIVATE_DATA tools/render_real.py data/renders/<id> [--pano-only|--image-only|--splat-only]
Inputs in the request dir: view.jpg (3D screenshot), top.jpg (top view), layout.json.
Outputs: real.png, pano.png (2:1 equirect), world.ply (SHARP 3DGS), provenance.json, status.json.
"""
import base64, hashlib, importlib.util, io, json, os, shutil, subprocess, sys, time
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


def status(d, **kw):
    s = json.loads((d / "status.json").read_text()) if (d / "status.json").exists() else {}
    s.update(kw); (d / "status.json").write_text(json.dumps(s))


def main():
    d = Path(sys.argv[1]).resolve(); mode = sys.argv[2] if len(sys.argv) > 2 else ""
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
