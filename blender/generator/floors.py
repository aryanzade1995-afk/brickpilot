"""Floor slabs — a thin slab at each storey base (visible in a cutaway)."""

from __future__ import annotations

from .context import Spec, add_box, assign, collection, material, mm

SLAB = 0.15


def build(spec: Spec):
    coll = collection("Floors")
    for fl in spec.floors:
        base = mm(fl["baseMm"])
        for blk in fl["blocks"]:
            r = blk["rect"]
            cx = (spec.wx(r["x"]) + spec.wx(r["x"] + r["w"])) / 2
            cy = (spec.wy(r["y"]) + spec.wy(r["y"] + r["h"])) / 2
            sx = abs(spec.wx(r["x"] + r["w"]) - spec.wx(r["x"]))
            sy = abs(spec.wy(r["y"] + r["h"]) - spec.wy(r["y"]))
            obj = add_box(f"slab-{blk['id']}", coll, (cx, cy, base - SLAB / 2), (sx, sy, SLAB))
            assign(obj, material("floor", spec))
    return coll
