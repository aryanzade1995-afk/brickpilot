"""Prepare six licensed Kenney cars for the shared parking/street fleet."""
import bpy,json,shutil,hashlib
from pathlib import Path
from mathutils import Matrix,Vector
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'output/kenney-car-kit/Models/GLB format'
DEST=ROOT/'public/exterior-assets/free-cars';DEST.mkdir(parents=True,exist_ok=True)
choices=[('sedan',4.3,'#b33132'),('sedan-sports',4.5,'#226cb2'),('hatchback-sports',4.0,'#23877e'),('suv',4.55,'#bb7431'),('suv-luxury',4.65,'#553f85'),('taxi',4.4,'#e6b533')]
records=[]
for key,length,paint in choices:
 bpy.ops.wm.read_factory_settings(use_empty=True)
 bpy.ops.import_scene.gltf(filepath=str(SOURCE/(key+'.glb')))
 objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
 shader=bpy.data.materials.new('Automotive paint '+paint);shader.use_nodes=True
 bsdf=shader.node_tree.nodes.get('Principled BSDF')
 rgb=[int(paint[i:i+2],16)/255 for i in (1,3,5)]
 bsdf.inputs['Base Color'].default_value=tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in rgb)+(1,)
 bsdf.inputs['Metallic'].default_value=.48;bsdf.inputs['Roughness'].default_value=.27;bsdf.inputs['Coat Weight'].default_value=.45
 painted=0
 for o in objects:
  if 'wheel' not in o.name.lower() and o.data.uv_layers.active:
   original=list(o.data.materials);o.data.materials.append(shader);paint_index=len(o.data.materials)-1
   for poly in o.data.polygons:
    mat=original[poly.material_index];im=next((n.image for n in mat.node_tree.nodes if n.type=='TEX_IMAGE'),None)
    if not im:continue
    uv=o.data.uv_layers.active.data[poly.loop_indices[0]].uv
    x=int(uv.x*im.size[0])%im.size[0];y=int(uv.y*im.size[1])%im.size[1]
    r,g,b=im.pixels[(y*im.size[0]+x)*4:(y*im.size[0]+x)*4+3]
    if r>.6 and .15<g<.7 and r>g*1.3 and r>b*1.4:poly.material_index=paint_index;painted+=1
  world=o.matrix_world.copy();o.parent=None;o.matrix_world=Matrix.Identity(4)
  for v in o.data.vertices:v.co=world@v.co
 points=[v.co for o in objects for v in o.data.vertices]
 lo=Vector([min(v[i] for v in points) for i in range(3)]);hi=Vector([max(v[i] for v in points) for i in range(3)])
 scale=length/(hi.y-lo.y);offset=Vector((-(lo.x+hi.x)/2,-(lo.y+hi.y)/2,-lo.z))
 for o in objects:
  for v in o.data.vertices:v.co=(v.co+offset)*scale
  o.data.update()
 fronts=[v.co.y for o in objects if 'wheel-front' in o.name for v in o.data.vertices]
 backs=[v.co.y for o in objects if 'wheel-back' in o.name for v in o.data.vertices]
 assert sum(fronts)/len(fronts)<sum(backs)/len(backs),'Expected +Z glTF front'
 assert painted>0,key+' must have distinct painted body panels'
 bpy.ops.object.select_all(action='DESELECT')
 for o in objects:o.select_set(True)
 bpy.ops.export_scene.gltf(filepath=str(DEST/(key+'.glb')),export_format='GLB',use_selection=True,export_animations=False,export_cameras=False,export_lights=False)
 records.append(dict(id=key,file=key+'.glb',lengthM=length,front='+Z',paint=paint,paintedFaces=painted,triangles=sum(len(p.vertices)-2 for o in objects for p in o.data.polygons),sha256=hashlib.sha256((DEST/(key+'.glb')).read_bytes()).hexdigest(),license='CC0-1.0',source='https://kenney.nl/assets/car-kit'))
(DEST/'manifest.json').write_text(json.dumps(records,indent=2)+'\n',encoding='utf-8')
shutil.copyfile(ROOT/'output/kenney-car-kit/License.txt',DEST/'License.txt')
(DEST/'SOURCE.md').write_text('Vehicles: Kenney Car Kit 3.1, CC0-1.0.\nOriginal: https://kenney.nl/assets/car-kit\nArchive by Kenney: https://opengameart.org/content/car-kit\nModified: six paint finishes, metre dimensions, grounded geometry, embedded textures.\n',encoding='utf-8')
print('Prepared six coloured cars',flush=True)
