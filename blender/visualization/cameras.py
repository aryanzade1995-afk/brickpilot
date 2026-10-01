"""Four named cameras framed against the actual architectural mesh bounds."""

import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
from .config import CAMERAS


def create_cameras(scene, building, options):
    bpy.context.view_layer.update()
    points = [obj.matrix_world @ Vector(corner) for obj in bpy.context.scene.objects if obj.type == "MESH" and
              not obj.get("presentation_only") and obj.get("material_role") != "leaf" and
              any(c.name != "LANDSCAPE" for c in obj.users_collection) for corner in obj.bound_box]
    lo = Vector(tuple(min(p[i] for p in points) for i in range(3)))
    hi = Vector(tuple(max(p[i] for p in points) for i in range(3)))
    target = (lo + hi) / 2
    span = max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z)
    directions = {"FrontCamera": Vector((0, 1, 0)), "HeroPerspectiveCamera": Vector((.75, 1, .16)),
                  "SideCamera": Vector((1, 0, 0)), "AerialCamera": Vector((.55, .8, 1.2))}
    result = []
    for name in CAMERAS:
        data = bpy.data.cameras.new(name)
        obj = bpy.data.objects.new(name, data)
        scene.collections["LIGHTING"].objects.link(obj)
        data.type = "ORTHO" if name in ("FrontCamera", "SideCamera") else "PERSP"
        data.lens = 48 if name == "HeroPerspectiveCamera" else 40
        data.clip_start, data.clip_end = .05, max(200, span * 20)
        data.sensor_width = 36
        data.dof.use_dof = False  # Keep the whole villa sharp, not miniature-like.
        direction = directions[name].normalized()
        distance = span * 2
        data.ortho_scale = span * 1.25
        for _ in range(24):
            obj.location = target + direction * distance
            obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()
            bpy.context.view_layer.update()
            projections = [world_to_camera_view(bpy.context.scene, obj, p) for p in points]
            if all(.07 <= p.x <= .93 and .07 <= p.y <= .93 and p.z > 0 for p in projections):
                break
            if data.type == "ORTHO":
                data.ortho_scale *= 1.10
            else:
                distance *= 1.10
        else:
            raise ValueError(f"Unable to frame {name}")
        obj["source_plan_id"] = building["planId"]
        obj["architectural_camera"] = True
        result.append({"name": name, "type": data.type, "lensMm": data.lens,
                       "locationM": [round(v, 4) for v in obj.location], "orthoScaleM": data.ortho_scale})
    bpy.context.scene.camera = bpy.data.objects[options["render"]["camera"]]
    return result
