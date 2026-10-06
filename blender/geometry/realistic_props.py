"""Offline, shared detailed prop meshes. All instances retain their source-plan identity."""
import math
from pathlib import Path
import bpy
from mathutils import Matrix, Vector

ASSETS = Path(__file__).resolve().parent.parent / 'assets'


def _templates(scene, key, filename):
    if not hasattr(scene, 'outdoor_assets'):
        scene.outdoor_assets = {}
    if key in scene.outdoor_assets:
        return scene.outdoor_assets[key]
    path = ASSETS / filename
    if not path.is_file():
        raise ValueError(f'Missing bundled 3D asset: {filename}. Restore blender/assets before rendering.')
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    imported = [o for o in bpy.data.objects if o not in before]
    bpy.context.view_layer.update()
    meshes = [o for o in imported if o.type == 'MESH']
    points = [o.matrix_world @ Vector(v) for o in meshes for v in o.bound_box]
    lo, hi = [min(p[i] for p in points) for i in range(3)], [max(p[i] for p in points) for i in range(3)]
    center = Vector(((lo[0]+hi[0])/2, (lo[1]+hi[1])/2, lo[2]))
    templates = []
    for obj in meshes:
        label = obj.name.split('.')[0]
        mesh = obj.data.copy()
        mesh.transform(Matrix.Translation(-center) @ obj.matrix_world)
        for polygon in mesh.polygons:
            polygon.use_smooth = True
        for material in mesh.materials:
            material['asset_pbr'] = True
            if key == 'car':
                _car_material(material)
        templates.append((label, mesh))
    for obj in imported:
        bpy.data.objects.remove(obj, do_unlink=True)
    # Bounds after baking prevent an asset update from silently changing its envelope.
    scene.outdoor_assets[key] = (templates, [b-a for a,b in zip(lo,hi)])
    return scene.outdoor_assets[key]


def _car_material(material):
    shader = next((n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not shader:
        return
    name = material.name.lower()
    shader.inputs['Alpha'].default_value = 1
    if 'body_color' in name:
        shader.inputs['Base Color'].default_value = (.48,.008,.012,1)
        shader.inputs['Metallic'].default_value = .65
        shader.inputs['Roughness'].default_value = .22
        shader.inputs['Coat Weight'].default_value = 1
        shader.inputs['Coat Roughness'].default_value = .12
    elif 'tires' in name:
        shader.inputs['Metallic'].default_value = 0
        shader.inputs['Roughness'].default_value = .78
    elif 'taillight' in name:
        shader.inputs['Base Color'].default_value = (.5,.005,.008,1)
        shader.inputs['Roughness'].default_value = .18
        shader.inputs['Emission Color'].default_value = (.3,.002,.002,1)
        shader.inputs['Emission Strength'].default_value = .3
    elif 'glass' in name:
        shader.inputs['Base Color'].default_value = (.12,.16,.18,1)
        shader.inputs['Roughness'].default_value = .08
        shader.inputs['Metallic'].default_value = .05
        shader.inputs['Transmission Weight'].default_value = .75
        shader.inputs['IOR'].default_value = 1.46
        if hasattr(material,'use_raytrace_refraction'):
            material.use_raytrace_refraction = True
    elif 'metal' in name:
        shader.inputs['Metallic'].default_value = .95
        shader.inputs['Roughness'].default_value = .26
    elif 'leather' in name or 'carpet' in name:
        shader.inputs['Metallic'].default_value = 0
        shader.inputs['Roughness'].default_value = .85


def _instance(scene, templates, name, at, scale, angle, source, asset):
    matrix = Matrix.Translation(Vector(at)) @ Matrix.Rotation(angle,4,'Z') @ Matrix.Scale(scale,4)
    objects = []
    for i,(label,mesh) in enumerate(templates):
        obj = bpy.data.objects.new(f'{name}_Body' if asset=='ferrari-458' and label=='body' else f'{name}_{label}_{i:02d}',mesh)
        scene.collections['LANDSCAPE'].objects.link(obj)
        obj.matrix_world = matrix
        obj['source_plan_id'],obj['source_id'] = scene.plan_id,source
        obj['asset_id'],obj['asset_revision'] = asset,4
        obj['asset_component'] = label
        obj['asset_credit'] = 'Ferrari 458 Italia by vicent091036 / CC BY 4.0' if asset=='ferrari-458' else 'Island Tree 01 by Poly Haven / CC0'
        objects.append(obj)
    return objects


def create_real_car(scene,name,x,y,grade,along_y):
    templates,size = _templates(scene,'car','ferrari-458.glb')
    if size[0] > 2.260 or size[1] > 4.540 or size[2] > 1.240:
        raise ValueError('The car mesh exceeds its checked parking envelope')
    return _instance(scene,templates,name,(x/1000,y/1000,grade/1000),1,0 if along_y else math.pi/2,name,'ferrari-458')


def create_real_tree(scene,name,x,y,grade,height,angle,source,house,boundary):
    templates,size = _templates(scene,'tree','island-tree.glb')
    # Uniform scale preserves botanical shape. Conservative canopy radius is used for placement.
    scale = min(height/1000/size[2], 2.8/max(size[0],size[1]))
    radius = math.hypot(size[0],size[1])*scale*500
    r = {'x':x-radius,'y':y-radius,'w':radius*2,'h':radius*2}
    from visualization.placement import within, overlaps
    if not within(r,boundary) or any(overlaps(r,p,100) for p in house):
        return []
    return _instance(scene,templates,name,(x/1000,y/1000,grade/1000),scale,angle,source,'island-tree-01')
