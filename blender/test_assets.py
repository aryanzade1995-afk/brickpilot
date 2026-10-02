"""Audit installed publisher files, PBR channels, resolution and reproducibility."""
import json
from pathlib import Path
import unittest
from PIL import Image

ROOT = Path(__file__).resolve().parent / 'assets'
MANIFEST = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))


class AssetLibraryTest(unittest.TestCase):
    def test_required_surface_sets_have_4k_and_1k_actual_maps(self):
        self.assertEqual(set(MANIFEST['textures']), {'white_plaster', 'lime_plaster', 'exposed_concrete', 'grey_stone',
            'sandstone', 'travertine', 'teak_wood', 'dark_wood', 'terracotta_tile', 'granite_paving', 'grass', 'gravel'})
        for name, spec in MANIFEST['textures'].items():
            for resolution, maps in spec['resolutions'].items():
                self.assertTrue({'color', 'normal', 'roughness', 'displacement'} <= maps.keys(), name)
                for channel, path in maps.items():
                    with self.subTest(name=name, resolution=resolution, channel=channel), Image.open(ROOT / path) as image:
                        self.assertEqual(max(image.size), 4096 if resolution == '4k' else 1024)
                        if channel == 'normal': self.assertIn(image.mode, ('RGB', 'RGBA'))

    def test_three_real_hdris_and_eight_unsimplified_models_are_present(self):
        self.assertEqual(set(MANIFEST['hdri']), {'sunny_day', 'golden_hour', 'overcast'})
        for spec in MANIFEST['hdri'].values():
            with (ROOT / spec['path']).open('rb') as file:
                self.assertTrue(file.read(10).startswith((b'#?RADIANCE', b'#?RGBE')))
        self.assertEqual(len(MANIFEST['models']), 8)
        for spec in MANIFEST['models'].values():
            with (ROOT / spec['path']).open('rb') as file:
                # Publisher blend files may be compressed using zstd or gzip.
                self.assertIn(file.read(4), (b'BLEN', b'\x28\xb5\x2f\xfd', b'\x1f\x8b\x08\x00'))
            self.assertEqual(spec['geometry'], 'publisher maximum, no decimation')
            self.assertTrue(spec['dependencies'])
            for dependency in spec['dependencies']:
                self.assertTrue((ROOT / dependency).is_file(), dependency)
                preview = dependency.replace('/' + spec['resolution'] + '/', '/1k/').replace('_' + spec['resolution'] + '.', '_1k.')
                if preview.endswith('.exr'):
                    self.assertTrue((ROOT / preview).is_file())
                else:
                    with Image.open(ROOT / preview) as image: self.assertLessEqual(max(image.size), 1024)

    def test_every_installed_file_has_license_source_and_integrity_record(self):
        inventory = json.loads((ROOT / 'inventory.json').read_text(encoding='utf-8'))['files']
        paths = {f['path'] for f in inventory}
        self.assertEqual(len(paths), len(inventory))
        self.assertTrue({f['path'] for f in MANIFEST['files']} <= paths)
        licenses = (ROOT / 'LICENSES.md').read_text(encoding='utf-8')
        for item in inventory:
            self.assertEqual(item['license'], 'CC0-1.0')
            self.assertEqual(len(item['sha256']), 64)
            self.assertIn(item['path'], licenses)
            self.assertIn(item['source'], licenses)
            self.assertEqual((ROOT / item['path']).stat().st_size, item['size'])


if __name__ == '__main__': unittest.main(verbosity=2)
