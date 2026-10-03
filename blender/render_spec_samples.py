"""Deterministic material sample rooms, not photographs or supplier products."""
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
scene.render.engine = "CYCLES"
scene.cycles.samples = 20
scene.cycles.use_denoising = True
scene.render.resolution_x, scene.render.resolution_y = 1600, 1000
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
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
folder = ROOT / "output/spec-samples"
folder.mkdir(parents=True, exist_ok=True)
for entry in json.loads(REGISTRY.read_text(encoding="utf-8"))["materials"]:
    material = create_spec_material(entry["id"])
    for obj in (floor, wall):
        obj.data.materials.clear()
        obj.data.materials.append(material)
    scene.render.filepath = str(folder / (entry["id"] + ".png"))
    bpy.ops.render.render(write_still=True)
    print("SAMPLE_READY", entry["id"], flush=True)
