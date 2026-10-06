"""Build edited layouts and test the actual Blender pillar meshes."""
import json
from copy import deepcopy
import sys
from pathlib import Path
import bpy
sys.path.insert(0, str(Path(__file__).resolve().parent))
from generator import create_scene
from covered_validation import validate_outdoor_meshes

args = sys.argv[sys.argv.index('--')+1:]
paths = sorted(Path(args[0]).glob('*.json'))
for path in paths:
    payload = json.loads(path.read_text())
    scene = create_scene(payload, {'render': {'engine': 'EEVEE', 'quality': 'preview', 'resolution': [640,480], 'samples': 8}})
    count = validate_outdoor_meshes(payload)
    assert count > 0
    pillar = next(o for o in bpy.context.scene.objects if o.name.startswith('GF_') and '_Roof_' in o.name and '_Post_' in o.name)
    old = pillar.location.copy()
    car = next((o for o in bpy.context.scene.objects if o.name.startswith('GF_Parking_Car_') and o.name.endswith('_Body')), None)
    target = car or next(o for o in bpy.context.scene.objects if o.name.startswith('Column_'))
    pillar.location.x, pillar.location.y = target.location.x, target.location.y
    collision_payload = deepcopy(payload)
    collision_payload['facadeGrammar'].pop('coveredOutdoor')
    try:
        validate_outdoor_meshes(collision_payload)
    except ValueError:
        pass
    else:
        raise AssertionError('Actual colliding pillar accepted')
    pillar.location = old
    print(f'CHECKED {path.name}: {count} exterior pillars; injected collision rejected', flush=True)
    if len(args)>1 and path.name == '3.json':
        bpy.context.scene.render.filepath = str(Path(args[1]).resolve())
        bpy.ops.render.render(write_still=True)
print(f'{len(paths)} real Blender scenes passed', flush=True)
