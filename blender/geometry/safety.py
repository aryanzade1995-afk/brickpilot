"""Semantic concept safety hardware, anchored to the verified 2D plan.

No claim of fire-code compliance; upper floors retain their real stair core.
"""
import bpy


def create_emergency_system(scene, building):
    safety = building.get("emergency", {})
    # The shared source already selects/validates the landing and treads. Never
    # independently size or relocate them in Python.
    for piece in [*safety.get("exitAccess", {}).get("pieces", []), *safety.get("entryAccess", {}).get("pieces", [])]:
        scene.rect(f"ExitAccess_{piece['id']}", "STRUCTURE", piece["rect"],
                   piece["bottomMm"], piece["topMm"]-piece["bottomMm"],
                   "concrete", piece["id"], bevel=0)
    for role, colour in (("safety_alarm", (0.9, 0.9, 0.85, 1)),
                         ("safety_extinguisher", (0.55, 0.035, 0.02, 1))):
        material = bpy.data.materials.new(role)
        material.use_nodes = True
        shader = material.node_tree.nodes.get("Principled BSDF")
        shader.inputs["Base Color"].default_value = colour
        shader.inputs["Roughness"].default_value = 0.45
        scene.materials[role] = material
    floors = {f["level"]: f for f in building["floors"]}
    for marker in safety.get("markers", []):
        floor = floors[marker["level"]]
        kind = marker["kind"]
        # Exit routes stay in the plan, but signs and lettering are omitted
        # from the villa geometry, renders and exported Blender/GLB files.
        if kind == "exit":
            continue
        dims = (140, 140, 50) if kind == "alarm" else (150, 150, 420)
        elevation = 2600 if kind == "alarm" else 1100
        obj = scene.box(marker["id"], "SAFETY", marker["at"]["x"], marker["at"]["y"],
                        floor["elevationMm"] + elevation - dims[2]/2,
                        *dims, "safety_"+kind, marker["sourceId"], bevel=5)
        obj["concept_safety_only"] = True
    for door in building["doors"]:
        if not door.get("emergencyExit"):
            continue
        floor = next(f for f in building["floors"] if f["id"] == door["floorId"])
        horizontal = door["orient"] == "h"
        width = door["width"] * 0.7
        scene.box("EmergencyDoor_ReleaseBar", "DOORS", door["at"]["x"], door["at"]["y"]-45,
                  floor["elevationMm"]+1030, width if horizontal else 45,
                  45 if horizontal else width, 40, "metal", door["id"], bevel=3)
