"""Export evaluated accepted geometry only, without generation or placement.

DXF: AutoCAD 2000 3DFACE entities, one layer per object, true colours, metres.
DAE: COLLADA 1.4.1, named mesh groups and base colours, Z-up, metres.
Both are polygon meshes, not parametric solids/BIM. Textures are not embedded.
"""
import argparse
from collections import defaultdict
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import re
import sys
from xml.sax.saxutils import quoteattr

import bpy


def number(value):
    if not math.isfinite(value):
        raise ValueError('Non-finite coordinate in accepted model')
    return format(value, '.9g')


def material_colour(material):
    if material and material.use_nodes:
        bsdf = next((n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if bsdf:
            return tuple(bsdf.inputs['Base Color'].default_value)
    return tuple(material.diffuse_color) if material else (.65, .65, .65, 1)


def collect_meshes():
    graph = bpy.context.evaluated_depsgraph_get()
    scale = bpy.context.scene.unit_settings.scale_length
    meshes = []
    for instance in graph.object_instances:
        obj = instance.object
        if obj.type not in {'MESH', 'CURVE', 'SURFACE', 'FONT'} or obj.hide_render or not instance.show_self:
            continue
        if not instance.is_instance and not obj.original.visible_get():
            continue
        mesh = obj.to_mesh()
        if mesh is None:
            continue
        try:
            mesh.calc_loop_triangles()
            if not mesh.loop_triangles:
                continue
            matrix = instance.matrix_world.copy()
            vertices = [tuple((matrix @ v.co) * scale) for v in mesh.vertices]
            reverse = matrix.determinant() < 0
            triangles = [(tuple(reversed(t.vertices)) if reverse else tuple(t.vertices), t.material_index) for t in mesh.loop_triangles]
            colours = [material_colour(m) for m in mesh.materials] or [material_colour(None)]
            meshes.append({'name': obj.name, 'vertices': vertices, 'triangles': triangles, 'colours': colours})
        finally:
            obj.to_mesh_clear()
    if not meshes:
        raise ValueError('No visible accepted geometry to export')
    return meshes


def write_dxf(path, meshes):
    with path.open('w', encoding='utf-8', newline='\n') as f:
        def pair(code, value):
            f.write(f'{code}\n{value}\n')
        pair(999, 'Formstead accepted villa; 3D polygon mesh; metres; Z up; base colours only')
        pair(0, 'SECTION'); pair(2, 'HEADER')
        for name, code, value in [('$ACADVER', 1, 'AC1015'), ('$INSUNITS', 70, 6), ('$MEASUREMENT', 70, 1)]:
            pair(9, name); pair(code, value)
        pair(0, 'ENDSEC'); pair(0, 'SECTION'); pair(2, 'TABLES')
        pair(0, 'TABLE'); pair(2, 'LAYER'); pair(5, '1'); pair(330, '0')
        pair(100, 'AcDbSymbolTable'); pair(70, len(meshes))
        layers = [f'M{i}_{re.sub(r"[^A-Za-z0-9_-]", "_", m["name"])[:150]}' for i, m in enumerate(meshes)]
        for i, layer in enumerate(layers):
            pair(0, 'LAYER'); pair(5, format(i + 2, 'X')); pair(330, '1')
            pair(100, 'AcDbSymbolTableRecord'); pair(100, 'AcDbLayerTableRecord')
            pair(2, layer); pair(70, 0); pair(62, 7); pair(6, 'CONTINUOUS')
        pair(0, 'ENDTAB'); pair(0, 'ENDSEC'); pair(0, 'SECTION'); pair(2, 'ENTITIES')
        handle = len(layers) + 2
        for mesh, layer in zip(meshes, layers):
            for triangle, index in mesh['triangles']:
                color = mesh['colours'][min(index, len(mesh['colours']) - 1)]
                rgb = [round(max(0, min(1, c)) * 255) for c in color[:3]]
                pair(0, '3DFACE'); pair(5, format(handle, 'X')); handle += 1
                pair(100, 'AcDbEntity'); pair(8, layer)
                pair(420, (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]); pair(100, 'AcDbFace')
                for i, vertex in enumerate((*triangle, triangle[-1])):
                    for axis, value in enumerate(mesh['vertices'][vertex]):
                        pair(10 + i + axis * 10, number(value))
                pair(70, 0)
        pair(0, 'ENDSEC'); pair(0, 'EOF')


def write_dae(path, meshes):
    now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    with path.open('w', encoding='utf-8', newline='\n') as f:
        w = f.write
        w('<?xml version="1.0" encoding="utf-8"?>\n<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">\n')
        w(f'<asset><contributor><authoring_tool>Formstead accepted villa mesh export</authoring_tool></contributor><created>{now}</created><modified>{now}</modified><unit name="meter" meter="1"/><up_axis>Z_UP</up_axis></asset>\n')
        w('<library_effects>\n')
        for i, mesh in enumerate(meshes):
            for j, colour in enumerate(mesh['colours']):
                rgb = ' '.join(number(c) for c in (*colour[:3], 1))
                w(f'<effect id="e{i}_{j}"><profile_COMMON><technique sid="common"><lambert><diffuse><color>{rgb}</color></diffuse><transparent opaque="A_ONE"><color>1 1 1 {number(colour[3])}</color></transparent></lambert></technique></profile_COMMON></effect>\n')
        w('</library_effects><library_materials>\n')
        for i, mesh in enumerate(meshes):
            for j in range(len(mesh['colours'])):
                w(f'<material id="m{i}_{j}" name="Material_{i}_{j}"><instance_effect url="#e{i}_{j}"/></material>\n')
        w('</library_materials><library_geometries>\n')
        for i, mesh in enumerate(meshes):
            w(f'<geometry id="g{i}" name={quoteattr(mesh["name"])}><mesh><source id="p{i}"><float_array id="a{i}" count="{len(mesh["vertices"]) * 3}">')
            for vertex in mesh['vertices']:
                w(' '.join(number(c) for c in vertex) + ' ')
            w(f'</float_array><technique_common><accessor source="#a{i}" count="{len(mesh["vertices"])}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source><vertices id="v{i}"><input semantic="POSITION" source="#p{i}"/></vertices>')
            groups = defaultdict(list)
            for tri, material in mesh['triangles']:
                groups[min(material, len(mesh['colours']) - 1)].append(tri)
            for material, triangles in groups.items():
                w(f'<triangles material="s{i}_{material}" count="{len(triangles)}"><input semantic="VERTEX" source="#v{i}" offset="0"/><p>')
                for tri in triangles:
                    w(' '.join(str(v) for v in tri) + ' ')
                w('</p></triangles>')
            w('</mesh></geometry>\n')
        w('</library_geometries><library_visual_scenes><visual_scene id="Villa" name="Accepted villa">\n')
        for i, mesh in enumerate(meshes):
            w(f'<node id="n{i}" name={quoteattr(mesh["name"])} type="NODE"><instance_geometry url="#g{i}"><bind_material><technique_common>')
            for j in range(len(mesh['colours'])):
                w(f'<instance_material symbol="s{i}_{j}" target="#m{i}_{j}"/>')
            w('</technique_common></bind_material></instance_geometry></node>\n')
        w('</visual_scene></library_visual_scenes><scene><instance_visual_scene url="#Villa"/></scene></COLLADA>\n')


def export_accepted(source, output, scope, version):
    bpy.ops.wm.open_mainfile(filepath=str(source))
    meshes = collect_meshes()
    output.mkdir(parents=True, exist_ok=True)
    prefix = f'villa-{scope}'
    write_dxf(output / f'{prefix}.dxf', meshes)
    write_dae(output / f'{prefix}.dae', meshes)
    points = [v for m in meshes for v in m['vertices']]
    info = {'exportVersion': version, 'scope': scope, 'units': 'metres', 'upAxis': 'Z',
            'meshCount': len(meshes), 'triangleCount': sum(len(m['triangles']) for m in meshes),
            'bounds': [[min(v[a] for v in points) for a in range(3)], [max(v[a] for v in points) for a in range(3)]],
            'qualifications': ['Polygon meshes, not parametric solids or BIM.', 'Base colours only; procedural and image textures are not included.',
                               'Import DAE in SketchUp, then save as SKP. Import support depends on your SketchUp edition.']}
    (output / 'manifest.json').write_text(json.dumps(info, indent=2), encoding='utf-8')
    print(json.dumps(info))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--scope', choices=['building-only', 'building-plus-solar'], required=True)
    parser.add_argument('--version', required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    export_accepted(args.source, args.output, args.scope, args.version)
