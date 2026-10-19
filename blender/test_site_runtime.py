"""Inspect actual editable site meshes from an exported Blender scene."""
import argparse
import json
from pathlib import Path
import sys
import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from geometry.site import overlaps, SITE_LEVELS


def bounds(obj):
    points = [obj.matrix_world @ Vector(p) for p in obj.bound_box]
    xs, ys, zs = [[getattr(p, axis) * 1000 for p in points] for axis in ("x", "y", "z")]
    return {"x": round(min(xs), 2), "y": round(min(ys), 2), "w": round(max(xs) - min(xs), 2),
            "h": round(max(ys) - min(ys), 2)}, max(zs)


parser = argparse.ArgumentParser()
parser.add_argument("--input", required=True)
parser.add_argument("--blend", required=True)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
building = json.loads(Path(args.input).read_text(encoding="utf-8"))["buildingModel"]
bpy.ops.wm.open_mainfile(filepath=str(Path(args.blend).resolve()))
for feature in building["siteFeatures"]:
    if feature["covered"]:
        continue
    obj = bpy.data.objects.get(feature["id"])
    assert obj is not None, feature["id"]
    assert obj.get("source_id") == feature["id"]
    rect, top = bounds(obj)
    assert all(abs(rect[k] - feature["rect"][k]) < .1 for k in rect), (feature, rect)
    if feature["kind"] != "pool":
        continue
    ground_floor=min(building['floors'],key=lambda f:f['level'])
    pool_grade=ground_floor['elevationMm'] if feature.get('roomId')=='courtyard' else ground_floor['elevationMm']-building.get('structuralSizing',{}).get('plinthHeightMm',-SITE_LEVELS['grade'])
    assert top < pool_grade, "Pool water must be below its source court/site grade"
    assert obj.get('material_role')=='water','Pool must use water rather than window glazing'
    shader=next(n for n in obj.data.materials[0].node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    assert abs(shader.inputs['IOR'].default_value-1.333)<.001,'Water uses the wrong refraction'
    basin=bpy.data.objects.get(f"{feature['id']}_Basin")
    assert basin is not None and basin.get('material_role')=='pool_tile','Light pool lining missing'
    for ground in [o for o in bpy.context.scene.objects if o.name.startswith(("Site_Ground", "Ground_Context"))]:
        assert not overlaps(bounds(ground)[0], feature["rect"]), "Solid ground covers the source pool"
    assert all(bpy.data.objects.get(f"{feature['id']}_Side_{i}") is not None for i in range(4))
    if feature.get('roomId')=='courtyard':
        paving=[o for o in bpy.context.scene.objects if o.name.startswith('Courtyard_Paving')]
        assert paving,'Courtyard paving missing'
        assert not any(overlaps(bounds(o)[0],feature['rect']) for o in paving),'Courtyard paving covers the pool'
        assert not any(o.name.startswith('Courtyard_Garden') for o in bpy.context.scene.objects),'Central planter covers the pool'
specialized=(json.loads(Path(args.input).read_text(encoding='utf-8')).get('facadeGrammar',{}).get('specialized') or {})
for unit in specialized.get('assemblies',[]):
    if unit['category']!='BALCONY':
        continue
    for part in unit['parts']:
        if part['role']!='post':
            continue
        obj=next((o for o in bpy.context.scene.objects if o.get('grammar_part_id')==part['id']),None)
        assert obj is not None,'Balcony post mesh missing'
        floor=next(f for f in building['floors'] if f['id']==part['anchor']['floorId'])
        points=[obj.matrix_world@Vector(p) for p in obj.bound_box]
        assert abs(min(p.z for p in points)*1000-floor['elevationMm'])<.2,'Balcony post floats above its slab'
print("PASS: source site rectangles, editable pool sides, water height and actual ground cut-outs")
