"""Migrate local accepted scene measurements after a sampling-frame change."""
import json
from pathlib import Path
import sys
import bpy
sys.path.insert(0, str(Path(__file__).resolve().parent))
from exporters.shape import measure_shape

output = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
history_path = output / 'villa-production-history.json'
history = json.loads(history_path.read_text(encoding='utf-8'))
updated = {}
for path in (output / 'villa-jobs').glob('*/accepted.json'):
    accepted = json.loads(path.read_text(encoding='utf-8'))
    directory, seed = Path(accepted['directory']), accepted['seed']
    payload = json.loads((directory / 'input.json').read_text(encoding='utf-8'))
    bpy.ops.wm.open_mainfile(filepath=str(directory / f'villa_{seed}.blend'))
    geometry = measure_shape(payload)
    accepted['realizedGeometry'] = geometry
    path.write_text(json.dumps(accepted), encoding='utf-8')
    manifest_path = directory / f'villa_{seed}.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    manifest['realizedGeometry'] = geometry
    manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
    updated[(accepted['planId'], seed)] = geometry
for item in history:
    key = (item['geometry']['planId'], item['geometry']['seed'])
    if key in updated:
        item['geometry'] = updated[key]
history_path.write_text(json.dumps(history), encoding='utf-8')
