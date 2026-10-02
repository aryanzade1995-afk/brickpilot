"""Build one editable Blender scene per new element and composition family."""
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import bpy
from generator import create_scene
from exporters.glb import export_glb
folder=Path(sys.argv[sys.argv.index('--')+1]).resolve()
results=[]
for path in sorted(folder.glob('*.json')):
    if path.name=='results.json': continue
    payload=json.loads(path.read_text())
    scene=create_scene(payload, {'render':{'engine':'EEVEE','quality':'preview'}})
    feature=payload['facadeGrammar']['features'][0]
    objects=[o for o in scene.collections['FACADE'].objects if o.get('source_id')==feature['id']]
    assert len(objects)==len(feature['parts']), path.name
    for part in feature['parts']:
        assert part['materialHint'] in ('wood','stone','wall','metal','glass')
    bpy.ops.wm.save_as_mainfile(filepath=str(path.with_suffix('.blend')))
    export_glb(path.with_suffix('.glb'))
    results.append({'name':path.stem,'parts':len(objects),'passed':True})
    print('ELEMENT PASS '+path.stem,flush=True)
folder.joinpath('results.json').write_text(json.dumps(results,indent=2))
assert len(results)==18
