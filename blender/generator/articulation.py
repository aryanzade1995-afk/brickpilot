"""
Facade articulation from the spec: the depth system.

Reads exactly the same resolved elements the three.js viewer reads
(`src/lib/three/buildMassing.ts` emitters), so the baked GLB and the
in-browser study model articulate identically:

    floors[].articulation.slabEdges   projecting floor plate + fascia + drip
    floors[].articulation.chajjas     cantilevered weather hoods
    floors[].articulation.fins        vertical brise-soleil
    floors[].articulation.screens     timber batten / jaali planes
    floors[].articulation.parapets    parapet upstand + coping cap

Nothing is decided here. `src/architecture/generator/articulationResolver.ts`
already chose every projection; this module only draws them. Window jamb
reveals and sills are cut by windows.py from `window.reveal`.

Convention: every articulation rect is already positioned OUTSIDE the wall
face in the plot frame, so there is no "which way is out" arithmetic here.

Collections: Articulation
"""

from __future__ import annotations

from .context import Spec, add_box, assign, collection, linked_box, material, mm


def _rect_box(name, coll, spec, r, z0, z1, mat_slot):
    """A box from a plot-frame rect extruded between two world heights."""
    h = z1 - z0
    if h <= 0.004 or r["w"] <= 4 or r["h"] <= 4:
        return None
    x0, x1 = spec.wx(r["x"]), spec.wx(r["x"] + r["w"])
    y0, y1 = spec.wy(r["y"]), spec.wy(r["y"] + r["h"])
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    obj = add_box(name, coll, (cx, cy, z0 + h / 2), (abs(x1 - x0), abs(y1 - y0), h))
    if obj is not None:
        assign(obj, material(mat_slot, spec))
    return obj


def _grow(r, by):
    return {"x": r["x"] - by, "y": r["y"] - by, "w": r["w"] + 2 * by, "h": r["h"] + 2 * by}


def build(spec: Spec):
    coll = collection("Articulation")

    for fl in spec.floors:
        art = fl.get("articulation") or {}
        if not art:
            continue
        L = fl["level"]
        base = mm(fl["baseMm"])
        wall_top = base + mm(fl["heightMm"])

        # ---- floor plate edges: the horizontal shadow line ----------------
        # The band hangs BELOW finished floor and stops short of it, so the
        # plate reads as a separate element, not a bulge in the wall.
        if L > 0:
            for se in art.get("slabEdges", []):
                fascia = mm(se["fasciaMm"])
                gap = mm(se["shadowGapMm"])
                top = base - gap
                bot = top - fascia
                _rect_box(f"art-{se['id']}", coll, spec, se["rect"], bot, top, "base")
                if se.get("dripMm", 0) > 0:
                    _rect_box(
                        f"art-{se['id']}-drip", coll, spec,
                        _grow(se["rect"], se["dripMm"]), bot, bot + 0.025, "base",
                    )

        # ---- chhajjas: hood + the drip that stops it staining the wall ----
        for c in art.get("chajjas", []):
            z0 = base + mm(c["atMm"])
            _rect_box(f"art-{c['id']}", coll, spec, c["rect"], z0, z0 + mm(c["thickMm"]), "base")
            if c.get("dripMm", 0) > 0:
                r = c["rect"]
                horiz = c["side"] in ("N", "S")
                if horiz:
                    ly = r["y"] + r["h"] - 70 if c["side"] == "S" else r["y"]
                    lip = {"x": r["x"], "y": ly, "w": r["w"], "h": 70}
                else:
                    lx = r["x"] + r["w"] - 70 if c["side"] == "E" else r["x"]
                    lip = {"x": lx, "y": r["y"], "w": 70, "h": r["h"]}
                _rect_box(
                    f"art-{c['id']}-drip", coll, spec, lip,
                    z0 - mm(c["dripMm"]), z0 + mm(c["thickMm"]), "base",
                )

        # ---- fins: vertical brise-soleil -----------------------------------
        for f in art.get("fins", []):
            z0, z1 = base + mm(f["fromMm"]), base + mm(f["toMm"])
            if z1 - z0 < 0.15:
                continue
            r = f["rect"]
            horiz = f["side"] in ("N", "S")
            along = r["w"] if horiz else r["h"]
            n = max(2, f["count"])
            for i in range(n):
                t = 0.5 if n == 1 else i / (n - 1)
                c = (r["x"] if horiz else r["y"]) + t * along
                half = f["thickMm"] / 2
                fr = (
                    {"x": c - half, "y": r["y"], "w": f["thickMm"], "h": r["h"]}
                    if horiz
                    else {"x": r["x"], "y": c - half, "w": r["w"], "h": f["thickMm"]}
                )
                _rect_box(f"art-{f['id']}-{i}", coll, spec, fr, z0, z1, "trim")

        # ---- slat screens: balcony privacy, stair core ---------------------
        for sc in art.get("screens", []):
            z0, z1 = base + mm(sc["fromMm"]), base + mm(sc["toMm"])
            if z1 - z0 < 0.2:
                continue
            r = sc["rect"]
            horiz = sc["side"] in ("N", "S")
            along = r["w"] if horiz else r["h"]
            face, depth = sc["slatMm"]
            if horiz:
                py = r["y"] + r["h"] - depth if sc["side"] == "S" else r["y"]
                plane = {"x": r["x"], "y": py, "w": r["w"], "h": depth}
            else:
                px = r["x"] + r["w"] - depth if sc["side"] == "E" else r["x"]
                plane = {"x": px, "y": r["y"], "w": depth, "h": r["h"]}
            n = max(2, sc["count"])
            for i in range(n):
                c = (plane["x"] if horiz else plane["y"]) + ((i + 0.5) * along) / n
                sr = (
                    {"x": c - face / 2, "y": plane["y"], "w": face, "h": plane["h"]}
                    if horiz
                    else {"x": plane["x"], "y": c - face / 2, "w": plane["w"], "h": face}
                )
                _rect_box(f"art-{sc['id']}-{i}", coll, spec, sr, z0, z1, "accent")
            rail = mm(sc["railMm"])
            _rect_box(f"art-{sc['id']}-rb", coll, spec, plane, z0, z0 + rail, "accent")
            _rect_box(f"art-{sc['id']}-rt", coll, spec, plane, z1 - rail, z1, "accent")

        # ---- parapet upstand + coping cap ----------------------------------
        # Four runs, not one box, so the roof deck stays open.
        for pa in art.get("parapets", []):
            t = pa["thickMm"]
            solid_top = wall_top + mm(pa["heightMm"] - pa["screenAboveMm"])
            cap_bot = wall_top + mm(pa["heightMm"])
            r = pa["rect"]
            runs = [
                ("n", {"x": r["x"], "y": r["y"], "w": r["w"], "h": t}),
                ("s", {"x": r["x"], "y": r["y"] + r["h"] - t, "w": r["w"], "h": t}),
                ("w", {"x": r["x"], "y": r["y"] + t, "w": t, "h": r["h"] - 2 * t}),
                ("e", {"x": r["x"] + r["w"] - t, "y": r["y"] + t, "w": t, "h": r["h"] - 2 * t}),
            ]
            for k, run in runs:
                _rect_box(f"art-{pa['id']}-{k}", coll, spec, run, wall_top, solid_top, "wall")
                if pa["screenAboveMm"] > 0:
                    horiz = k in ("n", "s")
                    along = run["w"] if horiz else run["h"]
                    n = max(2, int(along // 220))
                    for i in range(n):
                        c = (run["x"] if horiz else run["y"]) + ((i + 0.5) * along) / n
                        slat = (
                            {"x": c - 40, "y": run["y"], "w": 80, "h": run["h"]}
                            if horiz
                            else {"x": run["x"], "y": c - 40, "w": run["w"], "h": 80}
                        )
                        _rect_box(
                            f"art-{pa['id']}-{k}s{i}", coll, spec, slat, solid_top, cap_bot, "accent"
                        )
                # the coping cap — what stops a parapet reading as a sawn-off wall
                _rect_box(
                    f"art-{pa['id']}-{k}cap", coll, spec,
                    _grow(run, pa["copingProjMm"]), cap_bot, cap_bot + mm(pa["copingThickMm"]), "trim",
                )


def summary(spec: Spec) -> str:
    """counts for the CLI banner"""
    n = {"slabEdges": 0, "chajjas": 0, "fins": 0, "screens": 0, "parapets": 0}
    for fl in spec.floors:
        art = fl.get("articulation") or {}
        for k in n:
            n[k] += len(art.get(k, []))
    return "  ".join(f"{k}={v}" for k, v in n.items())
