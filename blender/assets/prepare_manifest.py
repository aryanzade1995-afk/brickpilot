"""Maintainer-only curation. Pin official CC0 download URLs/checksums, never scrape pages.

Powered by Poly Haven (https://polyhaven.com).
Run once to update curated sources; ordinary installs use fetch_assets.py and manifest.json.
"""
import json
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
TEXTURES = {
    'white_plaster': ('white_plaster_02', 1.0),
    'lime_plaster': ('rough_plaster_03', 1.0),
    'exposed_concrete': ('concrete_wall_005', 1.0),
    'grey_stone': ('stone_tile_wall', .6),
    'sandstone': ('sandstone_blocks_05', .6),
    'teak_wood': ('teak_veneer', 1.0),
    'dark_wood': ('dark_wood', 1.0),
    'terracotta_tile': ('clay_roof_tiles_02', .6),
    'granite_paving': ('granite_tile_03', .6),
    'grass': ('grass_ground', 1.0),
    'gravel': ('gravel_floor_02', .6),
}
MODELS = {
    'tropical_tree_01': 'island_tree_01',
    'tropical_tree_02': 'pachira_aquatica_01',
    'broadleaf_tree': 'jacaranda_tree',
    'shrub_01': 'shrub_01', 'shrub_02': 'shrub_02',
    'planter': 'planter_pot_clay', 'garden_lamp': 'street_lamp_02',
    'outdoor_seating': 'outdoor_table_chair_set_01',
}
HDRIS = {'sunny_day': 'kloofendal_43d_clear_puresky',
         'golden_hour': 'kiara_8_sunset', 'overcast': 'kloofendal_overcast_puresky'}


def request(url):
    with urlopen(Request(url, headers={'User-Agent': 'Formstead-CC0-asset-setup/1.0 (Powered by Poly Haven)'}), timeout=90) as response:
        return json.load(response)


def main():
    manifest = {'schemaVersion': 1, 'credit': 'Powered by Poly Haven (https://polyhaven.com)',
                'license': 'CC0-1.0', 'textures': {}, 'hdri': {}, 'models': {}, 'files': [],
                'notes': ['The two palm slots use approved realistic tropical trees because the public Poly Haven catalogue has no palm models.',
                          'lime_plaster uses photographed rough plaster as a visual finish; the source does not certify lime chemistry.',
                          'Botanical assets combine scanned textures with artist-built geometry; they are not claimed to be whole-tree photogrammetry.',
                          'The garden lamp is an outdoor street light model; keep its supplied dimensions unless a smaller fixture is configured.']}

    def record(path, item, source, provider='Poly Haven'):
        manifest['files'].append({'path': path, 'url': item['url'], 'size': item['size'],
                                  'md5': item.get('md5'), 'source': source, 'provider': provider})
        return path

    for key, (asset, scale) in TEXTURES.items():
        files = request('https://api.polyhaven.com/files/' + asset)
        source = 'https://polyhaven.com/a/' + asset
        entry = {'assetId': asset, 'source': source, 'tileSizeM': scale, 'resolutions': {}}
        for resolution in ('4k', '1k'):
            maps = {}
            for channel, aliases in {'color': ('Diffuse',), 'normal': ('nor_gl',), 'roughness': ('Rough',),
                                     'displacement': ('Displacement',), 'ao': ('AO',)}.items():
                variants = next((files[a][resolution] for a in aliases if a in files and resolution in files[a]), None)
                if not variants:
                    if channel == 'ao': continue
                    raise ValueError(f'{asset} lacks {resolution} {channel}')
                # 16-bit PNG height where available; high-quality JPEG colors/normals
                # provided by the publisher keep the downloaded library practical.
                ext = 'png' if channel == 'displacement' and 'png' in variants else 'jpg' if 'jpg' in variants else 'png'
                maps[channel] = record(f'textures/{key}/{resolution}/{channel}.{ext}', variants[ext], source)
            entry['resolutions'][resolution] = maps
        manifest['textures'][key] = entry

    # Named travertine from ambientCG; each official ZIP includes the full map set.
    acg = request('https://ambientcg.com/api/v2/full_json?id=Travertine009&include=downloadData')['foundAssets'][0]
    entry = {'assetId': 'Travertine009', 'source': acg['shortLink'], 'tileSizeM': .6, 'resolutions': {}}
    for resolution in ('4k', '1k'):
        download = next(d for d in acg['downloadFolders']['default']['downloadFiletypeCategories']['zip']['downloads']
                        if d['attribute'] == resolution.upper() + '-JPG')
        manifest['files'].append({'path': f'textures/travertine/{resolution}/source.zip',
                                  'url': download['downloadLink'], 'size': download['size'], 'md5': None,
                                  'source': acg['shortLink'], 'provider': 'ambientCG', 'extract': True})
        entry['resolutions'][resolution] = {channel: f'textures/travertine/{resolution}/Travertine009_{resolution.upper()}-JPG_{suffix}.jpg'
            for channel, suffix in {'color': 'Color', 'normal': 'NormalGL', 'roughness': 'Roughness',
                                    'displacement': 'Displacement', 'ao': 'AmbientOcclusion'}.items()}
    manifest['textures']['travertine'] = entry

    for key, asset in HDRIS.items():
        files = request('https://api.polyhaven.com/files/' + asset)
        item = files['hdri']['4k']['hdr']
        path = record(f'hdri/{key}/{asset}_4k.hdr', item, 'https://polyhaven.com/a/' + asset)
        manifest['hdri'][key] = {'assetId': asset, 'source': 'https://polyhaven.com/a/' + asset, 'path': path, 'resolution': '4k'}

    for key, asset in MODELS.items():
        files = request('https://api.polyhaven.com/files/' + asset)
        # The supplied .blend retains maximum geometry and editable nodes; select
        # its highest published texture resolution, not an LOD or simplified GLB.
        resolution = max(files['blend'], key=lambda r: int(r.rstrip('k')))
        item = files['blend'][resolution]['blend']
        source = 'https://polyhaven.com/a/' + asset
        folder = f'models/{key}/{resolution}'
        path = record(f'{folder}/{asset}_{resolution}.blend', item, source)
        deps = [record(f'{folder}/{relative}', dependency, source) for relative, dependency in sorted(item.get('include', {}).items())]
        manifest['models'][key] = {'assetId': asset, 'source': source, 'resolution': resolution,
                                  'path': path, 'dependencies': deps, 'geometry': 'publisher maximum, no decimation'}

    ROOT.mkdir(parents=True, exist_ok=True)
    (ROOT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    total = sum(f['size'] for f in manifest['files'])
    print(f"Pinned {len(manifest['textures'])} texture sets, {len(manifest['hdri'])} HDRIs, {len(manifest['models'])} models: {len(manifest['files'])} files, {total / 1e9:.2f} GB", flush=True)


if __name__ == '__main__': main()
