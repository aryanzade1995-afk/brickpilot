"""Check an actual saved Blender scene, including evaluated openings and slab voids.

blender -b --python-exit-code 1 --python blender/test_runtime.py --
    --input output/blender-input.json --blend output/villa/villa.blend --glb output/villa/villa.glb
"""

import argparse
import json
from pathlib import Path
import struct
import sys

import bpy
import bmesh
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from geometry.common import COLLECTION_NAMES  # noqa: E402
from geometry.stairs import stair_opening  # noqa: E402
from validation import validate_payload, opening_vertical_span  # noqa: E402
from specialized_validation import resolve_anchor  # noqa: E402


def hit(obj, origin, direction, distance=4):
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    inverse = evaluated.matrix_world.inverted()
    return evaluated.ray_cast(inverse @ Vector(origin), inverse.to_3x3() @ Vector(direction),
                              distance=distance)[0]


def main(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--blend", required=True)
    parser.add_argument("--glb", required=True)
    args = parser.parse_args(argv)
    payload = json.loads(Path(args.input).read_text(encoding="utf-8"))
    hosts = validate_payload(payload)
    building = payload["buildingModel"]
    bpy.ops.wm.open_mainfile(filepath=str(Path(args.blend).resolve()))
    assert bpy.context.scene.get("source_plan_id") == building["planId"]
    assert all(name in bpy.data.collections for name in COLLECTION_NAMES)
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    assert len(meshes) > 20
    assert len({obj.data.name for obj in meshes}) < len(meshes), "Repeated solids should share mesh data"
    assert all(obj.get("source_plan_id") == building["planId"] for obj in meshes)
    assert any(mod.type == "BEVEL" for obj in meshes for mod in obj.modifiers)
    floors = {floor["id"]: floor for floor in building["floors"]}
    for opening in [*building["doors"], *building["windows"]]:
        floor = floors[opening["floorId"]]
        sill, head = opening_vertical_span(opening, floor)
        point = [opening["at"]["x"] / 1000, opening["at"]["y"] / 1000,
                 (floor["elevationMm"] + (sill + head) / 2) / 1000]
        across = 1 if opening["orient"] == "h" else 0
        point[across] -= 1
        direction = [0, 0, 0]
        direction[across] = 1
        walls = [obj for obj in bpy.data.collections["WALLS"].objects if obj.get("source_id") == hosts[opening["id"]]]
        assert walls and not any(hit(obj, point, direction, 2) for obj in walls), f"Solid wall covers {opening['id']}"
    for slab in building["slabs"]:
        floor = floors[slab["floorId"]]
        for stair in building["stairs"]:
            if floors[stair["floorId"]]["level"] != floor["level"] - 1:
                continue
            opening = stair_opening(stair)
            point = [(opening["x"] + opening["w"] / 2) / 1000,
                     (opening["y"] + opening["h"] / 2) / 1000, floor["elevationMm"] / 1000 + 1]
            slabs = [obj for obj in bpy.data.collections["STRUCTURE"].objects if obj.get("source_id") == slab["id"]]
            assert not any(hit(obj, point, (0, 0, -1), 2) for obj in slabs), "Slab seals the stair core"
    for floor in building["floors"]:
        court = floor.get("courtyard")
        if court:
            point = [(court["x"] + court["w"] / 2) / 1000,
                     (court["y"] + court["h"] / 2) / 1000, floor["elevationMm"] / 1000 + 1]
            slabs = [obj for obj in bpy.data.collections["STRUCTURE"].objects if obj.name.startswith(f"{floor['id']}_Slab_")]
            assert not any(hit(obj, point, (0, 0, -1), 2) for obj in slabs), "Courtyard is filled by a slab"
    for obj in meshes:
        edit = bmesh.new()
        edit.from_mesh(obj.data)
        assert all(edge.is_manifold for edge in edit.edges), f"Non-manifold solid: {obj.name}"
        assert edit.calc_volume(signed=False) > 0, f"Empty solid: {obj.name}"
        edit.free()
    recessed = [feature for feature in payload["facadeGrammar"]["features"] if feature["type"] == "RECESSED_BOX"]
    for feature in recessed:
        zones = {zone["id"]: zone for zone in payload["facadeGrammar"]["zones"]}
        wall_ids = {zones[part["zoneId"]]["wallId"] for part in feature["parts"]}
        assert any(len(obj.data.vertices) > 8 for obj in bpy.data.collections["WALLS"].objects if obj.get("source_id") in wall_ids), "Recess did not carve its wall"
    specialized = payload["facadeGrammar"].get("specialized") or {"assemblies": []}
    parts_checked, niches_checked = 0, 0
    for unit in specialized["assemblies"]:
        for part in unit["parts"]:
            objects = [obj for obj in meshes if obj.get("grammar_part_id") == part["id"]]
            assert len(objects) == 1, f"Specialized part not exported as an editable object: {part['id']}"
            obj, r = objects[0], part["world"]
            assert obj["grammar_category"] == unit["category"] and obj["grammar_type"] == unit["type"]
            assert json.loads(obj["source_opening_ids"]) == unit["openingIds"]
            assert obj["source_anchor_id"] == part["anchor"]["sourceId"]
            if part["operation"] == "ADD":
                for actual, expected in zip(obj.dimensions, (r["w"], r["h"], r["height"])):
                    assert abs(actual - expected / 1000) < 0.002, f"Incorrect physical dimensions: {obj.name}"
            else:
                a = resolve_anchor(building, payload["massingModel"], part["anchor"])
                normal = Vector({"S": (0, 1, 0), "N": (0, -1, 0), "E": (1, 0, 0), "W": (-1, 0, 0)}[a["side"]])
                face = Vector(((r["x"] + r["w"] / 2) / 1000, (r["y"] + r["h"] / 2) / 1000, (r["z"] + r["height"] / 2) / 1000)) + normal * part["local"]["d"] / 2000
                origin, direction = face + normal, -normal
                distances = []
                for wall in bpy.data.collections["WALLS"].objects:
                    if wall.get("source_id") != part["anchor"]["sourceId"]:
                        continue
                    evaluated = wall.evaluated_get(bpy.context.evaluated_depsgraph_get())
                    inverse = evaluated.matrix_world.inverted()
                    result, location, _, _ = evaluated.ray_cast(inverse @ origin, inverse.to_3x3() @ direction, distance=2)
                    if result:
                        distances.append((evaluated.matrix_world @ location - origin).length)
                assert distances and min(distances) >= 1 + part["local"]["d"] / 1000 - 0.004, f"Source wall was not recessed: {obj.name}"
                niches_checked += 1
            parts_checked += 1
    data = Path(args.glb).read_bytes()
    magic, version, length = struct.unpack_from("<III", data)
    assert magic == 0x46546C67 and version == 2 and length == len(data)
    chunk_length, chunk_type = struct.unpack_from("<II", data, 12)
    assert chunk_type == 0x4E4F534A
    gltf = json.loads(data[20:20 + chunk_length])
    assert gltf.get("meshes") and len(gltf.get("nodes", [])) > 20
    print(json.dumps({"result": "passed", "meshObjects": len(meshes), "openings": len(hosts),
                      "recessedFeatures": len(recessed), "specializedParts": parts_checked,
                      "specializedNiches": niches_checked, "glbBytes": len(data)}, indent=2))


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:])
