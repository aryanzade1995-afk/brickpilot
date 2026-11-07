"""Export the same wall-local convex profiles shown in the live Three viewer."""
from pathlib import Path
import bpy
import bmesh
from interior_finishes import image_material


def create_facade_variation(scene, model):
    if not model:
        return
    if model['sourcePlanId'] != scene.plan_id or len(model['parts']) > 320:
        raise ValueError('Facade variation has a different source plan or exceeds its detail budget')
    materials = {}
    root = Path(__file__).resolve().parents[2]
    for key, look in model['materials'].items():
        if key == 'wall':
            materials[key] = scene.materials['wall']
        elif key == 'glass':
            materials[key] = scene.materials['glass']
        elif look.get('texture'):
            path = (root / 'public' / look['texture'].lstrip('/')).resolve()
            if not path.is_relative_to(root / 'public') or not path.is_file():
                raise ValueError('Facade material must use an existing public material asset')
            materials[key] = image_material('FacadeDesign_' + key, path, look['tileSizeM'], look['roughness'])
            materials[key].node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value = look['metalness']
            # Reuse the catalogue image material, with explicit UVs so GLB
            # exports retain the same physical texture scale as the viewer.
            nt=materials[key].node_tree
            coord=next(n for n in nt.nodes if n.type=='TEX_COORD')
            mapping=next(n for n in nt.nodes if n.type=='MAPPING')
            for link in list(nt.links):
                if link.to_node==mapping and link.to_socket==mapping.inputs['Vector']:nt.links.remove(link)
            nt.links.new(coord.outputs['UV'],mapping.inputs['Vector'])
            next(n for n in nt.nodes if n.type=='TEX_IMAGE').projection='FLAT'
        else:
            materials[key] = scene.materials['landscape' if key == 'green' else 'wall']
    for p in model['parts']:
        if min(p['w'], p['h'], p['depth']) <= 0 or p['offset'] < 0:
            raise ValueError('Invalid facade attachment dimensions')
        horizontal = p['side'] in ('N', 'S')
        sign = -1 if p['side'] in ('N', 'W') else 1
        profile = p.get('profile') or [[0, 0], [p['w'], 0], [p['w'], p['h']], [0, p['h']]]
        vertices = []
        for depth in (0, p['depth']):
            for u, z in profile:
                fixed = p['fixed'] + sign * (p['offset'] + depth)
                vertices.append(((p['u'] + u if horizontal else fixed) / 1000,
                                 (fixed if horizontal else p['u'] + u) / 1000, (p['z'] + z) / 1000))
        n = len(profile)
        faces = [tuple(reversed(range(n))), tuple(range(n, n * 2))]
        faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
        mesh = bpy.data.meshes.new(p['id']); mesh.from_pydata(vertices, [], faces); mesh.update()
        bm = bmesh.new(); bm.from_mesh(mesh); bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces)); bm.to_mesh(mesh); bm.free()
        uv=mesh.uv_layers.new(name='FacadeMaterialUV')
        for polygon in mesh.polygons:
            major=max(range(3),key=lambda axis:abs(polygon.normal[axis]))
            axes=[axis for axis in range(3) if axis!=major]
            for loop in polygon.loop_indices:
                v=mesh.vertices[mesh.loops[loop].vertex_index].co
                if major==(1 if horizontal else 0):
                    uv.data[loop].uv=((v.x if horizontal else v.y)-p['u']/1000,v.z-p['z']/1000)
                else:
                    uv.data[loop].uv=(v[axes[0]],v[axes[1]])
        mesh.materials.append(materials[p['material']])
        obj = bpy.data.objects.new(p['id'], mesh); scene.collections['FACADE'].objects.link(obj)
        obj['source_plan_id'], obj['source_id'] = scene.plan_id, p['zoneId']
        obj['facade_design_part'], obj['facade_design_signature'] = True, model['signature']
        if p.get('sourceStyle'):
            obj['facade_recipe'] = p['sourceStyle']
        obj['material_role'] = 'glass' if p['material'] == 'glass' else 'facade_finish'
        bevel = obj.modifiers.new('Facade edge refinement', 'BEVEL'); bevel.width = .004; bevel.segments = 2
        obj.modifiers.new('Facade weighted normals', 'WEIGHTED_NORMAL')
