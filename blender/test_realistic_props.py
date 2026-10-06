"""Verify detailed offline meshes, placement, instancing and browser texture export.

blender -b --python-exit-code 1 --python blender/test_realistic_props.py -- <output-folder>
"""
import json
import struct
import sys
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from geometry.common import SceneBuilder
from geometry.realistic_props import create_real_car,create_real_tree
from exporters.glb import export_glb
from visualization.surfaces import bounds_mm

out=Path(sys.argv[sys.argv.index('--')+1]).resolve()
out.mkdir(parents=True,exist_ok=True)
scene=SceneBuilder('realistic-prop-test')
a=create_real_car(scene,'Car_A',0,0,0,True)
b=create_real_car(scene,'Car_B',8000,0,0,False)
boundary={'x':-5000,'y':-5000,'w':40000,'h':15000}
t=create_real_tree(scene,'Tree_A',15000,0,0,4800,.2,'lawn',[],boundary)
u=create_real_tree(scene,'Tree_B',20000,0,0,4800,1.3,'lawn',[],boundary)
assert len(a)>=40 and len(t)>0
assert a[0].data is b[0].data and t[0].data is u[0].data
assert all(o['source_plan_id']=='realistic-prop-test' for o in a+b+t+u)
assert sum(len(o.data.polygons) for o in a)>50000
assert sum(len(o.data.polygons) for o in t)>150000
assert any(o['asset_component'].startswith('tire') for o in a)
assert any(o['asset_component']=='body' for o in a)
bpy.context.view_layer.update()
def envelope(objects):
    pts=[o.matrix_world @ Vector(p) for o in objects for p in o.bound_box]
    return [(max(p[i] for p in pts)-min(p[i] for p in pts))*1000 for i in range(3)]
assert all(d<=limit for d,limit in zip(envelope(a),(2260,4540,1240)))
assert all(d<=limit for d,limit in zip(envelope(b),(4540,2260,1240)))
assert not create_real_tree(scene,'BlockedTree',0,0,0,4800,0,'lawn',[{'x':-100,'y':-100,'w':200,'h':200}],boundary)
paint=next(m for o in a for m in o.data.materials if 'Body_Color' in m.name)
shader=next(n for n in paint.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
assert shader.inputs['Coat Weight'].default_value>=.9
asset_materials=set(m for o in t for m in o.data.materials)
assert all(any(n.type=='TEX_IMAGE' for n in m.node_tree.nodes) for m in asset_materials)
export_glb(out/'props.glb')
data=(out/'props.glb').read_bytes()
n=struct.unpack_from('<I',data,12)[0]
gltf=json.loads(data[20:20+n])
assert len(gltf.get('images',[]))>=3
assert sum('baseColorTexture' in m.get('pbrMetallicRoughness',{}) for m in gltf['materials'])>=3
assert len(gltf['meshes'])<len(a+b+t+u),'Instances must share browser geometry'
assert all(any(s.inputs['Base Color'].links for s in m.node_tree.nodes if s.type=='BSDF_PRINCIPLED') for m in asset_materials)

# A close view of the real car and tree; this image uses the same meshes as the villa.
for o in b+u:
    o.hide_render=True
for o in t:
    o.location.x-=11.3
    o.location.y+=1
scene.box('Studio_Ground','LANDSCAPE',1000,500,-100,18000,16000,100,'paving')
bpy.context.scene.world.use_nodes=True
bpy.context.scene.world.node_tree.nodes.get('Background').inputs[0].default_value=(.35,.42,.5,1)
bpy.context.scene.world.node_tree.nodes.get('Background').inputs[1].default_value=.4
for name,location,power,size in [('Key',(-4,-4,8),2200,6),('Rim',(5,4,6),1800,5),('Fill',(-3,5,5),1200,4)]:
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size
    obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj);obj.location=location
    obj.rotation_euler=(Vector((1,0,1))-obj.location).to_track_quat('-Z','Y').to_euler()
camera=bpy.data.cameras.new('PropCamera');obj=bpy.data.objects.new('PropCamera',camera);bpy.context.collection.objects.link(obj)
obj.location=(9,-10,5);obj.rotation_euler=(Vector((1.3,0,1))-obj.location).to_track_quat('-Z','Y').to_euler();camera.lens=52
bpy.context.scene.camera=obj
bpy.context.scene.render.engine='CYCLES';bpy.context.scene.cycles.samples=32;bpy.context.scene.cycles.use_denoising=True
bpy.context.scene.render.resolution_x=1200;bpy.context.scene.render.resolution_y=800;bpy.context.scene.render.resolution_percentage=100
bpy.context.scene.render.filepath=str(out/'realistic-car-and-tree.png')
bpy.ops.render.render(write_still=True)
print('REALISTIC PROPS PASSED: real car details, both orientations, shared trees, source identity, preserved browser textures',flush=True)
