"""blender --background --python scripts/check-entry-ramp-blender.py -- building.json output.glb"""
import json
import sys
from pathlib import Path
from types import SimpleNamespace
import bpy
import bmesh

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'blender'))
from geometry.safety import create_entry_ramp

source, destination = sys.argv[sys.argv.index('--') + 1:]
building = json.loads(Path(source).read_text(encoding='utf-8'))
bpy.ops.wm.read_factory_settings(use_empty=True)
collection = bpy.data.collections.new('LANDSCAPE')
bpy.context.scene.collection.children.link(collection)
materials = {}
for role, colour in [('concrete', (.55, .51, .45, 1)), ('metal', (.5, .55, .52, 1))]:
    mat = bpy.data.materials.new(role)
    mat.diffuse_color = colour
    mat.use_nodes = True
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = colour
    materials[role] = mat
create_entry_ramp(SimpleNamespace(collections={'LANDSCAPE': collection}, materials=materials), building)
ramp = building['entryRamp']
assert len(collection.objects) == len(ramp['solids']) + len(ramp['rails'])
for solid in ramp['solids']:
    obj = bpy.data.objects['EntryRamp_' + solid['id']]
    actual = [tuple(v.co) for v in obj.data.vertices]
    for a, expected in zip(actual, solid['verticesMm']):
        assert all(abs(a[i] - expected[i] / 1000) < .00001 for i in range(3))
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    assert bm.is_valid and bm.calc_volume() > 0
    bm.free()
    assert obj['formstead_entry_ramp'] and obj['source_plan_id'] == building['planId']
bpy.ops.export_scene.gltf(filepath=destination, export_format='GLB', export_extras=True)
assert Path(destination).stat().st_size > 1000
print('PASS canonical ramp: Blender vertices, closed solids, rails, identity and GLB export', flush=True)
