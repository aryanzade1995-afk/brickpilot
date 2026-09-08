"""
Interior partitions (cutaway model only) — a thin wall on each interior edge of
a room that is NOT already an exterior wall. Kept simple: one box per room
outline, hollowed by the room interior, so a cutaway reads as rooms.
"""

from __future__ import annotations

from .context import Spec, add_box, assign, collection, material, mm

INT_T = 0.1
CUT = 1.2  # partitions trimmed to this height for the dollhouse cutaway


def build(spec: Spec, cutaway_height: float = CUT):
    coll = collection("Partitions")
    for fl in spec.floors:
        base = mm(fl["baseMm"])
        h = min(mm(fl["heightMm"]), cutaway_height)
        for room in fl["rooms"]:
            if room["outdoor"] or room["class"] in ("balcony", "parking", "verandah", "courtyard"):
                continue
            r = room["rect"]
            x0, x1 = spec.wx(r["x"]), spec.wx(r["x"] + r["w"])
            y0, y1 = spec.wy(r["y"]), spec.wy(r["y"] + r["h"])
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            sx, sy = abs(x1 - x0), abs(y1 - y0)
            for dx, dy, w, d in (
                (0, sy / 2, sx, INT_T),
                (0, -sy / 2, sx, INT_T),
                (sx / 2, 0, INT_T, sy),
                (-sx / 2, 0, INT_T, sy),
            ):
                obj = add_box(f"part-{room['id']}", coll, (cx + dx, cy + dy, base + h / 2), (w, d, h))
                assign(obj, material("trim", spec))
    return coll
