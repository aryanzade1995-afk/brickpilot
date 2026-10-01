"""Planters with shared botanical meshes, source entry paving and site context."""

import math
import hashlib
from .placement import planting_layout, overlaps, within


class SeedStream:
    """One stable numeric-seed stream per anchored plant; no global random state."""
    def __init__(self, seed, key):
        self.state = int.from_bytes(hashlib.sha256(f"{seed}|{key}".encode()).digest()[:4], "little")

    def next(self):
        self.state = (1664525 * self.state + 1013904223) & 0xffffffff
        return self.state / 4294967296


def _leaf_mesh(scene):
    import bpy
    if hasattr(scene, "leaf_mesh"):
        return scene.leaf_mesh
    # A closed, curved lanceolate leaf, not a flat alpha card or sphere.
    mesh = bpy.data.meshes.new("Botanical_Lanceolate_Leaf")
    vertices = [(0, 0, 0), (-.032, 0, .09), (0, .012, .11), (.032, 0, .09), (0, -.018, .21),
                (0, -.002, 0), (-.032, -.002, .09), (0, .010, .11), (.032, -.002, .09), (0, -.020, .21)]
    faces = [(0, 1, 2), (0, 2, 3), (1, 4, 2), (2, 4, 3), (5, 7, 6), (5, 8, 7), (6, 7, 9), (7, 8, 9),
             (0, 5, 6, 1), (1, 6, 9, 4), (4, 9, 8, 3), (3, 8, 5, 0)]
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    mesh.materials.append(scene.materials["leaf"])
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    scene.leaf_mesh = mesh
    return mesh


def foliage(scene, name, rect, z, seed, leaves):
    import bpy
    stream = SeedStream(seed, name)
    mesh = _leaf_mesh(scene)
    centers = max(2, round(rect["w"] / 280))
    for cluster in range(centers):
        x = rect["x"] + rect["w"] * (cluster + .5) / centers
        y = rect["y"] + rect["h"] / 2
        height = 380 + stream.next() * 180
        scene.box(f"{name}_Stem_{cluster:02d}", "LANDSCAPE", x, y, z,
                  9, 9, height, "wood", name, bevel=2)
        for index in range(leaves):
            t = index / max(1, leaves - 1)
            azimuth = index * 2.399963 + stream.next() * .2
            obj = bpy.data.objects.new(f"{name}_Leaf_{cluster:02d}_{index:03d}", mesh)
            scene.collections["LANDSCAPE"].objects.link(obj)
            obj.location = (x / 1000, y / 1000, (z + 70 + height * t * .85) / 1000)
            obj.rotation_euler = (.15 + stream.next() * .55, .10 + stream.next() * .24, azimuth)
            scale = .6 + stream.next() * .25
            obj.scale = (scale, scale, scale)
            obj["source_plan_id"], obj["source_id"] = scene.plan_id, name
            obj["material_role"], obj["botanical_instance"] = "leaf", True


def planter(scene, name, plan, seed, leaves):
    r, z = plan["rect"], plan["z"]
    rim, height = 30, 360
    scene.rect(f"{name}_Base", "LANDSCAPE", r, z, 35, "secondary_wall", plan["sourceId"], bevel=4)
    for index, wall in enumerate([
        {"x": r["x"], "y": r["y"], "w": r["w"], "h": rim},
        {"x": r["x"], "y": r["y"] + r["h"] - rim, "w": r["w"], "h": rim},
        {"x": r["x"], "y": r["y"] + rim, "w": rim, "h": r["h"] - rim * 2},
        {"x": r["x"] + r["w"] - rim, "y": r["y"] + rim, "w": rim, "h": r["h"] - rim * 2},
    ]):
        obj = scene.rect(f"{name}_Rim_{index:02d}", "LANDSCAPE", wall, z, height, "secondary_wall", plan["sourceId"], bevel=4)
        obj["landscape_category"] = plan["category"]
    inner = {"x": r["x"] + rim, "y": r["y"] + rim, "w": r["w"] - rim * 2, "h": r["h"] - rim * 2}
    scene.rect(f"{name}_Soil", "LANDSCAPE", inner, z + height - 60, 30, "soil", plan["sourceId"], bevel=0)
    foliage(scene, name, inner, z + height - 25, seed, leaves)


def _entry_paving(scene, building):
    from specialized_validation import wall_side
    floor = min(building["floors"], key=lambda f: f["level"])
    boundary = {"x": 0, "y": 0, "w": building["plot"]["widthMm"], "h": building["plot"]["depthMm"]}
    for door in (d for d in building["doors"] if d["kind"] == "entry" and d["floorId"] == floor["id"]):
        wall = next((w for w in building["walls"] if w["kind"] == "exterior" and w["floorId"] == door["floorId"] and
                     abs((w["a"]["y"] if door["orient"] == "h" else w["a"]["x"]) - (door["at"]["y"] if door["orient"] == "h" else door["at"]["x"])) <= 2), None)
        if wall is None:
            continue
        side = wall_side(building, wall)
        horizontal, positive = side in ("N", "S"), side in ("S", "E")
        width, length = door["width"] + 300, 840
        fixed = (door["at"]["y"] if horizontal else door["at"]["x"]) + (1 if positive else -1) * wall["thickness"] / 2
        along = door["at"]["x"] if horizontal else door["at"]["y"]
        outside = fixed if positive else fixed - length
        rect = {"x": along - width / 2 if horizontal else outside,
                "y": outside if horizontal else along - width / 2,
                "w": width if horizontal else length, "h": length if horizontal else width}
        if not within(rect, boundary) or any(overlaps(rect, r["rect"]) for r in building["rooms"] if r["floorId"] == floor["id"] and r["outdoor"] and r["id"].startswith("parking")):
            scene.warnings.append("Entry steps omitted: reserved parking/site geometry protected.")
            continue
        for index in range(3):
            near = index * 280
            normal = fixed + near if positive else fixed - near - 280
            step = {"x": along - width / 2 if horizontal else normal, "y": normal if horizontal else along - width / 2,
                    "w": width if horizontal else 280, "h": 280 if horizontal else width}
            scene.rect(f"Entry_{door['id']}_ApproachStep_{index + 1}", "LANDSCAPE", step,
                       floor["elevationMm"] - 400, 400 * (3 - index) / 3, "paving", door["id"], bevel=4)


def create_landscape(scene, payload, options):
    import bpy
    from .surfaces import bounds_mm
    layout = planting_layout(payload, options)
    if not options["landscape"]["enabled"]:
        return layout
    seed = payload["villaDesignDNA"]["seed"]
    for index, plan in enumerate(layout["planters"]):
        planter(scene, f"Planting_{plan['category'].title()}_{index + 1:02d}", plan, seed, options["landscape"]["leavesPerPlant"])
    # Populate source grammar planters without adding another pot or changing
    # their footprint. The original green placeholder becomes actual soil.
    bpy.context.view_layer.update()
    for obj in list(scene.collections["BALCONIES"].objects):
        if obj.get("material_role") == "landscape":
            r = bounds_mm(obj)
            scene.assign_material(obj, "soil")
            inset = {"x": r["x"] + 50, "y": r["y"] + 30, "w": r["w"] - 100, "h": r["h"] - 60}
            if min(inset["w"], inset["h"]) > 80:
                foliage(scene, f"{obj.name}_Foliage", inset, r["z"] + r["height"], seed, options["landscape"]["leavesPerPlant"])
    _entry_paving(scene, payload["buildingModel"])
    scene.warnings.extend(layout["omissions"])
    return layout
