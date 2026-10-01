"""Contact sheets of actual Blender clay renders for visual review."""
import json
from pathlib import Path
import sys
from PIL import Image, ImageDraw, ImageFont

root = Path(sys.argv[1]).resolve()
font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 17)
for start in (1, 26):
    canvas = Image.new('RGB', (1600, 1340), '#ededed')
    draw = ImageDraw.Draw(canvas)
    for i, seed in enumerate(range(start, start + 25)):
        x, y = (i % 5) * 320, (i // 5) * 268
        picture = Image.open(root / str(seed) / f'villa_{seed}_hero.png').convert('RGB')
        picture.thumbnail((320, 240))
        canvas.paste(picture, (x, y))
        payload = json.loads((root.parent / 'gallery-inputs' / f'villa_{seed}.json').read_text(encoding='utf-8'))
        draw.text((x + 8, y + 243), f"{seed} · {payload['massingModel']['family'].replace('_', ' ')}", fill='#222', font=font)
    canvas.save(root / f'contact-sheet-{start}-{start + 24}.jpg', quality=95)
