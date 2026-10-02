"""Reproducible clay and evaluated-mesh check of the four brief wing choices.

Run scripts/review-wing-geometry.mjs first, then Blender with this script.
The last two cases reuse exactly one U-wing source plan with new exterior seeds.
"""
import hashlib
import json
from pathlib import Path
import sys

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from generator import main
from exporters.shape import _raster

directory = Path('output/wing-geometry-review').resolve()
report = json.loads((directory / 'report.json').read_text(encoding='utf-8'))
output = directory / 'scenes'
output.mkdir(parents=True, exist_ok=True)
settings = output / 'settings.json'
settings.write_text(json.dumps({
    'render': {'engine': 'EEVEE', 'quality': 'preview', 'samples': 8, 'resolution': [640, 480]},
    'landscape': {'enabled': False},
    'surfaces': {'stoneCladding': False, 'woodSlats': False, 'flutedPanels': False},
    'lighting': {'fixtures': False, 'interiorEmission': False},
}), encoding='utf-8')

for case in report['samples']:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    name = case['name']
    args = ['--input', str(directory / case['input']), '--out-dir', str(output), '--name', name,
            '--visualization', str(settings), '--gallery-frame']
    if case['render']:
        args += ['--render-all', '--production-names', '--clay']
    main(args)
    # Independently measure the complete top projection. The production roof
    # fingerprint only samples above the occupied roof datum, hiding court holes.
    triangles, vertices = [], set()
    graph = bpy.context.evaluated_depsgraph_get()
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH' or obj.get('presentation_only') or not any(
                c.name in ('STRUCTURE', 'WALLS', 'OPENINGS', 'WINDOWS', 'DOORS', 'MASSING', 'FACADE', 'BALCONIES', 'ROOF')
                for c in obj.users_collection):
            continue
        evaluated = obj.evaluated_get(graph)
        mesh = evaluated.to_mesh()
        try:
            mesh.calc_loop_triangles()
            points = [evaluated.matrix_world @ v.co for v in mesh.vertices]
            vertices.update(tuple(round(value, 5) for value in p) for p in points)
            triangles += [[(points[i].x, points[i].y) for i in t.vertices] for t in mesh.loop_triangles]
        finally:
            evaluated.to_mesh_clear()
    payload = json.loads((directory / case['input']).read_text(encoding='utf-8'))
    plot = payload['buildingModel']['plot']
    manifest_path = output / f'{name}.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    manifest['reviewTop'] = _raster(triangles, (0, 0, plot['widthMm'] * .001, plot['depthMm'] * .001))
    manifest['reviewVertexHash'] = hashlib.sha256(json.dumps(sorted(vertices)).encode()).hexdigest()
    manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
    print(f'WING_GEOMETRY_CHECK {name}: {len(vertices)} unique evaluated vertices', flush=True)
