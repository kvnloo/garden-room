#!/usr/bin/env python3
"""Private, incremental photo history. Run with .venv/bin/python tools/history_index.py.

Bounded libvips decoding; Samsung compressed DNGs use LibRaw's embedded JPEG
(no raw pixel array). All GPU inputs come from <=1600px derivatives. Source
paths are private and never returned by the HTTP timeline API. Models stay local.
"""
import argparse, ast, concurrent.futures, hashlib, io, json, os, re, subprocess, time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/history'
WORK = ROOT / 'work/history'
os.environ.setdefault('HF_HOME', str(ROOT / 'work/models/hf'))
os.environ.setdefault('TORCH_HOME', str(ROOT / 'work/models/torch'))
os.environ.setdefault('VIPS_CONCURRENCY', '2')
SOURCES = [Path('$PRIVATE_DATA'), Path('$PRIVATE_DATA'), Path('$PRIVATE_DATA Desktop')]
EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.heic', '.dng'}


def atomic(path, obj):
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1))
    tmp.replace(path)


def metadata(p, manifest):
    from PIL import Image
    raw = None
    try:
        with Image.open(p) as im:
            ex = im.getexif()
            raw = ex.get_ifd(34665).get(36867) or ex.get(306)
    except Exception:
        pass
    entry = manifest.get(p.name, {})
    raw = raw or entry.get('exif', {}).get('captured_at_raw')
    if not raw and p.suffix.lower() == '.dng':
        r = subprocess.run(['exiv2', '-K', 'Exif.Photo.DateTimeOriginal', '-Pv', str(p)], capture_output=True, text=True, timeout=30)
        raw = r.stdout.strip()
    if raw:
        try:
            return datetime.strptime(raw[:19], '%Y:%m:%d %H:%M:%S').astimezone().isoformat(), 'exif'
        except ValueError:
            pass
    m = re.search(r'(20\d{6})[_-](\d{6})', p.name)
    if m:
        try:
            return datetime.strptime(''.join(m.groups()), '%Y%m%d%H%M%S').astimezone().isoformat(), 'filename'
        except ValueError:
            pass
    return datetime.fromtimestamp(p.stat().st_mtime).astimezone().isoformat(), 'mtime'


def decode(p, old, manifest):
    from PIL import Image, ImageOps
    pid = hashlib.sha1(str(p).encode()).hexdigest()[:12]
    small, big = OUT / 'thumbs' / f'{pid}_512.webp', OUT / 'thumbs' / f'{pid}_1600.webp'
    stat = p.stat()
    fingerprint = [stat.st_size, stat.st_mtime_ns]
    cached = old.get(pid)
    if cached and cached.get('fingerprint') == fingerprint and small.exists() and big.exists():
        return cached
    if small.exists() and big.exists() and not cached:
        ts, date_source = metadata(p, manifest)
        with Image.open(big) as im:
            dimensions = list(im.size)
        return dict(id=pid, ts=ts, dateSource=date_source, src=str(p), fingerprint=fingerprint,
                    thumb512=f'/history/thumbs/{small.name}', thumb1600=f'/history/thumbs/{big.name}',
                    bytes512=small.stat().st_size, bytes1600=big.stat().st_size, size=dimensions,
                    decode='cached-derivative', description=manifest.get(p.name, {}).get('description', ''), plants=[])
    if cached and cached.get('fingerprint') != fingerprint:
        (WORK / f'{pid}-dino.npz').unlink(missing_ok=True)
        (WORK / f'{pid}-detector.npz').unlink(missing_ok=True)
    tmp = WORK / f'{pid}.jpg'
    method = 'vips'
    try:
        r = subprocess.run(['vips', 'thumbnail', str(p) + ('[unlimited=true]' if p.suffix.lower() == '.heic' else ''), str(tmp), '1600', '--size', 'down'], capture_output=True, timeout=90)
        if r.returncode:
            if p.suffix.lower() != '.dng':
                raise RuntimeError(r.stderr.decode(errors='replace')[-300:])
            # Samsung JPEG-XL DNG compression is not supported by system LibRaw.
            # Extract the camera JPEG, then let vips shrink-on-load it.
            import rawpy
            with rawpy.RawPy() as raw:
                raw.open_file(str(p))  # metadata only: imread() would unpack the raw
                thumb = raw.extract_thumb()
                if thumb.format != rawpy.ThumbFormat.JPEG:
                    raise RuntimeError('DNG has no JPEG preview')
                preview = WORK / f'{pid}-preview.jpg'
                preview.write_bytes(thumb.data)
                flip = raw.sizes.flip
            try:
                subprocess.run(['vips', 'thumbnail', str(preview), str(tmp), '1600'], capture_output=True, check=True, timeout=90)
                # Embedded previews may omit orientation. Match sensor orientation.
                with Image.open(tmp) as src:
                    im = src.copy()
                if im.width > im.height and flip in (5, 6):
                    im = im.transpose(Image.Transpose.ROTATE_270 if flip == 6 else Image.Transpose.ROTATE_90)
                im.save(tmp)
            finally:
                preview.unlink(missing_ok=True)
            method = 'libraw-embedded-jpeg'
        with Image.open(tmp) as src:
            im = ImageOps.exif_transpose(src).convert('RGB')
        im.thumbnail((1600, 1600))
        im.save(big, 'WEBP', quality=74, method=4)
        dimensions = list(im.size)
        im.thumbnail((512, 512))
        im.save(small, 'WEBP', quality=68, method=4)
        ts, date_source = metadata(p, manifest)
        return dict(id=pid, ts=ts, dateSource=date_source, src=str(p), fingerprint=fingerprint,
                    thumb512=f'/history/thumbs/{small.name}', thumb1600=f'/history/thumbs/{big.name}',
                    bytes512=small.stat().st_size, bytes1600=big.stat().st_size, size=dimensions,
                    decode=method, description=manifest.get(p.name, {}).get('description', ''), plants=[])
    finally:
        tmp.unlink(missing_ok=True)


def reference_boxes():
    tree = ast.parse((ROOT / 'tools/cutouts.py').read_text())
    rows = next(ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'PLANTS' for t in n.targets))
    from PIL import Image
    refs = []
    for row in rows:
        pid, name, photo, box = row[:4]
        p = ROOT / 'work/mid' / f'20261018_{photo}.jpg'
        with Image.open(p) as im:
            refs.append((pid, p.name, [round(v / 1024 if i % 2 == 0 else v / (1024 * im.height / im.width), 5) for i, v in enumerate(box)]))
    return refs


def identify(photos, threshold, unsure_threshold):
    import numpy as np
    import torch
    from PIL import Image
    from transformers import AutoImageProcessor, AutoModel
    torch.set_num_threads(4)
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    model = AutoModel.from_pretrained('facebook/dinov2-small').eval().to(device)
    processor = AutoImageProcessor.from_pretrained('facebook/dinov2-small')
    def embed(images):
        chunks = []
        with torch.inference_mode():
            for start in range(0, len(images), 48):
                inp = processor(images=images[start:start+48], return_tensors='pt').to(device)
                with torch.autocast(device_type=device, enabled=device == 'cuda'):
                    vec = model(**inp).last_hidden_state[:, 0].float()
                chunks.append(torch.nn.functional.normalize(vec, dim=-1).cpu().numpy())
        return np.concatenate(chunks)
    def crop(im, box):
        return im.crop(tuple(int(v * (im.width if i % 2 == 0 else im.height)) for i, v in enumerate(box)))
    from torchvision.models.detection import fasterrcnn_resnet50_fpn_v2, FasterRCNN_ResNet50_FPN_V2_Weights
    from torchvision.transforms.functional import to_tensor
    detector = fasterrcnn_resnet50_fpn_v2(weights=FasterRCNN_ResNet50_FPN_V2_Weights.DEFAULT, min_size=512, max_size=768).eval().to(device)
    refs = reference_boxes()
    reference_images, reference_pots = [], []
    for pid, filename, box in refs:
        with Image.open(ROOT / 'work/mid' / filename) as src:
            im = src.convert('RGB')
        c = crop(im, box)
        reference_images += [c, Image.open(ROOT / 'public/plants' / f'{pid}.webp').convert('RGB')]
        reference_pots.append(c.crop((0, int(c.height * .62), c.width, c.height)))
    ref = embed(reference_images).reshape(25, 2, -1)
    pots = embed(reference_pots)
    # Deterministic multiscale object proposals handle multi-plant scenes without
    # an extra detector download. Do not claim these are detector-derived boxes.
    boxes = [[0, 0, 1, 1]] + [[x, y, x+s, y+s] for s, offsets in [(.65, [0, .35]), (.4, [0, .3, .6])] for x in offsets for y in offsets]
    reviews_path = ROOT / 'tools/history_review_decisions.json'
    rejects = json.loads(reviews_path.read_text()).get('reject', {}) if reviews_path.exists() else {}
    for n, photo in enumerate(photos):
        cache = WORK / f'{photo["id"]}-dino.npz'
        if cache.exists():
            a = np.load(cache)
            features, pot_features = a['features'], a['pots']
        else:
            with Image.open(OUT / 'thumbs' / f'{photo["id"]}_1600.webp') as src:
                im = src.convert('RGB')
            crops = [crop(im, b) for b in boxes]
            features = embed(crops)
            pot_features = embed([c.crop((0, int(c.height * .62), c.width, c.height)) for c in crops])
            np.savez_compressed(cache, features=features, pots=pot_features)
        proposal_cache = WORK / f'{photo["id"]}-detector.npz'
        if proposal_cache.exists():
            detected = np.load(proposal_cache)
            detected_boxes, object_features, object_pots = detected['boxes'].tolist(), detected['features'], detected['pots']
        else:
            with Image.open(OUT / 'thumbs' / f'{photo["id"]}_1600.webp') as src:
                im = src.convert('RGB')
            small = im.copy(); small.thumbnail((768, 768))
            with torch.inference_mode():
                prediction = detector([to_tensor(small).to(device)])[0]
            selected = (prediction['labels'] == 64) & (prediction['scores'] >= .55)
            detected_boxes = prediction['boxes'][selected].cpu().numpy()
            detected_boxes = (detected_boxes / np.array([small.width, small.height, small.width, small.height])).clip(0,1).tolist()[:12]
            crops = [crop(im, b) for b in detected_boxes]
            object_features = embed(crops) if crops else np.empty((0, ref.shape[-1]), dtype=np.float32)
            object_pots = embed([c.crop((0, int(c.height*.62), c.width, c.height)) for c in crops]) if crops else object_features.copy()
            np.savez_compressed(proposal_cache, boxes=np.array(detected_boxes).reshape(-1,4), features=object_features, pots=object_pots)
        all_boxes = boxes + detected_boxes
        features = np.concatenate([features, object_features]); pot_features = np.concatenate([pot_features, object_pots])
        # Appearance plus stable pot; full-scene embeddings are NOT used as the
        # reference for individual identity (would label every plant in a room).
        appearance = np.max(np.einsum('bd,pkd->bpk', features, ref), axis=2)
        scores = .85 * appearance + .15 * (pot_features @ pots.T)
        best = scores.max(axis=0)
        chosen = sorted(range(25), key=lambda k: -float(best[k]))[:4]
        matches = []
        for k in chosen:
            score = float(best[k])
            if score >= unsure_threshold:
                bi = int(scores[:, k].argmax())
                matches.append(dict(id=refs[k][0], score=round(score, 4), box=all_boxes[bi], unsure=score < threshold, method='dino-detector+pot' if bi >= len(boxes) else 'dino-multiscale+pot'))
        # Ground-truth current-state source photographs have hand-picked boxes.
        for pid, filename, box in refs:
            if Path(photo['src']).name.lower() == filename.lower():
                matches = [m for m in matches if m['id'] != pid]
                matches.append(dict(id=pid, score=1.0, box=box, unsure=False, method='reference-source'))
        photo['plants'] = [m for m in matches if m['id'] not in rejects.get(photo['id'], []) or m.get('method') == 'reference-source']
        if (n + 1) % 25 == 0:
            print(f'GPU embeddings {n+1}/{len(photos)}', flush=True)
            atomic(OUT / 'index.partial.json', {'photos': photos})
    return dict(model='facebook/dinov2-small', device=device, threshold=threshold, unsureThreshold=unsure_threshold,
                proposals='COCO potted plant FasterRCNN >=.55 + whole + 13 multiscale windows; lower 38% pot comparison', saplingFraction=.15)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--thumbs-only', action='store_true')
    parser.add_argument('--threshold', type=float, default=.86)
    parser.add_argument('--unsure-threshold', type=float, default=.68)
    parser.add_argument('--limit', type=int)
    args = parser.parse_args()
    (OUT / 'thumbs').mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)
    old = json.loads((OUT / 'index.json').read_text()) if (OUT / 'index.json').exists() else {'photos': []}
    old_by_id = {p['id']: p for p in old['photos']}
    manifest_path = SOURCES[1].parent / 'manifest.json'
    manifest = {x['filename']: x for x in json.loads(manifest_path.read_text())['files']} if manifest_path.exists() else {}
    paths = sorted({p for root in SOURCES for p in root.rglob('*') if p.is_file() and p.suffix.lower() in EXTS})
    if args.limit:
        paths = paths[:args.limit]
    photos, errors = [], []
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        jobs = {pool.submit(decode, p, old_by_id, manifest): p for p in paths}
        for n, job in enumerate(concurrent.futures.as_completed(jobs)):
            try:
                photos.append(job.result())
            except Exception as e:
                errors.append({'src': str(jobs[job]), 'error': str(e)[:500]})
            if (n+1) % 50 == 0:
                print(f'Thumbnails {n+1}/{len(paths)}; errors {len(errors)}', flush=True)
    photos.sort(key=lambda p: (p['ts'], p['id']))
    atomic(OUT / 'index.json', dict(photos=photos, plants=old.get('plants', {}), errors=errors))
    if not args.thumbs_only:
        model = identify(photos, args.threshold, args.unsure_threshold)
        plants = {f'p{i:02}': [p['id'] for p in photos if any(a['id'] == f'p{i:02}' for a in p['plants'])] for i in range(1, 26)}
        atomic(OUT / 'index.json', dict(photos=photos, plants=plants, model=model, errors=errors))
    print(json.dumps({'indexed': len(photos), 'discovered': len(paths), 'errors': len(errors), 'assignments': sum(len(p['plants']) for p in photos), 'unsure': sum(a.get('unsure', False) for p in photos for a in p['plants'])}), flush=True)


if __name__ == '__main__':
    main()
