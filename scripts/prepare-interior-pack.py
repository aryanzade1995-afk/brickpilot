"""Offline conversion of licensed source meshes, not replacement architecture.
Run with Blender. Output is metre-based, Y-up GLB with floor at Y=0,
centred X/Z, and front +Z. Each asset keeps its author and licence notice.
"""
import bpy,json,math,re,shutil,hashlib,os
from pathlib import Path
from mathutils import Vector,Matrix
root=Path(__file__).resolve().parents[1];out=root/'public/interior-assets';out.mkdir(exist_ok=True)
downloads=json.loads((root/'output/furniture-sources/downloads.json').read_text())
only=set(filter(None,os.environ.get('FORMSTEAD_ASSETS','').split(',')))
records=json.loads((out/'manifest.json').read_text())['assets'] if only else []
for d in downloads:
 if only and d['id'] not in only:continue
 bpy.ops.wm.read_factory_settings(use_empty=True)
 folder=root/d['dir'];dest=out/d['id'];dest.mkdir(exist_ok=True)
 if d['id'] in ['toilet-wall','exhaust']:
  # Both source files explicitly offer CC BY 3.0 as a licence choice.
  header=next(folder.glob('*.obj')).read_text(errors='replace')[:1000]
  if 'at your choice' not in header:raise ValueError('Unverified licence '+d['id'])
  d={**d,'author':'Ola-Kristian HOFF'+('; volume adaptation by Emmanuel Puybaret / eTeks' if d['id']=='exhaust' else ''),'license':'CC-BY-3.0','licenseUrl':'https://creativecommons.org/licenses/by/3.0/'}
 if d.get('format')=='gltf':bpy.ops.import_scene.gltf(filepath=str(next(folder.glob('*.gltf'))))
 else:
  preferred=folder/(Path(d['sourceUrl']).stem+'.obj')
  bpy.ops.wm.obj_import(filepath=str(preferred if preferred.exists() else next(folder.glob('*.obj'))),forward_axis='NEGATIVE_Z',up_axis='Y')
 meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
 if d['id'] in ['kitchen-sink','kitchen-base','kitchen-drawers','kitchen-hob']:
  # Exclude the supplied cabinet; retain the selected Formstead kitchen.
  import bmesh
  for o in meshes:
   bm=bmesh.new();bm.from_mesh(o.data)
   def keep(f):
    name=o.data.materials[f.material_index].name.lower()
    if d['id']=='kitchen-sink':return any(s in name for s in ['aluminum','chrome','hole'])
    if d['id'] in ['kitchen-base','kitchen-drawers']:return name in ['cupboard-units','metal-handles']
    # Extract only the original cooktop/grates/burners, never the freestanding oven.
    return name in ['cooker-iron','burners','burners-top']
   remove=[f for f in bm.faces if not keep(f)]
   bmesh.ops.delete(bm,geom=remove,context='FACES');bm.to_mesh(o.data);bm.free();o.data.update()
  for o in list(meshes):
   if not o.data.polygons:bpy.data.objects.remove(o,do_unlink=True);meshes.remove(o)
  bpy.context.view_layer.update()
 if not meshes:raise ValueError(d['id'])
 # Explicit source import axes; retain proportion, fit later into source placement.
 points=[o.matrix_world@Vector(c) for o in meshes for c in o.bound_box]
 lo=Vector([min(p[i] for p in points) for i in range(3)]);hi=Vector([max(p[i] for p in points) for i in range(3)])
 size=hi-lo
 if min(size)<=0:raise ValueError('Degenerate '+d['id'])
 # Legacy OBJ catalogues have arbitrary units; scale longest axis to one metre.
 scale=1/max(size);shift=Vector((-(lo.x+hi.x)/2,-(lo.y+hi.y)/2,-lo.z))
 total_tris=sum(sum(max(0,len(p.vertices)-2) for p in o.data.polygons) for o in meshes)
 for o in meshes:
  matrix=o.matrix_world.copy();o.data.transform(matrix);o.parent=None;o.matrix_world=Matrix.Identity(4)
  for v in o.data.vertices:v.co=(v.co+shift)*scale
  bpy.context.view_layer.objects.active=o
  tris=sum(max(0,len(p.vertices)-2) for p in o.data.polygons)
  if total_tris>18000:
   m=o.modifiers.new('Browser detail budget','DECIMATE');m.ratio=18000/total_tris;bpy.ops.object.modifier_apply(modifier=m.name)
  o['asset_id']=d['id'];o['asset_source']=d['sourcePage'];o['asset_license']=d['license']
  # Retain imported normal maps and UVs. Improve legacy MTL highlights for PBR.
  for mat in o.data.materials:
   if not mat:continue
   mat.use_nodes=True;n=mat.node_tree.nodes.get('Principled BSDF');name=mat.name.lower()
   if d.get('format')!='gltf':
    metal=any(s in name for s in ['chrome','metal','aluminum','steel','silver'])
    ceramic=d['id'] in ['toilet','toilet-modern','toilet-wall','basin','bathtub'] and not metal
    soft=d['id'] in ['sofa','bed','armchair'] and not any(s in name for s in ['frame','metal','leg','wood'])
    n.inputs['Metallic'].default_value=.85 if metal else 0
    n.inputs['Roughness'].default_value=.22 if metal else .19 if ceramic else .82 if soft else .43
    if soft:n.inputs['Sheen Weight'].default_value=.3
   role='paint' if d['id'] in ['fan','exhaust'] or d['id'] in ['kitchen-base','kitchen-drawers','kitchen-upper'] and 'cupboard' in name else 'ceramic' if d['id'] in ['toilet','toilet-modern','toilet-wall','basin','bathtub'] and not any(s in name for s in ['chrome','metal','hole','water']) else 'upholstery' if d['id']=='sofa' and 'cushion' in name else 'original'
   mat['formsteadFinishRole']=role
 # No source cameras/lights are exported. Remove empty import roots to avoid inherited axes.
 for o in meshes:o.parent=None
 import bmesh
 for o in meshes:
  bm=bmesh.new();bm.from_mesh(o.data)
  loose=[v for v in bm.verts if not v.link_faces]
  if loose:bmesh.ops.delete(bm,geom=loose,context='VERTS')
  bm.to_mesh(o.data);bm.free();o.data.update()
 # Decimation can move extrema. Centre the final vertices, not stale pre-modifier
 # bound boxes, so browser and Blender share an exact floor/centre anchor.
 vertices=[v.co.copy() for o in meshes for v in o.data.vertices]
 low=Vector([min(v[i] for v in vertices) for i in range(3)]);high=Vector([max(v[i] for v in vertices) for i in range(3)])
 offset=Vector((-(low.x+high.x)/2,-(low.y+high.y)/2,-low.z))
 for o in meshes:
  for v in o.data.vertices:v.co+=offset
  o.data.update()
 final_size=high-low
 bpy.ops.object.select_all(action='DESELECT')
 for o in meshes:o.select_set(True)
 glb=dest/'model.glb'
 bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,export_extras=True,export_yup=True,export_animations=False,export_cameras=False,export_lights=False)
 sz=list(final_size)
 notice=''
 for f in list(folder.glob('*.txt'))+list(folder.glob('*.html')):
  if 'license' in f.name.lower():notice+=f.read_text(errors='replace')+'\n'
 if d.get('author'):author=d['author']
 else:
  m=re.search(r'Thank you for downloading .+? by (.+)',notice)
  author=m.group(1).strip() if m else 'Derte21' if d['id']=='sofa' else 'starapple' if d['id']=='toilet-modern' else ''
 if not author:raise ValueError('Missing author '+d['id'])
 if d['id']=='bed':author+='; sheets adaptation by Emmanuel Puybaret / eTeks'
 notice=f"{d['label']} — {author}\nSource: {d['sourcePage']}\nDownload: {d['sourceUrl']}\nLicence: {d['license']} {d['licenseUrl']}\nAdaptations: axis/unit normalization, mesh optimization and PBR conversion; colours may follow Formstead selections.\n\n"+notice
 (dest/'LICENSE.txt').write_text(notice,encoding='utf8')
 triangles=sum(sum(max(0,len(p.vertices)-2) for p in o.data.polygons) for o in meshes)
 record={k:v for k,v in d.items() if k not in ['dir','format']};record.update(author=author,url=f"/interior-assets/{d['id']}/model.glb",thumbnail=f"/interior-assets/{d['id']}/preview.png",notice=f"/interior-assets/{d['id']}/LICENSE.txt",sizeM=[round(sz[0],7),round(sz[2],7),round(sz[1],7)],triangles=triangles,bytes=glb.stat().st_size,sha256=hashlib.sha256(glb.read_bytes()).hexdigest(),version=1)
 records=[a for a in records if a['id']!=record['id']];records.append(record)
 # Actual mesh thumbnail, never a fake supplier photograph.
 floor=bpy.data.materials.new('studio');floor.diffuse_color=(.82,.80,.75,1)
 bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.008));bpy.context.object.data.materials.append(floor)
 bpy.ops.object.camera_add(location=(1.5,-1.8,1.25));cam=bpy.context.object;target=Vector((0,0,sz[2]*.45));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=1.65;bpy.context.scene.camera=cam
 for loc,power,size in [((1,-2,3),350,4),((-2,-1,2),220,3),((0,2,3),300,3)]:
  bpy.ops.object.light_add(type='AREA',location=loc);l=bpy.context.object;l.data.energy=power;l.data.shape='DISK';l.data.size=size;l.rotation_euler=(-l.location).to_track_quat('-Z','Y').to_euler()
 sc=bpy.context.scene;sc.world=bpy.data.worlds.new('Studio');sc.world.color=(.45,.45,.45);sc.render.engine='CYCLES';sc.cycles.samples=16;sc.cycles.use_denoising=True;sc.render.resolution_x=480;sc.render.resolution_y=360;sc.render.resolution_percentage=100;sc.render.filepath=str(dest/'preview.png');bpy.ops.render.render(write_still=True)
 print('PREPARED',d['id'],triangles,glb.stat().st_size,flush=True)
(out/'manifest.json').write_text(json.dumps({'version':1,'verifiedAt':'2026-10-24','assets':records},indent=2),encoding='utf8')
(root/'src/lib/interior-assets/catalogue.json').write_text(json.dumps({'version':1,'verifiedAt':'2026-10-24','assets':records},indent=2),encoding='utf8')
credits=['Formstead interior model library','Generic visual references, not manufacturer replicas.','Adaptations: optimization, axis/unit normalization, PBR conversion, scale and selected-colour variants.','']
for a in records:credits += [a['label']+' — '+a['author'],a['license']+' '+a['licenseUrl'],a['sourceUrl'],'Licence notice: '+a['notice'],'']
(out/'ATTRIBUTION.txt').write_text('\n'.join(credits),encoding='utf8')
print('PACK_COMPLETE',flush=True)
