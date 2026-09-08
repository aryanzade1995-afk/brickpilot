#!/usr/bin/env python3
"""
build_fingerprints — §9 the two fingerprints every reference gets.

  1. perceptual hash  (dHash, 64-bit) — catches the SAME PHOTO re-cropped,
     re-lit, re-scaled or colour-shifted.
  2. architectural fingerprint — a canonical signature over massing /
     floors / roof / entrance / balcony / facade / courtyard, matching
     src/architecture/library/fingerprint.ts exactly, so a Python-side
     dedup and a TS-side dedup agree.

    python build_fingerprints.py            # (re)build for every analyzed ref
    python build_fingerprints.py IMG.jpg    # just print the pHash of one file

Deps: Pillow, numpy.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
META = os.path.normpath(os.path.join(HERE, "..", "metadata"))
IMAGES = os.path.normpath(os.path.join(HERE, "..", "images"))


# ---- perceptual hash (dHash) ----------------------------------
def dhash(path: str, size: int = 8) -> str:
    from PIL import Image  # type: ignore
    import numpy as np  # type: ignore

    im = Image.open(path).convert("L").resize((size + 1, size), Image.Resampling.LANCZOS)
    a = np.asarray(im, dtype="int16")
    diff = a[:, 1:] > a[:, :-1]
    bits = 0
    for b in diff.flatten():
        bits = (bits << 1) | int(b)
    return f"{bits:016x}"


def hamming(a: str, b: str) -> int:
    return bin(int(a, 16) ^ int(b, 16)).count("1")


# ---- architectural fingerprint (mirrors fingerprint.ts) --------
def stable_hash(s: str) -> str:
    h = 0x811C9DC5
    for ch in s:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    h2 = ((h ^ (h >> 15)) * 0x2C1B3C6D) & 0xFFFFFFFF
    h2 = ((h2 ^ (h2 >> 13)) * 0x297A2D39) & 0xFFFFFFFF
    return (f"{h:08x}{h2:08x}")[:12]


def architectural_fingerprint(dna: dict, floors: int) -> dict:
    g = lambda k, d="": dna.get(k) or d  # noqa: E731
    massing = f"{g('massingComposition','stacked_volumes')}_{g('planFigure','rectangular')}"
    floors_axis = f"{floors}f_{g('upperFloorStrategy','full_upper')}"
    roof = g("roof", "flat_slab")
    entrance = f"{g('entrance','centered')}_{'dh' if dna.get('doubleHeightEntrance') else 'sh'}"
    balcony = f"{g('balcony','none')}_{g('balconyPosition','upper_front')}"
    facade = f"{g('facadeComposition','flat_plane')}_{g('screen','none')}_{g('materialPalette','white_minimal')}"
    courtyard = g("courtyard", "none")
    h = stable_hash("|".join([massing, floors_axis, roof, entrance, balcony, facade, courtyard]))
    return {
        "massing": massing, "floors": floors_axis, "roof": roof, "entrance": entrance,
        "balcony": balcony, "facade": facade, "courtyard": courtyard, "hash": h,
    }


AXIS_WEIGHT = {"massing": 0.30, "floors": 0.16, "roof": 0.16, "entrance": 0.10,
               "balcony": 0.12, "facade": 0.12, "courtyard": 0.04}


def _axis_score(a: str, b: str) -> float:
    if a == b:
        return 1.0
    ta, tb = a.split("_"), b.split("_")
    n = max(len(ta), len(tb))
    same = sum(1 for i in range(n) if i < len(ta) and i < len(tb) and ta[i] == tb[i])
    return same / n


def fp_similarity(a: dict, b: dict) -> float:
    if a["hash"] == b["hash"]:
        return 1.0
    return round(sum(w * _axis_score(a[axis], b[axis]) for axis, w in AXIS_WEIGHT.items()), 4)


# ---- driver ---------------------------------------------------
def rebuild() -> None:
    designs_path = os.path.join(META, "designs.json")
    if not os.path.exists(designs_path):
        sys.exit("metadata/designs.json missing - run generate_metadata.py first")
    with open(designs_path, encoding="utf-8") as fh:
        doc = json.load(fh)

    n_p, n_a = 0, 0
    for d in doc.get("designs", []):
        img = d.get("imagePath")
        if img:
            full = os.path.join(IMAGES, img) if not os.path.isabs(img) else img
            if os.path.exists(full):
                try:
                    d["perceptualHash"] = dhash(full)
                    n_p += 1
                except Exception as e:  # noqa: BLE001
                    d["perceptualHash"] = None
                    print(f"! pHash failed for {img}: {e}", file=sys.stderr)
        floors = int((d.get("dna") or {}).get("floors") or d.get("floors") or 2)
        d["fingerprint"] = architectural_fingerprint(d.get("dna", {}), floors)
        n_a += 1

    with open(designs_path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2)
        fh.write("\n")
    print(f"rebuilt {n_a} architectural fingerprints, {n_p} perceptual hashes -> {designs_path}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("image", nargs="?")
    args = ap.parse_args()
    if args.image:
        print(dhash(args.image))
    else:
        rebuild()


if __name__ == "__main__":
    main()
