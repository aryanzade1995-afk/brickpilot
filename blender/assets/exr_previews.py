"""Use Blender's OpenEXR reader for the few publisher model EXR dependencies."""
import bpy
import json
from pathlib import Path
import sys
from array import array
from math import sqrt

root = Path(__file__).resolve().parent
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
for spec in manifest['models'].values():
    for relative in spec['dependencies']:
        if not relative.endswith('.exr'): continue
        source = root / relative
        preview = root / relative.replace('/' + spec['resolution'] + '/', '/1k/').replace('_' + spec['resolution'] + '.', '_1k.')
        if preview.exists(): continue
        if not source.exists(): continue
        image = bpy.data.images.load(str(source), check_existing=False)
        image.colorspace_settings.name = 'Non-Color'
        width, height = image.size
        factor = 1024 / max(width, height)
        image.scale(round(width * factor), round(height * factor))
        if '_nor_' in source.name:
            pixels = array('f', [0.0]) * (image.size[0] * image.size[1] * 4)
            image.pixels.foreach_get(pixels)
            for i in range(0, len(pixels), 4):
                x, y, z = (pixels[i+j] * 2 - 1 for j in range(3))
                length = max(1e-6, sqrt(x*x+y*y+z*z))
                for j, value in enumerate((x,y,z)): pixels[i+j] = (value / length + 1) / 2
            image.pixels.foreach_set(pixels)
        preview.parent.mkdir(parents=True, exist_ok=True)
        image.file_format = 'OPEN_EXR'
        image.filepath_raw = str(preview)
        image.save()
        bpy.data.images.remove(image)
        print('1K EXR', preview.relative_to(root), flush=True)
