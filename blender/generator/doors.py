"""Doors — entry (optionally double-height + canopy) and balcony/court doors.
Internal doors are only cut for the cutaway model."""

from __future__ import annotations

from .context import Spec, add_box, assign, boolean_cut, collection, material, mm


def build(spec: Spec, wall_objs: dict, include_internal: bool = False):
    coll = collection("Doors")
    for fl in spec.floors:
        L = fl["level"]
        base = mm(fl["baseMm"])
        for d in fl["doors"]:
            if d["kind"] == "internal" and not include_internal:
                continue
            a, b = d["wall"]["a"], d["wall"]["b"]
            ax, ay = spec.wx(a["x"]), spec.wy(a["y"])
            bx, by = spec.wx(b["x"]), spec.wy(b["y"])
            cx, cy = (ax + bx) / 2, (ay + by) / 2
            axis = "x" if abs(bx - ax) > abs(by - ay) else "y"
            width = mm(d["widthMm"])
            height = mm(d["heightMm"])
            zc = base + height / 2

            size = (width, 0.6, height) if axis == "x" else (0.6, width, height)
            for host in wall_objs.get((L, d["side"]), []):
                cutter = add_box(f"{d['id']}-cut", coll, (cx, cy, zc), size)
                boolean_cut(host, cutter, delete_cutter=True)

            leaf_size = (width - 0.04, 0.05, height - 0.04) if axis == "x" else (0.05, width - 0.04, height - 0.04)
            leaf = add_box(f"{d['id']}-leaf", coll, (cx, cy, zc), leaf_size)
            assign(leaf, material("accent" if d["kind"] == "entry" else "frame", spec))

            canopy = mm(d.get("canopyMm", 0))
            if canopy > 0:
                cw = width + 1.6
                obj = add_box(f"{d['id']}-canopy", coll, (cx, cy - canopy / 2, base + height + 0.12), (cw, canopy, 0.24))
                assign(obj, material("trim", spec))
    return coll
