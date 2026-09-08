#!/usr/bin/env python3
"""
deduplicate — §9 reject references that are too similar.

Two passes:
  1. PERCEPTUAL — same photo re-cropped / re-lit / re-scaled / recoloured
     (dHash Hamming distance <= --phash-threshold, default 8).
  2. ARCHITECTURAL — near-identical DESIGN: same massing, floor offsets,
     roof, balcony strategy, entrance, facade composition, volume
     arrangement (fingerprint similarity >= --arch-threshold, default 0.86).

Keeps the first member of each cluster (prefer verified licence, then
vision analysis, then earliest collected). Writes designs.json back and
reports what was dropped.

    python deduplicate.py [--dry-run] [--phash-threshold 8] [--arch-threshold 0.86]

Deps: none beyond build_fingerprints (Pillow/numpy only if pHashes missing).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
META = os.path.normpath(os.path.join(HERE, "..", "metadata"))
sys.path.insert(0, HERE)
from build_fingerprints import fp_similarity, hamming  # noqa: E402


def licence_rank(d: dict) -> int:
    status = ((d.get("source") or {}).get("licenseStatus")) or "unknown"
    return {"verified_open": 0, "verified_permissive": 1, "user_provided": 2, "synthetic": 3, "unknown": 4}.get(status, 5)


def keep_better(a: dict, b: dict) -> dict:
    ra, rb = licence_rank(a), licence_rank(b)
    if ra != rb:
        return a if ra < rb else b
    va = 0 if a.get("analysis_source") == "vision" else 1
    vb = 0 if b.get("analysis_source") == "vision" else 1
    if va != vb:
        return a if va < vb else b
    return a  # stable: first wins


def dedup(designs: list[dict], phash_t: int, arch_t: float) -> tuple[list[dict], list[dict]]:
    kept: list[dict] = []
    dropped: list[dict] = []
    for d in designs:
        clash = None
        reason = None
        for k in kept:
            ph_a, ph_b = d.get("perceptualHash"), k.get("perceptualHash")
            if ph_a and ph_b and hamming(ph_a, ph_b) <= phash_t:
                clash, reason = k, f"perceptual dup of {k['id']} (hamming {hamming(ph_a, ph_b)})"
                break
            fa, fb = d.get("fingerprint"), k.get("fingerprint")
            if fa and fb:
                sim = fp_similarity(fa, fb)
                if sim >= arch_t:
                    clash, reason = k, f"architectural dup of {k['id']} (similarity {sim})"
                    break
        if clash is None:
            kept.append(d)
        else:
            winner = keep_better(clash, d)
            if winner is d:
                # d is better — swap it in
                kept[kept.index(clash)] = d
                dropped.append({**clash, "_dropped": f"superseded by {d['id']}"})
            else:
                dropped.append({**d, "_dropped": reason})
    return kept, dropped


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--phash-threshold", type=int, default=8)
    ap.add_argument("--arch-threshold", type=float, default=0.86)
    args = ap.parse_args()

    path = os.path.join(META, "designs.json")
    if not os.path.exists(path):
        sys.exit("metadata/designs.json missing - run generate_metadata.py first")
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)

    before = len(doc.get("designs", []))
    kept, dropped = dedup(doc["designs"], args.phash_threshold, args.arch_threshold)
    print(f"{before} references -> {len(kept)} kept, {len(dropped)} dropped")
    for d in dropped[:40]:
        print(f"  - {d['id']:32} {d.get('_dropped')}")
    if len(dropped) > 40:
        print(f"  ... and {len(dropped) - 40} more")

    if args.dry_run:
        print("\n(dry run - nothing written)")
        return

    doc["designs"] = kept
    doc["deduplicated"] = {
        "date": date.today().isoformat(),
        "before": before,
        "after": len(kept),
        "dropped": len(dropped),
        "phashThreshold": args.phash_threshold,
        "archThreshold": args.arch_threshold,
    }
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2)
        fh.write("\n")
    with open(os.path.join(META, "dedup_dropped.json"), "w", encoding="utf-8") as fh:
        json.dump({"dropped": dropped}, fh, indent=2)
        fh.write("\n")
    print(f"\nwrote {path}")


if __name__ == "__main__":
    main()
