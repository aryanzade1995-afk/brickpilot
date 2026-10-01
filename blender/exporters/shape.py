"""Shape measurements from evaluated Blender meshes; materials are never read."""
from mathutils import Vector
import bpy

GRID = 32
MEASUREMENT_SCHEMA_VERSION = 3


def _above_plane(points, z):
    """Clip triangles, including vertical faces crossing the roof datum."""
    output = []
    for a, b in zip(points, points[1:] + points[:1]):
        inside_a, inside_b = a.z >= z, b.z >= z
        if inside_a:
            output.append(a)
        if inside_a != inside_b:
            output.append(a + (b - a) * ((z - a.z) / (b.z - a.z)))
    return output


def _raster(triangles, bounds):
    x0, y0, width, height = bounds
    pixels = [0] * (GRID * GRID)
    for triangle in triangles:
        points = [((x - x0) * GRID / width, (y - y0) * GRID / height) for x, y in triangle]
        lo_x, hi_x = max(0, int(min(p[0] for p in points))), min(GRID - 1, int(max(p[0] for p in points)))
        lo_y, hi_y = max(0, int(min(p[1] for p in points))), min(GRID - 1, int(max(p[1] for p in points)))
        a, b, c = points
        area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        if abs(area) < 1e-8:
            continue
        for y in range(lo_y, hi_y + 1):
            for x in range(lo_x, hi_x + 1):
                if pixels[y * GRID + x]:
                    continue
                px, py = x + .5, y + .5
                cross = [((q[0] - p[0]) * (py - p[1]) - (q[1] - p[1]) * (px - p[0]))
                         for p, q in ((a, b), (b, c), (c, a))]
                if min(cross) >= -1e-6 or max(cross) <= 1e-6:
                    pixels[y * GRID + x] = 1
    return pixels


def measure_shape(payload):
    building = payload["buildingModel"]
    top = max(f["elevationMm"] + f["heightMm"] for f in building["floors"]) * .001
    # A constant plan-based frame across all seeds. No per-villa auto normalization.
    # Include the complete plot so supported forecourt additions are not clipped.
    span = (0, 0, building['plot']['widthMm'] * .001, building['plot']['depthMm'] * .001)
    front, side, roof, roof_front, roof_side = [], [], [], [], []
    graph = bpy.context.evaluated_depsgraph_get()
    count = 0
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.get("presentation_only") or not any(
                c.name in ("STRUCTURE", "WALLS", "OPENINGS", "WINDOWS", "DOORS", "MASSING", "FACADE", "BALCONIES", "ROOF") for c in obj.users_collection):
            continue
        evaluated = obj.evaluated_get(graph)
        mesh = evaluated.to_mesh()
        try:
            mesh.calc_loop_triangles()
            vertices = [evaluated.matrix_world @ v.co for v in mesh.vertices]
            for tri in mesh.loop_triangles:
                pts = [vertices[i] for i in tri.vertices]
                front.append([(v.x, v.z) for v in pts])
                side.append([(v.y, v.z) for v in pts])
                clipped = _above_plane(pts, top + .1)
                for i in range(1, len(clipped) - 1):
                    face = [clipped[0], clipped[i], clipped[i + 1]]
                    roof.append([(v.x, v.y) for v in face])
                    roof_front.append([(v.x, v.z) for v in face])
                    roof_side.append([(v.y, v.z) for v in face])
            count += 1
        finally:
            evaluated.to_mesh_clear()
    parts = {
        "front": _raster(front, (span[0], -.5, span[2], top + 5.5)),
        "side": _raster(side, (span[1], -.5, span[3], top + 5.5)),
        "roof": _raster(roof, span),
        "roofFront": _raster(roof_front, (span[0], top, span[2], 5)),
        "roofSide": _raster(roof_side, (span[1], top, span[3], 5)),
    }
    return {"schemaVersion": MEASUREMENT_SCHEMA_VERSION, "planId": building["planId"], "seed": payload["villaDesignDNA"]["seed"],
            "grid": GRID, "meshCount": count, "parts": parts,
            "vector": [n for values in parts.values() for n in values]}


def clay_materials():
    """One neutral material; hide landscaping/fixtures so they cannot imply novelty."""
    material = bpy.data.materials.new("Gallery_White_Clay")
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (.72, .72, .72, 1)
    shader.inputs["Roughness"].default_value = .8
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            if any(c.name == "LANDSCAPE" for c in obj.users_collection) and not obj.get("presentation_only"):
                obj.hide_render = True
            obj.data = obj.data.copy()
            obj.data.materials.clear()
            obj.data.materials.append(material)


def lock_gallery_cameras(payload):
    b = payload["buildingModel"]
    height = max(f["elevationMm"] + f["heightMm"] for f in b["floors"]) * .001 + 5
    width, depth = b["plot"]["widthMm"] * .001, b["plot"]["depthMm"] * .001
    target = Vector((width / 2, depth / 2, height / 2))
    span = max(width, depth, height)
    for name, direction in {"FrontCamera": (0, 1, .02), "SideCamera": (1, 0, .02),
                            "HeroPerspectiveCamera": (.75, 1, .4), "AerialCamera": (.55, .8, 1.2)}.items():
        camera = bpy.data.objects[name]
        camera.location = target + Vector(direction).normalized() * span * 2.6
        camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
        camera.data.ortho_scale = span * 1.5
