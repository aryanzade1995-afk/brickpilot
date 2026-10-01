"""Re-export compatible glTF PBR and refresh mesh measurements without re-rendering."""
import json
from pathlib import Path
import sys
import bpy
sys.path.insert(0, str(Path(__file__).resolve().parent))
from exporters.glb import export_glb
from exporters.shape import measure_shape
from generator import payload_digest

root = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
for seed in range(1, 51):
    directory = root / 'gallery-50-integrated' / str(seed)
    payload = json.loads((root / 'gallery-inputs' / f'villa_{seed}.json').read_text(encoding='utf-8'))
    bpy.ops.wm.open_mainfile(filepath=str(directory / f'villa_{seed}.blend'))
    manifest_path = directory / f'villa_{seed}.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    manifest['realizedGeometry'] = measure_shape(payload)
    manifest['inputDigest'] = payload_digest(payload)
    export_glb(directory / f'villa_{seed}.glb')
    manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
    print(f'FINALIZED seed={seed}', flush=True)
