"""Cycles lighting sidecar for the exact accepted GLB. No architecture search.

Receiver triangles keep their world positions. Non-overlapping UVs are exported
explicitly with those positions; browser matching never relies on glTF indices.
Neutral diffuse transport is separate from selected albedo. Direct sun remains
dynamic; the atlas combines INDIRECT diffuse with direct diffuse sky visibility.
Direct sun and fixture light remain dynamic. AO is delivered separately.
"""
import bpy,json,math,sys,struct,hashlib,time,argparse,re
import numpy as np
from pathlib import Path
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from walkthrough_export import root,add_interior_models,add_parts,add_finish_skins
from walkthrough_denoise import denoise_atlases

def world(p):return [float(p.x),float(p.z),float(-p.y)]
def prepare_device(scene):
    try:
        prefs=bpy.context.preferences.addons['cycles'].preferences
        for backend in ['OPTIX','CUDA']:
            try:
                prefs.compute_device_type=backend;prefs.get_devices()
                gpu=[d for d in prefs.devices if d.type!='CPU']
                if gpu:
                    for d in prefs.devices:d.use=d.type!='CPU'
                    scene.cycles.device='GPU';return backend+': '+', '.join(d.name for d in gpu)
            except Exception:pass
    except Exception:pass
    scene.cycles.device='CPU';return 'CPU'

def add_visible_sky(scene,indirect,objects,neutral,resolution):
    """Environment direct diffuse is not in Cycles' INDIRECT pass. Bake it
    separately with all lamps/emitters off, then add linear radiance. Otherwise
    suppressing Three's unoccluded ambient leaves window-lit rooms too dark.
    Keep the dynamic direct sun/local lights out to avoid double lighting.
    """
    lights=[(o,o.hide_render) for o in scene.objects if o.type=='LIGHT']
    emissions=[]
    for mat in bpy.data.materials:
        if not mat.use_nodes:continue
        for node in mat.node_tree.nodes:
            socket=node.inputs.get('Emission Strength') if node.type=='BSDF_PRINCIPLED' else node.inputs.get('Strength') if node.type=='EMISSION' else None
            if socket is not None:
                links=[link.from_socket for link in socket.links]
                emissions.append((mat.node_tree,socket,socket.default_value,links))
                for link in list(socket.links):mat.node_tree.links.remove(link)
                socket.default_value=0
    sky=bpy.data.images.new('Visible sky diffuse',width=resolution,height=resolution,float_buffer=True,alpha=False)
    sky.colorspace_settings.name='Non-Color'
    nodes=[]
    try:
        for light,_ in lights:light.hide_render=True
        for obj in objects:
            mat=obj.data.materials[0]
            node=mat.node_tree.nodes.new('ShaderNodeTexImage');node.image=sky;mat.node_tree.nodes.active=node;nodes.append((mat,node))
        bpy.ops.object.bake(type='DIFFUSE',pass_filter={'DIRECT'},margin=8,use_clear=True)
        bounce=np.empty(len(indirect.pixels),dtype=np.float32);visible=np.empty(len(sky.pixels),dtype=np.float32)
        indirect.pixels.foreach_get(bounce);sky.pixels.foreach_get(visible)
        bounce.reshape((-1,4))[:,:3]+=visible.reshape((-1,4))[:,:3]
        indirect.pixels.foreach_set(bounce);indirect.update()
    finally:
        for light,hidden in lights:light.hide_render=hidden
        for tree,socket,value,links in emissions:
            socket.default_value=value
            for origin in links:tree.links.new(origin,socket)
        for mat,node in nodes:mat.node_tree.nodes.remove(node)
        bpy.data.images.remove(sky)

def run(data,out):
    started=time.time();bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=data['sourcePath'])
    accepted=[o for o in bpy.context.scene.objects if o.type=='MESH']
    dynamic=set(data['dynamicNames'])
    receivers=[]
    neutral=bpy.data.materials.new('Neutral transport reference');neutral.use_nodes=True
    bsdf=neutral.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Base Color'].default_value=(.65,.65,.65,1);bsdf.inputs['Roughness'].default_value=.65
    transparent=bpy.data.materials.new('Daylight aperture');transparent.use_nodes=True
    nodes=transparent.node_tree.nodes;nodes.clear();t=nodes.new('ShaderNodeBsdfTransparent');o=nodes.new('ShaderNodeOutputMaterial');transparent.node_tree.links.new(t.outputs[0],o.inputs['Surface'])
    for obj in accepted:
        if obj.name in dynamic or re.match(r'Interior_.+_WarmCeiling_Diffuser$',obj.name):
            obj.hide_render=True;continue
        role=obj.get('material_role','')
        if role in ['glass','water']:
            obj.data.materials.clear();obj.data.materials.append(transparent);continue
        # Original exterior dressing remains an occluder, never an invented room.
        if re.match(r'(?:(?:GF|FF|SF|TF|F\d+|L\d+)_(?:Wall_|(?:Roof_)?Slab_|Terrace_Deck_)|Beam_|Column_|Stair_)',obj.name):
            if len(obj.data.polygons):receivers.append(obj)
        obj.data.materials.clear();obj.data.materials.append(neutral)
    if not receivers:raise ValueError('No supported architectural receivers')
    # Canonical furnishings are only occluders/emitters in this bake. Movable
    # doors are absent so opening a door never exposes a frozen leaf shadow.
    furnishing=root(data['planId'],'walkthrough-bake-occluders')
    app=data['appearance'];replaced=add_interior_models(app.get('models',[]),furnishing)
    add_parts([p for p in app['furniture'] if p['id'] not in replaced],furnishing,app['bindings'],'furnishing')
    add_finish_skins(app,furnishing)
    scene=bpy.context.scene;scene.render.engine='CYCLES';device=prepare_device(scene)
    print('@@bake device '+device,flush=True)
    scene.cycles.samples=data['samples'];scene.cycles.use_denoising=True;scene.cycles.max_bounces=6;scene.cycles.diffuse_bounces=4
    scene.world=bpy.data.worlds.new('Illustrative daylight');scene.world.use_nodes=True
    wn=scene.world.node_tree.nodes;sky=wn.new('ShaderNodeTexSky');sky.sky_type='NISHITA';sky.sun_elevation=math.radians(35);sky.sun_rotation=math.radians(135);sky.sun_disc=False
    scene.world.node_tree.links.new(sky.outputs['Color'],wn.get('Background').inputs['Color']);wn.get('Background').inputs['Strength'].default_value=.35
    bpy.ops.object.light_add(type='SUN',location=(0,0,20));sun=bpy.context.object;sun.rotation_euler=(math.radians(35),math.radians(-25),math.radians(-35));sun.data.energy=2;sun.data.angle=math.radians(8)
    floor_groups={}
    for obj in receivers:
        label=re.match(r'(GF|FF|SF|TF|F\d+|L\d+)_',obj.name)
        label=label.group(1) if label else 'structure'
        floor_groups.setdefault(label,[]).append(obj)
    manifest={'version':1,'planId':data['planId'],'identity':data['identity'],'sourceSha256':data['sourceSha256'],'layoutSignature':data['layoutSignature'],
      'preset':'daylight','transport':'neutral-indirect-diffuse','directLightBaked':False,'skyDirectBaked':True,'albedoBaked':False,'uvChannel':2,
      'qualifications':['Illustrative daylight, not a geographic sun study.','Neutral receiver reflectance separates lighting from selected paint; strong colour bleeding is approximated.','Movable doors are excluded from static occlusion.','Furniture uses dynamic local/IBL lighting; architectural receivers use baked indirect light.'],
      'device':device,'samples':data['samples'],'resolution':data['resolution'],'paddingPixels':8,'atlases':[],'meshes':[]}
    binary=bytearray()
    for group,objects in sorted(floor_groups.items()):
        print('@@bake '+group+' UV preparation',flush=True)
        bpy.ops.object.select_all(action='DESELECT')
        source_records=[]
        # Bake one atlas receiver per floor instead of restarting Cycles for
        # every small wall segment. Face attributes retain each original ID.
        for index,obj in enumerate(objects):
            source_records.append({'name':obj.name,'sourceId':obj.get('source_id')})
            attr=obj.data.attributes.get('formstead_receiver') or obj.data.attributes.new('formstead_receiver','INT','FACE')
            for value in attr.data:value.value=index
            obj.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]
        if len(objects)>1:bpy.ops.object.join()
        receiver=bpy.context.object;objects=[receiver]
        for obj in objects:
            obj.select_set(True)
            layer=obj.data.uv_layers.get('Formstead_Lightmap') or obj.data.uv_layers.new(name='Formstead_Lightmap')
            obj.data.uv_layers.active=layer;layer.active_render=True
        bpy.context.view_layer.objects.active=objects[0]
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=8/data['resolution'],correct_aspect=True,scale_to_bounds=False)
        bpy.ops.uv.pack_islands(rotate=True,margin=8/data['resolution'])
        bpy.ops.object.mode_set(mode='OBJECT')
        index=len(manifest['atlases']);record={'id':group,'irradiance':f'indirect-{index}.hdr','ao':f'ao-{index}.png','width':data['resolution'],'height':data['resolution']}
        for kind in ['indirect','ao']:
            image=bpy.data.images.new(f'{group}_{kind}',width=data['resolution'],height=data['resolution'],float_buffer=True,alpha=False)
            image.colorspace_settings.name='Non-Color'
            for obj in objects:
                # Separate material per receiver group provides an unambiguous
                # active target without changing the selected runtime materials.
                mat=neutral.copy();obj.data.materials.clear();obj.data.materials.append(mat)
                node=mat.node_tree.nodes.new('ShaderNodeTexImage');node.image=image;mat.node_tree.nodes.active=node
            print('@@bake '+group+' '+kind,flush=True)
            if kind=='indirect':
                bpy.ops.object.bake(type='DIFFUSE',pass_filter={'INDIRECT'},margin=8,use_clear=True)
                print('@@bake '+group+' visible sky diffuse',flush=True)
                add_visible_sky(scene,image,objects,neutral,data['resolution'])
            else:bpy.ops.object.bake(type='AO',margin=8,use_clear=True)
            image.filepath_raw=str(out/record['irradiance' if kind=='indirect' else 'ao']);image.file_format='HDR' if kind=='indirect' else 'PNG'
            image.save();bpy.data.images.remove(image)
        manifest['atlases'].append(record)
        for obj in objects:
            mesh=obj.data;mesh.calc_loop_triangles();uv=mesh.uv_layers['Formstead_Lightmap'].data;attribute=mesh.attributes['formstead_receiver'].data
            for source_index,source in enumerate(source_records):
              offset=len(binary);count=0
              for tri in mesh.loop_triangles:
                if attribute[tri.polygon_index].value!=source_index:continue
                for loop_index in tri.loops:
                    p=obj.matrix_world@mesh.vertices[mesh.loops[loop_index].vertex_index].co
                    binary.extend(struct.pack('<5f',*world(p),*uv[loop_index].uv));count+=1
              if count:manifest['meshes'].append({**source,'atlas':index,'offset':offset,'count':count})
    (out/'layout.bin').write_bytes(binary);manifest['layoutBytes']=len(binary)
    print('@@bake denoising linear irradiance',flush=True)
    denoise_atlases(out,manifest['atlases']);manifest['denoising']='OpenImageDenoise compositor, HDR, accurate prefilter';manifest['seconds']=round(time.time()-started,2)
    files=['layout.bin']+[a[k] for a in manifest['atlases'] for k in ['irradiance','ao']]
    manifest['files']=[{'name':f,'bytes':(out/f).stat().st_size,'sha256':hashlib.sha256((out/f).read_bytes()).hexdigest()} for f in files]
    (out/'manifest.json').write_text(json.dumps(manifest),encoding='utf8')
    print('@@bake complete',manifest['seconds'],device,flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--input',required=True);parser.add_argument('--out',required=True)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);out=Path(args.out);out.mkdir(parents=True,exist_ok=True)
    run(json.loads(Path(args.input).read_text(encoding='utf8')),out)
