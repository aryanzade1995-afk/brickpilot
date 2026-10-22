"""Replay canonical walkthrough surfaces; never search/replan architecture.

Input vertices are final glTF metres (x east, y up, z plan-north).
Only conversion: Blender = (x, -z, y). glTF export reverses that rotation.
The structural pass and appearance pass are isolated from generator.py and
interior_preview.py. Procedural furnishing arrives from the existing TS dresser.
"""
import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from exporters.glb import export_glb


def world_to_blender(p):
    return (p[0], -p[2], p[1])


def root(plan_id, kind):
    obj = bpy.data.objects.new('Formstead_' + kind, None)
    obj['sourcePlanId'] = plan_id
    obj['assetKind'] = kind
    obj['coordinates'] = 'metres-x-plan-east-y-up-z-plan-north'
    obj['deliveryVersion'] = 'walkthrough-assets-v1'
    bpy.context.scene.collection.objects.link(obj)
    return obj


def srgb(hex_color):
    rgb = [int(hex_color.lstrip('#')[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c < .04045 else ((c + .055) / 1.055) ** 2.4 for c in rgb)


def material(name, look):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat['asset_pbr'] = True  # Existing glTF exporter preserves embedded image nodes.
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*srgb(look.get('color', '#eeeae2')), 1)
    bsdf.inputs['Roughness'].default_value = look.get('rough', .8)
    bsdf.inputs['Metallic'].default_value = look.get('metal', 0)
    alpha = look.get('opacity', 1)
    if alpha < 1:
        bsdf.inputs['Alpha'].default_value = alpha
        mat.surface_render_method = 'DITHERED'
    if look.get('emissive'):
        bsdf.inputs['Emission Color'].default_value = (*srgb(look['emissive']), 1)
        bsdf.inputs['Emission Strength'].default_value = look.get('glow', 0)
    image = look.get('surface', {}).get('image')
    if image:
        # Server resolves and verifies public catalogue images before this process.
        texture = mat.node_tree.nodes.new('ShaderNodeTexImage')
        texture.image = bpy.data.images.load(image, check_existing=True)
        mat.node_tree.links.new(texture.outputs['Color'], bsdf.inputs['Base Color'])
    mat.use_backface_culling = alpha >= 1
    return mat


def mesh_object(name, vertices, faces, parent, extras, mat):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([world_to_blender(v) for v in vertices], [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    for key, value in extras.items():
        obj[key] = value
    mesh.materials.append(mat)
    # Real metre UVs for structural skins. No external procedural shader graph.
    uv = mesh.uv_layers.new(name='UVMap')
    for polygon in mesh.polygons:
        axis = max(range(3), key=lambda i: abs(polygon.normal[i]))
        axes = [i for i in range(3) if i != axis]
        for li in polygon.loop_indices:
            p = mesh.vertices[mesh.loops[li].vertex_index].co
            uv.data[li].uv = (p[axes[0]], p[axes[1]])
    return obj


BOX_FACES = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]


def primitive(part):
    """Small reusable shapes from dressRoom, without per-object Blender operators."""
    shape = part.get('shape', 'box')
    # Unit shapes are built Z-up, then converted into canonical Y-up below.
    if shape == 'box':
        verts = [(-.5, -.5, -.5), (.5, -.5, -.5), (.5, .5, -.5), (-.5, .5, -.5),
                 (-.5, -.5, .5), (.5, -.5, .5), (.5, .5, .5), (-.5, .5, .5)]
        faces = BOX_FACES
    else:
        segments = 12
        rings = 8 if shape == 'ball' else 1
        verts = []
        for j in range(rings + 1):
            phi = math.pi * j / rings
            z = math.cos(phi) * .5 if shape == 'ball' else j - .5
            radius = math.sin(phi) * .5 if shape == 'ball' else .5
            for i in range(segments):
                a = 2 * math.pi * i / segments
                verts.append((radius * math.cos(a), radius * math.sin(a), z))
        faces = [(j * segments + i, j * segments + (i + 1) % segments,
                  (j + 1) * segments + (i + 1) % segments, (j + 1) * segments + i)
                 for j in range(rings) for i in range(segments)]
        # Rings run from north to south for spheres (reverse exterior winding).
        if shape == 'ball':
            faces = [tuple(reversed(f)) for f in faces]
        else:
            faces += [tuple(reversed(range(segments))), tuple(range(segments, segments * 2))]
    px, py, pz = part['position']
    w, h, d = part['size']
    a = part.get('rotation', 0)
    c, s = math.cos(a), math.sin(a)
    result = []
    for x, by, up in verts:
        x, z = x * w, -by * d
        result.append((px + c * x + s * z, py + up * h, pz - s * x + c * z))
    return result, faces


def add_parts(parts, parent, bindings, kind):
    # Same room and same material share one mesh. Door leaves stay individual
    # so a future controller can operate them without touching the building.
    groups = defaultdict(list)
    for part in parts:
        material_key = json.dumps(bindings.get(part['binding'], {}), sort_keys=True) if kind == 'furnishing' else part['binding']
        key = (part['floorId'], part.get('roomId'), material_key, part['id'] if part['kind'] == 'door' else '')
        groups[key].append(part)
    material_cache = {}
    for i, ((floor, room, _, door), group) in enumerate(sorted(groups.items(), key=lambda p: str(p[0]))):
        binding = group[0]['binding']
        vertices, faces = [], []
        for part in group:
            pv, pf = primitive(part)
            offset = len(vertices)
            vertices.extend(pv)
            faces.extend(tuple(v + offset for v in f) for f in pf)
        look = bindings.get(binding, {'color': '#b5a38c', 'rough': .7})
        look_key = json.dumps(look, sort_keys=True)
        if look_key not in material_cache:
            material_cache[look_key] = material('look_' + str(len(material_cache)), look)
        obj = mesh_object(kind + '_' + str(i), vertices, faces, parent,
                    {'materialBinding': binding, 'floorId': floor, 'roomId': room or '', 'partIds': [p['id'] for p in group],
                     'doorId': door, 'sourcePlanId': parent['sourcePlanId'], 'materialBindings': [p['binding'] for p in group]}, material_cache[look_key])
        material_uv(obj, look)


def material_uv(obj, look):
    surface = look.get('surface', {})
    tile = surface.get('tileM', 1)
    sizes = surface.get('tileSizeM', [tile, tile])
    obj['materialTileM'] = tile
    obj['materialTileSizeM'] = sizes
    for uv in obj.data.uv_layers:
        for point in uv.data:
            point.uv = (point.uv.x / max(.01, sizes[0]), point.uv.y / max(.01, sizes[1]))


def add_finish_skins(app, parent):
    groups = defaultdict(list)
    for face in app.get('skins', []):
        groups[(face['roomId'], face['binding'])].append(face)
    for i, ((room, binding), group) in enumerate(groups.items()):
        vertices, faces = [], []
        for face in group:
            offset = len(vertices)
            vertices.extend(face['vertices'])
            faces.append(tuple(range(offset, offset + 4)))
        look = app['bindings'][binding]
        obj = mesh_object('finish_skin_' + str(i), vertices, faces, parent,
                          {'materialBinding': binding, 'roomId': room, 'sourcePlanId': parent['sourcePlanId'],
                           'finishSurfaceIds': [f['id'] for f in group], 'canonicalSurfaceIds': [f['canonicalSurfaceId'] for f in group]}, material(binding, look))
        material_uv(obj, look)


def structure(data, out):
    geometry = data['geometry']
    building = root(geometry['planId'], 'walkthrough-structure')
    groups = defaultdict(list)
    for face in geometry['faces']:
        groups[face['binding']].append(face)
    for i, (binding, group) in enumerate(sorted(groups.items())):
        vertices, faces = [], []
        for face in group:
            offset = len(vertices)
            vertices.extend(face['vertices'])
            faces.append(tuple(range(offset, offset + 4)))
        role = json.loads(binding)[2]
        look = {'color': '#c6dce4', 'rough': .12, 'opacity': .28} if role == 'glass' else {'color': '#eeeae2', 'rough': .8}
        mesh_object('skin_' + str(i), vertices, faces, building,
                    {'materialBinding': binding, 'floorId': group[0]['floorId'], 'roomId': group[0]['roomId'] or '',
                     'surfaceIds': [f['id'] for f in group], 'sourcePlanId': geometry['planId']}, material(binding, look))
    add_parts(geometry['openingParts'], building, {}, 'opening')
    export_glb(out / 'structure.glb')
    (out / 'structure.json').write_text(json.dumps({'planId': geometry['planId'], 'surfaceCount': len(geometry['faces'])}), encoding='utf-8')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    collision = root(geometry['planId'], 'walkthrough-collision')
    vertices, faces = [], []
    for item in geometry['collision']['colliders']:
        low, high = item['min'], item['max']
        part = {'position': [(a + b) / 2 for a, b in zip(low, high)], 'size': [b - a for a, b in zip(low, high)]}
        pv, pf = primitive(part)
        offset = len(vertices)
        vertices.extend(pv)
        faces.extend(tuple(v + offset for v in f) for f in pf)
    mesh_object('source-collision', vertices, faces, collision, {'sourcePlanId': geometry['planId'], 'collisionOnly': True}, material('collision', {'color': '#b65242'}))
    export_glb(out / 'collision.glb')


def appearance(data, out):
    geometry, app = data['geometry'], data['appearance']
    # Finish-only jobs load the exact accepted/cached architecture, never search.
    bpy.ops.import_scene.gltf(filepath=data['structurePath'])
    roots = [o for o in bpy.context.scene.objects if o.get('assetKind') == 'walkthrough-structure']
    if len(roots) != 1 or roots[0].get('sourcePlanId') != geometry['planId']:
        raise ValueError('Cached structure belongs to a different design')
    materials = {}
    for obj in bpy.context.scene.objects:
        key = obj.get('materialBinding')
        if key and obj.type == 'MESH':
            look = app['bindings'][key]
            # UVs encode metres. Material tile scale is set on the mesh copy,
            # leaving the immutable cached structural asset untouched.
            material_uv(obj, look)
            look_key = json.dumps(look, sort_keys=True)
            if look_key not in materials:
                materials[look_key] = material('selected_' + str(len(materials)), look)
            obj.data.materials.clear()
            obj.data.materials.append(materials[look_key])
    # Furniture has a separate GLB so clients can replace it with a new finish
    # package while retaining the loaded structure. The combined export has it too.
    furnishing = root(geometry['planId'], 'walkthrough-furniture')
    add_parts(app['furniture'], furnishing, app['bindings'], 'furnishing')
    add_finish_skins(app, furnishing)
    roots[0]['assetKind'] = 'walkthrough-combined'
    roots[0]['includesFurniture'] = True
    export_glb(out / 'house.glb')
    for obj in bpy.context.scene.objects:
        obj.hide_set(obj != furnishing and obj.parent != furnishing)
    export_glb(out / 'furniture.glb')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    data = json.loads(Path(args.input).read_text(encoding='utf-8'))
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if data['mode'] == 'structure':
        structure(data, out)
    elif data['mode'] == 'appearance':
        appearance(data, out)
    else:
        raise ValueError('Unsupported walkthrough export mode')
    print('@@done walkthrough-export', flush=True)


if __name__ == '__main__':
    main()
