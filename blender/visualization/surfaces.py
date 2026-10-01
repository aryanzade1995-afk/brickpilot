"""Physical finish details contained within their source solid's envelope."""

import math
from mathutils import Vector
from specialized_validation import wall_side


def bounds_mm(obj):
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    lo = [min(p[i] for p in points) * 1000 for i in range(3)]
    hi = [max(p[i] for p in points) * 1000 for i in range(3)]
    return {"x": lo[0], "y": lo[1], "z": lo[2], "w": hi[0] - lo[0], "h": hi[1] - lo[1], "height": hi[2] - lo[2]}


def create_surface_details(scene, building, options):
    import bpy
    bpy.context.view_layer.update()
    wall_map = {w["id"]: w for w in building["walls"] if w["kind"] == "exterior"}
    entries = {o["id"]: o for o in building["doors"] if o["kind"] == "entry"}
    result = {"stonePanels": 0, "slatPanels": 0, "flutedPanels": 0}
    originals = list(bpy.context.scene.objects)
    for obj in originals:
        if obj.type != "MESH" or len(obj.data.vertices) != 8:
            continue  # Preserve Boolean recesses: a bounding box is not their surface.
        role = obj.get("material_role")
        source = obj.get("source_id")
        side = obj.get("facade_side")
        if source in wall_map and obj in scene.collections["WALLS"].objects[:]:
            side = wall_side(building, wall_map[source])
        if source in entries and role == "door":
            opening = entries[source]
            wall = next((w for w in wall_map.values() if w["floorId"] == opening["floorId"] and
                         abs((w["a"]["y"] if opening["orient"] == "h" else w["a"]["x"]) -
                             (opening["at"]["y"] if opening["orient"] == "h" else opening["at"]["x"])) <= 2), None)
            side = wall_side(building, wall) if wall else None
        if side is None:
            continue
        if not (source in wall_map and obj.name in scene.collections["WALLS"].objects or source in entries and role == "door"):
            continue  # Keep validated facade-part meshes at their declared dimensions.
        stone = options["surfaces"]["stoneCladding"] and role in ("accent", "stone")
        fluted = options["surfaces"]["flutedPanels"] and options["palette"] == "WHITE_FLUTED_STONE" and role == "secondary_wall"
        wood = options["surfaces"]["woodSlats"] and role in ("wood", "timber", "door")
        if not (stone or fluted or wood):
            continue
        r, horizontal = bounds_mm(obj), side in ("N", "S")
        W, D, H = (r["w"], r["h"], r["height"]) if horizontal else (r["h"], r["w"], r["height"])
        if W < 350 or H < 500 or D < 20:
            continue
        along, fixed = (r["x"], r["y"]) if horizontal else (r["y"], r["x"])
        positive = side in ("S", "E")
        thickness = min(options["surfaces"]["fluteDepthMm"] if fluted else 14, D - 4)
        # Sink the substrate surface while keeping the composite finish inside
        # its original envelope. Without this, profiles inside a solid would
        # be invisible. Boolean walls are excluded above, so niches stay open.
        obj.data = obj.data.copy()
        inverse = obj.matrix_world.inverted()
        normal_axis = 1 if horizontal else 0
        front = fixed + D if positive else fixed
        for vertex in obj.data.vertices:
            world = obj.matrix_world @ vertex.co
            if abs(world[normal_axis] * 1000 - front) < 1:
                world[normal_axis] += (-1 if positive else 1) * (thickness + 2) / 1000
                vertex.co = inverse @ world
        obj.data.update()
        obj["finish_profile_depth_mm"] = thickness
        obj["composite_thickness_mm"] = D
        normal = fixed + D - thickness / 2 - 1 if positive else fixed + thickness / 2 + 1
        if fluted or wood:
            pitch = options["surfaces"]["slatPitchMm"]
            count = max(2, math.floor((W - 12) / pitch))
            width = pitch * (.78 if fluted else .60)
            offset = (W - (count - 1) * pitch - width) / 2
            u = along + offset + width / 2
            part = scene.box(f"Finish_{obj.name}_{'Flutes' if fluted else 'WoodSlats'}", "FACADE",
                             u if horizontal else normal, normal if horizontal else u, r["z"] + 8,
                             width if horizontal else thickness, thickness if horizontal else width, H - 16,
                             "stone" if fluted else "wood", source, bevel=3)
            array = part.modifiers.new("Repeated physical finish profile", "ARRAY")
            array.count, array.use_relative_offset, array.use_constant_offset = count, False, True
            array.constant_offset_displace = (pitch / 1000, 0, 0) if horizontal else (0, pitch / 1000, 0)
            part["finish_parent"] = obj.name
            result["flutedPanels" if fluted else "slatPanels"] += 1
        elif stone:
            cols = max(1, math.ceil(W / options["surfaces"]["stoneTileWidthMm"]))
            rows = max(1, math.ceil(H / options["surfaces"]["stoneTileHeightMm"]))
            joint = options["surfaces"]["jointMm"]
            for row in range(rows):
                u = along + W / cols / 2
                part = scene.box(f"Finish_{obj.name}_StoneCourse_{row + 1:02d}", "FACADE",
                                 u if horizontal else normal, normal if horizontal else u, r["z"] + H * row / rows + joint / 2,
                                 W / cols - joint if horizontal else thickness,
                                 thickness if horizontal else W / cols - joint, H / rows - joint, "stone", source, bevel=1)
                if cols > 1:
                    array = part.modifiers.new("Stone cladding modules", "ARRAY")
                    array.count, array.use_relative_offset, array.use_constant_offset = cols, False, True
                    array.constant_offset_displace = (W / cols / 1000, 0, 0) if horizontal else (0, W / cols / 1000, 0)
                part["finish_parent"] = obj.name
            result["stonePanels"] += 1
    return result
