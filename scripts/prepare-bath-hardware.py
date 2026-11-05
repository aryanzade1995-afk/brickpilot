"""Build optimized, selected-product visual approximations with Blender.
Compact basin mixers and shower assemblies are original geometry. All coordinates are metres, +Z up, -Y faces the room.
"""
import bpy, math, json, hashlib
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'public/bath-hardware';OUT.mkdir(parents=True,exist_ok=True)
records=[]
def material(name,color,metal=0,rough=.3):
 m=bpy.data.materials.new(name);m.use_nodes=True;n=m.node_tree.nodes.get('Principled BSDF')
 n.inputs['Base Color'].default_value=(*color,1);n.inputs['Metallic'].default_value=metal;n.inputs['Roughness'].default_value=rough
 return m
chrome=material('Selected fitting metal',(.72,.76,.8),1,.19)
rubber=material('Silicone nozzles',(.065,.075,.08),0,.65)
black=material('Aerator recess',(.015,.018,.02),0,.4)
red=material('Hot index',(.55,.025,.015),0,.3);blue=material('Cold index',(.02,.12,.55),0,.3)
def smooth(o,mat):
 o.data.materials.clear();o.data.materials.append(mat)
 if o.type=='MESH':
  for p in o.data.polygons:p.use_smooth=True
 return o
def cylinder(name,at,r,depth,mat=chrome,axis=(0,0,1),segments=32):
 bpy.ops.mesh.primitive_cylinder_add(vertices=segments,radius=r,depth=depth,location=at)
 o=bpy.context.object;o.name=name;o.rotation_euler=Vector(axis).to_track_quat('Z','Y').to_euler();smooth(o,mat)
 if segments>8:
  bevel=o.modifiers.new('Machined edge','BEVEL');bevel.width=min(.0015,r*.12);bevel.segments=2
 return o
def tube(name,points,r,mat=chrome):
 c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.resolution_u=12;c.bevel_depth=r;c.bevel_resolution=3
 s=c.splines.new('BEZIER');s.bezier_points.add(len(points)-1)
 for p,co in zip(s.bezier_points,points):p.co=co;p.handle_left_type=p.handle_right_type='AUTO'
 o=bpy.data.objects.new(name,c);bpy.context.collection.objects.link(o);c.materials.append(mat)
 return o
def finish(id,label,source,author):
 bpy.context.preferences.filepaths.save_version=0
 bpy.context.view_layer.update()
 objects=list(bpy.context.scene.objects)
 for o in objects:
  bpy.context.view_layer.objects.active=o;o.select_set(True)
  if o.type in {'CURVE','MESH'}:bpy.ops.object.convert(target='MESH');bpy.ops.object.modifier_apply(modifier='Machined edge') if 'Machined edge' in o.modifiers else None
  o.select_set(False)
 # Join by material to keep nozzles/rings from becoming hundreds of draw calls.
 groups={}
 for o in list(bpy.context.scene.objects):groups.setdefault(o.data.materials[0].name,[]).append(o)
 for group in groups.values():
  bpy.ops.object.select_all(action='DESELECT')
  for o in group:o.select_set(True)
  bpy.context.view_layer.objects.active=group[0];bpy.ops.object.join()
 for o in bpy.context.scene.objects:
  bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True);o.select_set(False)
 points=[o.matrix_world@Vector(p) for o in bpy.context.scene.objects for p in o.bound_box]
 # Retain the attachment origin; pad metadata around it for correct bounds.
 size=[max(p[i] for p in points)-min(p[i] for p in points) for i in (0,2,1)]
 bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(OUT/(id+'.blend')))
 path=OUT/(id+'.glb');bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB')
 tris=sum(len(o.data.loop_triangles) for o in bpy.context.scene.objects)
 records.append(dict(id=id,label=label,sourceUrl=source,sourcePage=source,license='CC0-1.0',licenseUrl='https://creativecommons.org/publicdomain/zero/1.0/',verifiedAt='2026-11-03',author=author,url='/bath-hardware/'+id+'.glb',thumbnail='/specs/products/svc-shower-1.jpeg' if 'shower' in id else '/specs/products/svc-faucet-1.jpeg',notice='/bath-hardware/LICENSE.txt',sizeM=size,triangles=tris,bytes=path.stat().st_size,sha256=hashlib.sha256(path.read_bytes()).hexdigest(),version=1))
def clear():
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)

# One compact mixer per basin, with red/blue temperature indices.
for variant in range(5):
 clear()
 wall=variant in (1,3)
 for x,index,index_mat in [(0,'Mixer',blue)]:
  if wall:
   cylinder(index+' wall rosette',(x,-.008,0),.028,.016,axis=(0,-1,0))
   cylinder(index+' valve',(x,-.035,0),.016,.055,axis=(0,-1,0))
   tube(index+' curved outlet',[(x,-.045,0),(x,-.08,-.015),(x,-.13,-.025),(x,-.14,-.045)],.009)
   cylinder(index+' aerator',(x,-.14,-.05),.011,.012)
   cylinder(index+' outlet bore',(x,-.14,-.057),.007,.002,black)
   tube(index+' lever',[(x,-.055,.015),(x,-.06,.045),(x,-.06,.065)],.0045)
   cylinder(index+' index',(x,-.066,.042),.004,.002,index_mat,axis=(0,-1,0))
  else:
   cylinder(index+' base gasket',(x,0,.002),.023,.004,rubber)
   cylinder(index+' mounting foot',(x,0,.007),.025,.008)
   cylinder(index+' valve body',(x,0,.055),.016,.09)
   cylinder(index+' cartridge cap',(x,0,.106),.019,.012)
   tube(index+' swivel neck',[(x,-.008,.087),(x,-.055,.1),(x,-.10,.095),(x,-.12,.077)],.010)
   cylinder(index+' aerator collar',(x,-.12,.073),.012,.012)
   cylinder(index+' aerator recess',(x,-.12,.066),.008,.002,black)
   tube(index+' handle',[(x,0,.115),(x,-.015,.132),(x,-.045,.135)],.0045)
   cylinder(index+' temperature index',(x,-.012,.117),.004,.002,index_mat)
 for offset,name,mat in [(-.004,'Hot index',red),(.004,'Cold index',blue)]:
  cylinder(name,(offset,-.067,.045) if wall else (offset,-.012,.118),.002,.002,mat,axis=(0,-1,0) if wall else (0,0,1))
 finish('basin-tap-'+str(variant),'Compact single basin mixer','https://www.jaquar.com/','Formstead original geometry, CC0')

for variant,diameter in enumerate([.105,.14,.18,.24,.30]):
 clear()
 cylinder('Mixer wall trim',(0,-.009,0),.064,.018,axis=(0,-1,0),segments=64)
 cylinder('Mixer cartridge',(0,-.035,0),.027,.05,axis=(0,-1,0))
 # Independent hot/cold low-level filling taps beneath the shower mixer.
 for x,index,mat in [(-.075,'Hot',red),(.075,'Cold',blue)]:
  cylinder(index+' filling rosette',(x,-.008,-.23),.025,.016,axis=(0,-1,0))
  cylinder(index+' filling valve',(x,-.04,-.23),.014,.06,axis=(0,-1,0))
  tube(index+' filling spout',[(x,-.05,-.24),(x,-.09,-.255),(x,-.13,-.28)],.009)
  cylinder(index+' filling aerator',(x,-.13,-.286),.012,.012)
  cylinder(index+' filling outlet',(x,-.13,-.293),.007,.002,black)
  tube(index+' filling handle',[(x,-.06,-.22),(x,-.065,-.19),(x,-.09,-.185)],.004)
  cylinder(index+' filling temperature index',(x,-.065,-.181),.003,.002,mat)
 cylinder('Shower diverter',(0,-.063,.075),.01,.025,axis=(0,-1,0))
 tube('Mixer lever',[(0,-.065,0),(0,-.075,.05),(0,-.08,.085)],.006)
 cylinder('Hot indicator',(-.016,-.02,.035),.003,.002,red,axis=(0,-1,0))
 cylinder('Cold indicator',(.016,-.02,.035),.003,.002,blue,axis=(0,-1,0))
 tube('Riser and rounded elbow',[(0,-.025,.05),(0,-.025,.65),(0,-.025,.99),(0,-.07,1.08),(0,-.23,1.08),(0,-.29,1.055)],.010)
 for z in [.16,.8]:
  cylinder('Riser mount',(0,-.009,z),.024,.018,axis=(0,-1,0))
  cylinder('Mount standoff',(0,-.025,z),.012,.035,axis=(0,-1,0))
 cylinder('Swivel ball',(0,-.29,1.044),.019,.028)
 cylinder('Overhead shell',(0,-.29,1.023),diameter/2,.020,segments=64)
 cylinder('Recessed spray face',(0,-.29,1.011),diameter*.455,.004,rubber,segments=64)
 # Separate silicone nozzles, each with a recessed dark bore.
 rings=min(4,max(2,round(diameter/.055)))
 for ring in range(rings):
  radius=diameter*.39*ring/max(1,rings-1);count=1 if ring==0 else ring*10
  for k in range(count):
   a=k*math.tau/count;x=math.cos(a)*radius;y=-.29+math.sin(a)*radius
   cylinder('Silicone jet',(x,y,1.007),.0025,.006,rubber,segments=8)
   cylinder('Jet bore',(x,y,1.0035),.0011,.001,black,segments=8)
 finish('shower-set-'+str(variant),'Detailed overhead shower '+str(round(diameter*1000))+' mm','https://www.jaquar.com/','Formstead original geometry, CC0')

# A clean, hollow pedestal basin prevents a second built-in tap from competing
# with the selected independent mixer. Original CC0 geometry, not vendor CAD.
clear()
ceramic=material('Glazed porcelain',(.89,.90,.88),0,.17)
rings=[(.68,.28),(.72,.70),(.82,.98),(.86,1),(.862,.94),(.82,.88),(.755,.46),(.746,.08)]
verts=[];faces=[];segments=64
for z,r in rings:
 for i in range(segments):
  a=i*math.tau/segments;verts.append((.275*r*math.cos(a),.215*r*math.sin(a),z))
for j in range(len(rings)-1):
 for i in range(segments):
  k=(i+1)%segments;faces.append((j*segments+i,j*segments+k,(j+1)*segments+k,(j+1)*segments+i))
faces.append(tuple((len(rings)-1)*segments+i for i in range(segments)))
mesh=bpy.data.meshes.new('Hollow porcelain shell');mesh.from_pydata(verts,[],faces);mesh.update()
o=bpy.data.objects.new('Hollow porcelain bowl',mesh);bpy.context.collection.objects.link(o);smooth(o,ceramic)
cylinder('Pedestal',(0,.04,.35),.075,.70,ceramic,segments=64)
cylinder('Waste flange',(0,0,.748),.018,.004,chrome)
cylinder('Waste opening',(0,0,.751),.011,.002,black)
finish('basin-no-tap','Pedestal basin with separate selected mixer','https://www.jaquar.com/','Formstead original geometry, CC0')
(OUT/'manifest.json').write_text(json.dumps(records,indent=2))
catalogue=ROOT/'src/lib/interior-assets/catalogue.json';doc=json.loads(catalogue.read_text())
doc['assets']=[a for a in doc['assets'] if not a['id'].startswith(('basin-tap-','shower-set-','basin-no-tap'))]+records
doc['updatedAt']='2026-11-03'
catalogue.write_text(json.dumps(doc,indent=2)+'\n')
