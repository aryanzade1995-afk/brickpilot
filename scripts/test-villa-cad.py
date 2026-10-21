"""Run in Blender: --python scripts/test-villa-cad.py. No external CAD install required."""
import importlib.util
from pathlib import Path
import tempfile
import xml.etree.ElementTree as ET
import bpy

spec = importlib.util.spec_from_file_location('villa_cad', Path(__file__).resolve().parents[1] / 'blender/cad_export.py')
cad = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cad)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.unit_settings.scale_length = .5
bpy.ops.mesh.primitive_cube_add(size=2, location=(4, 6, 8))
wall = bpy.context.object
wall.name = 'Wall & Balcony'
wall.scale = (-2, 3, 4)  # mirrored, non-uniform, translated; also exercise modifiers
wall.modifiers.new('Evaluated bevel', 'BEVEL').width = .1
bpy.ops.mesh.primitive_cube_add(size=2, location=(4, 6, 18))
panel = bpy.context.object
panel.name = 'Canonical_PV_Panel'
panel.scale = (.5, 1, .05)
panel['formstead_solar'] = True
bpy.ops.mesh.primitive_cube_add(size=100, location=(1000, 1000, 1000))
bpy.context.object.hide_render = True
meshes = cad.collect_meshes()
assert len(meshes) == 2
assert max(v[2] for m in meshes for v in m['vertices']) < 10
assert min(v[2] for m in meshes for v in m['vertices']) == 2
total = sum(len(m['triangles']) for m in meshes)
assert total > 24, 'Modifiers must be evaluated'
with tempfile.TemporaryDirectory(prefix='formstead-cad-geometry-') as directory:
    root = Path(directory)
    cad.write_dxf(root / 'model.dxf', meshes)
    cad.write_dae(root / 'model.dae', meshes)
    lines = (root / 'model.dxf').read_text().splitlines()
    pairs = list(zip(lines[::2], lines[1::2]))
    assert len([p for p in pairs if p == ('0', '3DFACE')]) == total
    unit = pairs.index(('9', '$INSUNITS'))
    assert pairs[unit + 1] == ('70', '6')
    assert ('30', '2') in pairs, 'Real Z elevation, not a flattened floor plan'
    tree = ET.parse(root / 'model.dae')
    ns = {'c': 'http://www.collada.org/2005/11/COLLADASchema'}
    assert tree.getroot().attrib['version'] == '1.4.1'
    assert tree.find('c:asset/c:unit', ns).attrib['meter'] == '1'
    assert tree.find('c:asset/c:up_axis', ns).text == 'Z_UP'
    assert len(tree.findall('.//c:geometry', ns)) == 2
    assert sum(int(e.attrib['count']) for e in tree.findall('.//c:triangles', ns)) == total
    assert tree.find('.//c:node', ns).attrib['name'] == meshes[0]['name']
    # Every coordinate and index in DAE must agree with the evaluated mesh.
    for geometry, mesh in zip(tree.findall('.//c:geometry', ns), meshes):
        actual = list(map(float, geometry.find('.//c:float_array', ns).text.split()))
        expected = [v for vertex in mesh['vertices'] for v in vertex]
        assert len(actual) == len(expected)
        assert all(abs(a - b) < 1e-6 for a, b in zip(actual, expected))
print(f'CAD geometry passed: {len(meshes)} meshes, {total} triangles, scaled coordinates, PV, hidden exclusion, modifiers and mirrored transforms.')
