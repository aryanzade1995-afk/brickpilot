import json,sys
from pathlib import Path
import bpy
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'blender'))
from generator import create_scene
from exporters.glb import export_glb
p=root/'output/doors-pipes-validation';payload=json.loads((p/'input.json').read_text())
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=create_scene(payload,{'render':{'engine':'EEVEE','quality':'preview','samples':16,'resolution':[768,576]}})
for spec in payload['balconySliders']:
 objects=[o for o in bpy.context.scene.objects if o.get('source_id')==spec['sourceId'] and o.type=='MESH']
 assert any(o.get('opening_operation') in ('surface-sliding-door','sliding-door') for o in objects),spec['sourceId']
 if spec['operation']=='surface-slide': assert all(not o.get('opening_operation') for o in objects if 'Fixed' in o.name)
assert len([o for o in bpy.context.scene.objects if o.name.startswith('Door_ROOF_STAIR_EXIT_Leaf_')])==2
assert not any(o.name.startswith('Service_') and 'Joint_' in o.name for o in bpy.context.scene.objects)
export_glb(p/'details.glb')
(p/'blender-check.json').write_text(json.dumps({'planId':scene.plan_id,'balconySliders':len(payload['balconySliders']),'roofDoorLeaves':2,'fittings':len(payload['plumbing']['assembly']['fittings']),'source':'Poly Haven CC0'}))
print('DETAIL_EXPORT_VALIDATED',flush=True)
