"""Replay canonical service segments. No route or pipe size is chosen here."""
import math
import bpy
from mathutils import Vector

COLORS = {'water': '#2484a0', 'drain': '#64716d', 'vent': '#967b68'}

def create_plumbing(scene, payload):
    layout = payload.get('plumbing')
    if not layout:
        return
    if layout.get('version') != 'villa-plumbing-v1' or layout.get('planId') != scene.plan_id:
        raise ValueError('Plumbing layout does not match this building')
    collection = bpy.data.collections.get('SERVICES') or bpy.data.collections.new('SERVICES')
    if collection.name not in {c.name for c in bpy.context.scene.collection.children}:
        bpy.context.scene.collection.children.link(collection)
    materials = {}
    def linear(v):
        return v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4
    for system, color in COLORS.items():
        material = bpy.data.materials.new('Service_' + system)
        material.use_nodes = True
        shader = material.node_tree.nodes.get('Principled BSDF')
        shader.inputs['Base Color'].default_value = (*[linear(int(color[i:i+2],16)/255) for i in (1,3,5)], 1)
        shader.inputs['Roughness'].default_value = .44
        shader.inputs['Metallic'].default_value = .12
        materials[system] = material
    def finish(obj, system):
        for old in list(obj.users_collection):
            old.objects.unlink(obj)
        collection.objects.link(obj)
        obj.data.materials.append(materials[system])
        obj['formstead_plumbing'] = True
        obj['source_plan_id'] = scene.plan_id
        obj['plumbing_signature'] = layout['signature']
        obj['service'] = system
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    joints = set()
    for i, segment in enumerate(layout['segments']):
        system, diameter = segment['system'], segment['diameterMm']
        if system not in materials or not math.isfinite(diameter) or not 0 < diameter <= 500:
            raise ValueError('Invalid canonical pipe envelope')
        points = [segment['from'], segment['to']]
        if not all(math.isfinite(p[k]) for p in points for k in ('x','y','z')):
            raise ValueError('Invalid canonical pipe position')
        a, b = [Vector(tuple(p[k]*.001 for k in ('x','y','z'))) for p in points]
        length, radius = (b-a).length, diameter*.0005
        if length < .0001:
            continue
        bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=radius, depth=length, location=(a+b)/2)
        obj = bpy.context.object
        obj.name = f'Service_{system}_{i:03d}'
        obj.rotation_euler = (b-a).to_track_quat('Z','Y').to_euler()
        finish(obj, system)
        for p in (a,b):
            key = (system, tuple(round(v,9) for v in p), diameter)
            if key in joints:
                continue
            joints.add(key)
            bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=radius*1.1, location=p)
            obj = bpy.context.object
            obj.name = f'Service_{system}_Joint_{len(joints):03d}'
            finish(obj,system)
    for issue in layout.get('issues',[]):
        scene.warnings.append(issue['reason'])
