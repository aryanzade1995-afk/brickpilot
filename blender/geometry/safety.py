"""Semantic concept safety hardware, anchored to the verified 2D plan.

No claim of fire-code compliance; upper floors retain their real stair core.
"""
import bpy
import math


def create_emergency_system(scene, building):
    safety = building.get("emergency", {})
    for role, colour in (("safety_exit", (0.025, 0.3, 0.12, 1)),
                         ("safety_alarm", (0.9, 0.9, 0.85, 1)),
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
        dims = (600, 80, 240) if kind == "exit" else (140, 140, 50) if kind == "alarm" else (150, 150, 420)
        elevation = 2350 if kind == "exit" else 2600 if kind == "alarm" else 1100
        if marker["orient"] == "v" and kind == "exit":
            dims = (dims[1], dims[0], dims[2])
        obj = scene.box(marker["id"], "SAFETY", marker["at"]["x"], marker["at"]["y"],
                        floor["elevationMm"] + elevation - dims[2]/2,
                        *dims, "safety_"+kind, marker["sourceId"], bevel=5)
        obj["concept_safety_only"] = True
        if kind == "exit":
            curve = bpy.data.curves.new(marker["id"]+"_Lettering", "FONT")
            curve.body = "EXIT"
            curve.align_x = "CENTER"
            curve.size = 0.11
            text = bpy.data.objects.new(marker["id"]+"_Lettering", curve)
            scene.collections["SAFETY"].objects.link(text)
            facing = marker.get("facing", 1)
            horizontal = marker["orient"] == "h"
            text.location = (obj.location.x+(0 if horizontal else facing*0.045),
                             obj.location.y+(facing*0.045 if horizontal else 0), obj.location.z-0.04)
            angle = math.pi if horizontal and facing == 1 else 0 if horizontal else math.pi/2 if facing == 1 else -math.pi/2
            text.rotation_euler = (math.pi/2, 0, angle)
            text["source_id"] = marker["sourceId"]
            text["source_plan_id"] = scene.plan_id
    for door in building["doors"]:
        if not door.get("emergencyExit"):
            continue
        floor = next(f for f in building["floors"] if f["id"] == door["floorId"])
        horizontal = door["orient"] == "h"
        width = door["width"] * 0.7
        scene.box("EmergencyDoor_ReleaseBar", "DOORS", door["at"]["x"], door["at"]["y"]-45,
                  floor["elevationMm"]+1030, width if horizontal else 45,
                  45 if horizontal else width, 40, "metal", door["id"], bevel=3)
