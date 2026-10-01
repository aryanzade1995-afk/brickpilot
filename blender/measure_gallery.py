import json
from pathlib import Path
import sys
import bpy
sys.path.insert(0, str(Path(__file__).resolve().parent))
from exporters.shape import measure_shape

root = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
for seed in range(1, 51):
    directory = root / 'gallery-50' / str(seed)
    payload = json.loads((root / 'gallery-inputs' / f'villa_{seed}.json').read_text(encoding='utf-8'))
    bpy.ops.wm.open_mainfile(filepath=str(directory / f'villa_{seed}.blend'))
    manifest_path = directory / f'villa_{seed}.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    manifest['realizedGeometry'] = measure_shape(payload)
    manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
    print(f'MEASURED seed={seed}', flush=True)
