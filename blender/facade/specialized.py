"""Editable solids and real wall cuts from the validated specialized grammars."""

import json
import bpy
from .features import _bounds_intersect


def _recess(scene, part, name):
    r, anchor = part["world"], part["anchor"]
    wall = next(w for w in scene.building["walls"] if w["id"] == anchor["sourceId"])
    horizontal = abs(wall["a"]["y"] - wall["b"]["y"]) <= 2
    cutter = scene.box(f"{name}_CuttingTool", "FACADE", r["x"] + r["w"] / 2, r["y"] + r["h"] / 2,
                       r["z"], r["w"] + (0 if horizontal else 4), r["h"] + (4 if horizontal else 0), r["height"], bevel=0)
    bpy.context.view_layer.update()
    count = 0
    for obj in list(scene.collections["WALLS"].objects):
        if obj.get("source_id") != anchor["sourceId"] or not _bounds_intersect(obj, cutter):
            continue
        obj.data = obj.data.copy()
        boolean = obj.modifiers.new(f"{name}_WallRecess", "BOOLEAN")
        boolean.operation, boolean.solver, boolean.object = "DIFFERENCE", "EXACT", cutter
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=boolean.name)
        obj.select_set(False)
        count += 1
    bpy.data.objects.remove(cutter, do_unlink=True)
    if not count:
        raise ValueError(f"{name} has no real wall mesh to recess")
    # Keep a backing skin against the retained wall, leaving real niche depth.
    from specialized_validation import resolve_anchor, derive_world
    a = resolve_anchor(scene.building, scene.massing, anchor)
    b = {**part["local"], "d": 12}
    back = derive_world(a, b)
    return scene.box(f"{name}_Back", "FACADE", back["x"] + back["w"] / 2, back["y"] + back["h"] / 2,
                     back["z"], back["w"], back["h"], back["height"], part["material"], part["anchor"]["sourceId"], bevel=2)


def create_specialized_grammars(scene, model, building, massing):
    if model is None:
        return
    scene.building, scene.massing = building, massing
    for index, unit in enumerate(model["assemblies"], 1):
        readable = "".join(word.title() for word in unit["type"].split("_"))
        for serial, part in enumerate(unit["parts"], 1):
            name = f"Grammar_{unit['category'].title()}_{readable}_{index:02d}_{part['role'].title()}_{serial:03d}"
            if part["operation"] == "RECESS":
                obj = _recess(scene, part, name)
            else:
                r = part["world"]
                material = "railing" if unit["category"] == "BALCONY" and part["role"] == "rail" and part["material"] == "metal" else part["material"]
                obj = scene.box(name, part["collection"], r["x"] + r["w"] / 2, r["y"] + r["h"] / 2,
                                r["z"], r["w"], r["h"], r["height"], material, unit["id"], bevel=4 if part["role"] in ("glass", "screen") else 8)
            obj["grammar_category"], obj["grammar_type"] = unit["category"], unit["type"]
            obj["grammar_part_id"], obj["grammar_operation"] = part["id"], part["operation"]
            obj["source_anchor_id"] = part["anchor"]["sourceId"]
            obj["source_opening_ids"] = json.dumps(unit["openingIds"])
            obj["source_room_ids"] = json.dumps(unit["sourceRoomIds"])
            if part["anchor"]["kind"] in ("WALL", "BALCONY"):
                from specialized_validation import resolve_anchor
                obj["facade_side"] = resolve_anchor(building, massing, part["anchor"])["side"]
