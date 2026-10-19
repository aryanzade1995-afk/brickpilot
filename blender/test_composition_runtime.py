"""Check composition roof planes and beam-cleared glazing in the actual scene."""
import argparse
import json
from pathlib import Path
import sys
import bpy
from mathutils import Vector

parser=argparse.ArgumentParser()
parser.add_argument('--input',required=True)
parser.add_argument('--blend',required=True)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
b=json.loads(Path(args.input).read_text(encoding='utf-8'))['buildingModel']
bpy.ops.wm.open_mainfile(filepath=str(Path(args.blend).resolve()))
composition=b['modernComposition']
assert len(composition['canopies'])>=2,'Composition lost its attached roof planes'

def bounds(obj):
    points=[obj.matrix_world@Vector(v) for v in obj.bound_box]
    return [[min(getattr(p,a) for p in points)*1000,max(getattr(p,a) for p in points)*1000] for a in ('x','y','z')]

for c in composition['canopies']:
    obj=bpy.data.objects.get(c['id'])
    assert obj is not None and obj.get('composition_canopy'),'Editable canopy missing'
    assert obj.get('source_window_id')==c['sourceWindowId']
    bb=bounds(obj)
    expected=[(c['rect']['x'],c['rect']['w']),(c['rect']['y'],c['rect']['h']),(c['bottomMm'],c['thicknessMm'])]
    for axis,(start,size) in zip(bb,expected):
        assert abs(axis[0]-start)<.5 and abs(axis[1]-start-size)<.5,'Canopy differs from source geometry'
    soffit=bpy.data.objects.get(c['id']+'_TimberSoffit')
    assert soffit is not None and soffit.get('material_role')=='wood'
    assert abs(bounds(soffit)[2][1]-c['bottomMm'])<.5,'Soffit is detached'
for w in b['windows']:
    if 'head' not in w:
        continue
    f=next(f for f in b['floors'] if f['id']==w['floorId'])
    axis=0 if w['orient']=='h' else 1
    fixed=w['at']['y' if axis==0 else 'x']
    at=w['at']['x' if axis==0 else 'y']
    for beam in [o for o in bpy.context.scene.objects if o.name.startswith('Beam_'+f['id'])]:
        bb=bounds(beam)
        if bb[1-axis][0]<fixed<bb[1-axis][1] and bb[axis][0]<at+w['width']/2 and bb[axis][1]>at-w['width']/2:
            assert f['elevationMm']+w['head']<bb[2][0]+.5,'Structural beam crosses the tall glazing'
print(f"PASS: {composition['id']}, {len(composition['canopies'])} editable canopy planes, timber soffits and beam-cleared glazing")
