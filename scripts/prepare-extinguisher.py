"""Blender: convert the verified Poly Haven 1K glTF into a packed local prop.
Source: https://polyhaven.com/a/korean_fire_extinguisher_01 (UM JOORIN, CC0).
Input: output/extinguisher-source/korean_fire_extinguisher_01.gltf
"""
import bpy
from pathlib import Path
from mathutils import Vector

root = Path(__file__).resolve().parents[1]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(root/'output/extinguisher-source/korean_fire_extinguisher_01.gltf'))
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
points = [o.matrix_world @ Vector(p) for o in meshes for p in o.bound_box]
lo = Vector(tuple(min(p[i] for p in points) for i in range(3)))
hi = Vector(tuple(max(p[i] for p in points) for i in range(3)))
scale = .65/(hi.z-lo.z)
offset = Vector(((lo.x+hi.x)/2, (lo.y+hi.y)/2, lo.z))
for o in meshes:
    world=o.matrix_world.copy()
    for v in o.data.vertices: v.co=(world@v.co-offset)*scale
    o.parent=None
    o.matrix_world.identity()
    o['formstead_extinguisher_asset']=True
    o['asset_source']='https://polyhaven.com/a/korean_fire_extinguisher_01'
    for p in o.data.polygons: p.use_smooth=True
out=root/'public/safety-assets'
out.mkdir(parents=True,exist_ok=True)
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(out/'fire-extinguisher.blend'))
bpy.ops.export_scene.gltf(filepath=str(out/'fire-extinguisher.glb'),export_format='GLB',export_extras=True)
print('EXTINGUISHER',len(meshes),'meshes',sum(len(o.data.polygons) for o in meshes),'polygons')
