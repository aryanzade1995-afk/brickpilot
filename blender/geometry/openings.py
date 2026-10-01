"""Door/window assemblies placed only inside holes cut by segmented wall meshes."""

import bpy

from .common import MM
from validation import opening_vertical_span


def _axis(wall):
    return "h" if abs(wall["a"]["y"] - wall["b"]["y"]) <= 2 else "v"


def _bar(scene, name, collection, axis, along, fixed, bottom, along_size, height,
         thickness, material, source_id):
    x, y = (along, fixed) if axis == "h" else (fixed, along)
    w, d = (along_size, thickness) if axis == "h" else (thickness, along_size)
    return scene.box(name, collection, x, y, bottom, w, d, height, material, source_id, bevel=3)


def _opening_anchor(scene, opening, floor, axis, bottom, height):
    empty = bpy.data.objects.new(f"Opening_{opening['id']}", None)
    scene.collections["OPENINGS"].objects.link(empty)
    empty.location = (opening["at"]["x"] * MM, opening["at"]["y"] * MM,
                      (floor["elevationMm"] + bottom) * MM)
    empty.empty_display_type = "CUBE"
    empty.empty_display_size = opening["width"] * MM / 2
    empty["source_id"] = opening["id"]
    empty["width_mm"] = opening["width"]
    empty["height_mm"] = height
    empty["source_plan_id"] = scene.plan_id
    return empty


def create_window_opening(scene, opening, wall, floor):
    axis = _axis(wall)
    along = opening["at"]["x" if axis == "h" else "y"]
    fixed = opening["at"]["y" if axis == "h" else "x"]
    width = opening["width"]
    sill, head = opening_vertical_span(opening, floor)
    base = floor["elevationMm"] + sill
    height = head - sill
    _opening_anchor(scene, opening, floor, axis, sill, height)
    jamb = 55
    depth = min(90, wall["thickness"])
    for side, offset in (("L", -width / 2 + jamb / 2), ("R", width / 2 - jamb / 2)):
        _bar(scene, f"Window_{opening['id']}_{side}", "WINDOWS", axis,
             along + offset, fixed, base, jamb, height, depth, "metal", opening["id"])
    for label, z in (("Sill", base), ("Head", base + height - jamb)):
        _bar(scene, f"Window_{opening['id']}_{label}", "WINDOWS", axis,
             along, fixed, z, width, jamb, depth, "metal", opening["id"])
    _bar(scene, f"Window_{opening['id']}_Glass", "WINDOWS", axis,
         along, fixed, base + jamb, width - 2 * jamb, height - 2 * jamb,
         26, "glass", opening["id"])


def create_door_opening(scene, opening, wall, floor):
    axis = _axis(wall)
    along = opening["at"]["x" if axis == "h" else "y"]
    fixed = opening["at"]["y" if axis == "h" else "x"]
    width = opening["width"]
    _sill, height = opening_vertical_span(opening, floor)
    base = floor["elevationMm"]
    _opening_anchor(scene, opening, floor, axis, 0, height)
    jamb = 55
    depth = min(90, wall["thickness"])
    for side, offset in (("L", -width / 2 + jamb / 2), ("R", width / 2 - jamb / 2)):
        _bar(scene, f"Door_{opening['id']}_{side}", "DOORS", axis,
             along + offset, fixed, base, jamb, height, depth, "metal", opening["id"])
    _bar(scene, f"Door_{opening['id']}_Head", "DOORS", axis,
         along, fixed, base + height - jamb, width, jamb, depth, "metal", opening["id"])
    if opening.get("leaf", True) or opening.get("treatment") == "glazed-slide":
        material = "glass" if opening.get("treatment") == "glazed-slide" else "door"
        _bar(scene, f"Door_{opening['id']}_Leaf", "DOORS", axis,
             along, fixed, base + 35, width - 2 * jamb - 15, height - jamb - 55,
             40, material, opening["id"])
