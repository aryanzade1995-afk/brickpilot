"""Replay an immutable accepted villa; consume TS instance transforms verbatim.

There is deliberately no roof allocation, panel placement or architectural generator here.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

import bpy
from mathutils import Matrix

sys.path.insert(0, str(Path(__file__).resolve().parent))
from exporters.glb import export_glb
from exporters.shape import measure_shape
from visualization.render import configure_render
from visualization.config import PRESETS


def tag(obj, signature):
    obj['formstead_solar'] = True
    obj['solar_visual_signature'] = signature
    return obj


def add_solar(contract):
    if contract['schemaVersion'] != 1 or contract['rendererVersion'] != 'canonical-pv-render-v1' or contract['matrixOrder'] != 'column-major' or contract['coordinates'] != 'blender-x-right-y-down-z-up-metres':
        raise ValueError('Unsupported canonical solar geometry contract')
    if len(contract['panels']) != contract['panelCount'] or abs(sum(p['ratedPowerW'] for p in contract['panels']) / 1000 - contract['capacityKwp']) > 1e-9:
        raise ValueError('Canonical solar inventory mismatch')
    # Also makes an explicitly tagged combined source safe to reopen without duplicates.
    for obj in list(bpy.data.objects):
        if obj.get('formstead_solar'):
            bpy.data.objects.remove(obj, do_unlink=True)
    collection = bpy.data.collections.new('FORMSTEAD_PHOTOVOLTAICS')
    bpy.context.scene.collection.children.link(collection)
    root = tag(bpy.data.objects.new('Formstead_Canonical_PV', None), contract['solarVisualSignature'])
    collection.objects.link(root)
    root['artifact_scope'] = 'building-plus-solar'
    root['panel_count'] = contract['panelCount']
    root['capacity_kwp'] = contract['capacityKwp']
    materials = {}
    for name, color, metallic in [('PV_Frame', (.21, .23, .25, 1), .65), ('PV_Face', (.015, .026, .039, 1), .25), ('PV_Reserved', (.65, .35, .06, 1), 0)]:
        mat = bpy.data.materials.new(name)
        mat.diffuse_color = color
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = color
        bsdf.inputs['Metallic'].default_value = metallic
        bsdf.inputs['Roughness'].default_value = .35
        materials[name] = mat
    # One shared packed raster; no per-cell geometry. Same 128x256 pattern as live Three.
    image = bpy.data.images.new('Formstead_PV_Cells', width=128, height=256, alpha=True)
    pixels = []
    def linear(v):
        s = v / 255
        return s / 12.92 if s <= .04045 else ((s + .055) / 1.055) ** 2.4
    for y in range(256):
        for x in range(128):
            rgb = (40, 51, 62) if x % 21 == 0 or y % 21 == 0 else (15, 26, 39)
            pixels.extend([*(linear(v) for v in rgb), 1])
    image.pixels.foreach_set(pixels)
    image.pack()
    texture = materials['PV_Face'].node_tree.nodes.new('ShaderNodeTexImage')
    materials['PV_Face']['asset_pbr'] = True
    texture.image = image
    materials['PV_Face'].node_tree.links.new(texture.outputs['Color'], materials['PV_Face'].node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    # Identical unit box and unit XY plane primitives used by the instanced live viewer.
    box = bpy.data.meshes.new('PV_Unit_Box')
    box.from_pydata([(-.5, -.5, -.5), (.5, -.5, -.5), (.5, .5, -.5), (-.5, .5, -.5),
                    (-.5, -.5, .5), (.5, -.5, .5), (.5, .5, .5), (-.5, .5, .5)], [],
                   [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)])
    box.materials.append(materials['PV_Frame'])
    plane = bpy.data.meshes.new('PV_Unit_Face')
    plane.from_pydata([(-.5, -.5, 0), (.5, -.5, 0), (.5, .5, 0), (-.5, .5, 0)], [], [(0, 1, 2, 3)])
    plane.materials.append(materials['PV_Face'])
    uv = plane.uv_layers.new(name='UVMap')
    for loop in plane.loops:
        v = plane.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = (v.x + .5, v.y + .5)
    def instance(name, mesh, values, panel):
        if len(values) != 16 or any(not isinstance(v, (float, int)) for v in values):
            raise ValueError('Invalid canonical instance matrix')
        obj = tag(bpy.data.objects.new(name, mesh), contract['solarVisualSignature'])
        obj.parent = root
        obj['panel_id'] = panel['id']
        obj['roof_surface_id'] = panel['roofSurfaceId']
        obj['specification_key'] = panel['specificationKey']
        collection.objects.link(obj)
        obj.matrix_world = Matrix([values[i:i + 4] for i in range(0, 16, 4)]).transposed()
        return obj
    for i, panel in enumerate(contract['panels']):
        instance(f'PV_{i:04d}_Frame', box, panel['frame'], panel)
        instance(f'PV_{i:04d}_Face', plane, panel['face'], panel)
        for j, matrix in enumerate(panel['supports']):
            instance(f'PV_{i:04d}_Support_{j}', box, matrix, panel)
    lines = contract['reservationLines']
    if len(lines) % 6:
        raise ValueError('Invalid reservation line endpoints')
    for i in range(0, len(lines), 6):
        curve = bpy.data.curves.new('PV_Keep_Free_Boundary', 'CURVE')
        curve.dimensions = '3D'
        curve.bevel_depth = .015
        curve.bevel_resolution = 0
        poly = curve.splines.new('POLY')
        poly.points.add(1)
        poly.points[0].co = (*lines[i:i + 3], 1)
        poly.points[1].co = (*lines[i + 3:i + 6], 1)
        curve.materials.append(materials['PV_Reserved'])
        obj = tag(bpy.data.objects.new(f'PV_Keep_Free_{i // 6}', curve), contract['solarVisualSignature'])
        obj.parent = root
        collection.objects.link(obj)
        # Convert the visual boundary for inclusion in the combined GLB as well.
        bpy.context.view_layer.update()
        mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(bpy.context.evaluated_depsgraph_get()))
        mesh_obj = tag(bpy.data.objects.new(obj.name + '_Mesh', mesh), contract['solarVisualSignature'])
        mesh_obj.parent = root
        collection.objects.link(mesh_obj)
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.context.view_layer.update()
    return root


def main(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument('--replay', required=True)
    parser.add_argument('--out-dir', required=True)
    parser.add_argument('--name', required=True)
    parser.add_argument('--export-only', action='store_true', help='Geometry verification without image rendering')
    args = parser.parse_args(argv)
    if not re.fullmatch(r'[a-zA-Z0-9_-]+', args.name):
        raise ValueError('Invalid artifact filename')
    replay = json.loads(Path(args.replay).read_text(encoding='utf-8'))
    payload_bytes = Path(replay['payloadPath']).read_bytes()
    payload = json.loads(payload_bytes)
    base = Path(replay['baseBlend'])
    if hashlib.sha256(payload_bytes + base.read_bytes()).hexdigest() != replay['buildingCacheKey']:
        raise ValueError('Accepted building source changed')
    manifest = json.loads(Path(replay['baseManifest']).read_text(encoding='utf-8'))
    expected_digest = hashlib.sha256(('villa-blender-v2|' + json.dumps(payload, sort_keys=True, separators=(',', ':'))).encode()).hexdigest()
    if manifest.get('inputDigest') != expected_digest:
        raise ValueError('Accepted input manifest changed')
    bpy.ops.wm.open_mainfile(filepath=str(base))
    scene = bpy.context.scene
    if scene.get('source_plan_id') != replay['accepted']['planId'] or str(scene.get('architectural_seed')) != str(replay['accepted']['seed']):
        raise ValueError('Accepted building plan or seed changed')
    before = measure_shape(payload)
    add_solar(replay['contract'])
    after = measure_shape(payload)
    if before != after:
        raise ValueError('Solar changed the architectural fingerprint')
    scene['artifact_scope'] = 'building-plus-solar'
    scene['building_cache_key'] = replay['buildingCacheKey']
    scene['solar_visual_signature'] = replay['contract']['solarVisualSignature']
    out = Path(args.out_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)
    options = manifest['visualization']['options']
    options['render'].update(PRESETS[replay['quality']])
    options['render']['quality'] = replay['quality']
    configure_render(options, replay['accepted']['seed'])
    bpy.ops.wm.save_as_mainfile(filepath=str(out / f'{args.name}.blend'))
    export_glb(out / f'{args.name}.glb')
    if not args.export_only:
        for name, suffix in [('HeroPerspectiveCamera', 'hero'), ('FrontCamera', 'front'), ('AerialCamera', 'aerial')]:
            scene.camera = bpy.data.objects[name]
            scene.render.filepath = str(out / f'{args.name}_{suffix}.png')
            bpy.ops.render.render(write_still=True)
    verification = {'schemaVersion': 1, 'seed': replay['accepted']['seed'], 'planId': replay['accepted']['planId'],
                    'solarVisualSignature': replay['contract']['solarVisualSignature'], 'architecturalFingerprintUnchanged': before == after,
                    'panelCount': replay['contract']['panelCount'], 'capacityKwp': replay['contract']['capacityKwp'],
                    'realizedGeometry': after}
    (out / f'{args.name}.json').write_text(json.dumps(verification), encoding='utf-8')
    print('Accepted building replayed; canonical solar exported; architectural fingerprint unchanged.', flush=True)


if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
