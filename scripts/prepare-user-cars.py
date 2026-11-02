"""Extract car-only browser assets from the two user-supplied archives.
Canonical GLB axes: metres, Y up, nose +Z, grounded and centred in X/Z.
"""
import bpy,math,json,hashlib
from pathlib import Path
from mathutils import Vector,Matrix
ROOT=Path(__file__).resolve().parents[1]
dest=ROOT/'public/exterior-assets/user-cars';dest.mkdir(parents=True,exist_ok=True)
records=[]
for filename,key,names,yaw,length in [
 ('uploads_files_2815692_Mclaren+Senna.blend','mclaren-senna',['senna','FR','RR','RL','FL'],0,4.65),
 ('202009122216-2.blend','compact-hatch',['carr','roda.002','roda.003','roda.001','roda.000','Retrovisor.001','macanetaCopia','grade2','Cube.001','grade3'],-math.pi/2,4.3)]:
 file=ROOT/'output/user-car-source'/filename
 bpy.ops.wm.open_mainfile(filepath=str(file),load_ui=False,use_scripts=False)
 bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get();objects=[]
 for name in names:
  source=bpy.data.objects[name]
  for mod in source.modifiers:
   if mod.type=='SUBSURF':mod.show_viewport=False
 bpy.context.view_layer.update()
 for name in names:
  source=bpy.data.objects[name];mesh=bpy.data.meshes.new_from_object(source.evaluated_get(deps),depsgraph=deps)
  mesh.transform(Matrix.Rotation(yaw,4,'Z')@source.matrix_world)
  obj=bpy.data.objects.new(key+'_'+name,mesh);objects.append(obj)
 for obj in list(bpy.data.objects):
  if obj not in objects:bpy.data.objects.remove(obj,do_unlink=True)
 for obj in objects:bpy.context.scene.collection.objects.link(obj)
 points=[v.co for o in objects for v in o.data.vertices]
 lo=Vector([min(v[i] for v in points) for i in range(3)]);hi=Vector([max(v[i] for v in points) for i in range(3)])
 scale=length/(hi.y-lo.y);offset=Vector((-(lo.x+hi.x)/2,-(lo.y+hi.y)/2,-lo.z))
 for o in objects:
  for v in o.data.vertices:v.co=(v.co+offset)*scale
  o.data.update()
 count=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in objects)
 for o in objects:
  if len(o.data.polygons)>100:
   bpy.context.view_layer.objects.active=o;mod=o.modifiers.new('Browser detail budget','DECIMATE');mod.ratio=min(1,45000/count)
   bpy.ops.object.modifier_apply(modifier=mod.name)
  for p in o.data.polygons:p.use_smooth=True
 missing=[]
 for mat in {m for o in objects for m in o.data.materials if m}:
  mat.use_nodes=True
  for node in list(mat.node_tree.nodes):
   if node.type=='TEX_IMAGE' and node.image and not node.image.packed_file:
    path=Path(bpy.path.abspath(node.image.filepath))
    if not path.is_file():missing.append(node.image.name);mat.node_tree.nodes.remove(node)
  shader=next((n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
  if not shader:continue
  if mat.name in ['BodyPaint','CARR']:
   shader.inputs['Base Color'].default_value=(.035,.19,.29,1) if key=='compact-hatch' else (.85,.23,.02,1)
   shader.inputs['Metallic'].default_value=.65;shader.inputs['Roughness'].default_value=.24
   shader.inputs['Coat Weight'].default_value=.55
  if mat.name in ['Glass','Windows','VD']:
   shader.inputs['Base Color'].default_value=(.04,.07,.08,1);shader.inputs['Roughness'].default_value=.12;shader.inputs['Metallic'].default_value=.25
 bpy.ops.object.select_all(action='DESELECT')
 for o in objects:o.select_set(True)
 output=dest/(key+'.glb')
 bpy.ops.export_scene.gltf(filepath=str(output),export_format='GLB',use_selection=True,export_animations=False,export_cameras=False,export_lights=False)
 records.append({'id':key,'source':filename,'sourceSha256':hashlib.sha256(file.read_bytes()).hexdigest(),'file':output.name,'front':'+Z','lengthM':length,'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in objects),'missingTextureMaps':sorted(set(missing)),'provenance':'user-supplied; no licence supplied with archive'})
 scene=bpy.context.scene;scene.world=bpy.data.worlds.new('Preview world');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.5,.5,.5,1)
 bpy.ops.object.camera_add(location=(6,-7,4));camera=bpy.context.object;camera.rotation_euler=(Vector((0,0,.6))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=6;scene.camera=camera
 bpy.ops.object.light_add(type='AREA',location=(1,-3,6));bpy.context.object.data.energy=700;bpy.context.object.data.size=5
 scene.render.engine='CYCLES';scene.cycles.samples=12;scene.cycles.use_denoising=True;scene.render.resolution_x=560;scene.render.resolution_y=360;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.filepath=str(dest/(key+'.png'));bpy.ops.render.render(write_still=True)
(dest/'manifest.json').write_text(json.dumps(records,indent=2)+'\n')
(dest/'SOURCE.txt').write_text('User supplied cars from 25-mclaren-senna.zip and 43-202009122216-2.zip. No author/licence included. Car-only extraction, decimation, metre normalization, nose +Z. Missing source textures use visual material approximations. See manifest.json.\n')
print(records,flush=True)
