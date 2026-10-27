"""Extract curated objects from user-supplied blends; never execute blend scripts.
Blender -b --disable-autoexec --python this.py -- --source-root DIR --downloads-root DIR
Original files are read only. GLBs: Y-up metres, floor Y=0, centred X/Z,
front +Z; bounded detail and embedded <=1K PBR maps. No source architecture.
"""
import argparse, hashlib, json, math, sys
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
args = argparse.ArgumentParser()
args.add_argument('--source-root', required=True)
args.add_argument('--downloads-root', required=True)
args.add_argument('--only', default='')
opts = args.parse_args(sys.argv[sys.argv.index('--')+1:])
recipes = json.loads((ROOT/'scripts/user-furniture-recipes.json').read_text())
records = []
for recipe in recipes:
    if opts.only and recipe['id'] not in opts.only.split(','):
        continue
    source = Path(opts.downloads_root if recipe['source'].startswith('Grey Roadside') else opts.source_root)/recipe['source']
    bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False, use_scripts=False)
    # Realise the existing visible form at modest subdivision, not render-time
    # subdivision/fluid/particle simulations from a complete source room.
    for obj in bpy.data.objects:
        for modifier in obj.modifiers:
            if modifier.type == 'SUBSURF':
                modifier.levels = min(modifier.levels, 1)
                modifier.render_levels = modifier.levels
    def selected(obj):
        names = [c.name for c in obj.users_collection]
        included = obj.name in recipe.get('names',[]) or any(obj.name.startswith(p) for p in recipe.get('namePrefixes',[])) or any(p in obj.name for p in recipe.get('nameContains',[])) or any(c in recipe.get('collections',[]) for c in names) or any(c.startswith(p) for c in names for p in recipe.get('collectionPrefixes',[]))
        excluded = obj.name in recipe.get('exclude',[]) or any(obj.name.startswith(p) for p in recipe.get('excludePrefixes',[]))
        return obj.type == 'MESH' and included and not excluded and len(obj.data.polygons)>0
    originals = [o for o in bpy.data.objects if selected(o)]
    if not originals:
        raise ValueError('No selected source geometry: '+recipe['id'])
    rotation = math.radians(recipe.get('rotation',0))
    if recipe.get('rotationObject'):
        rotation = -bpy.data.objects[recipe['rotationObject']].matrix_world.to_euler().z
    if recipe.get('alignObject'):
        rotation = -bpy.data.objects[recipe['alignObject']].matrix_world.to_euler().z
    turn = Matrix.Rotation(rotation,4,'Z')
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    copies=[]
    for original in originals:
        evaluated = original.evaluated_get(deps)
        data = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=True, depsgraph=deps)
        data.transform(turn @ original.matrix_world)
        copy = bpy.data.objects.new(original.name+'_Browser',data)
        copies.append(copy)
    source_names=[o.name for o in originals]
    # Keep source materials/images; drop the room, cameras, lights and scripts.
    for obj in list(bpy.data.objects):
        if obj not in copies:
            bpy.data.objects.remove(obj,do_unlink=True)
    for obj in copies:
        bpy.context.scene.collection.objects.link(obj)
    verts=[v.co for o in copies for v in o.data.vertices]
    lo=Vector([min(v[i] for v in verts) for i in range(3)])
    hi=Vector([max(v[i] for v in verts) for i in range(3)])
    scale=1/max(hi-lo)
    offset=Vector((-(lo.x+hi.x)/2,-(lo.y+hi.y)/2,-lo.z))
    for obj in copies:
        for v in obj.data.vertices:
            v.co=(v.co+offset)*scale
        obj.data.update()
    total=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in copies)
    for obj in copies:
        bpy.context.view_layer.objects.active=obj
        if total>17500:
            mod=obj.modifiers.new('Browser triangle budget','DECIMATE')
            mod.ratio=17500/total
            bpy.ops.object.modifier_apply(modifier=mod.name)
        bm=bmesh.new();bm.from_mesh(obj.data)
        loose=[v for v in bm.verts if not v.link_faces]
        if loose:bmesh.ops.delete(bm,geom=loose,context='VERTS')
        bm.to_mesh(obj.data);bm.free();obj.data.update()
        obj['asset_id']=recipe['id']
        obj['source_file']=recipe['source']
        obj['asset_license']='User-supplied; redistribution rights unverified'
    # Bound texture upload sizes and retain original UVs/normal/roughness maps.
    used_materials={m for o in copies for m in o.data.materials if m}
    for mat in used_materials:
        mat.use_nodes=True
        bsdf=next((n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
        if not bsdf:
            bsdf=mat.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
            bsdf.inputs['Base Color'].default_value=mat.diffuse_color
            bsdf.inputs['Roughness'].default_value=.48
            output=next((n for n in mat.node_tree.nodes if n.type=='OUTPUT_MATERIAL'),None) or mat.node_tree.nodes.new('ShaderNodeOutputMaterial')
            mat.node_tree.links.new(bsdf.outputs['BSDF'],output.inputs['Surface'])
        name=mat.name.lower()
        metal=bsdf.inputs['Metallic'].default_value>.5 or any(t in name for t in ['chrome','metal','steel','alumin'])
        role=recipe.get('role','original')
        if metal:role='original'
        if role=='upholstery' and any(t in name for t in ['wood','leg','metal','plastic','frame']):role='original'
        if role=='ceramic' and any(t in name for t in ['chrome','water','tap','drain','black','rubber']):role='original'
        mat['formsteadFinishRole']=role
        # These older source shaders export as white in glTF. Use explicit
        # browser PBR approximations for the existing steel/glass cooker parts.
        if recipe['id']=='user-kitchen-hob':
            for link in list(bsdf.inputs['Base Color'].links):mat.node_tree.links.remove(link)
            steel='01' in name
            bsdf.inputs['Base Color'].default_value=(.35,.38,.4,1) if steel else (.012,.015,.018,1)
            bsdf.inputs['Metallic'].default_value=.85 if steel else .35
            bsdf.inputs['Roughness'].default_value=.26 if steel else .2
        if role=='upholstery' and not bsdf.inputs['Base Color'].is_linked and min(bsdf.inputs['Base Color'].default_value[:3])>.65:
            bsdf.inputs['Base Color'].default_value=(.10,.24,.25,1)
        if recipe['id'].startswith('user-library') and not bsdf.inputs['Base Color'].is_linked:
            bsdf.inputs['Base Color'].default_value=(.32,.22,.13,1)
            bsdf.inputs['Roughness'].default_value=.42
        for node in mat.node_tree.nodes:
            if node.type=='TEX_IMAGE' and node.image and node.image.size[0]>0:
                image=node.image
                w,h=image.size
                if max(w,h)>1024:
                    ratio=1024/max(w,h);image.scale(max(1,round(w*ratio)),max(1,round(h*ratio)))
    # Merge source pieces per material in glTF; repeated furniture shares buffers
    # in the existing browser asset cache. No Draco decoder dependency.
    bpy.ops.object.select_all(action='DESELECT')
    for obj in copies:obj.select_set(True)
    bpy.context.view_layer.objects.active=copies[0]
    bpy.ops.object.join()
    asset=bpy.context.object
    asset.name=recipe['id']
    verts=[v.co for v in asset.data.vertices]
    lo=Vector([min(v[i] for v in verts) for i in range(3)])
    hi=Vector([max(v[i] for v in verts) for i in range(3)])
    offset=Vector((-(lo.x+hi.x)/2,-(lo.y+hi.y)/2,-lo.z))
    for v in asset.data.vertices:v.co+=offset
    asset.data.update()
    size=hi-lo
    dest=ROOT/'public/interior-assets'/recipe['id'];dest.mkdir(parents=True,exist_ok=True)
    glb=dest/'model.glb'
    bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,export_yup=True,export_extras=True,export_animations=False,export_cameras=False,export_lights=False,export_image_format='AUTO')
    triangles=sum(len(p.vertices)-2 for p in asset.data.polygons)
    notice=f"{recipe['label']}\nUser-supplied asset\nSource: user-supplied {recipe['source']}\nAuthor and redistribution licence not supplied/verified. No open licence is asserted.\nPrepared for this local project at the user's request. Confirm rights before publishing these assets.\nAdaptations: individual-object extraction, triangle/texture budgets, PBR materials, Y-up metre normalization and selected-finish binding.\n"
    (dest/'LICENSE.txt').write_text(notice,encoding='utf-8')
    record=dict(id=recipe['id'],label=recipe['label'],sourceUrl=f"/interior-assets/{recipe['id']}/LICENSE.txt",sourcePage=f"/interior-assets/{recipe['id']}/LICENSE.txt",license='User-supplied · rights unverified',licenseUrl=f"/interior-assets/{recipe['id']}/LICENSE.txt",verifiedAt='',preparedAt='2026-10-27',author='User-supplied asset',url=f"/interior-assets/{recipe['id']}/model.glb",thumbnail=f"/interior-assets/{recipe['id']}/preview.png",notice=f"/interior-assets/{recipe['id']}/LICENSE.txt",sizeM=[round(size.x,7),round(size.z,7),round(size.y,7)],triangles=triangles,bytes=glb.stat().st_size,sha256=hashlib.sha256(glb.read_bytes()).hexdigest(),version=1,provenance='user-supplied',sourceFile=recipe['source'],sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),sourceObjects=source_names)
    records.append(record)
    # Photograph the actual optimized model, not the source scene or fake art.
    scene=bpy.context.scene
    scene.use_nodes=False
    scene.world=bpy.data.worlds.new('Furniture studio');scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.65,.65,.65,1)
    bpy.ops.object.camera_add(location=(1.25,-1.7,1.05))
    camera=bpy.context.object;target=Vector((0,0,size.z*.46))
    camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.type='ORTHO';camera.data.ortho_scale=1.5;scene.camera=camera
    for loc,energy in [((1,-2,3),250),((-2,-1,2),150)]:
        bpy.ops.object.light_add(type='AREA',location=loc)
        light=bpy.context.object;light.data.energy=energy;light.data.size=3
        light.rotation_euler=(-light.location).to_track_quat('-Z','Y').to_euler()
    scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=8;scene.cycles.use_denoising=True
    scene.render.resolution_x=400;scene.render.resolution_y=300;scene.render.resolution_percentage=100
    scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG'
    scene.render.image_settings.color_mode='RGBA'
    scene.render.filepath=str(dest/'preview.png')
    bpy.ops.render.render(write_still=True)
    print('PREPARED',recipe['id'],triangles,glb.stat().st_size,flush=True)

# Update only this imported pack; retain every existing catalogue record.
for file in [ROOT/'src/lib/interior-assets/catalogue.json',ROOT/'public/interior-assets/manifest.json']:
    catalogue=json.loads(file.read_text(encoding='utf-8'))
    catalogue['assets']=[a for a in catalogue['assets'] if a['id'] not in {r['id'] for r in records}]+records
    catalogue['updatedAt']='2026-10-27'
    file.write_text(json.dumps(catalogue,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
print('USER_PACK_COMPLETE',len(records),flush=True)
