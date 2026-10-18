#!/usr/bin/env python3
"""Make <=768px private contact sheets; no source photos uploaded anywhere."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageOps
ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data/history'
OUT = ROOT / 'work/history-review'
OUT.mkdir(parents=True, exist_ok=True)
a = json.loads((DATA / 'index.json').read_text())
rows = []
for i in range(1, 26):
    pid = f'p{i:02}'
    candidates = [(p, next(m for m in p['plants'] if m['id'] == pid)) for p in a['photos'] if any(m['id'] == pid and m.get('method') != 'reference-source' for m in p['plants'])]
    candidates.sort(key=lambda pair: -pair[1]['score'])
    chosen = candidates[:4]
    rows.append((pid, chosen))
manifest = []
for batch in range(5):
    sheet = Image.new('RGB', (768, 720), '#111b17')
    draw = ImageDraw.Draw(sheet)
    for r, (pid, chosen) in enumerate(rows[batch*5:batch*5+5]):
        y = r * 144
        ref = Image.open(ROOT / 'public/plants' / f'{pid}.webp').convert('RGBA')
        bg = Image.new('RGBA', ref.size, '#273429'); bg.alpha_composite(ref)
        sheet.paste(ImageOps.contain(bg.convert('RGB'), (120, 116)), (0, y+24))
        draw.text((2, y+4), f'{pid} REFERENCE', fill='#edce8a')
        for c, (p, m) in enumerate(chosen, 1):
            im = Image.open(DATA / 'thumbs' / f'{p["id"]}_512.webp').convert('RGB')
            box = m.get('box', [0,0,1,1]); crop = im.crop(tuple(int(v*(im.width if k%2==0 else im.height)) for k,v in enumerate(box)))
            tile = ImageOps.contain(crop, (148, 110))
            x = 128+(c-1)*160
            sheet.paste(tile, (x, y+30))
            draw.text((x, y+2), f'{c} {m["score"]:.3f} {"?" if m["unsure"] else "OK"}', fill='white')
            draw.text((x, y+15), p['ts'][:10], fill='#abb6aa')
            manifest.append({'plant':pid, 'position':c, 'photo':p['id'], 'score':m['score'], 'unsure':m['unsure'], 'sheet':batch+1})
    sheet.save(OUT / f'assignments-{batch+1}.jpg', quality=85)
(OUT / 'sample.json').write_text(json.dumps(manifest, indent=1))
# Final calibration sheet: two non-anchor confident matches plus four unsure
# examples. Keep all six sheets <=768px and preserve exact sample IDs.
selected = []
for pid in ['p06', 'p08', 'p01', 'p03', 'p05', 'p07']:
    candidates = [(p, m) for p in a['photos'] for m in p['plants'] if m['id'] == pid and m['method'] != 'reference-source']
    if candidates:
        selected.append((pid, max(candidates, key=lambda pair: pair[1]['score'])))
sheet = Image.new('RGB', (768, 768), '#111b17'); draw = ImageDraw.Draw(sheet)
final_sample = []
for r, (pid, (p, m)) in enumerate(selected):
    y = r * 128
    ref = Image.open(ROOT / 'public/plants' / f'{pid}.webp').convert('RGBA')
    bg = Image.new('RGBA', ref.size, '#273429'); bg.alpha_composite(ref)
    sheet.paste(ImageOps.contain(bg.convert('RGB'), (135, 108)), (0, y+20))
    im = Image.open(DATA / 'thumbs' / f'{p["id"]}_512.webp').convert('RGB')
    sheet.paste(ImageOps.contain(im, (280, 108)), (156, y+20))
    b = m['box']; crop = im.crop(tuple(int(v*(im.width if k%2==0 else im.height)) for k,v in enumerate(b)))
    sheet.paste(ImageOps.contain(crop, (280, 108)), (460, y+20))
    draw.text((0,y+2), f'{pid} REF', fill='#edce8a')
    draw.text((156,y+2), f'{p["ts"][:10]} {m["score"]:.3f} {"UNSURE" if m["unsure"] else "CONFIDENT"}', fill='white')
    draw.text((460,y+2), 'MATCH CROP', fill='white')
    final_sample.append({'plant':pid, 'photo':p['id'], 'score':m['score'], 'unsure':m['unsure']})
sheet.save(OUT / 'assignments-6.jpg', quality=88)
(OUT / 'final-sample.json').write_text(json.dumps(final_sample, indent=1))
print(json.dumps({'sample':len(manifest), 'assignments':sum(len(p['plants']) for p in a['photos']), 'unsure':sum(m.get('unsure',False) for p in a['photos'] for m in p['plants'])}))
