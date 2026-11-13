"""Optimise independently licensed vegetation; never open or alter a house."""
import bpy
import json
import sys
from pathlib import Path

config = json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text())
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=config['input'])
meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
total = sum(sum(len(face.vertices) - 2 for face in obj.data.polygons) for obj in meshes)
ratio = min(1, config['budget'] / max(1, total))
for obj in meshes:
    bpy.context.view_layer.objects.active = obj
    if ratio < 1:
        modifier = obj.modifiers.new('Browser vegetation budget', 'DECIMATE')
        modifier.ratio = ratio
        modifier.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj['asset_source'] = config['source']
    obj['asset_license'] = 'CC0-1.0'
actual = sum(sum(len(face.vertices) - 2 for face in obj.data.polygons) for obj in meshes)
print('VEGETATION_TRIANGLES', total, '->', actual, flush=True)
Path(config['output']).parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=config['output'], export_format='GLB', export_yup=True,
                          export_texcoords=True, export_normals=True, export_tangents=False,
                          export_materials='EXPORT', export_extras=True)
