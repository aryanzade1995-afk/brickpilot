"""
Structural frame from the spec (§10): columns, beams, slabs.

Every column / beam / slab in the spec was resolved by
src/architecture/generator/structure.ts with a real reason and a
support relationship — this module just draws them. Repeated columns
use one linked mesh. Joined per collection by optimize.py.

Collections: Columns · Beams · Slabs
"""

from __future__ import annotations

from .context import Spec, add_box, assign, collection, linked_box, material, mm


def build(spec: Spec):
    cols_coll = collection("Columns")
    beams_coll = collection("Beams")
    slabs_coll = collection("Slabs")
    fh = mm(spec.requirements["floorHeightMm"])

    for fl in spec.floors:
        L = fl["level"]
        base = mm(fl["baseMm"])

        # ---- columns: a per-storey segment from this slab to the next
        for c in fl.get("columns", []):
            sx, sy = mm(c["sizeMm"][0]), mm(c["sizeMm"][1])
            cx, cy = spec.wx(c["at"]["x"]), spec.wy(c["at"]["y"])
            h = fh
            obj = linked_box(f"col-{c['id']}", cols_coll, (cx, cy, base + h / 2), (sx, sy, h))
            if obj is not None:
                assign(obj, material("base" if c["role"] in ("corner", "frame", "transfer") else "wall", spec))

        # ---- beams: sit just under the slab they carry
        for bm in fl.get("beams", []):
            ax, ay = spec.wx(bm["a"]["x"]), spec.wy(bm["a"]["y"])
            bx, by = spec.wx(bm["b"]["x"]), spec.wy(bm["b"]["y"])
            depth = mm(bm["depthMm"])
            width = 0.23
            length = ((bx - ax) ** 2 + (by - ay) ** 2) ** 0.5
            if length < 0.3:
                continue
            mx, my = (ax + bx) / 2, (ay + by) / 2
            z = base + fh - depth / 2  # beams hang below the slab soffit at this level's top
            horiz = abs(bx - ax) >= abs(by - ay)
            size = (length, width, depth) if horiz else (width, length, depth)
            obj = add_box(f"beam-{bm['id']}", beams_coll, (mx, my, z), size)
            assign(obj, material("base", spec))

        # ---- slabs: the floor plate for this level
        for s in fl.get("slabs", []):
            r = s["rect"]
            cant = s.get("cantilever", {}) or {}
            x0 = r["x"] - cant.get("W", 0)
            x1 = r["x"] + r["w"] + cant.get("E", 0)
            y0 = r["y"] - cant.get("N", 0)
            y1 = r["y"] + r["h"] + cant.get("S", 0)
            cx = (spec.wx(x0) + spec.wx(x1)) / 2
            cy = (spec.wy(y0) + spec.wy(y1)) / 2
            szx = abs(spec.wx(x1) - spec.wx(x0))
            szy = abs(spec.wy(y1) - spec.wy(y0))
            t = mm(s["thicknessMm"])
            obj = add_box(f"slab-{s['id']}", slabs_coll, (cx, cy, base - t / 2), (szx, szy, t))
            assign(obj, material("base", spec))

    return cols_coll
