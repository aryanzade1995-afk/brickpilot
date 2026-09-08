"""
Facade vocabulary from the spec's FacadeElement list — the things that make a
style read on the elevation: plinth, base cladding, string courses, chajja
hoods, brise-soleil fins, jaali screens, cladding panels, a feature pier, a
feature tower, a columned verandah and pergolas.
"""

from __future__ import annotations

from .context import Spec, add_box, assign, collection, linked_box, material, mm

FIN_T = 0.05


def build(spec: Spec):
    coll = collection("Facade")
    foot = spec.massing["footprintMm"]
    fx0, fx1 = spec.wx(foot["x"]), spec.wx(foot["x"] + foot["w"])
    fy0, fy1 = spec.wy(foot["y"]), spec.wy(foot["y"] + foot["h"])
    fcx, fcy = (fx0 + fx1) / 2, (fy0 + fy1) / 2
    fsx, fsy = abs(fx1 - fx0), abs(fy1 - fy0)
    fh = mm(spec.requirements["floorHeightMm"])
    n_floors = spec.requirements["floors"]

    def rect_world(r):
        x0, x1 = spec.wx(r["x"]), spec.wx(r["x"] + r["w"])
        y0, y1 = spec.wy(r["y"]), spec.wy(r["y"] + r["h"])
        return (x0 + x1) / 2, (y0 + y1) / 2, abs(x1 - x0), abs(y1 - y0)

    for el in spec.facade:
        k = el["kind"]

        if k == "plinth":
            hh = mm(el["heightMm"])
            proj = mm(el["projMm"])
            obj = add_box("plinth", coll, (fcx, fcy, hh / 2), (fsx + 2 * proj, fsy + 2 * proj, hh))
            assign(obj, material("base", spec))

        elif k == "base_cladding":
            to_l = el["toLevel"]
            hh = fh * (to_l + 1)
            skin = add_box("base-clad", coll, (fcx, fy0 - 0.02, hh / 2), (fsx, 0.05, hh))
            assign(skin, material("base", spec))

        elif k == "string_course":
            z = mm(el["level"]) * 0 + el["level"] * fh
            proj = mm(el["projMm"])
            _band(coll, spec, fcx, fcy, fsx + 2 * proj, fsy + 2 * proj, z, 0.12, "trim")

        elif k == "chajja":
            z = el["level"] * fh
            proj = mm(el["projMm"])
            for w in [x for x in _all_windows(spec) if x["level"] == el["level"] and x["side"] == "S"]:
                a, b = w["wall"]["a"], w["wall"]["b"]
                cx = (spec.wx(a["x"]) + spec.wx(b["x"])) / 2
                add_hood(coll, spec, cx, fy0, z + mm(w["sillMm"] + w["heightMm"]) + 0.1, mm(w["widthMm"]) + 0.5, proj)

        elif k == "fins":
            cx, cy, sx, _sy = rect_world(el["rect"])
            depth = mm(el["depthMm"])
            cnt = el["count"]
            z0 = el["level"] * fh
            for i in range(cnt):
                fx = cx - sx / 2 + sx * (i / max(cnt - 1, 1))
                obj = linked_box(f"fin{i}", coll, (fx, cy - depth / 2, z0 + fh / 2), (FIN_T, depth, fh - 0.4))
                assign(obj, material("trim", spec))

        elif k == "jaali":
            cx, cy, sx, sy = rect_world(el["rect"])
            z0 = el["level"] * fh
            panel_h = fh - 0.5
            horiz = sx >= sy
            obj = add_box("jaali", coll, (cx, cy, z0 + panel_h / 2 + 0.3), (max(sx, 0.14) if horiz else 0.14, 0.14 if horiz else max(sy, 0.14), panel_h))
            assign(obj, material("accent", spec))

        elif k == "clad":
            cx, cy, sx, sy = rect_world(el["rect"])
            two = el.get("twoStorey") and n_floors > 1
            h = fh * (2 if two else 1) - 0.3
            horiz = sx >= sy
            obj = add_box("clad", coll, (cx, cy, h / 2 + 0.15), ((sx if horiz else 0.06), (0.06 if horiz else sy), h))
            assign(obj, material("accent", spec))

        elif k == "feature_pier":
            at = el["at"]
            px, py = spec.wx(at["x"]), spec.wy(at["y"])
            w = mm(el["widthMm"])
            d = mm(el["depthMm"])
            top = mm(el["topMm"])
            obj = add_box("feature-pier", coll, (px, py, top / 2), (w, d, top))
            assign(obj, material("accent", spec))

        elif k == "feature_tower":
            cx, cy, sx, sy = rect_world(el["footprint"])
            top = mm(el["topMm"])
            obj = add_box("feature-tower", coll, (cx, cy, top / 2), (sx, sy, top))
            assign(obj, material("trim" if el["cladding"] == "white_fins" else "accent", spec))

        elif k == "verandah":
            # only the roof slab here — the columns are real structural columns
            # (role="verandah") built by structure.py from the same anchor
            cx, cy, sx, sy = rect_world(el["rect"])
            roof = add_box("verandah-roof", coll, (cx, cy, fh - 0.15), (sx + 0.4, sy + 0.3, 0.22))
            assign(roof, material("roof", spec))

        elif k == "canopy":
            at = el["at"]
            px, py = spec.wx(at["x"]), spec.wy(at["y"])
            obj = add_box("entry-canopy", coll, (px, py, mm(el["heightMm"])), (mm(el["widthMm"]), mm(el["depthMm"]), 0.28))
            assign(obj, material("trim", spec))

        elif k == "pergola":
            cx, cy, sx, sy = rect_world(el["rect"])
            z = (n_floors * fh + 0.1) if el["where"] == "roof" else (fh - 0.2)
            frame = add_box("pergola-frame", coll, (cx, cy, z), (sx, sy, 0.12))
            assign(frame, material("accent", spec))
            for i in range(int(sx / 0.35) + 1):
                sx0 = cx - sx / 2 + i * 0.35
                obj = linked_box(f"pergola-slat{i}", coll, (sx0, cy, z + 0.1), (0.05, sy, 0.14))
                assign(obj, material("accent", spec))

    return coll


def _all_windows(spec: Spec):
    return [w for fl in spec.floors for w in fl["windows"]]


def _band(coll, spec, cx, cy, sx, sy, z, h, mat):
    for dx, dy, w, d in ((0, sy / 2, sx, 0.1), (0, -sy / 2, sx, 0.1), (sx / 2, 0, 0.1, sy), (-sx / 2, 0, 0.1, sy)):
        obj = add_box("string", coll, (cx + dx, cy + dy, z), (w, d, h))
        assign(obj, material(mat, spec))


def add_hood(coll, spec, cx, wall_y, z, w, proj):
    obj = add_box("chajja", coll, (cx, wall_y - proj / 2, z), (w, proj, 0.14))
    assign(obj, material("trim", spec))
