"""Make first-draft labels for column photos, so a detector can be trained without drawing outlines by hand.

FastSAM outlines everything it can see; shapes that look like columns (tall, narrow, solid) and that match the
other columns in the same photo are kept. The result is written as YOLO segmentation labels plus a preview image
of every photo, so the labels can be checked by eye before training.

  python autolabel.py  [photo folders ...]        (default: ml/data/raw and ../output/test-photos)
"""
import sys, random, shutil
from pathlib import Path
import numpy as np, cv2
from ultralytics import FastSAM

HERE = Path(__file__).parent
OUT = HERE / "data"
folders = [Path(a) for a in sys.argv[1:]] or [HERE / "data" / "raw", HERE.parent / "output" / "test-photos"]
photos = sorted(p for f in folders if f.exists() for p in f.glob("*") if p.suffix.lower() in {".jpg", ".jpeg", ".png"} and "overlay" not in p.name.lower())
print(f"{len(photos)} photos")

model = FastSAM("FastSAM-s.pt")


def column_like(poly, w, h):
    x, y = poly[:, 0], poly[:, 1]
    bw, bh = x.max() - x.min(), y.max() - y.min()
    if bw < 4 or bh < 12:
        return None
    area = cv2.contourArea(poly.astype(np.float32))
    solidity = area / (bw * bh)
    slender = bh / bw
    if slender < 2.2 or solidity < 0.6 or bh < h * 0.035 or bh > h * 0.9 or bw > w * 0.2:
        return None
    return dict(w=bw, h=bh, base=(float(x[np.argmax(y)]), float(y.max())), poly=poly, box=(x.min(), y.min(), x.max(), y.max()))


def iou(a, b):
    iw = min(a[2], b[2]) - max(a[0], b[0]); ih = min(a[3], b[3]) - max(a[1], b[1])
    if iw <= 0 or ih <= 0:
        return 0
    i = iw * ih
    return i / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i)


def consistent(cands):
    uniq = []
    for c in sorted(cands, key=lambda c: -(c["h"] * c["w"])):
        if not any(iou(c["box"], u["box"]) > 0.4 for u in uniq):
            uniq.append(c)
    if len(uniq) < 3:
        return []          # a lone shape is not evidence of a row of columns
    mw, mh = np.median([c["w"] for c in uniq]), np.median([c["h"] for c in uniq])
    return [c for c in uniq if 0.5 * mw <= c["w"] <= 1.9 * mw and 0.5 * mh <= c["h"] <= 1.7 * mh]


random.seed(7)
for sub in ("images/train", "images/val", "labels/train", "labels/val", "preview"):
    (OUT / sub).mkdir(parents=True, exist_ok=True)
kept_total = 0
rows = []
for p in photos:
    img = cv2.imread(str(p))
    if img is None:
        continue
    h, w = img.shape[:2]
    res = model(str(p), device=0, retina_masks=True, imgsz=1024, conf=0.3, iou=0.7, verbose=False)[0]
    cands = []
    if res.masks is not None:
        for poly in res.masks.xy:
            if len(poly) >= 4:
                c = column_like(poly, w, h)
                if c:
                    cands.append(c)
    cols = consistent(cands)
    rows.append((p, img, cols))
    kept_total += len(cols)
    print(f"{p.name}: {len(cands)} candidates -> {len(cols)} columns")

# only photos where columns were found become training images
usable = [r for r in rows if r[2]]
random.shuffle(usable)
nval = max(1, round(len(usable) * 0.2))
for i, (p, img, cols) in enumerate(usable):
    split = "val" if i < nval else "train"
    h, w = img.shape[:2]
    stem = f"{p.parent.name}_{p.stem}"
    cv2.imwrite(str(OUT / "images" / split / f"{stem}.jpg"), img)
    lines = []
    for c in cols:
        pts = c["poly"]
        eps = 0.004 * cv2.arcLength(pts.astype(np.float32), True)
        pts = cv2.approxPolyDP(pts.astype(np.float32), eps, True).reshape(-1, 2)
        if len(pts) >= 3:
            lines.append("0 " + " ".join(f"{x / w:.5f} {y / h:.5f}" for x, y in pts))
    (OUT / "labels" / split / f"{stem}.txt").write_text("\n".join(lines))
    prev = img.copy()
    for c in cols:
        cv2.polylines(prev, [c["poly"].astype(np.int32)], True, (0, 200, 0), max(2, w // 400))
    cv2.imwrite(str(OUT / "preview" / f"{stem}.jpg"), prev)

(OUT / "columns.yaml").write_text(f"path: {OUT.as_posix()}\ntrain: images/train\nval: images/val\nnames:\n  0: column\n")
print(f"{len(usable)} usable photos ({len(rows) - len(usable)} had no columns), {kept_total} column labels. Preview images: {OUT / 'preview'}")
