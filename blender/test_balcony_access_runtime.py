"""Verify fixed windows and actual hinged/sliding balcony doors in saved meshes."""
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
assert b['openingPolicy']['minWindowSillMm']==900
for window in b['windows']:
    assert window.get('sill',900)>=900,'A window is drawn as floor-level access'
    assert 'treatment' not in window and 'leaf' not in window
    glass=bpy.data.objects.get(f"Window_{window['id']}_Glass")
    assert glass is not None and glass.get('opening_operation')=='fixed-window'
    floor=next(f for f in b['floors'] if f['id']==window['floorId'])
    bottom=min((glass.matrix_world@Vector(p)).z for p in glass.bound_box)*1000
    assert bottom>=floor['elevationMm']+window.get('sill',900),'Window mesh lost its sill'
sliders=0
for door in b['doors']:
    if door.get('treatment')!='glazed-slide':
        continue
    sliders+=1
    names=[f"Door_{door['id']}_Sliding{side}_Glass" for side in ('Left','Right')]
    panels=[bpy.data.objects.get(name) for name in names]
    assert all(p is not None and p.get('opening_operation')=='sliding-door' for p in panels),'Sliding panels missing'
    fixed_axis='y' if door['orient']=='h' else 'x'
    assert abs(getattr(panels[0].location,fixed_axis)-getattr(panels[1].location,fixed_axis))>.03,'Panels occupy the same track'
    assert bpy.data.objects.get(f"Door_{door['id']}_SlidingTrack") is not None
    assert all(bpy.data.objects.get(f"Door_{door['id']}_Sliding{side}_Handle") is not None for side in ('Left','Right'))
for room in b['rooms']:
    if not room['outdoor'] or not room['id'].startswith('balcony'):
        continue
    access=next((d for d in b['doors'] if d['floorId']==room['floorId'] and room['id'] in d.get('rooms',[])),None)
    assert access is not None and access['kind']=='door','Window used as balcony access'
    if access.get('treatment')!='glazed-slide':
        assert bpy.data.objects.get(f"Door_{access['id']}_Leaf") is not None
assert sliders>0,'Sliding door coverage missing'
print(f"PASS: {len(b['windows'])} fixed raised-sill windows, {sliders} two-panel sliding doors, and real balcony access")
