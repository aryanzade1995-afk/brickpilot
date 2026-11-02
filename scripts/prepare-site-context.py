"""Create lightweight browser variants of the already licensed outdoor assets."""
import bpy,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'blender'))
from geometry.realistic_props import _car_material
dest=ROOT/'public/exterior-assets/site-context';dest.mkdir(parents=True,exist_ok=True)
records=[]
for filename,target in [('ferrari-458.glb',28000),('island-tree.glb',22000)]:
 bpy.ops.wm.read_factory_settings(use_empty=True)
 bpy.ops.import_scene.gltf(filepath=str(ROOT/'blender/assets'/filename))
 meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
 count=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes)
 for o in meshes:
  if filename.startswith('ferrari'):
   for mat in o.data.materials:
    if mat:_car_material(mat)
  if len(o.data.polygons)>100:
   bpy.context.view_layer.objects.active=o
   mod=o.modifiers.new('Context LOD','DECIMATE');mod.ratio=min(1,target/count)
   bpy.ops.object.modifier_apply(modifier=mod.name)
  for p in o.data.polygons:p.use_smooth=True
 output=dest/filename
 bpy.ops.export_scene.gltf(filepath=str(output),export_format='GLB',export_animations=False,export_cameras=False,export_lights=False)
 records.append({'file':filename,'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes),'bytes':output.stat().st_size})
(dest/'manifest.json').write_text(json.dumps(records,indent=2)+'\n')
for name in ['ATTRIBUTION.md','LICENSES.md']:(dest/name).write_bytes((ROOT/'blender/assets'/name).read_bytes())
print(records,flush=True)
