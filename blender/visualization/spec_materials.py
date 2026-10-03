"""Specification material registry. Opt-in; existing villa palettes remain intact."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = ROOT / "blender/assets/spec-materials.json"


def material_spec(material_id):
    entries = json.loads(REGISTRY.read_text(encoding="utf-8"))["materials"]
    spec = next((m for m in entries if m["id"] == material_id), None)
    if spec is None:
        raise ValueError(f"Unknown specification material: {material_id}")
    path = (ROOT / spec["texture"]).resolve()
    if not path.is_relative_to(ROOT / "blender/assets/textures") or not path.is_file():
        raise ValueError(f"Missing or unsafe specification texture: {material_id}")
    return spec, path


def create_spec_material(material_id):
    """Editable image-based shader using the exact catalogue close-up file."""
    import bpy
    spec, path = material_spec(material_id)
    material = bpy.data.materials.get("Spec_" + material_id) or bpy.data.materials.new("Spec_" + material_id)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = bpy.data.images.load(str(path), check_existing=True)
    texture.image.colorspace_settings.name = "sRGB"
    texture.projection, texture.projection_blend = "BOX", .2
    geometry = nodes.new("ShaderNodeNewGeometry")
    scale = nodes.new("ShaderNodeVectorMath")
    scale.operation = "SCALE"
    scale.inputs[3].default_value = 1 / spec["tileSizeM"]
    links.new(geometry.outputs["Position"], scale.inputs[0])
    links.new(scale.outputs["Vector"], texture.inputs["Vector"])
    links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    shader.inputs["Roughness"].default_value = spec["roughness"]
    shader.inputs["Metallic"].default_value = spec["metallic"]
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    material["specification_id"] = material_id
    material["source_texture"] = spec["texture"]
    return material
