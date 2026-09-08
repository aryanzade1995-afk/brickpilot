#!/usr/bin/env python3
"""
resplan_openings.py — mine ResPlan for *where doors and windows sit*, the
numbers BrickPilot's `deriveDoors` / `deriveWindows` are tuned against.

ResPlan (github.com/m-agour/ResPlan, arXiv 2508.14006, CC BY 4.0) is 17,000 real
**South-Asian** residential floor plans as Shapely vector geometry — the closest
public dataset to BrickPilot's brief. Statistics only; no geometry is copied
into the app. The dataset has a takedown policy — keep the .pkl as reference.

Plan schema (per dict):
    living/kitchen : Polygon        bedroom/bathroom/balcony : MultiPolygon
    door/window/wall/front_door     : (Multi)Polygon  — thin rectangles in-wall
    inner          : (Multi)Polygon — the interior boundary
    wall_depth     : float (px)     area : float (m²)   graph : nx.Graph
Coordinates are a per-plan-normalised ~256 px canvas; the metric scale is
recovered from `area` (m²) ÷ built pixel-area.

Usage
-----
    pip install shapely numpy networkx
    python scripts/resplan_openings.py "~/Downloads/archive (2).zip"
    python scripts/resplan_openings.py ~/Downloads/ResPlan.pkl
    # writes scripts/opening_stats.json  (ResPlan supersedes the SYNBUILD run)
"""
from __future__ import annotations

import json
import math
import pickle
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

OUT = Path(__file__).with_name("opening_stats.json")
PCTS = (10, 25, 50, 75, 90)

# ResPlan's flat taxonomy -> BrickPilot room kinds. `bedroom` is generic (no
# master/child split); `dining`/`study` are not labelled separately.
KIND = {
    "living": "living", "kitchen": "kitchen", "bedroom": "bed",
    "bathroom": "bath", "balcony": "balcony", "storage": "utility",
    "stair": "stair",
}
ROOM_KEYS = ["living", "kitchen", "bedroom", "bathroom", "balcony", "storage", "stair"]
DAYLIGHT = {"living", "kitchen", "bed"}


def pct(xs, p):
    xs = sorted(xs)
    if not xs:
        return None
    k = (len(xs) - 1) * p / 100
    lo, hi = math.floor(k), math.ceil(k)
    return round(xs[lo] + (xs[hi] - xs[lo]) * (k - lo), 3)


def pcts(xs):
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
    """metres per pixel, from the real floor area over the built pixel-area."""
    inner, wall = p.get("inner"), p.get("wall")
    a = (inner.area if inner and not inner.is_empty else 0.0) + (
        wall.area if wall and not wall.is_empty else 0.0
    )
    A = p.get("area")
    return math.sqrt(A / a) if a > 0 and A else None


def obb(poly):
    """(long_len, short_len, cx, cy, ux, uy) — oriented bbox long axis."""
    r = poly.minimum_rotated_rectangle
    if r.geom_type != "Polygon":
        return None
    xs, ys = r.exterior.coords.xy
    p = [(xs[i], ys[i]) for i in range(4)]
    e0 = math.dist(p[0], p[1])
    e1 = math.dist(p[1], p[2])
    if e0 >= e1:
        a, b, lng, sht = p[0], p[1], e0, e1
    else:
        a, b, lng, sht = p[1], p[2], e1, e0
    if lng < 1e-6:
        return None
    ux, uy = (b[0] - a[0]) / lng, (b[1] - a[1]) / lng
    c = poly.centroid
    return lng, sht, c.x, c.y, ux, uy


def ring_segments(poly, simp):
    """exterior-ring segments of a (simplified) room polygon, as
    ((x1,y1),(x2,y2),length,ux,uy)."""
    g = poly.simplify(simp).buffer(0)
    parts = geoms(g) or [poly]
    out = []
    for part in parts:
        if part.geom_type != "Polygon":
            continue
        cs = list(part.exterior.coords)
        for i in range(len(cs) - 1):
            (x1, y1), (x2, y2) = cs[i], cs[i + 1]
            L = math.hypot(x2 - x1, y2 - y1)
            if L > simp:
                out.append((x1, y1, x2, y2, L, (x2 - x1) / L, (y2 - y1) / L))
    return out


def host_edge(cx, cy, ux, uy, segs):
    """the ring segment an opening at (cx,cy) with axis (ux,uy) sits on:
    minimise perpendicular distance, penalise non-parallel."""
    best, bestcost = None, 1e18
    for (x1, y1, x2, y2, L, sx, sy) in segs:
        t = ((cx - x1) * sx + (cy - y1) * sy) / L
        tc = max(0.0, min(1.0, t))
        px, py = x1 + tc * L * sx, y1 + tc * L * sy
        d = math.hypot(cx - px, cy - py)
        para = abs(ux * sx + uy * sy)  # 1 = parallel
        cost = d + (1.0 - para) * L * 2.0
        if cost < bestcost:
            bestcost = cost
            best = (x1, y1, x2, y2, L, sx, sy, t)
    return best, bestcost


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

    door_jamb: list[float] = []
    door_centre_off: list[float] = []
    door_w_int: list[float] = []
    door_w_ext: list[float] = []
    win_w: list[float] = []
    win_centre_off: list[float] = []
    win_wall_len: list[float] = []
    win_per_room: dict[str, list[int]] = defaultdict(list)
    room_has_win: Counter = Counter()
    room_seen: Counter = Counter()
    pair_w: dict[str, list[float]] = defaultdict(list)
    n_plans = 0

    for p in data:
        if p.get("id") in aug:
            continue
        s = plan_scale(p)
        if not s:
            continue
        wd = (p.get("wall_depth") or 4.0)
        inner = p.get("inner")
        inner_ring = None
        if inner is not None and not inner.is_empty:
            ig = geoms(inner)
            if ig:
                inner_ring = max(ig, key=lambda g: g.area).exterior
        rooms = []
        for key in ROOM_KEYS:
            for g in geoms(p.get(key)):
                if g.geom_type == "Polygon" and g.area > (wd * 4) ** 2:
                    rooms.append({"kind": KIND[key], "poly": g,
                                  "buf": g.buffer(wd * 1.4), "wins": 0})
        if not rooms:
            continue
        n_plans += 1
        for r in rooms:
            room_seen[r["kind"]] += 1

        # doors
        for d in geoms(p.get("door")):
            o = obb(d)
            if not o:
                continue
            lng, sht, cx, cy, ux, uy = o
            w = lng * s
            if not (0.4 < w < 2.6):
                continue
            near = [r for r in rooms if r["buf"].intersects(d)]
            near.sort(key=lambda r: d.distance(r["poly"]))
            near = near[:2]
            if not near:
                continue
            ext = bool(inner_ring) and inner_ring.distance(d.centroid) < wd * 1.8
            (door_w_ext if ext else door_w_int).append(w)
            if len(near) == 2:
                a, b = sorted(k["kind"] for k in near)
                pair_w[f"{a}|{b}"].append(w)
            if not ext:
                target = near[-1]
                seg, cost = host_edge(cx, cy, ux, uy, ring_segments(target["poly"], wd * 0.6))
                if seg and cost < wd * 3:
                    x1, y1, x2, y2, L, sx, sy, t = seg
                    tc = max(0.0, min(1.0, t))
                    # gap from the nearer door *reveal* (edge) to the room corner
                    door_jamb.append(max(0.0, min(tc, 1 - tc) * L * s - w / 2))
                    door_centre_off.append(abs(tc - 0.5))

        # windows
        for wnd in geoms(p.get("window")):
            o = obb(wnd)
            if not o:
                continue
            lng, sht, cx, cy, ux, uy = o
            w = lng * s
            if not (0.3 < w < 4.0):
                continue
            win_w.append(w)
            near = [r for r in rooms if r["buf"].intersects(wnd)]
            near.sort(key=lambda r: wnd.distance(r["poly"]))
            if not near:
                continue
            host = near[0]
            host["wins"] += 1
            seg, cost = host_edge(cx, cy, ux, uy, ring_segments(host["poly"], wd * 0.6))
            if seg and cost < wd * 3:
                x1, y1, x2, y2, L, sx, sy, t = seg
                tc = max(0.0, min(1.0, t))
                win_centre_off.append(abs(tc - 0.5))
                win_wall_len.append(L * s)

        for r in rooms:
            win_per_room[r["kind"]].append(r["wins"])
            if r["wins"]:
                room_has_win[r["kind"]] += 1

    out = {
        "_source": "ResPlan (17k real South-Asian plans, arXiv 2508.14006, CC BY 4.0) — statistics only, not redistributed",
        "_note": "metres, recovered per-plan from `area` m². jamb = gap from a door reveal to "
                 "the nearest corner of the room it opens into; centre_off = |position-0.5| along "
                 "the host wall (0 = dead centre). ResPlan is 2-D — no sill/head; keep those from "
                 "NBC norms / SYNBUILD (sill ~0.9 m).",
        "plans_used": n_plans,
        "door": {
            "interior_jamb_offset_m": pcts(door_jamb),
            "interior_centre_offset": pcts(door_centre_off),
            "interior_clear_width_m": pcts(door_w_int),
            "exterior_clear_width_m": pcts(door_w_ext),
            "share_reveal_within_250mm_of_corner": round(
                sum(1 for x in door_jamb if x <= 0.25) / len(door_jamb), 2
            ) if door_jamb else None,
            "clear_width_by_room_pair_m": {
                k: {"p50": pct(v, 50), "n": len(v)}
                for k, v in sorted(pair_w.items())
                if len(v) >= 40
            },
        },
        "window": {
            "width_m": pcts(win_w),
            "centre_offset_on_wall": pcts(win_centre_off),
            "host_wall_length_m": pcts(win_wall_len),
            "share_centred_within_15pct": round(
                sum(1 for x in win_centre_off if x <= 0.15) / len(win_centre_off), 2
            ) if win_centre_off else None,
        },
        "windows_per_room": {
            k: {
                "mean": round(sum(v) / len(v), 2),
                "p50": pct([float(x) for x in v], 50),
                "p90": pct([float(x) for x in v], 90),
                "share_with_any": round(room_has_win[k] / room_seen[k], 2) if room_seen[k] else None,
                "n": room_seen[k],
            }
            for k, v in sorted(win_per_room.items())
        },
    }
    OUT.write_text(json.dumps(out, indent=2) + "\n")
    print(f"wrote {OUT}  ({n_plans} plans)")
    print(json.dumps({k: out[k] for k in ("door", "window", "windows_per_room")}, indent=2))


if __name__ == "__main__":
    main()
