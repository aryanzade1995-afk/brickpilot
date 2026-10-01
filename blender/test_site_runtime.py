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
    assert top < SITE_LEVELS["grade"], "Pool water must be below grade"
    for ground in [o for o in bpy.context.scene.objects if o.name.startswith(("Site_Ground", "Ground_Context"))]:
        assert not overlaps(bounds(ground)[0], feature["rect"]), "Solid ground covers the source pool"
    assert all(bpy.data.objects.get(f"{feature['id']}_Side_{i}") is not None for i in range(4))
print("PASS: source site rectangles, editable pool sides, water height and actual ground cut-outs")
