"""Shared concept sizing from the self-contained BuildingModel, in millimetres."""
import math


def slab_thickness(floor, legacy=180):
    return floor.get("slabThicknessMm", legacy)


def clear_beam(beam, columns):
    a, b = beam["a"], beam["b"]
    length = math.hypot(b["x"]-a["x"], b["y"]-a["y"])
    if length <= 0:
        raise ValueError("Beam has no span")
    def end(point):
        return next((c["size"]/2 for c in columns
                     if math.hypot(c["at"]["x"]-point["x"], c["at"]["y"]-point["y"]) <= 2), 0)
    start, finish = end(a), end(b)
    if start+finish >= length:
        raise ValueError("Beam cannot fit between column faces")
    return {"x": a["x"]+(b["x"]-a["x"])*start/length,
            "y": a["y"]+(b["y"]-a["y"])*start/length}, \
           {"x": b["x"]-(b["x"]-a["x"])*finish/length,
            "y": b["y"]-(b["y"]-a["y"])*finish/length}, length-start-finish


def create_sized_foundation(scene, building, floor):
    sizing = building["structuralSizing"]
    rules = building["quantityRules"]
    qualification = sizing["qualification"]
    columns = [c for c in building["columns"] if c["floorId"] == floor["id"]]
    for footing in sizing["footings"]:
        r, bottom, thickness = footing["rect"], footing["bottomMm"], footing["thicknessMm"]
        obj = scene.rect(footing["id"], "STRUCTURE", r, bottom, thickness,
                         "concrete", footing["columnId"], bevel=3)
        obj["qualification"] = qualification
        obj["below_grade"] = True
        p, t = rules["earthwork"]["pccProjectionMm"], rules["earthwork"]["pccThicknessMm"]
        pcc = {"x":r["x"]-p, "y":r["y"]-p, "w":r["w"]+2*p, "h":r["h"]+2*p}
        scene.rect(f"PCC_{footing['columnId']}", "STRUCTURE", pcc, bottom-t, t,
                   "concrete", footing["columnId"], bevel=0)
        column = next(c for c in columns if c["id"] == footing["columnId"])
        top = floor["elevationMm"] - slab_thickness(floor)
        scene.box(f"Pedestal_{column['id']}", "STRUCTURE", column["at"]["x"],
                  column["at"]["y"], bottom+thickness, column["size"], column["size"],
                  top-bottom-thickness, "concrete", column["id"], bevel=3)
    for beam in sizing["plinthBeams"]:
        a, b, length = clear_beam(beam, columns)
        obj = scene.box(beam["id"], "STRUCTURE", (a["x"]+b["x"])/2, (a["y"]+b["y"])/2,
                        floor["elevationMm"]-slab_thickness(floor)-beam["depthMm"],
                        length, beam["widthMm"], beam["depthMm"], "concrete", beam["id"], bevel=3)
        obj.rotation_euler.z = math.atan2(b["y"]-a["y"], b["x"]-a["x"])
        obj["qualification"] = qualification
    bpy_scene = __import__('bpy').context.scene
    bpy_scene["plinth_height_mm"] = sizing["plinthHeightMm"]
    bpy_scene["structural_qualification"] = qualification
