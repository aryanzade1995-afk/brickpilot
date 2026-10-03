"""Deterministic material sample rooms, not photographs or supplier products."""
import hashlib
import json
import sys
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "blender"))
from visualization.spec_materials import create_spec_material, REGISTRY

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE_NEXT"
scene.render.film_transparent = False
scene.render.image_settings.quality = 92
scene.render.resolution_x, scene.render.resolution_y = 1280, 800
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "JPEG"
scene.view_settings.view_transform = "AgX"
scene.world.color = (.35, .35, .35)

def box(name, center, size, material):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    bevel = obj.modifiers.new("Controlled edges", "BEVEL")
    bevel.width, bevel.segments = .012, 3
    return obj

plain = bpy.data.materials.new("Neutral plaster")
plain.diffuse_color = (.72, .70, .65, 1)
floor = box("Sample floor", (0, 0, -.07), (4, 3.4, .14), plain)
wall = box("Sample wall", (0, 1.65, 1.45), (4, .12, 2.9), plain)
box("Side wall", (-1.95, .45, 1.45), (.1, 2.5, 2.9), plain)
box("Low console", (.7, .95, .36), (1.5, .65, .72), plain)
box("Neutral seat", (-.6, .35, .35), (.7, .75, .7), plain)
box("Neutral seat back", (-.6, .65, .65), (.7, .16, .65), plain)
box("Side table", (-.2, -.55, .22), (.6, .5, .44), plain)
for location, energy, size in [((0, -2, 4.5), 550, 5), ((2, 0, 3.7), 300, 3)]:
    bpy.ops.object.light_add(type="AREA", location=location)
    light = bpy.context.object
    light.data.energy, light.data.shape, light.data.size = energy, "DISK", size
    light.rotation_euler = (Vector((0, .6, .8)) - light.location).to_track_quat("-Z", "Y").to_euler()
bpy.ops.object.camera_add(location=(5, -6.5, 4.2))
camera = bpy.context.object
camera.rotation_euler = (Vector((0, .5, 1.1)) - camera.location).to_track_quat("-Z", "Y").to_euler()
camera.data.lens = 48
scene.camera = camera
folder = ROOT / "public/specs/samples"
folder.mkdir(parents=True, exist_ok=True)
metadata = []
for entry in json.loads(REGISTRY.read_text(encoding="utf-8"))["materials"]:
    material = create_spec_material(entry["id"])
    for obj in (floor, wall):
        obj.data.materials.clear()
        obj.data.materials.append(material)
    scene.render.filepath = str(folder / (entry["id"] + "-1280.jpg"))
    bpy.ops.render.render(write_still=True)
    print("SAMPLE_READY", entry["id"], flush=True)

    original = Path(scene.render.filepath)
    image = bpy.data.images.load(str(original), check_existing=False)
    image.scale(800, 500)
    web = folder / (entry["id"] + "-800.jpg")
    image.filepath_raw, image.file_format = str(web), "JPEG"
    image.save()
    bpy.data.images.remove(image)
    metadata.append({"materialId": entry["id"], "texture": entry["texture"], "photo": {
        "file": original.relative_to(ROOT).as_posix(), "webFile": web.relative_to(ROOT).as_posix(),
        "kind": "visualisation", "source": "blender://specification-room", "licence": "CC0-1.0",
        "credit": "Formstead EEVEE sample; " + entry["credit"],
        "verifiedBy": "render-audit: deterministic Blender sample, not a photograph",
        "width": 1280, "height": 800, "sha256": hashlib.sha256(original.read_bytes()).hexdigest(),
        "webSha256": hashlib.sha256(web.read_bytes()).hexdigest(),
        "caption": "Visualisation · standard material room, not a supplier product or your generated plan"}})
(ROOT / "src/lib/cost/data/samples.json").write_text(json.dumps({"samples": metadata}, indent=2), encoding="utf-8")
