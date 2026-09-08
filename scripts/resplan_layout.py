#!/usr/bin/env python3
"""
resplan_layout.py — mine ResPlan for the *layout grammar* BrickPilot's new
real-topology plan engine (src/lib/engine/layout/) is built on.

ResPlan (github.com/m-agour/ResPlan, arXiv 2508.14006, CC BY 4.0) — 17,000 real
South-Asian residential floor plans as Shapely vector geometry + NetworkX
connectivity graphs. Statistics only; no geometry is copied into the app. The
dataset has a takedown policy — keep the .pkl as local reference.

What it writes (scripts/resplan_layout.json):
  shape_mix / shape_aspect  — built-enclosure silhouette classes + their aspect
  program[<bed count>]      — per-type floor-area fraction (sizes layout cells)
  zone[<type>]              — normalised centroid mean+σ, entry at plan-south
  adjacency[<a>|<b>]        — P(a shares a *door* with b | both present)
  corridor_share            — fraction of plans with a distinct circulation room

Usage:
    pip install shapely numpy networkx
    python scripts/resplan_layout.py "~/Downloads/archive (2).zip"
    python scripts/resplan_layout.py ~/Downloads/ResPlan.pkl
"""
from __future__ import annotations

import json
import math
import pickle
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from shapely.ops import unary_union

OUT = Path(__file__).with_name("resplan_layout.json")
PCTS = (25, 50, 75)

# ResPlan's flat taxonomy -> BrickPilot room kinds. `bedroom` is generic
# (no master/child split); dining/study/pooja/utility are not labelled.
KIND = {"living": "living", "kitchen": "kitchen", "bedroom": "bed",
        "bathroom": "bath", "balcony": "balcony", "storage": "utility"}
ENCLOSURE_KEYS = ["living", "kitchen", "bedroom", "bathroom", "storage"]


def pct(xs, p):
    xs = sorted(xs)
    if not xs:
        return None
    k = (len(xs) - 1) * p / 100
    lo, hi = math.floor(k), math.ceil(k)
    return round(xs[lo] + (xs[hi] - xs[lo]) * (k - lo), 3)


def band(xs):
    return {f"p{p}": pct(xs, p) for p in PCTS} if xs else None


def load_plans(path: Path):
    if path.suffix == ".zip":
        with zipfile.ZipFile(path) as z:
            name = next((n for n in z.namelist() if n.endswith(".pkl")), None)
            if not name:
                sys.exit(f"no .pkl inside {path}")
            return pickle.loads(z.read(name))
    return pickle.loads(path.read_bytes())


def geoms(g):
    if g is None or g.is_empty:
        return []
    return [x for x in g.geoms if not x.is_empty] if hasattr(g, "geoms") else [g]


def plan_scale(p):
    inn, wall = p.get("inner"), p.get("wall")
    a = (inn.area if inn and not inn.is_empty else 0.0) + (
        wall.area if wall and not wall.is_empty else 0.0
    )
    A = p.get("area")
    return math.sqrt(A / a) if a > 0 and A else None


def enclosure(p):
    """habitable built silhouette — union of the enclosed rooms, no balcony."""
    parts = [g for k in ENCLOSURE_KEYS for g in geoms(p.get(k))]
    if not parts:
        return None
    u = unary_union(parts)
    cand = geoms(u)
    return max(cand, key=lambda x: x.area) if cand else None


def classify(poly, s):
    mnx, mny, mxx, mxy = poly.bounds
    bw, bh = (mxx - mnx), (mxy - mny)
    if bw <= 0 or bh <= 0:
        return None, None
    fill = poly.area / (bw * bh)
    asp = max(bw, bh) / min(bw, bh)
    sp = poly.simplify(max(bw, bh) * 0.04)
    nv = len(sp.exterior.coords) - 1 if sp.geom_type == "Polygon" else 99
    holes = len(sp.interiors) if sp.geom_type == "Polygon" else 0
    if holes:
        return "courtyard", asp
    if fill >= 0.86:
        return ("square" if asp < 1.3 else "rectangle"), asp
    if fill >= 0.70:
        return ("l-shape" if nv <= 6 else "t-shape"), asp
    if fill >= 0.55:
        return "u-shape", asp
    return "complex", asp


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = Path(sys.argv[1]).expanduser()
    if not src.exists():
        sys.exit(f"not found: {src}")
    print(f"loading {src.name} …")
    data = load_plans(src)
    aug = set()
    try:
        with zipfile.ZipFile(src) as z:
            if "split.json" in z.namelist():
                aug = set(json.loads(z.read("split.json")).get("augmented", []))
    except Exception:
        pass
    print(f"{len(data)} plans ({len(aug)} augmented, skipped)")

    shape_ct: Counter = Counter()
    shape_asp: dict[str, list[float]] = defaultdict(list)
    frac: dict[int, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    rooms_ct: dict[int, dict[str, list[int]]] = defaultdict(lambda: defaultdict(list))
    zone: dict[str, list[tuple[float, float]]] = defaultdict(list)
    attach: dict[str, list[float]] = defaultdict(list)  # frac of A rooms with a door to any B
    corridor = [0, 0]
    n = 0

    for p in data:
        if p.get("id") in aug:
            continue
        s = plan_scale(p)
        if not s:
            continue
        sil = enclosure(p)  # built silhouette (no balconies) — for shape class
        inn = geoms(p.get("inner"))
        if sil is None or sil.geom_type != "Polygon" or not inn:
            continue
        poly = max(inn, key=lambda g: g.area)  # interior boundary — for fractions + zones
        if poly.geom_type != "Polygon" or poly.area <= 0:
            continue
        cls, asp = classify(sil, s)
        if not cls:
            continue
        n += 1
        shape_ct[cls] += 1
        shape_asp[cls].append(round(asp, 3))

        nb = min(len(geoms(p.get("bedroom"))), 5)
        pa = poly.area
        mnx, mny, mxx, mxy = poly.bounds
        bw, bh = mxx - mnx, mxy - mny

        # orient so the front door is at plan-south (y -> 1)
        fd = geoms(p.get("front_door"))
        flip = False
        if fd and bh > 0:
            flip = (fd[0].centroid.y - mny) / bh < 0.5

        def norm(g):
            c = g.centroid
            x = (c.x - mnx) / bw if bw else 0.5
            y = (c.y - mny) / bh if bh else 0.5
            return (round(x, 4), round(1 - y if flip else y, 4))

        for key in ["living", "kitchen", "bedroom", "bathroom", "balcony"]:
            gs = geoms(p.get(key))
            rooms_ct[nb][KIND[key]].append(len(gs))
            for g in gs:
                frac[nb][KIND[key]].append(round(g.area / pa, 4))
                zone[KIND[key]].append(norm(g))
        if fd:
            zone["entry"].append(norm(fd[0]))

        # adjacency: for each ordered type pair, the fraction of A-rooms that
        # have a *door* to at least one B-room (this is what the layout engine
        # needs — "should every bedroom get a door to the living room?")
        G = p.get("graph")
        if G is not None:
            by_type: dict[str, list[str]] = defaultdict(list)
            for nd in G.nodes:
                t = G.nodes[nd].get("type")
                if t:
                    by_type[t].append(nd)
            door_nbrs: dict[str, set[str]] = defaultdict(set)
            for u, v, d in G.edges(data=True):
                if d.get("type") in ("via_door", "direct"):
                    door_nbrs[u].add(v)
                    door_nbrs[v].add(u)
            for ta, nodes_a in by_type.items():
                for tb, nodes_b in by_type.items():
                    if ta == tb or not nodes_b:
                        continue
                    bset = set(nodes_b)
                    hit = sum(1 for na in nodes_a if door_nbrs[na] & bset)
                    attach[f"{KIND.get(ta, ta)}->{KIND.get(tb, tb)}"].append(hit / len(nodes_a))

        # corridor: a thin (aspect > 2.6), small (< 9 % area) room touching ≥ 3 rooms
        allr = [g for k in ["living", "kitchen", "bedroom", "bathroom"] for g in geoms(p.get(k))]
        has = False
        for g in allr:
            b = g.bounds
            w, h = b[2] - b[0], b[3] - b[1]
            if min(w, h) < 1e-6:
                continue
            if max(w, h) / min(w, h) > 2.6 and g.area / pa < 0.09:
                if sum(1 for o in allr if o is not g and g.buffer(s * 12).intersects(o)) >= 3:
                    has = True
                    break
        corridor[0] += 1 if has else 0
        corridor[1] += 1

    if n == 0:
        sys.exit("no plans parsed")

    zsum = {}
    for k, v in zone.items():
        a = np.array(v)
        zsum[k] = {"cx": round(float(a[:, 0].mean()), 3), "cy": round(float(a[:, 1].mean()), 3),
                   "sx": round(float(a[:, 0].std()), 3), "sy": round(float(a[:, 1].std()), 3),
                   "n": len(v)}

    adjacency = {
        k: round(float(np.mean(v)), 3)
        for k, v in sorted(attach.items())
        if len(v) >= 200
    }

    out = {
        "_source": "ResPlan (17k real South-Asian plans, arXiv 2508.14006, CC BY 4.0) — statistics only, not redistributed",
        "_note": "shape classes are of the habitable built silhouette (balconies excluded); real "
                 "listing envelopes are genuinely notched, so u/t dominate — treat shape_mix as a "
                 "weak prior, `auto` keys off plot aspect + programme. zone centroids are normalised "
                 "0..1 with the front door oriented to plan-south (cy→1).",
        "plans_used": n,
        "shape_mix": {k: round(c / n, 3) for k, c in shape_ct.most_common()},
        "shape_aspect": {k: band(v) for k, v in sorted(shape_asp.items())},
        "corridor_share": round(corridor[0] / corridor[1], 3) if corridor[1] else None,
        "program": {
            str(nb): {
                "rooms": {k: round(float(np.mean(v)), 2) for k, v in sorted(rooms_ct[nb].items()) if v},
                "area_fraction": {k: band(v) for k, v in sorted(frac[nb].items()) if v},
            }
            for nb in sorted(frac)
            if nb >= 1
        },
        "zone": zsum,
        "adjacency": adjacency,
    }
    OUT.write_text(json.dumps(out, indent=2) + "\n")
    print(f"wrote {OUT}  ({n} plans)")
    print(json.dumps({k: out[k] for k in ("shape_mix", "corridor_share", "zone", "adjacency")}, indent=2))


if __name__ == "__main__":
    main()
