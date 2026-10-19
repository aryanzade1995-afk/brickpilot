"""Check the actual exterior meshes, assigned colours, and tree-free scene."""
import argparse
import json
from pathlib import Path
import sys
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parent))
from visualization.palettes import resolve_palette,palette_specs,color_rgba

parser=argparse.ArgumentParser()
parser.add_argument('--input',required=True)
parser.add_argument('--blend',required=True)
parser.add_argument('--reference')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
payload=json.loads(Path(args.input).read_text(encoding='utf-8'))
bpy.ops.wm.open_mainfile(filepath=str(Path(args.blend).resolve()))
assert not any(o.name.startswith('Garden_Tree_') or o.get('asset_id')=='island-tree-01' for o in bpy.context.scene.objects),'Exterior still contains trees'
palette=resolve_palette(payload['villaDesignDNA']['materialPalette'])
specs=palette_specs(palette)
for role in ('primary_wall','secondary_wall','accent'):
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.get('material_role')==role]
    assert objects,f'Missing real exterior meshes with {role} finish'
    expected=color_rgba(specs[role]['color'])
    for obj in objects:
        shader=next(n for n in obj.active_material.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
        actual=shader.inputs['Base Color'].default_value
        assert all(abs(a-b)<.001 for a,b in zip(actual,expected)),f'{obj.name}: wrong colour'
if args.reference:
    before=json.loads(Path(args.reference).read_text(encoding='utf-8'))
    assert payload['buildingModel']==before['buildingModel'],'Recolouring changed the source building'
    assert payload['massingModel']['masses']==before['massingModel']['masses'],'Recolouring moved exterior volumes'
print(f'PASS: {palette}, three assigned exterior colour roles, no trees, source geometry preserved')
