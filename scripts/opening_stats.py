#!/usr/bin/env python3
"""
opening_stats.py — mine real floor-plan datasets for *where doors and windows
sit*, the numbers BrickPilot's `deriveDoors` / `deriveWindows` are tuned against.

Statistics only. No geometry from any dataset is copied into the app. Keep the
raw dataset files on your machine as reference and respect each licence.

Inputs it understands
---------------------
  SYNBUILD-3D-style zip / dir
      `**/final_building_*.json` with `unit_dict_list` — each unit carries
      `floor_unit_points/adjacency`, `door_unit_points/adj`,
      `window_unit_points/adj`, `unit_room_boundary_dict`.
      Points are metres; z is the building-global height (normalised per unit).
      Room-type ids follow the RPLAN taxonomy
      (1 living, 2 master, 3 kitchen, 4 bath, 5 dining, 6 child, 7 study,
       8 second-bed, 9 guest, 10 balcony, 11 entrance, 12 storage, 13 walk-in).

Usage
-----
    python scripts/opening_stats.py ~/Downloads/sample_100.zip
    # writes scripts/opening_stats.json

Downstream: retune DOOR_JAMB / DOOR_W and the WindowSpec + placement in
src/lib/engine/generate.ts (deriveDoors / deriveWindows) against the output.
"""
from __future__ import annotations

import json
import math
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

OUT = Path(__file__).with_name("opening_stats.json")
PCTS = (10, 25, 50, 75, 90)

ROOM_TYPE = {
    1: "living", 2: "bed", 3: "kitchen", 4: "bath", 5: "dining", 6: "bed",
    7: "study", 8: "bed", 9: "bed", 10: "balcony", 11: "foyer", 12: "utility",
    13: "utility",
}
HABITABLE = {"living", "dining", "kitchen", "bed", "study"}


def pct(xs, p):
    xs = sorted(xs)
    if not xs:
        return None
    k = (len(xs) - 1) * p / 100
    lo, hi = math.floor(k), math.ceil(k)
    return round(xs[lo] + (xs[hi] - xs[lo]) * (k - lo), 3)


def pcts(xs):
    return {f"p{p}": pct(xs, p) for p in PCTS} if xs else None


# --------------------------------------------------------------------------- #
def synbuild_records(src: Path):
    if src.is_dir():
        for f in src.rglob("final_building_*.json"):
            try:
                yield json.loads(f.read_text())
            except Exception:
                continue
        return
    with zipfile.ZipFile(src) as z:
        for n in z.namelist():
            if "MACOSX" in n or not n.endswith(".json"):
                continue
            try:
                d = json.loads(z.read(n))
            except Exception:
                continue
            if isinstance(d, dict) and "unit_dict_list" in d:
                yield d


def components(adj: np.ndarray):
    n = len(adj)
    seen: set[int] = set()
    out = []
    for i in range(n):
        if i in seen:
            continue
        stack, comp = [i], []
        while stack:
            x = stack.pop()
            if x in seen:
                continue
            seen.add(x)
            comp.append(x)
            for y in np.where(adj[x] > 0)[0]:
                if y not in seen:
                    stack.append(int(y))
        out.append(comp)
    return out


def quad_to_seg(pts: np.ndarray):
    """4 opening corners (x,y,z) -> (a2d, b2d, z_lo, z_hi, width)."""
    xy = pts[:, :2]
    uniq: list[np.ndarray] = []
    for p in xy:
        if not any(np.allclose(p, u, atol=1e-4) for u in uniq):
            uniq.append(p)
    if len(uniq) != 2:
        c = xy.mean(0)
        i0 = int(np.argmax(((xy - c) ** 2).sum(1)))
        i1 = int(np.argmax(((xy - xy[i0]) ** 2).sum(1)))
        uniq = [xy[i0], xy[i1]]
    a, b = uniq[0], uniq[1]
    return a, b, float(pts[:, 2].min()), float(pts[:, 2].max()), float(np.hypot(*(b - a)))


def wall_segments(P2: np.ndarray, A: np.ndarray):
    segs = []
    for i in range(len(P2)):
        for j in np.where(A[i] > 0)[0]:
            if j > i:
                segs.append((P2[i], P2[j]))
    return segs


def proj_param(p, a, b):
    ab = b - a
    denom = float(np.dot(ab, ab)) + 1e-12
    t = float(np.dot(p - a, ab)) / denom
    tc = max(0.0, min(1.0, t))
    proj = a + tc * ab
    return float(np.hypot(*(p - proj))), t  # perpendicular dist, unclamped param


def match_wall(a, b, walls):
    """nearest wall segment to opening endpoints a,b -> (wall, perp_err)."""
    best = (1e9, None)
    for (wa, wb) in walls:
        d0, _ = proj_param(a, wa, wb)
        d1, _ = proj_param(b, wa, wb)
        if d0 + d1 < best[0]:
            best = (d0 + d1, (wa, wb))
    return best[1], best[0] / 2


def on_boundary(seg, outline_pts):
    """is this wall segment part of the traced unit outline?"""
    if outline_pts is None:
        return None
    a, b = seg
    n = len(outline_pts)
    for i in range(n):
        p, q = outline_pts[i], outline_pts[(i + 1) % n]
        da, _ = proj_param(np.array(a), np.array(p), np.array(q))
        db, _ = proj_param(np.array(b), np.array(p), np.array(q))
        if da < 0.25 and db < 0.25:
            return True
    return False


def trace_outline(P2: np.ndarray, A: np.ndarray, sub):
    """outer face walk of the sub-graph — same idea as analyze_datasets."""
    S = list(sub)
    nbrs = {i: [j for j in S if j != i and A[i][j]] for i in S}
    nbrs = {i: v for i, v in nbrs.items() if v}
    if len(nbrs) < 3:
        return None
    start = min(nbrs, key=lambda i: (P2[i][0], P2[i][1]))

    def ang(f, t):
        return math.atan2(P2[t][1] - P2[f][1], P2[t][0] - P2[f][0])

    prev = start
    cur = min(nbrs[start], key=lambda j: (ang(start, j) + math.pi / 2) % (2 * math.pi))
    loop = [start]
    for _ in range(len(S) * 4):
        loop.append(cur)
        if cur == start:
            break
        back = ang(cur, prev)
        nxt = min(
            (j for j in nbrs.get(cur, []) if j != prev),
            key=lambda j: (back - ang(cur, j)) % (2 * math.pi),
            default=None,
        )
        if nxt is None:
            return None
        prev, cur = cur, nxt
    if len(loop) < 4 or loop[-1] != start:
        return None
    return [tuple(P2[i]) for i in loop[:-1]]


# --------------------------------------------------------------------------- #
def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)

    units = 0
    door_jamb: list[float] = []          # m, gap from door reveal to nearest wall junction
    door_centre_off: list[float] = []    # |pos-0.5| along the wall, 0 = dead centre
    door_w_int: list[float] = []
    door_w_ext: list[float] = []
    win_sill: list[float] = []
    win_head: list[float] = []
    win_w: list[float] = []
    win_centre_off: list[float] = []     # |pos-0.5| along the room's wall
    win_per_room: dict[str, list[int]] = defaultdict(list)
    room_has_window: Counter = Counter()
    room_seen: Counter = Counter()
    win_wall_len: list[float] = []

    for d in synbuild_records(Path(sys.argv[1]).expanduser()):
        for u in d.get("unit_dict_list", []):
            P = np.asarray(u.get("floor_unit_points") or [], dtype=float)
            A = np.asarray(u.get("floor_unit_adjacency") or [], dtype=float)
            if P.shape[0] < 4 or A.shape[0] != P.shape[0]:
                continue
            floor_z = float(P[:, 2].min())
            P2 = P[:, :2]
            walls = wall_segments(P2, A)
            if not walls:
                continue
            outline = trace_outline(P2, A, range(len(P2)))
            units += 1

            # ---- rooms as bbox rectangles keyed by type ----
            rooms = []
            for code, loops in (u.get("unit_room_boundary_dict") or {}).items():
                try:
                    rtype = ROOM_TYPE.get(int(code))
                except (TypeError, ValueError):
                    rtype = None
                if not rtype:
                    continue
                idx = sorted({i for loop in loops for i in loop if 0 <= i < len(P2)})
                if len(idx) < 3:
                    continue
                pts = P2[idx]
                x0, y0 = pts[:, 0].min(), pts[:, 1].min()
                x1, y1 = pts[:, 0].max(), pts[:, 1].max()
                rooms.append({"type": rtype, "box": (x0, y0, x1, y1),
                              "c": ((x0 + x1) / 2, (y0 + y1) / 2)})
                room_seen[rtype] += 1

            # ---- doors ----
            Dp = np.asarray(u.get("door_unit_points") or [], dtype=float)
            Da = np.asarray(u.get("door_unit_adj") or [], dtype=float)
            if Dp.size and Da.shape[0] == Dp.shape[0]:
                for comp in components(Da):
                    if len(comp) < 3:
                        continue
                    a, b, _z0, _z1, w = quad_to_seg(Dp[comp])
                    wall, err = match_wall(a, b, walls)
                    if wall is None or err > 0.4 or w < 0.4:
                        continue
                    wa, wb = wall
                    L = float(np.hypot(*(wb - wa)))
                    if L < w + 0.2:
                        continue
                    _, ta = proj_param(a, wa, wb)
                    _, tb = proj_param(b, wa, wb)
                    lo, hi = sorted((ta * L, tb * L))
                    jamb = max(0.0, min(lo, L - hi))
                    mid = (lo + hi) / 2 / L
                    ext = on_boundary(wall, outline)
                    if ext:
                        door_w_ext.append(w)
                    else:
                        door_w_int.append(w)
                        door_jamb.append(jamb)
                        door_centre_off.append(abs(mid - 0.5))

            # ---- windows ----
            Wp = np.asarray(u.get("window_unit_points") or [], dtype=float)
            Wa = np.asarray(u.get("window_unit_adj") or [], dtype=float)
            room_win = Counter()
            if Wp.size and Wa.shape[0] == Wp.shape[0]:
                for comp in components(Wa):
                    if len(comp) < 3:
                        continue
                    a, b, z0, z1, w = quad_to_seg(Wp[comp])
                    if w < 0.3:
                        continue
                    win_sill.append(round(z0 - floor_z, 3))
                    win_head.append(round(z1 - floor_z, 3))
                    win_w.append(w)
                    wall, err = match_wall(a, b, walls)
                    if wall is not None and err < 0.5:
                        wa, wb = wall
                        L = float(np.hypot(*(wb - wa)))
                        if L > w:
                            win_wall_len.append(L)
                            _, ta = proj_param(a, wa, wb)
                            _, tb = proj_param(b, wa, wb)
                            mid = (ta + tb) / 2
                            win_centre_off.append(abs(mid - 0.5))
                    # assign to nearest room centroid
                    m = np.array([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])
                    if rooms:
                        r = min(rooms, key=lambda r: math.hypot(m[0] - r["c"][0], m[1] - r["c"][1]))
                        room_win[id(r)] += 1
            for r in rooms:
                k = r["type"]
                cnt = room_win.get(id(r), 0)
                win_per_room[k].append(cnt)
                if cnt:
                    room_has_window[k] += 1

    if units == 0:
        sys.exit("no SYNBUILD units parsed — check the input path")

    out = {
        "_source": "SYNBUILD-3D sample (RPLAN taxonomy) — statistics only, not redistributed",
        "_note": "metres. jamb = gap from a door reveal to the nearest wall junction; "
                 "centre_off = |position-0.5| along the host wall (0 = dead centre). "
                 "Interior doors cluster against a corner, not mid-wall.",
        "units_used": units,
        "door": {
            "interior_jamb_offset_m": pcts(door_jamb),
            "interior_centre_offset": pcts(door_centre_off),
            "interior_clear_width_m": pcts(door_w_int),
            "exterior_clear_width_m": pcts(door_w_ext),
            "share_within_250mm_of_corner": round(
                sum(1 for x in door_jamb if x <= 0.25) / len(door_jamb), 2
            ) if door_jamb else None,
        },
        "window": {
            "sill_height_m": pcts(win_sill),
            "head_height_m": pcts(win_head),
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
                "share_with_any": round(room_has_window[k] / room_seen[k], 2) if room_seen[k] else None,
                "n": room_seen[k],
            }
            for k, v in sorted(win_per_room.items())
        },
    }
    OUT.write_text(json.dumps(out, indent=2) + "\n")
    print(f"wrote {OUT}  ({units} units)")
    print(json.dumps(out["door"], indent=2))
    print(json.dumps(out["window"], indent=2))
    print(json.dumps(out["windows_per_room"], indent=2))


if __name__ == "__main__":
    main()
