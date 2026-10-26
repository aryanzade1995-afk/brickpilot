"""Replay validated reference solids through the existing SceneBuilder/exporter.
No vision, placement inference, floor-plan search or Python supplied by a client.
Canonical input=(plan X east, plan Y south, Z up) millimetres.
"""
import argparse,json,math,sys
from pathlib import Path
import bpy,bmesh
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from geometry.common import SceneBuilder
from generator import create_scene
from exporters.glb import export_glb
from walkthrough_export import material,world_to_blender
from visualization.config import visualization_options
from visualization.render import configure_render
from visualization.lighting import _world,_light

def run(data,out):
    if data.get('version')!=1 or data['geometry']['status']=='rejected':raise ValueError('Only validated reference geometry is exportable')
    geometry=data['geometry'];parts=geometry['parts']
    if len(parts)>600:raise ValueError('Reference mesh budget exceeded')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    include_base=data['settings']['mode']=='preserve-plan' or data['settings']['operation']=='style-transfer'
    if include_base and not data.get('sourcePath'):
        scene=create_scene(data['base'],{'render':{'quality':data['quality']}})
    else:
        scene=SceneBuilder(geometry['sourcePlanId'])
        if include_base:
            source=Path(data['sourcePath'])
            if not source.is_file() or source.suffix.lower()!='.glb':raise ValueError('Accepted source GLB is unavailable')
            bpy.ops.import_scene.gltf(filepath=str(source))
    options=visualization_options(data['base'],{'render':{'quality':data['quality']}})
    configure_render(options,data['base']['villaDesignDNA']['seed'])
    if data['settings']['operation']=='style-transfer':
        palette=geometry['style'];cache={}
        for obj in list(bpy.context.scene.objects):
            role=obj.get('material_role')
            if obj.type!='MESH' or role not in palette:continue
            look=palette[role]
            if role not in cache:cache[role]=material('Reference_style_'+role,{'color':look['color'],'rough':look['roughness'],'metal':look['metallic'],'opacity':look['opacity']})
            obj.data=obj.data.copy();obj.data.materials.clear();obj.data.materials.append(cache[role])
    parent=bpy.data.objects.new('ReferenceFacade_'+geometry['signature'],None);bpy.context.scene.collection.objects.link(parent)
    parent['reference_signature']=geometry['signature'];parent['source_plan_id']=geometry['sourcePlanId'];parent['reference_image_hash']=data['spec']['source']['imageHash'];parent['mode']=data['settings']['mode']
    owners={};materials={};exported=[]
    for part in parts:
        if any(not isinstance(v,(float,int)) or not math.isfinite(v) for v in part['positionMm']+part['sizeMm']) or min(part['sizeMm'])<=0:raise ValueError('Invalid reference solid')
        owner=part['ownerId']
        if owner not in owners:
            obj=bpy.data.objects.new('Reference_'+owner,None);bpy.context.scene.collection.objects.link(obj);obj.parent=parent;obj['reference_component_id']=owner;owners[owner]=obj
        look=part['material'];key=json.dumps(look,sort_keys=True)
        if key not in materials:
            role='reference_'+str(len(materials));scene.materials[role]=material(role,{'color':look['color'],'rough':look['roughness'],'metal':look['metallic'],'opacity':look['opacity']});materials[key]=role
        x,y,z=part['positionMm'];w,d,h=part['sizeMm']
        obj=scene.box(part['id'],'FACADE',x,y,z-h/2,w,d,h,materials[key],part['id'],bevel=0)
        obj.parent=owners[owner];obj['reference_part_id']=part['id'];obj['reference_component_id']=owner;obj['reference_parent_id']=part['parentId'] or '';obj['reference_semantic']=part['semantic'];obj['reference_confidence']=part['confidence'];obj['reference_evidence']=part['evidence'];obj['reference_image_hash']=part['sourceImage']
        mesh=bmesh.new();mesh.from_mesh(obj.data)
        if any(not edge.is_manifold for edge in mesh.edges):mesh.free();raise ValueError('Non-manifold generated reference mesh')
        mesh.free();exported.append({'id':part['id'],'ownerId':owner,'positionMm':part['positionMm'],'sizeMm':part['sizeMm']})
    for source in data['spec']['volumes']:
        if source['id'] in owners and source['parentId'] in owners:owners[source['id']].parent=owners[source['parentId']]
    _world(options['lighting'])
    frame=geometry['frame'];centre=Vector((frame['origin'][0]*.001,frame['origin'][1]*.001,frame['heightMm']*.0005));span=max(frame['widthMm'],frame['heightMm'])*.001
    _light(scene,'Reference_Daylight','AREA',tuple(centre+Vector((span,-span,span*1.5))),1800,(1,.94,.85),centre).data.shape='DISK'
    camera_data=bpy.data.cameras.new('ReferenceCamera');camera=bpy.data.objects.new('ReferenceCamera',camera_data);bpy.context.scene.collection.objects.link(camera)
    camera.location=world_to_blender(data['camera']['position']);target=Vector(world_to_blender(data['camera']['target']));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
    camera_data.lens=data['camera']['focalLengthMm'];camera_data.sensor_fit='VERTICAL';camera_data.sensor_height=36;camera_data.clip_end=500;bpy.context.scene.camera=camera
    aspect=data['camera']['aspect'];limit=1200 if data['quality']=='preview' else 1800
    bpy.context.scene.render.resolution_x=max(64,round(limit*min(1,aspect)));bpy.context.scene.render.resolution_y=max(64,round(limit*min(1,1/aspect)));bpy.context.scene.render.resolution_percentage=100
    bpy.context.scene.world.color=(.8,.8,.8)
    blend=out/'facade.blend';glb=out/'facade.glb'
    bpy.context.scene['reference_signature']=geometry['signature'];bpy.context.scene['reference_scope']='plan-preserving facade' if include_base else 'reference-led exterior study; room planning unresolved'
    bpy.ops.wm.save_as_mainfile(filepath=str(blend));export_glb(glb)
    bpy.context.scene.render.filepath=str(out/'facade.png');bpy.ops.render.render(write_still=True)
    count=sum(1 for o in bpy.context.scene.objects if o.type=='MESH')
    (out/'facade.json').write_text(json.dumps({'version':1,'identity':data['identity'],'signature':geometry['signature'],'sourcePlanId':geometry['sourcePlanId'],'sourceAccepted':bool(data.get('sourcePath')),'scope':'building-plus-reference' if include_base else 'reference-led-study','meshCount':count,'referenceMeshCount':len(exported),'parts':exported,'qualifications':geometry['qualifications'],'issues':geometry['issues']}),encoding='utf8')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--input',required=True);parser.add_argument('--out',required=True);args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);out=Path(args.out);out.mkdir(parents=True,exist_ok=True);run(json.loads(Path(args.input).read_text(encoding='utf8')),out)
