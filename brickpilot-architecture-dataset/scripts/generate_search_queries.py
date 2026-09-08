#!/usr/bin/env python3
"""
generate_search_queries — §12 SEARCH QUERY GENERATOR.

Produces hundreds of diverse architectural search queries by combining
style x massing x roof x facade x entrance x balcony, plus a curated
hand list. Queries are for DISCOVERY only (finding candidate references
on open-licensed sources); collect_references.py consumes queries.json.

    python generate_search_queries.py [--out ../metadata/queries.json] [--max 800]

No third-party dependencies.
"""
from __future__ import annotations

import argparse
import itertools
import json
import os
import random
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
META = os.path.normpath(os.path.join(HERE, "..", "metadata"))

STYLES = [
    "modern Indian villa",
    "contemporary Indian house",
    "modern Kerala home",
    "Kerala contemporary villa",
    "luxury Indian villa",
    "tropical Indian modern house",
    "minimal Indian house",
    "courtyard house India",
]

# international composition references (§13) — tagged separately, not target styles
INTERNATIONAL = [
    "Japanese modern house",
    "Mediterranean contemporary villa",
    "tropical modern house Bali",
    "Southeast Asian modern villa",
    "Australian contemporary house",
    "Brazilian modernist house",
    "European minimalist house",
]

MASSING = [
    "", "L-shaped", "U-shaped", "courtyard", "stacked volumes", "offset volumes",
    "split volume", "cantilever", "floating upper floor", "linear", "stepped volumes",
]
ROOF = [
    "", "flat roof", "floating roof", "roof terrace", "butterfly roof",
    "sloped roof", "Kerala tiled roof", "deep overhang roof",
]
FACADE = [
    "", "stone facade", "wood screen", "vertical fins", "jaali screen",
    "exposed concrete", "white minimal facade", "brick facade", "louvers",
]
ENTRANCE = ["", "double height entrance", "recessed entrance", "porte cochere", "framed entrance"]
BALCONY = ["", "cantilever balcony", "corner balcony", "wrap verandah", "terrace balcony"]

VIEWS = ["exterior", "facade", "elevation", "front view", "street view", "architecture"]

# a curated hand list — the queries a person would actually type
CURATED = [
    "modern Indian villa exterior",
    "contemporary Indian villa architecture",
    "Indian luxury villa facade",
    "modern Kerala house exterior",
    "Kerala contemporary villa",
    "Indian tropical modern villa",
    "cantilever Indian villa",
    "floating volume villa architecture",
    "modern courtyard villa India",
    "minimal Indian villa architecture",
    "modern villa double height entrance",
    "Indian villa stone wood facade",
    "modern villa vertical fins",
    "modern Indian villa roof terrace",
    "contemporary Indian sloped roof villa",
    "modern tropical villa courtyard",
    "Indian villa asymmetric massing",
    "offset volume house India",
    "Indian villa deep overhang",
    "Kerala modern house tiled roof verandah",
    "Indian bungalow flat roof parapet",
    "modern Indian house brick jaali",
]


def combos(max_q: int, seed: int = 7) -> list[str]:
    rng = random.Random(seed)
    out: set[str] = set(q.lower().strip() for q in CURATED)

    # style x one-extra-axis (dense, high quality)
    for style, axis in itertools.product(STYLES, MASSING + ROOF + FACADE + ENTRANCE + BALCONY):
        if not axis:
            continue
        out.add(f"{axis} {style}".lower().strip())
        out.add(f"{style} {axis} exterior".lower().strip())

    # style x massing x roof (two axes)
    for style, m, r in itertools.product(STYLES, MASSING, ROOF):
        if not (m or r):
            continue
        out.add(f"{m} {style} {r}".replace("  ", " ").lower().strip())

    # style x facade x entrance
    for style, f, e in itertools.product(STYLES, FACADE, ENTRANCE):
        if not (f or e):
            continue
        out.add(f"{style} {f} {e}".replace("  ", " ").lower().strip())

    # international x composition axis
    for style, axis in itertools.product(INTERNATIONAL, MASSING + ROOF + FACADE):
        if not axis:
            continue
        out.add(f"{axis} {style}".lower().strip())

    # style x view
    for style, v in itertools.product(STYLES + INTERNATIONAL, VIEWS):
        out.add(f"{style} {v}".lower().strip())

    queries = sorted(out)
    if len(queries) > max_q:
        rng.shuffle(queries)
        # always keep the curated ones
        keep = set(q.lower().strip() for q in CURATED)
        rest = [q for q in queries if q not in keep]
        queries = sorted(keep) + rest[: max_q - len(keep)]
    return sorted(set(queries))


def style_for_query(q: str) -> str:
    ql = q.lower()
    if "kerala" in ql and "contemporary" in ql:
        return "kerala_contemporary"
    if "kerala" in ql:
        return "modern_kerala"
    if "luxury" in ql:
        return "luxury_indian"
    if "tropical" in ql:
        return "tropical_indian"
    if "courtyard" in ql:
        return "courtyard"
    if "minimal" in ql:
        return "minimalist"
    if "contemporary indian" in ql:
        return "contemporary_indian"
    if any(k in ql for k in ("japanese", "mediterranean", "australian", "brazilian", "european", "bali", "southeast asian")):
        return "international"
    if "cantilever" in ql or "floating" in ql:
        return "cantilever"
    if "roof terrace" in ql or "rooftop" in ql:
        return "rooftop_terrace"
    if "sloped" in ql or "butterfly" in ql:
        return "sloped_roof"
    return "modern_indian"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(META, "queries.json"))
    ap.add_argument("--max", type=int, default=800)
    args = ap.parse_args()

    queries = combos(args.max)
    payload = {
        "generated": date.today().isoformat(),
        "count": len(queries),
        "note": "DISCOVERY queries only. Use open-licensed sources; verify each licence.",
        "queries": [{"q": q, "style_bucket": style_for_query(q)} for q in queries],
    }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)
        fh.write("\n")
    print(f"wrote {len(queries)} queries -> {args.out}")
    buckets: dict[str, int] = {}
    for q in payload["queries"]:
        buckets[q["style_bucket"]] = buckets.get(q["style_bucket"], 0) + 1
    for b in sorted(buckets):
        print(f"  {b:24} {buckets[b]}")


if __name__ == "__main__":
    main()
