"""Prepare redistributable real meshes for offline render and browser use.

blender -b --python blender/prepare_outdoor_assets.py -- <source-gltf> <destination-glb>
"""
import sys
import json
from pathlib import Path
import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index('--')+1:]
source, destination = args[:2]
budget = int(args[2]) if len(args)>2 else 140000
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(Path(source).resolve()))
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
bpy.context.view_layer.update()
pts = [o.matrix_world @ Vector(v) for o in meshes for v in o.bound_box]
lo = [min(p[i] for p in pts) for i in range(3)]
hi = [max(p[i] for p in pts) for i in range(3)]
print('ASSET_BOUNDS '+json.dumps({'min':lo,'max':hi,'size':[b-a for a,b in zip(lo,hi)],'meshes':len(meshes),'faces':sum(len(o.data.polygons) for o in meshes)}),flush=True)
if destination == '-':
    sys.exit(0)
ratio = min(1, budget/sum(len(o.data.polygons) for o in meshes))
for obj in meshes:
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    if len(obj.data.polygons) > 1000:
        mod = obj.modifiers.new('Browser mesh budget', 'DECIMATE')
        mod.ratio = ratio
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for p in obj.data.polygons:
        p.use_smooth = True
bpy.ops.export_scene.gltf(filepath=str(Path(destination).resolve()),export_format='GLB',export_apply=True,
                          export_draco_mesh_compression_enable=True,export_draco_mesh_compression_level=6)
print('PREPARED '+destination,flush=True)
