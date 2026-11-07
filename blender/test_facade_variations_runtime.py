"""Render/check all ten attachment sets on one existing generated house."""
import json
import sys
from pathlib import Path
from types import SimpleNamespace
import bpy
from mathutils import Vector
sys.path.insert(0, str(Path(__file__).resolve().parent))
from facade.variations import create_facade_variation

root = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
mixed = '--mixed' in sys.argv
base = 'MIXED' if mixed else 'D01'
bpy.ops.wm.open_mainfile(filepath=str(root / base / f'{base}.blend'))
wall = next(o.data.materials[0] for o in bpy.data.objects if o.type == 'MESH' and o.get('material_role') == 'wall')
glass = next(o.data.materials[0] for o in bpy.data.objects if o.type == 'MESH' and o.get('material_role') == 'glass')
source = json.loads((root / base / 'input.json').read_text())
scene = SimpleNamespace(plan_id=source['buildingModel']['planId'], collections={'FACADE':bpy.data.collections['FACADE']}, materials={'wall':wall,'glass':glass,'landscape':wall})
report=[]
for design in (['MIXED'] if mixed else [f'D{i:02d}' for i in range(1,11)]):
    folder=root/design
    payload=json.loads((folder/'input.json').read_text());model=payload['facadeDesign']
    for obj in list(bpy.data.objects):
        if obj.get('facade_design_part'):
            mesh=obj.data;bpy.data.objects.remove(obj,do_unlink=True)
            if mesh.users==0:bpy.data.meshes.remove(mesh)
    create_facade_variation(scene,model)
    bpy.context.view_layer.update()
    if mixed:
        recipes={bpy.data.objects[p['id']]['facade_recipe'] for p in model['parts']}
        assert 5 <= len(recipes) <= 6, recipes
        assert recipes == set(model['styles'])
    for part in model['parts']:
        obj=bpy.data.objects[part['id']]
        # Raw profile dimensions match the viewer exactly. Blender's 4 mm edge
        # bevel may trim a pointed leaf, but must remain inside this envelope.
        points=[obj.matrix_world@v.co for v in obj.data.vertices]
        evaluated=[obj.matrix_world@Vector(v) for v in obj.bound_box]
        bounds=part['bounds']
        expected=[(bounds['x'],bounds['w']),(bounds['y'],bounds['d']),(bounds['z'],bounds['h'])]
        for axis,(lo,size) in enumerate(expected):
            assert abs(min(p[axis] for p in points)-lo/1000)<.001,(design,part['id'],axis)
            assert abs(max(p[axis] for p in points)-(lo+size)/1000)<.001,(design,part['id'],axis)
            assert min(p[axis] for p in evaluated)>=lo/1000-.001,(design,part['id'],'bevel envelope')
            assert max(p[axis] for p in evaluated)<=(lo+size)/1000+.001,(design,part['id'],'bevel envelope')
        assert len(obj.data.polygons)>0
        assert obj.data.uv_layers.active is not None,'Facade GLB requires explicit material UVs'
    bpy.context.scene.render.resolution_x=800;bpy.context.scene.render.resolution_y=700
    bpy.context.scene.render.filepath=str(folder/f'{design}.png')
    bpy.ops.render.render(write_still=True)
    report.append({'design':design,'parts':len(model['parts']),'boundsMatchLivePreview':True})
    (root/'runtime-checks.json').write_text(json.dumps(report,indent=2))
    print(f'CHECKED {design}: {len(model["parts"])} geometry parts',flush=True)
