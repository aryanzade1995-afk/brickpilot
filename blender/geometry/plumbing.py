"""Replay canonical pipe tubes and CC0 fitting transforms; never route in Python."""
import json
import math
from pathlib import Path
import bpy
from mathutils import Vector

COLORS = {'water': '#dedbd0', 'drain': '#55595a', 'vent': '#99958c'}
ASSETS = json.loads((Path(__file__).resolve().parents[2]/'src/lib/plumbing/data/polyhaven-fittings.json').read_text())

def create_plumbing(scene, payload):
    layout=payload.get('plumbing')
    if not layout: return
    if layout.get('version')!='villa-plumbing-v1' or layout.get('planId')!=scene.plan_id: raise ValueError('Plumbing layout does not match this building')
    assembly=layout.get('assembly')
    if assembly and (assembly.get('version')!='pipe-kit-v1' or assembly.get('source')!='polyhaven-modular-pipes'): raise ValueError('Unsupported canonical fitting assembly')
    collection=bpy.data.collections.get('SERVICES') or bpy.data.collections.new('SERVICES')
    if collection.name not in {c.name for c in bpy.context.scene.collection.children}: bpy.context.scene.collection.children.link(collection)
    def linear(v): return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4
    materials={}
    for system,color in COLORS.items():
        m=bpy.data.materials.new('Service_'+system);m.use_nodes=True
        shader=m.node_tree.nodes.get('Principled BSDF')
        shader.inputs['Base Color'].default_value=(*[linear(int(color[i:i+2],16)/255) for i in (1,3,5)],1)
        shader.inputs['Roughness'].default_value=.32;shader.inputs['Metallic'].default_value=.04;materials[system]=m
    def finish(obj,system):
        for old in list(obj.users_collection): old.objects.unlink(obj)
        collection.objects.link(obj);obj.data.materials.append(materials[system])
        obj['formstead_plumbing']=True;obj['source_plan_id']=scene.plan_id;obj['plumbing_signature']=layout['signature'];obj['service']=system
        for p in obj.data.polygons: p.use_smooth=True
    for i,s in enumerate(assembly['tubes'] if assembly else layout['segments']):
        diameter=s['diameterMm'];system=s['system']
        if system not in materials or not math.isfinite(diameter) or not 0<diameter<=500: raise ValueError('Invalid canonical pipe envelope')
        points=[s['from'],s['to']]
        if not all(math.isfinite(p[k]) for p in points for k in ('x','y','z')): raise ValueError('Invalid canonical pipe position')
        a,b=[Vector(tuple(p[k]*.001 for k in ('x','y','z'))) for p in points];length=(b-a).length
        if length<.0001: continue
        bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=diameter*.0005,depth=length,end_fill_type='NOTHING',location=(a+b)/2)
        obj=bpy.context.object;obj.name=f'Service_{system}_{i:03d}';obj.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();finish(obj,system)
    for f in assembly['fittings'] if assembly else []:
        if f['kind'] not in ('elbow','tee','coupler') or f['system'] not in materials: raise ValueError('Invalid fitting type')
        asset=ASSETS['parts'][f['kind']];scale=f['diameterMm']/asset['nominalDiameterM']*.001
        origin=Vector(tuple(f['position'][k]*.001 for k in ('x','y','z')))
        basis=[Vector(tuple(v[k] for k in ('x','y','z'))) for v in f['basis']]
        if len(basis)!=3 or not math.isfinite(scale) or not 0<scale<10 or any(abs(v.length-1)>.001 for v in basis): raise ValueError('Invalid fitting transform')
        def transform(values,i,scaled): return sum((basis[k]*values[i+k]*(scale if scaled else 1) for k in range(3)),Vector((0,0,0)))
        vertices=[origin+transform(asset['positions'],i,True) for i in range(0,len(asset['positions']),3)]
        mesh=bpy.data.meshes.new('Service_Fitting');mesh.from_pydata(vertices,[],[tuple(range(i,i+3)) for i in range(0,len(vertices),3)]);mesh.update()
        normals=[transform(asset['normals'],i,False).normalized() for i in range(0,len(asset['normals']),3)]
        mesh.normals_split_custom_set_from_vertices(normals)
        obj=bpy.data.objects.new(f"Service_{f['system']}_{f['kind']}_{f['id']}",mesh);collection.objects.link(obj);finish(obj,f['system'])
        obj['asset_source']='https://polyhaven.com/a/modular_pipes';obj['asset_license']='CC0-1.0';obj['asset_part']=asset['sourceObject']
    for issue in layout.get('issues',[]): scene.warnings.append(issue['reason'])
