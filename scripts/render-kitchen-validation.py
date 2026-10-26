"""Visual QA of the canonical accepted house kitchen, no architecture search."""
import bpy,json,sys,copy,math
from pathlib import Path
from mathutils import Vector
repo=Path(__file__).resolve().parents[1];sys.path.insert(0,str(repo/'blender'))
from walkthrough_export import root,add_interior_models,material,primitive,mesh_object,world_to_blender
app=json.loads((repo/'output/furniture-sources/appearance.json').read_text())
geometry=json.loads((repo/'output/furniture-sources/geometry.json').read_text())
room=next(r for r in geometry['metadata']['rooms'] if 'kitchen' in r['id'].lower());key=room['id']
bpy.ops.wm.read_factory_settings(use_empty=True);parent=root('kitchen-qa','walkthrough-furniture')
models=[m for m in app['models'] if m['roomId']==key];replaced=add_interior_models(models,parent)
def selected(key):
    look=copy.deepcopy(app['bindings'][key]);image=look.get('surface',{}).get('image')
    if image:look['surface']['image']=str(repo/'public'/image.lstrip('/'))
    return material(key,look)
for part in app['furniture']:
    if part['roomId']!=key or part['id'] in replaced:continue
    vertices,faces=primitive(part);mesh_object(part['id'],vertices,faces,parent,{},selected(part['binding']))
for face in geometry['faces']:
    if face['roomId']!=key:continue
    mesh_object(face['id'],face['vertices'],[tuple(range(len(face['vertices'])))],parent,{},selected(face['binding']))
for face in app['skins']:
    if face['roomId']==key:mesh_object(face['id'],face['vertices'],[tuple(range(len(face['vertices'])))],parent,{},selected(face['binding']))
bpy.ops.object.camera_add(location=world_to_blender([14.95,1.58,-4.85]));cam=bpy.context.object
target=Vector(world_to_blender([16.4,1.05,-3.35]));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.lens=18;bpy.context.scene.camera=cam
for position,power,size in [([15.4,2.65,-3.4],90,2),([15.7,2.2,-2.2],70,1.5)]:
    bpy.ops.object.light_add(type='AREA',location=world_to_blender(position));light=bpy.context.object;light.data.energy=power;light.data.shape='DISK';light.data.size=size
    light.rotation_euler=(Vector(world_to_blender([16,.7,-3.65]))-light.location).to_track_quat('-Z','Y').to_euler()
sc=bpy.context.scene;sc.world=bpy.data.worlds.new('Daylight');sc.world.color=(.35,.35,.35)
sc.render.engine='CYCLES';sc.cycles.samples=32;sc.cycles.use_denoising=True;sc.render.resolution_x=1000;sc.render.resolution_y=750;sc.render.resolution_percentage=100
sc.render.filepath=str(repo/'outputs/formstead-kitchen-slabs-qa.png');bpy.ops.render.render(write_still=True)
