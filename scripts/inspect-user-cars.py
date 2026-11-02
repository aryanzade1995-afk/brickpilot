import bpy,json
from pathlib import Path
from mathutils import Vector
root=Path(__file__).resolve().parents[1]
results=[]
for file in (root/'output/user-car-source').glob('*.blend'):
 bpy.ops.wm.open_mainfile(filepath=str(file),load_ui=False,use_scripts=False)
 bpy.context.view_layer.update()
 entries=[]
 for o in bpy.context.scene.objects:
  if o.type!='MESH':continue
  vs=[o.matrix_world@Vector(v) for v in o.bound_box]
  entries.append({'name':o.name,'vertices':len(o.data.vertices),'bounds':[[min(v[i] for v in vs) for i in range(3)],[max(v[i] for v in vs) for i in range(3)]],'materials':[m.name for m in o.data.materials if m]})
 results.append({'file':file.name,'objects':entries,'images':[{'name':i.name,'packed':bool(i.packed_file),'path':i.filepath} for i in bpy.data.images]})
(root/'output/user-car-inspection.json').write_text(json.dumps(results,indent=2))
