"""Extract CC0 Poly Haven component meshes for identical browser/Blender replay."""
import bpy,json,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root/'output/third-party/modular-pipes/modular_pipes.gltf'))
parts={}
for key,name,anchor in [('coupler','pipe_5cm_pvc',(0,0,.025)),('elbow','pipe_turn_short_pvc',(0,0,.1)),('tee','pipe_junction_t_pvc',(0,0,.1)),('support','pipe_support_pvc',(0,-.05,0))]:
 o=bpy.data.objects[name];m=o.data;m.calc_loop_triangles()
 positions=[];normals=[]
 for triangle in m.loop_triangles:
  for vi in triangle.vertices:
   v=m.vertices[vi];positions.extend(round(v.co[i]-anchor[i],7) for i in range(3));normals.extend(round(v.normal[i],7) for i in range(3))
 parts[key]={'sourceObject':name,'positions':positions,'normals':normals,'nominalDiameterM':.1}
 print('EXTRACTED',key,len(positions)//9,flush=True)
out=root/'src/lib/plumbing/data';out.mkdir(parents=True,exist_ok=True)
(out/'polyhaven-fittings.json').write_text(json.dumps({'source':'https://polyhaven.com/a/modular_pipes','author':'Kuutti Siitonen','license':'CC0-1.0','sourceCoordinates':'metres, Z along pipe, X/Z bend plane','parts':parts},separators=(',',':')))
