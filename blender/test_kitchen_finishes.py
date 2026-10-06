"""Verify selected kitchen materials on real Blender objects, without rendering.

blender -b --python-exit-code 1 --python blender/test_kitchen_finishes.py -- scene.json ...
"""
import copy
import json
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from interior_preview import box, principled, hex_rgb, kelvin_rgb, furniture_materials
from interior_finishes import apply_finishes

for filename in sys.argv[sys.argv.index('--')+1:]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    data = json.loads(Path(filename).read_text(encoding='utf8'))
    original = copy.deepcopy(data)
    mats = furniture_materials('luxury')  # chosen finishes must override even dark luxury decor
    selected = apply_finishes(data, box, principled, hex_rgb, kelvin_rgb, mats, {})
    assert data == original, 'source architecture and placements were mutated'
    for f in data['furniture']:
        if f['id'] in selected.get('skip', ()):
            continue
        material = selected.get('furniture', {}).get(f['id'])
        if f['mat'] == 'panel' and ('-counter' in f['id'] or '-upper' in f['id']):
            assert material and material.name == 'finish-cabinets', f['id']
        if f['mat'] == 'stone' and '-top' in f['id']:
            assert material and material.name == 'finish-counter', f['id']
        if material:
            pos, size = selected.get('reshape', {}).get(f['id'], (f['pos'], f['size']))
            box(f['id'], pos, size, material)
    for role, key in [('finish-counter', 'counter'), ('finish-cabinets', 'cabinets')]:
        material = bpy.data.materials[role]
        expected = data['finishes'][key].get('image')
        if expected:
            images = [n.image.filepath for n in material.node_tree.nodes if n.type == 'TEX_IMAGE']
            assert expected in images, (role, expected, images)
    objects = list(bpy.context.scene.objects)
    shutters = [o for o in objects if o.get('finish_item') == 'kitchen-cabinets']
    assert shutters and all(o.data.materials[0].name == 'finish-cabinets' for o in shutters)
    bowls = [o for o in objects if o.name.startswith('kitchen-sink-bowl-')]
    assert len(bowls) == data['finishes']['kitchenSink']['bowls']
    assert all(o.get('finish_name') == data['finishes']['kitchenSink']['name'] for o in bowls)
    assert 'kitchen-faucet' in bpy.data.objects
    assert any(o.get('finish_item') == 'kitchen-counter' for o in objects)
    assert any(o.name.startswith('backsplash-') for o in objects)
    print(f'Kitchen material and geometry checks passed: {Path(filename).name}', flush=True)
