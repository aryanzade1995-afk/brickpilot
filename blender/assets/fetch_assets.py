"""Reproducible local CC0 library installer. Never downloads at render time.

Powered by Poly Haven (https://polyhaven.com). Original blobs stay out of Git;
the pinned manifest and per-file licenses reconstruct the same local library.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
from pathlib import Path
import shutil
import time
from urllib.request import Request, urlopen
from urllib.parse import urlparse
import zipfile
import os
import subprocess

ROOT = Path(__file__).resolve().parent
ALLOWED_HOSTS = {'dl.polyhaven.org', 'ambientcg.com'}


def digest(path, algorithm='md5'):
    hasher = hashlib.new(algorithm)
    with path.open('rb') as data:
        for chunk in iter(lambda: data.read(1024 * 1024), b''): hasher.update(chunk)
    return hasher.hexdigest()


def asset_path(relative):
    path = (ROOT / relative).resolve()
    if not path.is_relative_to(ROOT) or path == ROOT:
        raise ValueError('Asset path escapes library')
    return path


def fetch(item):
    path = asset_path(item['path'])
    if urlparse(item['url']).scheme != 'https' or urlparse(item['url']).hostname not in ALLOWED_HOSTS:
        raise ValueError('Only pinned official HTTPS asset sources are allowed')
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_file() and path.stat().st_size == item['size'] and (not item.get('md5') or digest(path) == item['md5']):
        return path
    partial = path.with_name(path.name + '.partial')
    for attempt in range(5):
        try:
            with urlopen(Request(item['url'], headers={'User-Agent': 'Formstead-CC0-asset-setup/1.0 (Powered by Poly Haven)'}), timeout=120) as response, partial.open('wb') as target:
                shutil.copyfileobj(response, target, 1024 * 1024)
            if partial.stat().st_size != item['size'] or item.get('md5') and digest(partial) != item['md5']:
                raise ValueError(f'Publisher checksum/size mismatch: {item["path"]}')
            partial.replace(path)
            return path
        except Exception:
            if attempt == 4: raise
            time.sleep(2 ** attempt)


def inventory(manifest):
    rows, files = [], []
    for item in manifest['files']:
        path = asset_path(item['path'])
        if not path.is_file(): continue
        members = [path]
        if item.get('extract'):
            with zipfile.ZipFile(path) as archive:
                for member in archive.infolist():
                    target = asset_path(str(path.parent.relative_to(ROOT) / member.filename))
                    if member.is_dir(): continue
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(member) as source, target.open('wb') as output: shutil.copyfileobj(source, output)
                    members.append(target)
        for local in members:
            relative = local.relative_to(ROOT).as_posix()
            files.append({'path': relative, 'sha256': digest(local, 'sha256'), 'size': local.stat().st_size,
                          'source': item['source'], 'download': item['url'], 'license': 'CC0-1.0'})
            rows.append(f"| `{relative}` | [{item['provider']} source]({item['source']}) | [download]({item['url']}) | CC0-1.0 |")
    # Native 1K maps are provided for each surface set. Model dependency maps
    # also get local 1K derivatives, retaining alpha and tangent-normal direction.
    from PIL import Image
    import numpy as np
    exrs = [path for model in manifest['models'].values() for path in model['dependencies'] if path.endswith('.exr') and asset_path(path).is_file()]
    if exrs:
        executable = os.environ.get('BLENDER_BIN') or shutil.which('blender')
        if not executable:
            tools = ROOT.parents[1] / 'output' / 'tools'
            candidates = sorted(tools.glob('blender-*/blender.exe'), reverse=True)
            executable = str(candidates[0]) if candidates else None
        if not executable: raise ValueError('Set BLENDER_BIN to create the model EXR preview maps')
        subprocess.run([executable, '-b', '--factory-startup', '--threads', '2', '--python-exit-code', '1', '--python', str(ROOT / 'exr_previews.py')],
                       check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    for model in manifest['models'].values():
        for relative in model['dependencies']:
            source = asset_path(relative)
            if not source.is_file() or source.suffix.lower() not in ('.png', '.jpg', '.jpeg', '.exr'): continue
            preview_relative = relative.replace('/' + model['resolution'] + '/', '/1k/').replace('_' + model['resolution'] + '.', '_1k.')
            preview = asset_path(preview_relative)
            if not preview.exists() and source.suffix.lower() != '.exr':
                preview.parent.mkdir(parents=True, exist_ok=True)
                with Image.open(source) as image:
                    sixteen_bit = image.mode.startswith('I;16')
                    if sixteen_bit: image = image.convert('F')
                    image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
                    if '_nor_' in source.name:
                        normal = np.asarray(image.convert('RGB'), dtype=np.float32) / 127.5 - 1
                        normal /= np.maximum(np.linalg.norm(normal, axis=2, keepdims=True), 1e-6)
                        image = Image.fromarray(np.rint((normal + 1) * 127.5).clip(0, 255).astype('uint8'))
                    if sixteen_bit: image = Image.fromarray(np.rint(np.asarray(image)).clip(0,65535).astype('uint16'))
                    image.save(preview)
            original = next(f for f in files if f['path'] == relative)
            derived = {**original, 'path': preview_relative, 'sha256': digest(preview, 'sha256'),
                       'size': preview.stat().st_size, 'derivedFrom': relative, 'process': 'Lanczos 1K; normal vectors renormalized'}
            files.append(derived)
            rows.append(f"| `{preview_relative}` | [Poly Haven source]({original['source']}) | 1K derivative of `{relative}` | CC0-1.0 |")
    (ROOT / 'inventory.json').write_text(json.dumps({'schemaVersion': 1, 'files': files}, indent=2) + '\n', encoding='utf-8')
    text = '# Asset licenses and file provenance\n\nPowered by [Poly Haven](https://polyhaven.com).\n\n'
    text += 'Downloaded asset files are CC0 1.0. Licenses: [Poly Haven](https://polyhaven.com/license), [ambientCG](https://docs.ambientcg.com/license/), [CC0](https://creativecommons.org/publicdomain/zero/1.0/).\n\n'
    text += '\n'.join('- ' + note for note in manifest['notes']) + '\n\n'
    text += 'Binary files are installed locally, excluded from Git, and verified against the pinned manifest. `inventory.json` records SHA-256 for every installed original and extracted map. The installer can recreate them on another PC.\n\n'
    text += '| Local file | Source asset | Original download | License |\n| --- | --- | --- | --- |\n' + '\n'.join(rows) + '\n'
    (ROOT / 'LICENSES.md').write_text(text, encoding='utf-8')
    return len(files)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--workers', type=int, default=3)
    parser.add_argument('--group', choices=('textures', 'hdri', 'models', 'all'), default='all')
    args = parser.parse_args()
    if not 1 <= args.workers <= 4: parser.error('workers must be 1–4')
    manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
    items = [f for f in manifest['files'] if args.group == 'all' or f['path'].startswith(args.group + '/')]
    missing = sum(f['size'] for f in items if not asset_path(f['path']).is_file())
    if shutil.disk_usage(ROOT).free < missing + 2 * 1024 ** 3: raise ValueError('Insufficient free space for the selected asset library plus 2 GB reserve')
    failures = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(fetch, item): item for item in items}
        for index, future in enumerate(as_completed(futures), 1):
            item = futures[future]
            try:
                future.result()
                print(f'[{index}/{len(items)}] {item["path"]}', flush=True)
            except Exception as error:
                failures.append(item['path'])
                print(f'FAILED {item["path"]}: {error}', flush=True)
    count = inventory(manifest)
    print(f'Installed and recorded {count} files; failures={len(failures)}', flush=True)
    if failures: raise SystemExit(1)


if __name__ == '__main__': main()
