"""Plan-faithful foundation, slabs, segmented walls, columns, beams and stairs."""

from __future__ import annotations

import math
import bpy
import bmesh

from .common import floor_prefix
from .plates import create_plate, subtract_rectangles
from .stairs import stair_layout
from .massing import mass_rect
from validation import opening_vertical_span


def create_foundation(scene, floor, thickness_mm=400, exterior_walls=()):
    for index, rect in enumerate(floor["footprint"], 1):
        scene.rect(f"{floor_prefix(floor)}_Foundation_{index:03d}", "STRUCTURE", rect,
                   floor["elevationMm"] - thickness_mm, thickness_mm,
                   source_id=floor["id"])
    # Plan plates end at wall centre lines. Extend the plinth beneath the
    # actual exterior wall thickness so its outer half is not left floating.
    for index, wall in enumerate(exterior_walls, 1):
        a, b = wall["a"], wall["b"]
        horizontal = abs(a["y"] - b["y"]) <= 2
        width = abs(b["x"] - a["x"]) if horizontal else wall["thickness"]
        depth = wall["thickness"] if horizontal else abs(b["y"] - a["y"])
        scene.box(f"{floor_prefix(floor)}_Foundation_Wall_{index:03d}", "STRUCTURE",
                  (a["x"] + b["x"]) / 2, (a["y"] + b["y"]) / 2,
                  floor["elevationMm"] - thickness_mm, width, depth, thickness_mm,
                  "concrete", wall["id"])


def create_slab(scene, slab, floor, voids=()):
    return create_plate(scene, f"{floor_prefix(floor)}_Slab_{int(slab['id'].split('_')[-1]):03d}",
                        "STRUCTURE", slab["rect"], slab["topMm"] - slab["thicknessMm"],
                        slab["thicknessMm"], slab["id"], voids)


def create_roof_slab(scene, floor, voids=()):
    top = floor["elevationMm"] + floor["heightMm"]
    for index, rect in enumerate(floor["footprint"], 1):
        create_plate(scene, f"{floor_prefix(floor)}_Roof_Slab_{index:03d}", "ROOF",
                     rect, top - 180, 180, floor["id"], voids)


def _wall_piece(scene, wall, floor, axis, fixed, start, end, bottom, top, serial):
    if end - start < 20 or top - bottom < 20:
        return None
    thickness = wall["thickness"]
    x = (start + end) / 2 if axis == "h" else fixed
    y = fixed if axis == "h" else (start + end) / 2
    width, depth = ((end - start, thickness) if axis == "h" else (thickness, end - start))
    material = "wall" if wall["kind"] == "exterior" else "concrete"
    return scene.box(f"{floor_prefix(floor)}_Wall_{serial:03d}", "WALLS", x, y,
                     bottom, width, depth, top - bottom, material, wall["id"], bevel=0)


def create_wall(scene, wall, floor, hosted_openings, serial_start):
    """Emit piers, sills and headers around each void. No wall exists in the opening."""
    a, b = wall["a"], wall["b"]
    axis = "h" if abs(a["y"] - b["y"]) <= 2 else "v"
    fixed = a["y"] if axis == "h" else a["x"]
    lo, hi = sorted((a["x"], b["x"]) if axis == "h" else (a["y"], b["y"]))
    base, top = floor["elevationMm"], floor["elevationMm"] + wall.get("heightMm", floor["heightMm"])
    openings = sorted(hosted_openings, key=lambda item: item["at"]["x" if axis == "h" else "y"])
    serial = serial_start
    cursor = lo
    for opening in openings:
        at = opening["at"]["x" if axis == "h" else "y"]
        left, right = at - opening["width"] / 2, at + opening["width"] / 2
        if left < cursor - 2 or right > hi + 2:
            raise ValueError(f"{opening['id']} does not fit {wall['id']}")
        if left > cursor + 20:
            _wall_piece(scene, wall, floor, axis, fixed, cursor, left, base, top, serial)
            serial += 1
        sill, head = opening_vertical_span(opening, floor)
        if sill > 20:
            _wall_piece(scene, wall, floor, axis, fixed, left, right, base, base + sill, serial)
            serial += 1
        if top - (base + head) > 20:
            _wall_piece(scene, wall, floor, axis, fixed, left, right, base + head, top, serial)
            serial += 1
        cursor = right
    if hi > cursor + 20:
        _wall_piece(scene, wall, floor, axis, fixed, cursor, hi, base, top, serial)
        serial += 1
    return serial


def create_column(scene, column, floor):
    return scene.box(f"Column_{column['id']}", "STRUCTURE", column["at"]["x"],
                     column["at"]["y"], floor["elevationMm"], column["size"],
                     column["size"], floor["heightMm"], "concrete", column["id"])


def create_beam(scene, beam, floor, depth_mm=300, width_mm=230, exterior_walls=()):
    a, b = beam["a"], beam["b"]
    length = math.hypot(b["x"] - a["x"], b["y"] - a["y"])
    axis = "h" if abs(a["y"] - b["y"]) <= 2 else "v"
    fixed = a["y"] if axis == "h" else a["x"]
    lo, hi = sorted((a["x"], b["x"]) if axis == "h" else (a["y"], b["y"]))
    for wall in exterior_walls:
        wa, wb = wall["a"], wall["b"]
        wall_axis = "h" if abs(wa["y"] - wb["y"]) <= 2 else "v"
        wall_fixed = wa["y"] if axis == "h" else wa["x"]
        wall_lo, wall_hi = sorted((wa["x"], wb["x"]) if axis == "h" else (wa["y"], wb["y"]))
        if axis == wall_axis and abs(fixed - wall_fixed) <= 2 and min(hi, wall_hi) > max(lo, wall_lo):
            # Keep the structural face inside the exterior finish. Coincident
            # beam/wall surfaces create dark bands and z-fighting in exports.
            width_mm = min(width_mm, wall["thickness"] - 30)
    obj = scene.box(f"Beam_{beam['id']}", "STRUCTURE", (a["x"] + b["x"]) / 2,
                    (a["y"] + b["y"]) / 2, floor["elevationMm"] + floor["heightMm"] - depth_mm,
                    length, width_mm, depth_mm, "concrete", beam["id"])
    obj.rotation_euler.z = math.atan2(b["y"] - a["y"], b["x"] - a["x"])
    return obj


def create_staircase(scene, stair, floor):
    """Two source-aligned flights, solid risers and a real turning landing."""
    layout = stair_layout(stair)
    count, going = layout["steps_per_flight"], layout["going"]
    rise = floor["heightMm"] / (count * 2)
    base, serial = floor["elevationMm"], 1
    for flight_index, lines in enumerate(layout["flights"]):
        a0, a1 = lines[0][0], lines[0][1]
        # The final return-flight step is the retained destination slab landing.
        for step in range(count if flight_index == 0 else count - 1):
            b = step * going if flight_index == 0 else layout["travel"] - (step + 1) * going
            top = rise * (step + 1 + flight_index * count)
            scene.rect(f"{floor_prefix(floor)}_Stair_Tread_{serial:03d}", "STRUCTURE",
                       layout["world_rect"](a0, b, a1 - a0, going),
                       base, top, source_id=stair["id"])
            serial += 1
    scene.rect(f"{floor_prefix(floor)}_Stair_MidLanding_01", "STRUCTURE",
               layout["world_rect"](0, layout["travel"], layout["across"], layout["run"] - layout["travel"]),
               base + count * rise - 180, 180, source_id=stair["id"])


def _pitched_mesh(scene, mass, roof_type):
    x0, x1 = mass["x"], mass["x"] + mass["width"]
    y0, y1 = mass["y"], mass["y"] + mass["depth"]
    # The ridge follows the longer side of this validated roof volume.
    along_x = mass["width"] >= mass["depth"]
    u0, u1 = (x0, x1) if along_x else (y0, y1)
    v0, v1 = (y0, y1) if along_x else (x0, x1)
    base = mass["elevation"]
    eave = base + min(220, mass["height"] * 0.25)
    peak = base + mass["height"]
    xy = (lambda u, v: (u, v)) if along_x else (lambda u, v: (v, u))
    def vertex(u, v, z):
        x, y = xy(u, v)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        dx, dy = x - cx, y - cy
        dx, dy = {0: (dx, dy), 90: (-dy, dx), 180: (-dx, -dy), 270: (dy, -dx)}[mass["rotation"]]
        x, y = cx + dx, cy + dy
        return (x * 0.001, y * 0.001, z * 0.001)
    vertices = [vertex(u0, v0, base), vertex(u1, v0, base),
                vertex(u1, v1, base), vertex(u0, v1, base)]
    if roof_type == "mono-slope":
        vertices += [vertex(u0, v0, eave), vertex(u1, v0, eave),
                     vertex(u1, v1, peak), vertex(u0, v1, peak)]
        faces = [(0, 3, 2, 1), (0, 1, 5, 4), (1, 2, 6, 5),
                 (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7)]
    else:
        vertices += [vertex(u0, v0, eave), vertex(u1, v0, eave),
                     vertex(u1, v1, eave), vertex(u0, v1, eave)]
        inset = min((u1 - u0) * 0.25, (v1 - v0) * 0.5) if roof_type == "hip" else 0
        vertices += [vertex(u0 + inset, (v0 + v1) / 2, peak),
                     vertex(u1 - inset, (v0 + v1) / 2, peak)]
        faces = [(0, 3, 2, 1), (0, 1, 5, 4), (1, 2, 6, 5),
                 (2, 3, 7, 6), (3, 0, 4, 7),
                 (4, 5, 9, 8), (8, 9, 6, 7),
                 (7, 4, 8), (5, 6, 9)]
    mesh = bpy.data.meshes.new(f"RoofMesh_{mass['id']}")
    mesh.from_pydata(vertices, [], faces)
    edit = bmesh.new()
    edit.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(edit, faces=edit.faces)
    edit.to_mesh(mesh)
    edit.free()
    mesh.update()
    mesh.materials.append(scene.materials["stone"])
    obj = bpy.data.objects.new(f"RoofMass_{mass['id']}", mesh)
    scene.collections["MASSING"].objects.link(obj)
    obj["source_id"] = mass["id"]
    obj["source_plan_id"] = scene.plan_id
    bevel = obj.modifiers.new("Controlled roof bevel", "BEVEL")
    bevel.width = 12 * 0.001
    bevel.segments = 2
    obj.modifiers.new("Roof weighted normals", "WEIGHTED_NORMAL")
    return obj


def create_massing_volume(scene, mass, roof_type="flat-terrace", voids=()):
    if mass["usage"] == "support":
        r = mass_rect(mass)
        scene.rect(f"EnvelopeFoundation_{mass['id']}", "STRUCTURE", r, mass["elevation"] - 400, 400,
                   "concrete", mass["id"], bevel=8)
        return scene.rect(f"EnvelopePier_{mass['id']}", "STRUCTURE", r, mass["elevation"], mass["height"],
                          "concrete", mass["id"], bevel=12)
    if mass["usage"] == "canopy":
        return scene.rect(f"EnvelopeCanopy_{mass['id']}", "MASSING", mass_rect(mass), mass["elevation"], mass["height"],
                          "wall", mass["id"], bevel=12)
    if mass["usage"] != "roof":
        return None
    if roof_type in ("gable", "hip", "mono-slope"):
        return _pitched_mesh(scene, mass, roof_type)
    if mass.get("shell"):
        # Editable hollow envelope, never an independent occupied room. The
        # lower roof/slab and original openings remain the plan's geometry.
        result = []
        for index, r in enumerate(subtract_rectangles(mass_rect(mass), voids), 1):
            t = min(180, r["w"] / 4, r["h"] / 4)
            z, h = mass["elevation"], mass["height"]
            pieces = [(r["x"], r["y"], r["w"], t),
                      (r["x"], r["y"] + r["h"] - t, r["w"], t),
                      (r["x"], r["y"] + t, t, r["h"] - t * 2),
                      (r["x"] + r["w"] - t, r["y"] + t, t, r["h"] - t * 2)]
            for side, (x, y, w, d) in enumerate(pieces):
                obj = scene.rect(f"RoofEnvelope_{mass['id']}_{index}_Wall_{side}", "MASSING",
                                 {"x": x, "y": y, "w": w, "h": d}, z, h - t,
                                 "wall", mass["id"], bevel=12)
                obj["unoccupied_envelope"] = True
                result.append(obj)
            result.append(scene.rect(f"RoofEnvelope_{mass['id']}_{index}_Slab", "MASSING",
                                      r, z + h - t, t, "wall", mass["id"], bevel=12))
        return result
    return [scene.rect(f"RoofMass_{mass['id']}_{index:02d}", "MASSING", piece,
                       mass["elevation"], mass["height"], "stone", mass["id"], bevel=16)
            for index, piece in enumerate(subtract_rectangles(mass_rect(mass), voids), 1)]
