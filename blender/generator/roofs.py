"""
Per-block roofs from blk['roof']:
  flat_parapet / flat_band / flat_eave  -> flat slab + parapet / fascia band / oversailing eave
  mono_slope                            -> single-pitch prism
  hip / gable                           -> ridged prism
"""

from __future__ import annotations

import math

from .context import Spec, add_box, add_prism, assign, collection, material, mm


def build(spec: Spec):
    coll = collection("Roofs")
    for fl in spec.floors:
        top = fl["level"] == spec.top_level
        base = mm(fl["baseMm"])
        h = mm(fl["heightMm"])
        for blk in fl["blocks"]:
            r = blk["rect"]
            roof = blk["roof"]
            if not top and not roof.get("terrace"):
                continue
            x0, x1 = spec.wx(r["x"]), spec.wx(r["x"] + r["w"])
            y0, y1 = spec.wy(r["y"]), spec.wy(r["y"] + r["h"])
            lo_x, hi_x, lo_y, hi_y = min(x0, x1), max(x0, x1), min(y0, y1), max(y0, y1)
            cx, cy = (lo_x + hi_x) / 2, (lo_y + hi_y) / 2
            sx, sy = hi_x - lo_x, hi_y - lo_y
            zt = base + h
            eave = mm(roof.get("eaveMm", 0))
            kind = roof["kind"]

            if kind in ("flat_parapet", "flat_band", "flat_eave"):
                thick = 0.2
                obj = add_box(f"roof-{blk['id']}", coll, (cx, cy, zt + thick / 2), (sx + 2 * eave, sy + 2 * eave, thick))
                assign(obj, material("roof", spec))
                par = mm(roof.get("parapetMm", 0))
                if par > 0:
                    _ring(coll, spec, cx, cy, sx, sy, zt + thick, par, "trim")
                band = mm(roof.get("bandMm", 0))
                if band > 0:
                    _ring(coll, spec, cx, cy, sx + 2 * eave, sy + 2 * eave, zt + thick - band, band, "trim", inset=-0.08)
            else:
                pitch = math.radians(roof.get("pitchDeg", 20))
                rise = max(sx, sy) * 0.5 * math.tan(pitch)
                if kind == "mono_slope":
                    fall = roof.get("fall", "S")
                    verts = _mono_verts(lo_x - eave, hi_x + eave, lo_y - eave, hi_y + eave, zt, rise, fall)
                else:  # hip / gable — ridge along X
                    verts = _ridge_verts(lo_x - eave, hi_x + eave, lo_y - eave, hi_y + eave, zt, rise)
                faces = _hull_faces(len(verts))
                obj = add_prism(f"roof-{blk['id']}", coll, verts, faces)
                assign(obj, material("roof", spec))
    return coll


def _ring(coll, spec, cx, cy, sx, sy, z, height, mat, inset: float = 0.0):
    t = 0.14
    for dx, dy, w, d in (
        (0, sy / 2 - inset, sx, t),
        (0, -(sy / 2 - inset), sx, t),
        (sx / 2 - inset, 0, t, sy),
        (-(sx / 2 - inset), 0, t, sy),
    ):
        obj = add_box("parapet", coll, (cx + dx, cy + dy, z + height / 2), (w, d, height))
        assign(obj, material(mat, spec))


def _mono_verts(x0, x1, y0, y1, z, rise, fall):
    lo = z
    hi = z + rise
    if fall == "S":
        return [(x0, y0, lo), (x1, y0, lo), (x1, y1, hi), (x0, y1, hi), (x0, y0, lo - 0.15), (x1, y0, lo - 0.15), (x1, y1, hi - 0.15), (x0, y1, hi - 0.15)]
    return [(x0, y0, hi), (x1, y0, hi), (x1, y1, lo), (x0, y1, lo), (x0, y0, hi - 0.15), (x1, y0, hi - 0.15), (x1, y1, lo - 0.15), (x0, y1, lo - 0.15)]


def _ridge_verts(x0, x1, y0, y1, z, rise):
    ym = (y0 + y1) / 2
    return [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z), (x0, ym, z + rise), (x1, ym, z + rise), (x0, ym, z + rise - 0.15), (x1, ym, z + rise - 0.15)]


def _hull_faces(n: int):
    # simple convex-ish shell: bottom quad + fan to the top verts
    if n == 8:
        return [(0, 1, 2, 3), (0, 1, 5, 4), (1, 2, 5), (2, 3, 5, 4), (3, 0, 4)]
    return [(0, 1, 2, 3)]
