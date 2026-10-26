"""Offline style library. Replays production architecture; never runs in a web request."""
import argparse
import hashlib
import json
import os
import sys
import time
import traceback
from pathlib import Path
import bpy
sys.path.insert(0, str(Path(__file__).resolve().parent))
from generator import create_scene

parser = argparse.ArgumentParser()
parser.add_argument('--inputs', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--start', type=int, default=0)
parser.add_argument('--end', type=int, default=240)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
inputs, output = Path(args.inputs), Path(args.output)
output.mkdir(parents=True, exist_ok=True)
index = json.loads((inputs / 'index.json').read_text(encoding='utf-8'))
options = {'render': {'engine': 'EEVEE', 'quality': 'preview', 'samples': 16, 'resolution': [768, 576]}, 'landscape': {'enabled': False}}
for item in index['entries'][args.start:args.end]:
    if item['status'] != 'ready':
        continue
    key = item['id']
    source = (inputs / f'{key}.json').read_bytes()
    digest = hashlib.sha256(source + json.dumps(options, sort_keys=True).encode()).hexdigest()
    image, record = output / f'{key}.png', inputs / f'{key}.render.json'
    if image.exists() and record.exists() and json.loads(record.read_text()).get('digest') == digest:
        continue
    # Multiple offline batches may share a library; only one owns each image.
    lock = inputs / f'{key}.lock'
    try:
        with lock.open('x') as handle:
            handle.write(str(os.getpid()))
    except FileExistsError:
        continue
    start = time.monotonic()
    try:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        payload = json.loads(source)['payload']
        create_scene(payload, options)
        bpy.context.scene.camera = bpy.data.objects['HeroPerspectiveCamera']
        bpy.context.scene.render.filepath = str(image.resolve())
        bpy.ops.render.render(write_still=True)
        record.write_text(json.dumps({'digest': digest, 'source': 'Blender', 'planId': payload['buildingModel']['planId'], 'seed': payload['villaDesignDNA']['seed'], 'image': item['image'], 'seconds': round(time.monotonic() - start, 2)}))
        print('HOUSE_IDEA ' + json.dumps({'id': key, 'status': 'ready', 'seconds': round(time.monotonic() - start, 2)}), flush=True)
    except Exception as error:
        traceback.print_exc()
        record.write_text(json.dumps({'digest': digest, 'status': 'failed', 'reason': str(error)}))
        print('HOUSE_IDEA ' + json.dumps({'id': key, 'status': 'failed', 'reason': str(error)}), flush=True)
    finally:
        lock.unlink(missing_ok=True)
