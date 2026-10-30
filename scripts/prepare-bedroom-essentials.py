"""Extract the uploaded bedroom bed, never the source room or its architecture.
Run Blender --disable-autoexec --python this.py -- --source-root DIR.
"""
import argparse,hashlib,json,sys
from pathlib import Path
import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--source-root',required=True)
opts=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);source=Path(opts.source_root)
blend=source/'bed room.blend';bpy.ops.wm.open_mainfile(filepath=str(blend),load_ui=False,use_scripts=False)
bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get()
def extract(name):
 original=bpy.data.objects[name];evaluated=original.evaluated_get(deps)
 mesh=bpy.data.meshes.new_from_object(evaluated,preserve_all_data_layers=True,depsgraph=deps)
 # Some spare parts reside outside the active source scene; their basis is
 # still explicit authored data and must be applied before assembly.
 matrix=original.matrix_world if original.name in bpy.context.scene.objects else original.matrix_basis
 mesh.transform(matrix);obj=bpy.data.objects.new('Bedroom_'+name,mesh);return obj
frame=extract('Cube.002');mattress=extract('Cube.003');pillow=extract('Plane.005');duvet=extract('Plane.002')
def bounds(obj):
 vs=[v.co for v in obj.data.vertices]
 return Vector([min(v[i] for v in vs) for i in range(3)]),Vector([max(v[i] for v in vs) for i in range(3)])
def fit(obj,size,centre,bottom):
 lo,hi=bounds(obj);old=hi-lo
 for v in obj.data.vertices:
  v.co=Vector(((v.co.x-(lo.x+hi.x)/2)*size.x/old.x+centre.x,
               (v.co.y-(lo.y+hi.y)/2)*size.y/old.y+centre.y,
               (v.co.z-lo.z)*size.z/old.z+bottom))
 obj.data.update()
lo,hi=bounds(frame);span=hi-lo;centre=(lo+hi)/2
# Reassemble the supplied spare mattress/pillows on the supplied bed frame.
bed_bottom=lo.z+span.z*.32;bed_depth=span.y*.86
fit(mattress,Vector((span.x*.9,bed_depth,span.z*.14)),Vector((centre.x,centre.y-span.y*.04,0)),bed_bottom)
mlo,mhi=bounds(mattress)
fit(duvet,Vector((span.x*.9,bed_depth*.8,span.z*.075)),Vector((centre.x,centre.y-span.y*.12,0)),mhi.z-.015)
fit(pillow,Vector((span.x*.38,bed_depth*.2,span.z*.13)),Vector((centre.x-span.x*.23,centre.y+bed_depth*.3,0)),mhi.z)
second=pillow.copy();second.data=pillow.data.copy()
for v in second.data.vertices:v.co.x+=span.x*.46
objects=[frame,mattress,duvet,pillow,second]
for obj in list(bpy.data.objects):
 if obj not in objects:bpy.data.objects.remove(obj,do_unlink=True)
for obj in objects:bpy.context.scene.collection.objects.link(obj)
vs=[v.co for o in objects for v in o.data.vertices];lo=Vector([min(v[i] for v in vs) for i in range(3)]);hi=Vector([max(v[i] for v in vs) for i in range(3)])
scale=1/max(hi-lo);offset=Vector((-(lo.x+hi.x)/2,-(lo.y+hi.y)/2,-lo.z))
for obj in objects:
 for v in obj.data.vertices:v.co=(v.co+offset)*scale
 obj.data.update()
for image in bpy.data.images:
 if image.source!='FILE':continue
 path=source/Path(image.filepath.replace('\\','/')).name
 if path.is_file():image.filepath=str(path);image.reload();image.pack()
for mat in {m for o in objects for m in o.data.materials if m}:
 if mat.use_nodes:
  for node in mat.node_tree.nodes:
   if node.type=='BSDF_PRINCIPLED':node.inputs['Roughness'].default_value=.65
bpy.ops.object.select_all(action='DESELECT')
for obj in objects:obj.select_set(True)
bpy.context.view_layer.objects.active=frame;bpy.ops.object.join();asset=bpy.context.object;asset.name='bedroom-essentials-bed'
size=(hi-lo)*scale;dest=ROOT/'public/interior-assets/bedroom-essentials-bed';dest.mkdir(parents=True,exist_ok=True)
glb=dest/'model.glb'
bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,export_yup=True,export_extras=True,export_animations=False,export_cameras=False,export_lights=False)
author='Blend Swap 91629 contributor (name not included in supplied archive)'
notice='Bed room essentials — Blend Swap #91629\n'+author+'\nSource: https://www.blendswap.com/blends/view/91629\nLicence: CC BY 3.0, as included in the uploaded archive.\nAdaptations: bed-only extraction, mattress/pillow assembly, origin and scale normalization, browser GLB conversion. Original creator name could not be independently retrieved; preserve the supplied licence and source link.\n'
(dest/'LICENSE.txt').write_text(notice,encoding='utf-8');(dest/'SOURCE-LICENSE.html').write_bytes((source/'91629 - LICENSE.html').read_bytes())
record=dict(id=asset.name,label='Bedroom essentials · upholstered bed',author=author,license='CC-BY-3.0',licenseUrl='/interior-assets/bedroom-essentials-bed/SOURCE-LICENSE.html',sourceUrl='https://www.blendswap.com/blends/view/91629',sourcePage='https://www.blendswap.com/blends/view/91629',verifiedAt='2026-10-30',preparedAt='2026-10-30',url='/interior-assets/bedroom-essentials-bed/model.glb',thumbnail='/interior-assets/bedroom-essentials-bed/preview.png',notice='/interior-assets/bedroom-essentials-bed/LICENSE.txt',sizeM=[round(size.x,7),round(size.z,7),round(size.y,7)],triangles=sum(len(p.vertices)-2 for p in asset.data.polygons),bytes=glb.stat().st_size,sha256=hashlib.sha256(glb.read_bytes()).hexdigest(),version=1,provenance='uploaded-licensed',sourceFile='Bed room essentials.zip / bed room.blend',sourceSha256=hashlib.sha256(blend.read_bytes()).hexdigest(),sourceObjects=['Cube.002','Cube.003','Plane.005','Plane.002'])
for file in [ROOT/'src/lib/interior-assets/catalogue.json',ROOT/'public/interior-assets/manifest.json']:
 data=json.loads(file.read_text(encoding='utf-8'));data['assets']=[a for a in data['assets'] if a['id']!=asset.name]+[record]
 file.write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
scene=bpy.context.scene;scene.world=bpy.data.worlds.new('Bed studio');scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.65,.65,.65,1)
bpy.ops.object.camera_add(location=(1.3,-1.6,1.1));camera=bpy.context.object;camera.rotation_euler=(Vector((0,0,size.z*.45))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=1.5;scene.camera=camera
bpy.ops.object.light_add(type='AREA',location=(1,-2,3));bpy.context.object.data.energy=400;bpy.context.object.data.size=4
scene.render.engine='CYCLES';scene.cycles.samples=12;scene.cycles.use_denoising=True
scene.render.resolution_x=480;scene.render.resolution_y=360;scene.render.resolution_percentage=100;scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG';scene.render.filepath=str(dest/'preview.png');bpy.ops.render.render(write_still=True)
print('BED_PREPARED',record['triangles'],record['sizeM'],flush=True)
