#!/usr/bin/env python3
"""
analyze_datasets.py — mine the 3-D house datasets for the parameter *ranges* the
massing grammar (src/lib/engine/massing/) is tuned against.

Statistics only. Nothing from any dataset is copied into the app — no geometry,
no models, no assets. Respect each dataset's licence; the raw files stay on your
machine as reference.

Inputs it understands
---------------------
  *.zip / dir containing SYNBUILD-3D-style JSON
      (`**/final_building_*.json` with `unit_dict_list`, `sampled_roof_points_list`)
  *.zip / *.dae  COLLADA exports (SketchUp etc.) — one concrete villa each

Usage
-----
    python scripts/analyze_datasets.py ~/Downloads/sample_100.zip ~/Downloads/vlla+6.zip
    # writes scripts/massing_stats.json

When scripts/massing_stats.json is absent the grammar falls back to the built-in
defaults compiled into archetypes.ts (see the comments there).
"""
from __future__ import annotations

import json
import math
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter
from pathlib import Path

OUT = Path(__file__).with_name("massing_stats.json")
PCTS = (10, 50, 90)


def pct(xs: list[float], p: int) -> float:
    if not xs:
        return 0.0
    xs = sorted(xs)
    k = (len(xs) - 1) * p / 100
    lo, hi = math.floor(k), math.ceil(k)
    if lo == hi:
        return round(xs[int(k)], 3)
    return round(xs[lo] + (xs[hi] - xs[lo]) * (k - lo), 3)


def poly_area(pts: list[list[float]]) -> float:
    if len(pts) < 3:
        return 0.0
    s = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i][0], pts[i][1]
        x2, y2 = pts[(i + 1) % len(pts)][0], pts[(i + 1) % len(pts)][1]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2


def bbox(pts):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def trace_outer_boundary(pts, adj, subset):
    """Walk the outer face of the planar wireframe restricted to `subset`
    (vertex indices). Returns the boundary as an ordered [x, y] list, or None.
    `adj` is an N×N 0/1 matrix."""
    S = set(subset)
    nbrs = {i: [j for j in subset if j != i and adj[i][j]] for i in subset}
    nbrs = {i: v for i, v in nbrs.items() if v}
    if len(nbrs) < 3:
        return None
    start = min(nbrs, key=lambda i: (pts[i][0], pts[i][1]))
    # first step: the neighbour giving the smallest polar angle from straight down
    import math as _m

    def ang(frm, to):
        return _m.atan2(pts[to][1] - pts[frm][1], pts[to][0] - pts[frm][0])

    prev = start
    cur = min(nbrs[start], key=lambda j: (ang(start, j) - (-_m.pi / 2)) % (2 * _m.pi))
    loop = [start]
    for _ in range(len(subset) * 3):
        loop.append(cur)
        if cur == start:
            break
        back = ang(cur, prev)
        # turn as far clockwise (right) as possible → hugs the outer boundary
        nxt = min(
            nbrs.get(cur, []),
            key=lambda j: (back - ang(cur, j)) % (2 * _m.pi) if j != prev else 1e9,
            default=None,
        )
        if nxt is None:
            return None
        prev, cur = cur, nxt
    if len(loop) < 4 or loop[-1] != start:
        return None
    return [pts[i][:2] for i in loop[:-1]]


# --------------------------------------------------------------------------- #
#  SYNBUILD-3D style JSON
# --------------------------------------------------------------------------- #
def synbuild_records(src: Path):
    if src.is_dir():
        for f in src.rglob("final_building_*.json"):
            yield json.loads(f.read_text())
        return
    with zipfile.ZipFile(src) as z:
        for n in z.namelist():
            if "MACOSX" in n or not n.endswith(".json"):
                continue
            if "final_building" not in n and "final_building_outdir" not in n:
                # SYNBUILD keeps them under final_building_outdir/**, but be lenient
                pass
            try:
                d = json.loads(z.read(n))
            except Exception:
                continue
            if isinstance(d, dict) and "unit_dict_list" in d:
                yield d


def analyse_synbuild(src: Path, acc: dict) -> int:
    n = 0
    for d in synbuild_records(src):
        bp = d.get("final_building_points") or []
        ba = d.get("final_building_adj") or []
        n_units = len(d.get("unit_dict_list") or [])
        if not bp or len(ba) != len(bp) or not (1 <= n_units <= 5):
            continue

        # group vertices by storey z-level (SYNBUILD stacks floors at a fixed
        # floor-to-floor height); trace the outer boundary of each level
        zs = sorted({round(p[2], 1) for p in bp})
        levels = [z for z in zs if z < max(zs)] or zs[:1]  # drop the roof band
        foots = []
        for z in levels[:n_units]:
            sub = [i for i, p in enumerate(bp) if abs(p[2] - z) < 0.6]
            poly = trace_outer_boundary(bp, ba, sub) if len(sub) >= 3 else None
            if not poly:
                foots = []
                break
            a = poly_area(poly)
            bx = bbox(poly)
            sol = a / (max(1e-6, (bx[2] - bx[0]) * (bx[3] - bx[1])))
            if not (0.3 <= sol <= 1.03):  # a bad trace — skip the whole building
                foots = []
                break
            foots.append((a, bx))
        if len(foots) < 2:
            continue
        n += 1
        acc["storeys"].append(n_units)

        prev_c = None
        prev_span = None
        for area, (x0, y0, x1, y1) in foots:  # type: ignore[misc]
            w, h = (x1 - x0) or 1e-6, (y1 - y0) or 1e-6
            acc["solidity"].append(min(1.0, area / (w * h)))
            acc["aspect"].append(max(w, h) / min(w, h))
            c = ((x0 + x1) / 2, (y0 + y1) / 2)
            span = max(w, h)
            if prev_c is not None:
                d_off = math.hypot(c[0] - prev_c[0], c[1] - prev_c[1])
                acc["floor_offset_ratio"].append(d_off / prev_span)
                acc["floor_shrink_ratio"].append(min(1.5, span / prev_span))
            prev_c, prev_span = c, span

        top_bb = foots[-1][1]  # type: ignore[index]
        g_bb = foots[0][1]  # type: ignore[index]

        # roof rise / pitch from the sampled roof cloud, over the top-floor span
        roof = d.get("sampled_roof_points_list") or []
        roof = [p for p in roof if isinstance(p, (list, tuple)) and len(p) >= 3]
        if len(roof) > 20:
            zs = [p[2] for p in roof]
            rise = max(zs) - min(zs)
            run = max(top_bb[2] - top_bb[0], top_bb[3] - top_bb[1]) / 2 or 1e-6
            acc["roof_rise_over_run"].append(min(1.2, rise / run))
            acc["roof_pitch_deg"].append(round(math.degrees(math.atan2(rise, run)), 1))
            acc["roof_flat"].append(1 if rise / run < 0.08 else 0)

        # opening density: windows per metre of ground perimeter
        win = d.get("final_window_points") or []
        perim = 2 * ((g_bb[2] - g_bb[0]) + (g_bb[3] - g_bb[1])) or 1e-6
        acc["window_density"].append(len(win) / perim)
    return n


# --------------------------------------------------------------------------- #
#  COLLADA (.dae) — one concrete villa
# --------------------------------------------------------------------------- #
def analyse_collada(src: Path, exemplars: list) -> int:
    data = None
    name = src.name
    if src.suffix == ".zip":
        with zipfile.ZipFile(src) as z:
            dae = next((n for n in z.namelist() if n.endswith(".dae")), None)
            if not dae:
                return 0
            data = z.read(dae)
            name = dae
    elif src.suffix == ".dae":
        data = src.read_bytes()
    if not data:
        return 0

    # pull every <float_array> of vertex positions; COLLADA is xyz-interleaved.
    # skip 16-length arrays (transform matrices) and other non-mesh payloads.
    floats = []
    for m in re.finditer(rb"<float_array[^>]*>([^<]+)</float_array>", data):
        chunk = m.group(1).split()
        if len(chunk) % 3 == 0 and 12 <= len(chunk) and len(chunk) != 16:
            try:
                floats.append([float(x) for x in chunk])
            except ValueError:
                continue
    if not floats:
        return 0
    xs, ys, zs = [], [], []
    for arr in floats:
        for i in range(0, len(arr) - 2, 3):
            xs.append(arr[i]); ys.append(arr[i + 1]); zs.append(arr[i + 2])
    if len(xs) < 50:
        return 0

    # NB: this does NOT compose the COLLADA scene-graph <node> transforms, so the
    # absolute extent is only indicative — we report shape ratios, which survive
    # the missing transforms. Install `pycollada` and extend for true metres.
    def robust_span(vs: list[float]) -> float:
        vs = sorted(vs)
        k = len(vs) - 1
        return vs[min(k, int(k * 0.97))] - vs[int(k * 0.03)]

    w, d, hgt = robust_span(xs), robust_span(ys), robust_span(zs)
    long_side, short_side = max(w, d, 1e-6), max(1e-6, min(w, d))
    exemplars.append(
        {
            "source": name,
            "vertices": len(xs),
            "local_aspect": round(long_side / short_side, 2),
            "height_over_footprint": round(hgt / long_side, 2),
            "_note": "extent not transform-composed; ratios only",
        }
    )
    return 1


# --------------------------------------------------------------------------- #
def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)

    acc = {
        k: []
        for k in (
            "storeys",
            "solidity",
            "aspect",
            "floor_offset_ratio",
            "floor_shrink_ratio",
            "roof_rise_over_run",
            "roof_pitch_deg",
            "roof_flat",
            "window_density",
        )
    }
    exemplars: list = []
    syn_n = dae_n = 0

    for a in sys.argv[1:]:
        p = Path(a).expanduser()
        if not p.exists():
            print(f"skip (not found): {p}")
            continue
        if p.suffix == ".dae" or (p.suffix == ".zip" and _has_dae(p)):
            dae_n += analyse_collada(p, exemplars)
        else:
            syn_n += analyse_synbuild(p, acc)

    if syn_n == 0 and dae_n == 0:
        sys.exit("no recognised records — pass a SYNBUILD-style zip and/or a .dae / zip-with-.dae")

    solidity = acc["solidity"]
    non_rect = sum(1 for s in solidity if s < 0.92) / len(solidity) if solidity else 0.0

    out = {
        "_source": "SYNBUILD-3D-style JSON + COLLADA villa exports — statistics only, not redistributed",
        "buildings_used": syn_n,
        "collada_exemplars": exemplars,
        "storey_hist": {str(k): v for k, v in sorted(Counter(acc["storeys"]).items())},
        "footprint_solidity": {f"p{p}": pct(solidity, p) for p in PCTS},
        "share_non_rectangular_footprint": round(non_rect, 2),
        "footprint_aspect": {f"p{p}": pct(acc["aspect"], p) for p in PCTS},
        "floor_offset_ratio": {f"p{p}": pct(acc["floor_offset_ratio"], p) for p in PCTS},
        "floor_shrink_ratio": {f"p{p}": pct(acc["floor_shrink_ratio"], p) for p in PCTS},
        "roof_rise_over_run": {f"p{p}": pct(acc["roof_rise_over_run"], p) for p in PCTS},
        "roof_pitch_deg": {f"p{p}": pct(acc["roof_pitch_deg"], p) for p in PCTS},
        "share_flat_roof": round(sum(acc["roof_flat"]) / len(acc["roof_flat"]), 2)
        if acc["roof_flat"]
        else None,
        "window_density_per_m": {f"p{p}": pct(acc["window_density"], p) for p in PCTS},
    }
    OUT.write_text(json.dumps(out, indent=2) + "\n")
    print(f"wrote {OUT}  (synbuild={syn_n}, collada={dae_n})")
    print(json.dumps({k: out[k] for k in ("storey_hist", "footprint_solidity", "share_non_rectangular_footprint", "floor_offset_ratio")}, indent=2))


def _has_dae(zip_path: Path) -> bool:
    try:
        with zipfile.ZipFile(zip_path) as z:
            return any(n.endswith(".dae") for n in z.namelist())
    except Exception:
        return False


if __name__ == "__main__":
    main()
