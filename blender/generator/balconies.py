"""Balcony slabs + railings from the spec's BalconySpec list."""

from __future__ import annotations

from .context import Spec, add_box, assign, collection, material, mm

SLAB = 0.16
RAIL_H = 1.0


def build(spec: Spec):
    coll = collection("Balconies")
    for fl in spec.floors:
        base = mm(fl["baseMm"])
        for b in fl["balconies"]:
            r = b["rect"]
            x0, x1 = spec.wx(r["x"]), spec.wx(r["x"] + r["w"])
            y0, y1 = spec.wy(r["y"]), spec.wy(r["y"] + r["h"])
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            sx, sy = abs(x1 - x0), abs(y1 - y0)

            slab = add_box(f"{b['id']}-slab", coll, (cx, cy, base + SLAB / 2), (sx, sy, SLAB))
            assign(slab, material("trim", spec))

            rail_mat = "glass" if b["railStyle"] == "glass" else "frame"
            # rail along the three open edges (not the wall side)
            edges = {
                "S": [(cx, cy - sy / 2, sx, 0.06), (cx - sx / 2, cy, 0.06, sy), (cx + sx / 2, cy, 0.06, sy)],
                "N": [(cx, cy + sy / 2, sx, 0.06), (cx - sx / 2, cy, 0.06, sy), (cx + sx / 2, cy, 0.06, sy)],
                "W": [(cx - sx / 2, cy, 0.06, sy), (cx, cy - sy / 2, sx, 0.06), (cx, cy + sy / 2, sx, 0.06)],
                "E": [(cx + sx / 2, cy, 0.06, sy), (cx, cy - sy / 2, sx, 0.06), (cx, cy + sy / 2, sx, 0.06)],
            }.get(b["side"], [])
            for i, (rx, ry, rw, rd) in enumerate(edges):
                obj = add_box(f"{b['id']}-rail{i}", coll, (rx, ry, base + SLAB + RAIL_H / 2), (rw, rd, RAIL_H))
                assign(obj, material(rail_mat, spec))
    return coll
