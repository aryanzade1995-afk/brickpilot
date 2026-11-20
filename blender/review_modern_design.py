"""Compare an exported Modern Box model with its canonical solids and baseline cameras."""
import json
import struct
import sys
from pathlib import Path

import bpy

base, folder = map(Path, sys.argv[sys.argv.index('--') + 1:])
style = folder.name
bpy.ops.wm.open_mainfile(filepath=str(base))
cameras = {obj.name: (obj.matrix_world.copy(), obj.data.ortho_scale, obj.data.lens)
           for obj in bpy.context.scene.objects if obj.type == 'CAMERA'}
bpy.ops.wm.open_mainfile(filepath=str(folder / f'{style}.blend'))
model = json.loads((folder / 'input.json').read_text())['facadeDesign']
with (folder / f'{style}.glb').open('rb') as glb:
    assert glb.read(4) == b'glTF'
    glb.seek(12)
    length, chunk = struct.unpack('<II', glb.read(8))
    document = json.loads(glb.read(length))
exported = {node['name']: node for node in document['nodes'] if 'mesh' in node}
for part in model['parts']:
    mesh = bpy.data.objects[part['id']]
    bounds = part['bounds']
    points = [mesh.matrix_world @ vertex.co for vertex in mesh.data.vertices]
    for axis, (lo, size) in enumerate([('x','w'), ('y','d'), ('z','h')]):
        assert abs(min(p[axis] for p in points)*1000 - bounds[lo]) < 1
        assert abs(max(p[axis] for p in points)*1000 - bounds[lo] - bounds[size]) < 1
    node = exported[part['id']]
    assert node['extras']['facade_design_signature'] == model['signature']
    assert node['extras']['facade_style'] == style
    assert node['extras']['source_plan_id'] == model['sourcePlanId']
scene = bpy.context.scene
for name, (matrix, scale, lens) in cameras.items():
    camera = bpy.data.objects[name]
    camera.matrix_world = matrix
    camera.data.ortho_scale = scale
    camera.data.lens = lens
    scene.camera = camera
    scene.render.filepath = str(folder / f'{name}.png')
    bpy.ops.render.render(write_still=True)
print(f"Verified {style}: {len(model['parts'])} Blender and GLB parts", flush=True)
