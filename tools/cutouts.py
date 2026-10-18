"""Cut each plant out of the KDE Connect photos into a transparent WebP sprite.

Boxes are in 1024-wide coordinates of the photo (picked by eye from gridded previews).
Input: work/mid/<photo>.jpg (2048 px long edge, made with vips from $PRIVATE_DATA).
Output: public/plants/<id>.webp + public/plants.json (editable defaults).
"""
import json, sys
from pathlib import Path
from PIL import Image
from rembg import remove, new_session

ROOT = Path(__file__).resolve().parents[1]
MID = ROOT / "work" / "mid"
OUT = ROOT / "public" / "plants"
OUT.mkdir(parents=True, exist_ok=True)

# id, name, photo, box(1024 coords), pot diameter cm, pot height cm, plant height cm, light need
PLANTS = [
    ("p01", "Trailing plectranthus", "121441", (55, 515, 305, 768), 25, 18, 45, "med"),
    ("p02", "Eggplant", "121441", (100, 280, 310, 610), 40, 30, 90, "high"),
    ("p03", "Curry leaf (brown pot)", "121441", (195, 165, 360, 430), 40, 32, 90, "high"),
    ("p04", "Pepper (grey wicker)", "121441", (355, 180, 470, 400), 30, 25, 70, "high"),
    ("p05", "Chili (taupe wicker)", "121441", (405, 190, 545, 480), 35, 30, 80, "high"),
    ("p06", "Curry leaf (dark pot)", "121441", (540, 180, 690, 485), 35, 28, 90, "high"),
    ("p07", "Banana", "121441", (555, 10, 905, 400), 45, 32, 150, "high"),
    ("p08", "Aloe (painted ceramic)", "121441", (715, 355, 795, 445), 18, 15, 25, "high"),
    ("p09", "Herb barrel", "121441", (775, 160, 960, 420), 45, 30, 80, "high"),
    ("p10", "Raised planter A (peppers)", "121446", (340, 240, 660, 450), 80, 75, 110, "high"),
    ("p11", "Pepper (dark wicker)", "121437", (590, 300, 705, 470), 30, 25, 60, "high"),
    ("p12", "Curry leaf (dark pot 2)", "121437", (570, 190, 715, 380), 35, 28, 90, "high"),
    ("p13", "Small green pot 1", "121437", (585, 460, 640, 510), 12, 10, 15, "med"),
    ("p14", "Small green pot 2", "121437", (588, 485, 640, 540), 12, 10, 15, "med"),
    ("p15", "Tiny planter", "121437", (665, 500, 722, 562), 12, 8, 15, "med"),
    ("p16", "Ficus (ceramic)", "121446", (655, 375, 760, 555), 20, 18, 55, "med"),
    ("p17", "Seedlings (grey pot)", "121446", (415, 505, 505, 620), 20, 18, 30, "high"),
    ("p18", "Seedling tray", "121446", (505, 540, 572, 612), 20, 8, 15, "high"),
    ("p19", "Sprout (white pot)", "121446", (668, 670, 748, 750), 15, 12, 20, "med"),
    ("p20", "Raised planter B", "121449", (425, 320, 622, 550), 80, 75, 110, "high"),
    ("p21", "Seedlings (blue ceramic)", "121504", (388, 420, 472, 528), 25, 20, 35, "high"),
    ("p22", "Tomato", "121504", (448, 330, 562, 520), 35, 28, 100, "high"),
    ("p23", "Tall leafy shrub", "121504", (575, 335, 792, 602), 40, 30, 120, "high"),
    ("p24", "Bushy herb", "121513", (60, 200, 960, 1200), 35, 25, 60, "med"),
    ("p25", "Holy basil (back pot)", "121441", (470, 250, 590, 410), 35, 28, 60, "high"),
]

def plant_mask(crop, rem):
    """Hard alpha: salient object (rembg) OR foliage (PlantCV-style excess-green index).

    rembg alone returns ghostly soft alpha on cluttered plant clusters; ExG keeps the leaves.
    """
    import numpy as np
    from scipy import ndimage as ndi
    rgb = np.asarray(crop, dtype=np.float32) / 255.0
    a = np.asarray(rem)[..., 3].astype(np.float32) / 255.0
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    s = r + g + b + 1e-6
    exg = 2 * g / s - r / s - b / s
    leaf = (exg > 0.10) & (g > 0.12)
    leaf = ndi.binary_opening(leaf, iterations=1)
    obj = a > 0.5
    m = obj | leaf
    m = ndi.binary_closing(m, iterations=2)
    m = ndi.binary_fill_holes(m) if obj.mean() > 0.02 else m
    lab, n = ndi.label(m)
    if n:
        sizes = ndi.sum(m, lab, range(1, n + 1))
        keep = np.isin(lab, 1 + np.nonzero(sizes >= max(sizes.max() * 0.04, 30))[0])
        m = keep
    alpha = ndi.gaussian_filter(m.astype(np.float32), 0.8)
    out = np.dstack([np.asarray(crop), (alpha * 255).clip(0, 255).astype(np.uint8)])
    return Image.fromarray(out, "RGBA")


def main(only=None):
    session = new_session("isnet-general-use")
    meta = []
    for pid, name, photo, box, pd, ph, h, light in PLANTS:
        out = OUT / f"{pid}.webp"
        if (only is None or pid in only) and (not out.exists() or only):
            im = Image.open(MID / f"20261018_{photo}.jpg").convert("RGB")
            s = im.width / 1024
            x1, y1, x2, y2 = [int(v * s) for v in box]
            crop = im.crop((x1, y1, x2, y2))
            cut = plant_mask(crop, remove(crop, session=session))
            bb = cut.getbbox() or (0, 0, cut.width, cut.height)
            cut = cut.crop(bb)
            cut.thumbnail((512, 512))
            cut.save(out, "WEBP", quality=82)
            print(pid, cut.size, flush=True)
        meta.append(dict(id=pid, name=name, src=f"plants/{pid}.webp", photo=f"20261018_{photo}.jpg",
                         potD=pd, potH=ph, height=h, light=light))
    (ROOT / "public" / "plants.json").write_text(json.dumps(meta, indent=1))

if __name__ == "__main__":
    main(set(sys.argv[1:]) or None)
