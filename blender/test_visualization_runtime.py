"""Verify the visualization data in an actual saved .blend scene."""

import argparse
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
sys.path.insert(0, str(Path(__file__).resolve().parent))
from visualization.config import CAMERAS  # noqa: E402
from visualization.palettes import PALETTES  # noqa: E402
from visualization.materials import create_materials  # noqa: E402


def main(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument("--blend", required=True)
    parser.add_argument("--manifest", required=True)
    args = parser.parse_args(argv)
    bpy.ops.wm.open_mainfile(filepath=str(Path(args.blend).resolve()))
    report = json.loads(Path(args.manifest).read_text())["visualization"]
    scene = bpy.context.scene
    used = {slot.material for obj in scene.objects if obj.type == "MESH" for slot in obj.material_slots if slot.material}
    assert len(used) <= 14, f"Excess materials: {len(used)}"
    assert all(m.use_nodes and any(n.type == "BSDF_PRINCIPLED" for n in m.node_tree.nodes) for m in used)
    assert all(any(n.type == "TEX_NOISE" for n in m.node_tree.nodes) for m in used if m.get("surface_type") in ("plaster", "wood", "concrete", "stone"))
    assert all(name in bpy.data.objects for name in CAMERAS)
    points = [obj.matrix_world @ Vector(corner) for obj in scene.objects if obj.type == "MESH" and
              not obj.get("presentation_only") and any(c.name != "LANDSCAPE" for c in obj.users_collection) for corner in obj.bound_box]
    for name in CAMERAS:
        camera = bpy.data.objects[name]
        assert camera.type == "CAMERA"
        assert all(.065 <= p.x <= .935 and .065 <= p.y <= .935 and p.z > 0 for p in
                   (world_to_camera_view(scene, camera, point) for point in points)), f"Clipped architecture in {name}"
    assert scene.render.engine in ("CYCLES", "BLENDER_EEVEE_NEXT")
    assert scene.view_settings.view_transform == "AgX"
    assert scene.cycles.use_denoising and scene.cycles.transmission_bounces >= 6
    profiles = [obj for obj in scene.objects if obj.get("finish_profile_depth_mm")]
    if sum(report["surfaces"].values()):
        assert profiles, "Physical cladding/slat substrate treatments are missing"
        assert any(obj.get("finish_parent") and any(mod.type == "ARRAY" for mod in obj.modifiers) for obj in scene.objects)
    for core in profiles:
        assert core["composite_thickness_mm"] > core["finish_profile_depth_mm"] + 2
        assert abs(min(core.dimensions) * 1000 - (core["composite_thickness_mm"] - core["finish_profile_depth_mm"] - 2)) < 1, "Physical profile remains hidden inside its substrate"
    if report["palette"] == "WHITE_FLUTED_STONE" and report["options"]["surfaces"]["flutedPanels"]:
        assert report["surfaces"]["flutedPanels"] > 0, "Selected stone flutes must produce physical geometry"
    assert bpy.data.objects["Sun_Architectural"].data.energy > 0
    assert scene.world.use_nodes
    if report["lighting"]["environment"] == "HDRI":
        assert any(n.type == "TEX_ENVIRONMENT" and n.image.packed_file for n in scene.world.node_tree.nodes)
    else:
        assert any(n.type == "TEX_SKY" for n in scene.world.node_tree.nodes)
    if report["options"]["landscape"]["enabled"]:
        assert any(o.get("botanical_instance") for o in scene.objects)
    for role, bounds in {"primary": (.55, .75), "secondary": (.15, .30), "accent": (.05, .15)}.items():
        assert bounds[0] <= report["composition"]["actual"][role] <= bounds[1], report["composition"]
    # Exercise each palette's actual node graph, not only its Python data.
    for name in PALETTES:
        materials = create_materials(name)
        glass = next(n for n in materials["glass"].node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        assert glass.inputs["Transmission Weight"].default_value == 1
        assert abs(glass.inputs["IOR"].default_value - 1.45) < .001
        assert materials["wall"] == materials["primary_wall"]
    print(json.dumps({"result": "passed", "palette": report["palette"], "activeMaterials": len(used),
                      "cameras": list(CAMERAS), "composition": report["composition"]["actual"],
                      "planters": len(report["landscape"]["planters"]), "engine": scene.render.engine}, indent=2))


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:])
