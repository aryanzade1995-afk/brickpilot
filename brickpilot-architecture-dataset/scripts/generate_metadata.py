#!/usr/bin/env python3
"""
generate_metadata — assemble metadata/designs.json (§3), the master
STRUCTURED-DNA record for every reference.

Sources merged:
  * metadata/genomes.json      — synthetic design genomes (always present)
  * raw/collected.json + raw/*.json  — harvested images + their analysis
  * images/<bucket>/*          — user-dropped images (analysed on the fly)

For a harvested / user image with no analysis yet, this runs
analyze_reference.analyze() (vision if GEMINI_API_KEY, else heuristic),
files the image under images/<style-bucket>/, and records the licence.

    python generate_metadata.py [--no-analyze] [--include-synthetic]

Deps: Pillow/numpy only if images need analysing.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
META = os.path.normpath(os.path.join(HERE, "..", "metadata"))
RAW = os.path.normpath(os.path.join(HERE, "..", "raw"))
IMAGES = os.path.normpath(os.path.join(HERE, "..", "images"))
sys.path.insert(0, HERE)

STYLE_TO_BUCKET = {
    "modern_indian": "modern_indian", "contemporary_indian": "contemporary_indian",
    "modern_kerala": "modern_kerala", "kerala_contemporary": "kerala_contemporary",
    "luxury_indian_villa": "luxury_indian", "tropical_indian_modern": "tropical_indian",
    "minimal_indian": "minimalist", "courtyard_indian_modern": "courtyard",
    "international": "international",
}


def bucket_for(dna: dict) -> str:
    style = dna.get("style") or "modern_indian"
    if dna.get("internationalTag"):
        return "international"
    if dna.get("cantilever") or dna.get("massingComposition") in ("cantilevered_volumes", "floating_upper_volume"):
        return "cantilever"
    if dna.get("roof") in ("roof_terrace",) or "roof_as_feature" in (dna.get("characteristics") or []):
        if dna.get("roof") == "roof_terrace":
            return "rooftop_terrace"
    if dna.get("roof") in ("mono_slope", "butterfly", "gable", "contemporary_sloped"):
        return "sloped_roof"
    if dna.get("courtyard") not in (None, "none"):
        return "courtyard"
    return STYLE_TO_BUCKET.get(style, "mixed")


def synthetic_entries() -> list[dict]:
    p = os.path.join(META, "genomes.json")
    if not os.path.exists(p):
        print("! metadata/genomes.json missing - run: npx tsx scripts/genome-corpus.mts", file=sys.stderr)
        return []
    doc = json.load(open(p, encoding="utf-8"))
    out = []
    for d in doc.get("designs", []):
        out.append({
            "id": d["id"],
            "kind": "synthetic",
            "style": d["style"],
            "internationalTag": d.get("dna", {}).get("internationalTag"),
            "source": d["source"],
            "requirements": d.get("requirements"),
            "dna": {**d["dna"], "style": d["style"], "floors": (d.get("requirements") or {}).get("floors", 2)},
            "genome": d.get("genome"),
            "fingerprint": d["fingerprint"],
            "imagePath": None,
        })
    return out


def harvested_entries(do_analyze: bool) -> list[dict]:
    manifest = os.path.join(RAW, "collected.json")
    if not os.path.exists(manifest):
        return []
    items = json.load(open(manifest, encoding="utf-8")).get("items", [])
    out = []
    an = None
    if do_analyze:
        try:
            import analyze_reference as an  # type: ignore
        except Exception as e:  # noqa: BLE001
            print(f"! analyze_reference unavailable ({e}) - recording without DNA", file=sys.stderr)

    for it in items:
        fpath = os.path.join(RAW, it["file"])
        if not os.path.exists(fpath):
            continue
        style_hint = None
        analysis = {"dna": {}, "analysis_source": "none", "needs_vision": True}
        if an is not None:
            try:
                analysis = an.analyze(fpath, style_hint)
            except Exception as e:  # noqa: BLE001
                print(f"! analyse {it['file']}: {e}", file=sys.stderr)
        dna = analysis.get("dna", {})
        dna.setdefault("style", dna.get("style") or "modern_indian")
        bucket = bucket_for(dna)
        dest_dir = os.path.join(IMAGES, bucket)
        os.makedirs(dest_dir, exist_ok=True)
        dest = os.path.join(dest_dir, it["file"])
        if not os.path.exists(dest):
            shutil.copy2(fpath, dest)
        out.append({
            "id": f"{bucket}_{os.path.splitext(it['file'])[0]}",
            "kind": "harvested",
            "style": dna.get("style"),
            "internationalTag": dna.get("internationalTag"),
            "source": it["license_record"],
            "dna": dna,
            "analysis_source": analysis.get("analysis_source"),
            "needs_vision": analysis.get("needs_vision", True),
            "vocab_warnings": analysis.get("vocab_warnings", []),
            "fingerprint": None,  # build_fingerprints fills this
            "imagePath": f"{bucket}/{it['file']}",
            "bytes": it.get("bytes"),
        })
    return out


def user_dropped_entries(do_analyze: bool) -> list[dict]:
    out = []
    an = None
    if do_analyze:
        try:
            import analyze_reference as an  # type: ignore
        except Exception:
            an = None
    for bucket in os.listdir(IMAGES):
        bdir = os.path.join(IMAGES, bucket)
        if not os.path.isdir(bdir):
            continue
        for f in os.listdir(bdir):
            if not f.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
                continue
            fid = f"{bucket}_{os.path.splitext(f)[0]}"
            out.append((bucket, f, fid, os.path.join(bdir, f), an))
    return out  # resolved in main() so we can skip already-recorded ids


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-analyze", action="store_true")
    ap.add_argument("--no-synthetic", action="store_true")
    ap.add_argument("--no-harvested", action="store_true", help="skip raw/collected.json (committed dataset is synthetic-only)")
    ap.add_argument("--no-user", action="store_true", help="skip loose images in images/<bucket>/")
    args = ap.parse_args()
    do_analyze = not args.no_analyze

    designs: list[dict] = []
    if not args.no_synthetic:
        designs += synthetic_entries()
    if not args.no_harvested:
        designs += harvested_entries(do_analyze)

    known = {d["id"] for d in designs}
    user_rows = [] if args.no_user else user_dropped_entries(do_analyze)
    for bucket, f, fid, path, an in user_rows:
        if fid in known:
            continue
        dna = {}
        src = {"licenseStatus": "user_provided", "commercialUseAllowed": True, "modificationAllowed": True, "dateCollected": date.today().isoformat(), "domain": "user"}
        if an is not None:
            try:
                a = an.analyze(path, None)
                dna = a.get("dna", {})
            except Exception:
                pass
        designs.append({
            "id": fid, "kind": "user_provided", "style": dna.get("style"),
            "source": src, "dna": dna, "fingerprint": None, "imagePath": f"{bucket}/{f}",
        })

    doc = {
        "generated": date.today().isoformat(),
        "schema": "SCHEMA.md",
        "count": len(designs),
        "byKind": _count(designs, "kind"),
        "byStyle": _count(designs, "style"),
        "designs": designs,
    }
    os.makedirs(META, exist_ok=True)
    with open(os.path.join(META, "designs.json"), "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2)
        fh.write("\n")
    print(f"wrote {len(designs)} designs -> metadata/designs.json")
    for k, v in sorted(doc["byKind"].items()):
        print(f"  {k:16} {v}")
    print("next: python build_fingerprints.py && python deduplicate.py && python validate_dataset.py")


def _count(rows: list[dict], key: str) -> dict:
    out: dict[str, int] = {}
    for r in rows:
        out[str(r.get(key))] = out.get(str(r.get(key)), 0) + 1
    return out


if __name__ == "__main__":
    main()
