"""Package the curated real-photo reference collection; never generate images."""
import csv
import hashlib
import html
import json
from collections import Counter
from pathlib import Path
import zipfile
from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / 'public/datasets/modern-villas-v1'
records = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
assert records and all(r['image_type'] == 'real_photograph' for r in records)
assert len({r['id'] for r in records}) == len(records)
assert len({r['sha256'] for r in records}) == len(records), 'Duplicate photo bytes'
for r in records:
    p = (ROOT / r['file']).resolve()
    assert p.is_relative_to(ROOT.resolve())
    assert hashlib.sha256(p.read_bytes()).hexdigest() == r['sha256']
    with Image.open(p) as im:
        assert im.size == (r['width'], r['height'])
        im.verify()
    assert r['source_url'].startswith('https://commons.wikimedia.org/')
    assert r['creator'] and r['license'].startswith('CC BY')
    r['review_status'] = 'visually_reviewed'
    r['image_origin'] = 'Web photograph; not AI-generated'
    r['modifications'] = 'Wikimedia-provided resized preview; no crop, retouching or local recompression.'
    r['group_id'] = r['building_name'].lower().replace(' ', '-')
    r['split'] = 'reference_only'
    if not r['license_url']:
        terms = r['license'].split()
        r['license_url'] = f'https://creativecommons.org/licenses/{terms[1].lower()}/{terms[2]}/'

counts = Counter((r['building_type'], r['style']) for r in records)
assert all(counts[(t, s)] for t in ['villa-bungalow', 'large-villa'] for s in ['modern-box', 'contemporary', 'courtyard'])
(ROOT / 'manifest.json').write_text(json.dumps(records, indent=2, ensure_ascii=False), encoding='utf-8')
with (ROOT / 'manifest.csv').open('w', encoding='utf-8-sig', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=list(records[0]))
    writer.writeheader()
    writer.writerows(records)

licences = ['# Image sources and licences', '', 'Each photograph retains its own licence. Attribution and share-alike conditions apply as listed below. There is no blanket CC0 licence for this collection.', '']
for r in records:
    licences += [f"## {r['id']} — {r['building_name']}", '', f"File: `{r['file']}`", f"Creator: {r['creator']}", f"Credit: {r['credit']}", f"Source: {r['source_url']}", f"Original image: {r['original_url']}", f"Licence: [{r['license']}]({r['license_url']})", f"Changes: {r['modifications']}", '']
(ROOT / 'LICENSES.md').write_text('\n'.join(licences), encoding='utf-8')
lines = ['# Modern villa photo reference dataset v1', '', f"{len(records)} real photographs of {len({r['group_id'] for r in records})} buildings. No AI images are included.", '', '## Categories', '', '| Reference type | Style | Photos |', '| --- | --- | --- |']
for (t,s), count in sorted(counts.items()):
    lines.append(f'| {t} | {s} | {count} |')
lines += ['', '## Contents', '', '`images/real/<building-type>/<style>/`: licensed photo files.', '`manifest.csv` and `manifest.json`: labels, dimensions, creators, source URLs, licences and SHA-256 checksums.', '`LICENSES.md`: per-photo attribution and licence links.', '`index.html`: standalone offline gallery; open after extracting the ZIP.', '', '## Collection and use', '', 'Discovery used Google Search and Wikimedia Commons search/image metadata APIs. Photos were downloaded from Wikimedia Commons, not from Google thumbnails. All selected previews were visually inspected. No AI-generated images or unknown-licence images are included.', '', 'This is a small architectural reference dataset. Some buildings are historical modernist precedents. Contemporary is an application reference grouping, not a claim about construction date. Villa/bungalow and large-villa labels are approximate reference groupings; verified floor areas, room counts and dimensions are unknown. No photographed building is guaranteed to match the application grammar exactly.', '', 'Use for browsing, style inspiration and prototyping retrieval. It is too small and too concentrated on a few buildings to claim a general-purpose trained villa generator. Multiple views of the same building share group_id: split by building when expanding into a training/evaluation dataset, to avoid leakage. No fabricated training/test split is supplied.', '', 'Real photos cannot establish floor plans, structural safety or buildability. Generated 2D/3D plans remain governed by the application validators.', '', '## Search record', '', '[Google discovery query](https://www.google.com/search?q=modern+villa+exterior+photographs+site%3Acommons.wikimedia.org)', '', 'All direct file sources are preserved in the manifests and LICENSES.md.']
(ROOT / 'README.md').write_text('\n'.join(lines), encoding='utf-8')
cards = []
for r in records:
    esc = html.escape
    cards.append(f'<figure data-type="{r["building_type"]}" data-style="{r["style"]}"><a href="{esc(r["file"])}"><img loading="lazy" src="{esc(r["file"])}" alt="{esc(r["building_name"])}"></a><figcaption><b>{esc(r["building_name"])}</b><p>{r["building_type"]} / {r["style"]}</p><p>{esc(r["creator"])} · {r["license"]}</p><a href="{esc(r["source_url"])}">Source and attribution</a> · <a download href="{esc(r["file"])}">Download image</a></figcaption></figure>')
page = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Modern villa photo dataset</title><style>body{background:#f4f4f4;color:#161616;margin:0;padding:32px;font-family:system-ui}main{max-width:1400px;margin:auto}select{padding:12px;margin:12px 8px 12px 0}#gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:22px}figure{background:white;border:1px solid #ddd;margin:0}img{width:100%;height:260px;object-fit:contain;background:#eee}figcaption{padding:16px;font-size:13px}a{color:inherit}figure[hidden]{display:none}</style></head><body><main><h1>Modern villa photo dataset</h1><p>' + str(len(records)) + ' real photographs. Six reference groups. No AI images.</p><p>Some images show historical modernist precedents. Size labels are approximate; no floor plans or verified dimensions are supplied.</p><p><a download href="manifest.csv">CSV labels</a> · <a download href="manifest.json">JSON metadata</a> · <a href="LICENSES.md">Licences</a> · <a href="README.md">Dataset notes</a></p><label>Type <select id="type"><option value="all">All</option><option value="villa-bungalow">Villa / bungalow</option><option value="large-villa">Large villa</option></select></label><label>Style <select id="style"><option value="all">All</option><option value="modern-box">Modern Box</option><option value="contemporary">Contemporary</option><option value="courtyard">Courtyard</option></select></label><div id="gallery">' + ''.join(cards) + '</div></main><script>function filter(){for(const card of document.querySelectorAll("figure"))card.hidden=!( (document.querySelector("#type").value==="all"||card.dataset.type===document.querySelector("#type").value)&&(document.querySelector("#style").value==="all"||card.dataset.style===document.querySelector("#style").value));}document.querySelectorAll("select").forEach(s=>s.addEventListener("change",filter));</script></body></html>'
(ROOT / 'index.html').write_text(page, encoding='utf-8')
archive = ROOT / 'modern-villas-v1.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
    for r in records:
        z.write(ROOT / r['file'], 'modern-villas-v1/' + r['file'])
    for name in ['manifest.json', 'manifest.csv', 'LICENSES.md', 'README.md', 'index.html']:
        z.write(ROOT / name, 'modern-villas-v1/' + name)
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
print(json.dumps({'images': len(records), 'buildings': len({r['group_id'] for r in records}), 'zip_bytes': archive.stat().st_size, 'groups': {f'{t}/{s}': n for (t,s),n in counts.items()}}, indent=2))
