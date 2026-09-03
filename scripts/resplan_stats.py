#!/usr/bin/env python3
"""
resplan_stats.py  —  mine the ResPlan dataset for the numbers BrickPilot's
deterministic generator is tuned against.

ResPlan (https://github.com/m-agour/ResPlan, CC BY 4.0) is a pickle of ~17,000
vector residential floor plans. We only read it to derive *statistics* — nothing
from the dataset is redistributed. The dataset has a takedown policy; treat the
raw plans as reference, not as content to ship.

Usage
-----
    # once, in a venv:
    pip install numpy shapely networkx        # + whatever ResPlan/requirements.txt lists
    #   put resplan_utils.py (from the ResPlan repo) on PYTHONPATH, or beside this file
    python scripts/resplan_stats.py /path/to/ResPlan.zip

    # writes scripts/resplan_stats.json

The ResPlan pickle schema isn't fully documented; this script is defensive and
prints what it finds. If your copy exposes rooms differently, adjust
`iter_rooms()` / `ROOM_TYPES` below — the maths downstream is generic.
"""
from __future__ import annotations

import json
import math
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

OUT = Path(__file__).with_name("resplan_stats.json")

# ResPlan's 17-category taxonomy → BrickPilot's room ids. Adjust the left side to
# whatever string / int labels your ResPlan copy uses.
ROOM_TYPES = {
    "living": "living",
    "livingroom": "living",
    "hall": "living",
    "dining": "dining",
    "diningroom": "dining",
    "kitchen": "kitchen",
    "master": "masterBed",
    "masterroom": "masterBed",
    "bedroom": "bed",
    "secondroom": "bed",
    "childroom": "bed",
    "bathroom": "bath",
    "washroom": "bath",
    "toilet": "bath",
    "balcony": "balcony",
    "utility": "utility",
    "storage": "utility",
    "pooja": "pooja",
    "study": "study",
    "entrance": "foyer",
    "foyer": "foyer",
}

PCTS = (10, 50, 90)


def pct(xs: list[float], p: int) -> float:
    if not xs:
        return 0.0
    xs = sorted(xs)
    k = (len(xs) - 1) * p / 100
    lo = math.floor(k)
    hi = math.ceil(k)
    if lo == hi:
        return round(xs[int(k)], 1)
    return round(xs[lo] + (xs[hi] - xs[lo]) * (k - lo), 1)


def load_plans(zip_path: str):
    """Yield plan objects from ResPlan.zip. Tries pickle-in-zip, then a bare pickle."""
    import pickle

    p = Path(zip_path)
    if p.suffix == ".zip":
        with zipfile.ZipFile(p) as z:
            name = next((n for n in z.namelist() if n.endswith((".pkl", ".pickle", ".p"))), None)
            if not name:
                sys.exit(f"no pickle inside {p}; contents: {z.namelist()[:10]}")
            with z.open(name) as f:
                data = pickle.load(f)
    else:
        with open(p, "rb") as f:
            data = pickle.load(f)

    if isinstance(data, dict):
        for v in data.values():
            yield v
    elif isinstance(data, (list, tuple)):
        yield from data
    else:
        yield data


def iter_rooms(plan):
    """
    Yield (type_str, area_m2, bbox_w_m, bbox_h_m) for each room in a plan.
    ResPlan stores geometry as metric polygons; this handles the common shapes.
    """
    rooms = plan.get("rooms") if isinstance(plan, dict) else getattr(plan, "rooms", None)
    if not rooms:
        return
    for r in rooms:
        g = r if isinstance(r, dict) else r.__dict__
        t = str(g.get("type") or g.get("label") or g.get("category") or "").lower().replace(" ", "")
        poly = g.get("polygon") or g.get("points") or g.get("coords") or g.get("geometry")
        if poly is None:
            continue
        try:
            xs = [pt[0] for pt in poly]
            ys = [pt[1] for pt in poly]
        except (TypeError, IndexError):
            continue
        w = (max(xs) - min(xs))
        h = (max(ys) - min(ys))
        # shoelace area; coords assumed metres (ResPlan is metric-scale)
        area = abs(sum(xs[i] * ys[(i + 1) % len(xs)] - xs[(i + 1) % len(xs)] * ys[i] for i in range(len(xs)))) / 2
        # some copies store mm — normalise if the plan is absurdly large
        if area > 4000:
            area, w, h = area / 1e6, w / 1000, h / 1000
        yield t, round(area, 2), round(w, 2), round(h, 2)


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)

    areas: dict[str, list[float]] = defaultdict(list)
    room_counts: list[int] = []
    aspects: list[float] = []
    has: Counter = Counter()
    n = 0

    for plan in load_plans(sys.argv[1]):
        rs = list(iter_rooms(plan))
        if not (2 <= len(rs) <= 12):
            continue
        total = sum(a for _, a, _, _ in rs)
        if not (45 <= total <= 500):  # villa-shaped only
            continue
        n += 1
        room_counts.append(len([1 for t, *_ in rs if ROOM_TYPES.get(t) not in (None, "bath", "balcony")]))
        seen = set()
        pw = sum(w for _, _, w, _ in rs) / max(1, len(rs))
        ph = sum(h for _, _, _, h in rs) / max(1, len(rs))
        if ph:
            aspects.append(round(pw / ph, 2))
        for t, a, _w, _h in rs:
            key = ROOM_TYPES.get(t)
            if not key:
                continue
            areas[key].append(a)
            seen.add(key)
        for k in ("balcony", "pooja", "utility"):
            if k in seen:
                has[k] += 1

    if n == 0:
        sys.exit("no villa-shaped plans matched — check iter_rooms()/ROOM_TYPES against your ResPlan copy")

    out = {
        "_source": "ResPlan (github.com/m-agour/ResPlan) — statistics only, CC BY 4.0",
        "plans_used": n,
        "room_area_m2": {
            k: {f"p{p}": pct(v, p) for p in PCTS} for k, v in sorted(areas.items())
        },
        "habitable_room_count": {f"p{p}": pct([float(x) for x in room_counts], p) for p in PCTS},
        "plan_aspect_ratio": {f"p{p}": pct(aspects, p) for p in PCTS},
        "share_with": {k: round(has[k] / n, 2) for k in ("balcony", "pooja", "utility")},
    }
    OUT.write_text(json.dumps(out, indent=2) + "\n")
    print(f"wrote {OUT}  ({n} plans)")
    print(json.dumps(out["room_area_m2"], indent=2))


if __name__ == "__main__":
    main()
