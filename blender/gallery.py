"""Render exact same-plan seeds in one Blender process with a fixed clay camera."""
import argparse
import json
from pathlib import Path
import sys
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from generator import main, payload_digest
from exporters.shape import measure_shape, MEASUREMENT_SCHEMA_VERSION

parser = argparse.ArgumentParser()
parser.add_argument("--inputs", required=True)
parser.add_argument("--out-dir", required=True)
parser.add_argument("--start", type=int, default=1)
parser.add_argument("--end", type=int, default=50)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
inputs, output = Path(args.inputs).resolve(), Path(args.out_dir).resolve()
output.mkdir(parents=True, exist_ok=True)
options = output / "clay-settings.json"
options.write_text(json.dumps({"render": {"engine": "EEVEE", "quality": "preview", "samples": 8, "resolution": [512, 384]},
                              "landscape": {"enabled": False},
                              "surfaces": {"stoneCladding": False, "woodSlats": False, "flutedPanels": False},
                              "lighting": {"fixtures": False, "interiorEmission": False}}), encoding="utf-8")
plan_id = None
for seed in range(args.start, args.end + 1):
    input_path = inputs / f"villa_{seed}.json"
    payload = json.loads(input_path.read_text(encoding="utf-8"))
    current_id = payload["buildingModel"]["planId"]
    if plan_id and current_id != plan_id:
        raise ValueError("Gallery inputs must use exactly one source plan")
    plan_id = current_id
    directory = output / str(seed)
    manifest_path = directory / f"villa_{seed}.json"
    previous = json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.exists() else {}
    complete = all((directory / f"villa_{seed}{suffix}").exists() for suffix in
                   ('.blend', '.glb', '_hero.png', '_front.png', '_aerial.png'))
    if complete and previous.get('inputDigest') == payload_digest(payload):
        if previous.get('realizedGeometry', {}).get('schemaVersion') != MEASUREMENT_SCHEMA_VERSION:
            bpy.ops.wm.open_mainfile(filepath=str(directory / f'villa_{seed}.blend'))
            previous['realizedGeometry'] = measure_shape(payload)
            manifest_path.write_text(json.dumps(previous), encoding='utf-8')
        print(f"GALLERY_RESUME seed={seed}", flush=True)
        continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    print(f"GALLERY_START seed={seed}", flush=True)
    main(["--input", str(input_path), "--out-dir", str(directory), "--name", f"villa_{seed}",
          "--visualization", str(options), "--render-all", "--production-names", "--clay", "--gallery-frame"])
    print(f"GALLERY_COMPLETE seed={seed}", flush=True)
