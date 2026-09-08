"""
Exterior wall shells — four thin wall planes per massing block. Returned as
a dict keyed by (level, side) so windows.py / doors.py can cut the right one.
Interior partitions come from rooms.py (cutaway only).
"""

from __future__ import annotations

from .context import Spec, add_box, assign, collection, material, mm

EXT_T = 0.23


def build(spec: Spec, detailed: bool = True):
    coll = collection("Walls")
    walls: dict[tuple[int, str], list] = {}
    for fl in spec.floors:
        L = fl["level"]
        base = mm(fl["baseMm"])
        h = mm(fl["heightMm"])
        for blk in fl["blocks"]:
            r = blk["rect"]
            x0, x1 = spec.wx(r["x"]), spec.wx(r["x"] + r["w"])
            y0, y1 = spec.wy(r["y"]), spec.wy(r["y"] + r["h"])
            lo_x, hi_x = min(x0, x1), max(x0, x1)
            lo_y, hi_y = min(y0, y1), max(y0, y1)
            span_x = hi_x - lo_x
            span_y = hi_y - lo_y
            zc = base + h / 2
            # plan side -> world edge. plan-S (entry) maps to world -Y (lo_y).
            edges = {
                "S": ((lo_x + hi_x) / 2, lo_y, span_x, EXT_T),
                "N": ((lo_x + hi_x) / 2, hi_y, span_x, EXT_T),
                "W": (lo_x, (lo_y + hi_y) / 2, EXT_T, span_y),
                "E": (hi_x, (lo_y + hi_y) / 2, EXT_T, span_y),
            }
            for side, (cx, cy, sx, sy) in edges.items():
                obj = add_box(f"wall-{blk['id']}-{side}", coll, (cx, cy, zc), (sx, sy, h))
                assign(obj, material("wall", spec))
                walls.setdefault((L, side), []).append(obj)
    void = detailed  # (kept for a future non-detailed fast path)
    del void
    return coll, walls
