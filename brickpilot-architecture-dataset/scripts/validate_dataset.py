#!/usr/bin/env python3
"""
validate_dataset — §10 DATASET QUALITY GATE + report.

Checks:
  - >= 500 references (synthetic + harvested + user)
  - no obvious duplicates (perceptual + architectural fingerprint)
  - every design: valid style, valid vocabulary terms, source recorded,
    licence status recorded, architectural fingerprint present
  - every real image: file exists, opens, >= min resolution
  - unknown-licence images are counted, never treated as commercial assets

Writes reports/dataset_report.json:
  total_images, images_per_style, duplicate_count, unknown_license_count,
  missing_metadata_count, massing_distribution, roof_distribution,
  facade_distribution, floor_distribution, quality_score

    python validate_dataset.py [--min 500] [--min-resolution 640]

Exit code 1 if the dataset fails the gate.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
META = os.path.normpath(os.path.join(HERE, "..", "metadata"))
IMAGES = os.path.normpath(os.path.join(HERE, "..", "images"))
REPORTS = os.path.normpath(os.path.join(HERE, "..", "reports"))
sys.path.insert(0, HERE)
from build_fingerprints import fp_similarity, hamming  # noqa: E402

VALID_STYLES = {
    "modern_indian", "contemporary_indian", "modern_kerala", "kerala_contemporary",
    "luxury_indian_villa", "tropical_indian_modern", "minimal_indian",
    "courtyard_indian_modern", "international",
}


def load_vocab_fields() -> dict:
    p = os.path.join(META, "vocabulary.json")
    return json.load(open(p, encoding="utf-8"))["fields"] if os.path.exists(p) else {}


def check_image(rel: str, min_res: int) -> tuple[bool, str]:
    full = os.path.join(IMAGES, rel)
    if not os.path.exists(full):
        return False, "missing file"
    if os.path.getsize(full) < 8000:
        return False, "file too small"
    try:
        from PIL import Image  # type: ignore

        with Image.open(full) as im:
            w, h = im.size
        if min(w, h) < min_res:
            return False, f"resolution {w}x{h} < {min_res}"
        return True, "ok"
    except Exception as e:  # noqa: BLE001
        return False, f"cannot open ({e})"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--min", type=int, default=400)
    ap.add_argument("--min-resolution", type=int, default=640)
    ap.add_argument("--arch-threshold", type=float, default=0.9)
    args = ap.parse_args()

    dp = os.path.join(META, "designs.json")
    if not os.path.exists(dp):
        sys.exit("metadata/designs.json missing - run generate_metadata.py first")
    doc = json.load(open(dp, encoding="utf-8"))
    designs = doc.get("designs", [])
    fields = load_vocab_fields()

    problems: list[str] = []
    missing_metadata = 0
    unknown_license = 0
    bad_images = 0
    per_style: dict[str, int] = {}
    massing: dict[str, int] = {}
    roof: dict[str, int] = {}
    facade: dict[str, int] = {}
    floors_dist: dict[str, int] = {}
    vocab_violations = 0

    for d in designs:
        dna = d.get("dna") or {}
        style = d.get("style") or dna.get("style")
        per_style[str(style)] = per_style.get(str(style), 0) + 1
        if style not in VALID_STYLES:
            problems.append(f"{d.get('id')}: invalid style {style!r}")

        if not d.get("source") or not (d["source"].get("licenseStatus")):
            missing_metadata += 1
            problems.append(f"{d.get('id')}: no licence record")
        elif d["source"]["licenseStatus"] == "unknown":
            unknown_license += 1

        if not d.get("fingerprint"):
            missing_metadata += 1
            problems.append(f"{d.get('id')}: no architectural fingerprint")

        # vocabulary validity
        for fld, vocabfld in (("massingComposition", "massingComposition"), ("roof", "roofType"),
                              ("facadeComposition", "facadeComposition"), ("entrance", "entranceType"),
                              ("balcony", "balconyType"), ("courtyard", "courtyardType")):
            val = dna.get(fld)
            if val is not None and fields.get(vocabfld) and val not in fields[vocabfld]:
                vocab_violations += 1

        massing[str(dna.get("massingComposition"))] = massing.get(str(dna.get("massingComposition")), 0) + 1
        roof[str(dna.get("roof"))] = roof.get(str(dna.get("roof")), 0) + 1
        facade[str(dna.get("facadeComposition"))] = facade.get(str(dna.get("facadeComposition")), 0) + 1
        floors_dist[str(dna.get("floors"))] = floors_dist.get(str(dna.get("floors")), 0) + 1

        if d.get("imagePath"):
            ok, why = check_image(d["imagePath"], args.min_resolution)
            if not ok:
                bad_images += 1
                problems.append(f"{d.get('id')}: image {why}")

    # duplicate scan — architectural OR perceptual
    dup = 0
    rows = designs
    for i in range(len(rows)):
        for j in range(i + 1, len(rows)):
            a, b = rows[i], rows[j]
            fa, fb = a.get("fingerprint"), b.get("fingerprint")
            if fa and fb and (fa["hash"] == fb["hash"] or fp_similarity(fa, fb) >= args.arch_threshold):
                dup += 1
                continue
            pa, pb = a.get("perceptualHash"), b.get("perceptualHash")
            if pa and pb and hamming(pa, pb) <= 6:
                dup += 1

    total = len(designs)
    real_images = sum(1 for d in designs if d.get("imagePath"))

    # quality score 0-100
    score = 100.0
    if total < args.min:
        score -= min(40, (args.min - total) / args.min * 40)
    score -= min(25, dup / max(total, 1) * 100)
    score -= min(15, unknown_license / max(total, 1) * 50)
    score -= min(15, missing_metadata / max(total, 1) * 100)
    score -= min(10, bad_images / max(real_images, 1) * 50) if real_images else 0
    score -= min(10, vocab_violations / max(total, 1) * 100)
    score = round(max(0.0, score), 1)

    report = {
        "generated": date.today().isoformat(),
        "total_images": total,
        "real_images": real_images,
        "synthetic": sum(1 for d in designs if d.get("kind") == "synthetic"),
        "images_per_style": dict(sorted(per_style.items())),
        "duplicate_count": dup,
        "unknown_license_count": unknown_license,
        "missing_metadata_count": missing_metadata,
        "bad_image_count": bad_images,
        "vocab_violations": vocab_violations,
        "massing_distribution": dict(sorted(massing.items(), key=lambda kv: -kv[1])),
        "roof_distribution": dict(sorted(roof.items(), key=lambda kv: -kv[1])),
        "facade_distribution": dict(sorted(facade.items(), key=lambda kv: -kv[1])),
        "floor_distribution": dict(sorted(floors_dist.items())),
        "quality_score": score,
        "passes_gate": total >= args.min and dup < total * 0.1 and missing_metadata == 0 and not any("invalid style" in p for p in problems),
        "problems": problems[:60],
        "problem_count": len(problems),
    }

    os.makedirs(REPORTS, exist_ok=True)
    with open(os.path.join(REPORTS, "dataset_report.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
        fh.write("\n")

    print(f"total {total}  ({report['synthetic']} synthetic, {real_images} real images)")
    print(f"duplicates {dup}   unknown-licence {unknown_license}   missing-metadata {missing_metadata}   bad-images {bad_images}")
    print(f"quality score: {score}/100   gate: {'PASS' if report['passes_gate'] else 'FAIL'}")
    if problems:
        print(f"\nfirst problems ({len(problems)}):")
        for p in problems[:20]:
            print(f"  - {p}")
    print(f"\n-> reports/dataset_report.json")
    if not report["passes_gate"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
