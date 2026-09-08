"""Storey volumes from the spec's per-floor MassBlocks (+ cantilever overhang)."""

from __future__ import annotations

from .context import Spec, add_box, assign, collection, material, mm


def build(spec: Spec):
    coll = collection("Massing")
    for fl in spec.floors:
        for blk in fl["blocks"]:
            r = blk["rect"]
            base = mm(blk["baseMm"])
            h = mm(blk["heightMm"])
            cant = blk.get("cantilever", {}) or {}

            x0 = r["x"] - cant.get("W", 0)
            x1 = r["x"] + r["w"] + cant.get("E", 0)
            y0 = r["y"] - cant.get("N", 0)
            y1 = r["y"] + r["h"] + cant.get("S", 0)

            cx = (spec.wx(x0) + spec.wx(x1)) / 2
            cy = (spec.wy(y0) + spec.wy(y1)) / 2
            sx = abs(spec.wx(x1) - spec.wx(x0))
            sy = abs(spec.wy(y1) - spec.wy(y0))

            obj = add_box(blk["id"], coll, (cx, cy, base + h / 2), (sx, sy, h))
            assign(obj, material("wall", spec))
    return coll
