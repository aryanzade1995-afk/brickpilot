"""Specification material registry. Opt-in; existing villa palettes remain intact."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = ROOT / "blender/assets/spec-materials.json"


def material_spec(material_id):
    entries = json.loads(REGISTRY.read_text(encoding="utf-8"))["materials"]
    spec = next((m for m in entries if m["id"] == material_id), None)
    if spec is None:
        raise ValueError(f"Unknown specification material: {material_id}")
    path = (ROOT / spec["texture"]).resolve()
    if not path.is_relative_to(ROOT / "blender/assets/textures") or not path.is_file():
        raise ValueError(f"Missing or unsafe specification texture: {material_id}")
    return spec, path


def create_spec_material(material_id):
    """Editable image-based shader using the exact catalogue close-up file."""
    import bpy
    spec, path = material_spec(material_id)
    material = bpy.data.materials.get("Spec_" + material_id) or bpy.data.materials.new("Spec_" + material_id)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = bpy.data.images.load(str(path), check_existing=True)
    texture.image.colorspace_settings.name = "sRGB"
    texture.projection, texture.projection_blend = "BOX", .2
    geometry = nodes.new("ShaderNodeNewGeometry")
    scale = nodes.new("ShaderNodeVectorMath")
    scale.operation = "SCALE"
    scale.inputs[3].default_value = 1 / spec["tileSizeM"]
    links.new(geometry.outputs["Position"], scale.inputs[0])
    links.new(scale.outputs["Vector"], texture.inputs["Vector"])
    links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    shader.inputs["Roughness"].default_value = spec["roughness"]
    shader.inputs["Metallic"].default_value = spec["metallic"]
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    material["specification_id"] = material_id
    material["source_texture"] = spec["texture"]
    return material


def apply_specifications(scene, building, specifications):
    """Apply existing surface finishes; never alter walls, openings or source slabs.

    Room floor skins are a separate, non-structural FINISHES collection. Exact
    stair/shaft cuts remain open. Unmodelled products remain specification intent.
    Glass retains transmission rather than using a photograph of glass as paint.
    """
    if not specifications:
        return {"applied": [], "unmodelled": []}
    import bpy
    from geometry.plates import subtract_rectangles
    from geometry.stairs import stair_opening
    houses = {entry["item"]: entry for entry in specifications["houses"]}
    by_floor = {f["id"]: f for f in building["floors"]}
    walls = {w["id"]: w for w in building["walls"]}
    doors = {o["id"]: o for o in building["doors"]}
    room_specs = {(r["level"], r["sourceId"]): {s["item"]: s for s in r["finishes"]}
                  for r in specifications["rooms"]}
    applied = set()

    def assign(obj, entry):
        material = create_spec_material(entry["material"])
        obj.data = obj.data.copy()  # shared primitives must not change other rooms
        obj.data.materials.clear()
        obj.data.materials.append(material)
        for polygon in obj.data.polygons:
            polygon.material_index = 0
        obj["finish_item"], obj["finish_option"] = entry["item"], entry["option"]
        applied.add(entry["item"])

    roles = {"primary_wall": "exterior-paint", "secondary_wall": "external-plaster",
             "wall": "exterior-paint", "stone": "facade-cladding", "wood": "main-door",
             "accent": "facade-cladding", "paving": "paving", "landscape": "landscaping"}
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH":
            continue
        source = obj.get("source_id")
        wall = walls.get(source)
        door = doors.get(source)
        if wall:
            floor = by_floor[wall["floorId"]]
            exterior = houses.get("exterior-paint")
            # Assign each physical wall face from its adjacent real room.
            obj.data = obj.data.copy()
            for polygon in obj.data.polygons:
                center = obj.matrix_world @ polygon.center
                normal = (obj.matrix_world.to_3x3() @ polygon.normal).normalized()
                probe = center + normal * .02
                room = next((r for r in building["rooms"] if r["floorId"] == floor["id"] and
                    not r["outdoor"] and r["rect"]["x"] <= probe.x * 1000 <= r["rect"]["x"] + r["rect"]["w"] and
                    r["rect"]["y"] <= probe.y * 1000 <= r["rect"]["y"] + r["rect"]["h"]), None)
                entry = (room_specs.get((floor["level"], room["semanticId"]), {}).get("interior-paint") if room else
                         exterior if wall["kind"] == "exterior" else None)
                if entry:
                    material = create_spec_material(entry["material"])
                    if material.name not in obj.data.materials:
                        obj.data.materials.append(material)
                    polygon.material_index = obj.data.materials.find(material.name)
                    applied.add(entry["item"])
        elif door and obj.get("material_role") not in ("metal", "glass"):
            entry = houses.get("main-door" if door["kind"] == "entry" else "internal-door")
            if entry:
                assign(obj, entry)
        elif obj.get("material_role") not in ("glass", "metal", "railing", "light_emission"):
            item = roles.get(obj.get("material_role"))
            if any(c.name == "ROOF" for c in obj.users_collection):
                item = "roof-type" if "Slab" in obj.name or "Surface" in obj.name else "parapet-finish"
            if item and item in houses:
                assign(obj, houses[item])

    collection = bpy.data.collections.get("FINISHES") or bpy.data.collections.new("FINISHES")
    if collection.name not in scene.collections:
        bpy.context.scene.collection.children.link(collection)
        scene.collections["FINISHES"] = collection
    for room in building["rooms"]:
        floor = by_floor[room["floorId"]]
        finishes = room_specs.get((floor["level"], room["semanticId"]), {})
        entry = next((s for key, s in finishes.items() if key.startswith("floor-")), None)
        if not entry or room["outdoor"] or "stair" in room["semanticId"]:
            continue
        cuts = [shaft["rect"] for shaft in building["shafts"] if shaft["floorId"] == floor["id"]]
        cuts += [stair_opening(s) for s in building["stairs"] if by_floor[s["floorId"]]["level"] == floor["level"] - 1]
        cuts += [v["rect"] for v in floor.get("doubleHeightVoids", [])]
        if floor.get("courtyard"):
            cuts.append(floor["courtyard"])
        for index, rect in enumerate(subtract_rectangles(room["rect"], cuts), 1):
            obj = scene.rect(f"{floor['id']}_Finish_{room['semanticId']}_{index}", "FINISHES", rect,
                             floor["elevationMm"], 1, source_id=room["semanticId"], bevel=0)
            assign(obj, entry)
    all_items = set(houses) | {s["item"] for r in specifications["rooms"] for s in r["finishes"]}
    bpy.context.scene["finish_signature"] = specifications["signature"]
    return {"signature": specifications["signature"], "applied": sorted(applied),
            "unmodelled": sorted(all_items - applied),
            "note": "Unmodelled services/fittings remain BOQ specification intent; glazing retains a physical transmission shader."}
