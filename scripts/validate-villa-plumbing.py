"""Blender integration check: append services to a copy of an accepted villa.
Never saves or changes the source .blend; exports a separate test artifact.
"""
import sys,json,hashlib
from pathlib import Path
import bpy
from types import SimpleNamespace
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'blender'))
from geometry.plumbing import create_plumbing
from exporters.glb import export_glb
from exporters.shape import measure_shape
args=sys.argv[sys.argv.index('--')+1:]
source,layout_path,out=map(Path,args)
payload=json.loads(source.read_text(encoding='utf-8'))
payload['plumbing']=json.loads(layout_path.read_text(encoding='utf-8'))
def source_digest():
    values=[]
    for obj in sorted(bpy.context.scene.objects,key=lambda o:o.name):
        if obj.get('formstead_plumbing'):continue
        values.append((obj.name,tuple(v for row in obj.matrix_world for v in row),tuple(tuple(v.co) for v in obj.data.vertices) if obj.type=='MESH' else None))
    return hashlib.sha256(repr(values).encode()).hexdigest()
before=source_digest()
shape=measure_shape(payload)
scene=SimpleNamespace(plan_id=payload['buildingModel']['planId'],warnings=[])
create_plumbing(scene,payload)
assert source_digest()==before, 'Accepted architecture changed'
assert measure_shape(payload)==shape, 'Services changed architectural uniqueness measurement'
objects=[o for o in bpy.context.scene.objects if o.get('formstead_plumbing')]
assert objects and all(o.get('source_plan_id')==scene.plan_id for o in objects)
export_glb(out)
assert source_digest()==before
out.with_suffix('.validation.json').write_text(json.dumps({'planId':scene.plan_id,'architectureUnchanged':True,'shapeUnchanged':True,'serviceObjects':len(objects),'canonicalSegments':len(payload['plumbing']['segments']),'issues':scene.warnings},indent=2))
print('CANONICAL_PLUMBING_VALIDATED',len(objects))
