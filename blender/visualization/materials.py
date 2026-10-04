"""Physically scaled procedural PBR surfaces, with a small curated finish set."""

from .palettes import palette_specs, resolve_palette, color_rgba, finish, ALIASES


def _material(name, spec):
    import bpy
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    output, shader = nodes.new("ShaderNodeOutputMaterial"), nodes.new("ShaderNodeBsdfPrincipled")
    output.location, shader.location = (650, 0), (350, 0)
    color = color_rgba(spec["color"])
    material.diffuse_color = color
    shader.inputs["Base Color"].default_value = color
    shader.inputs["Roughness"].default_value = spec["roughness"]
    shader.inputs["Metallic"].default_value = spec["metallic"]
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    material["surface_type"], material["roughness"] = spec["surface"], spec["roughness"]
    surface = spec["surface"]
    if surface == "glass":
        shader.inputs["Transmission Weight"].default_value = spec["transmission"]
        shader.inputs["IOR"].default_value = spec["ior"]
        if hasattr(material, "use_raytrace_refraction"):
            material.use_raytrace_refraction = True
        if hasattr(material, "thickness_mode"):
            material.thickness_mode = "SLAB"
        absorption = nodes.new("ShaderNodeVolumeAbsorption")
        absorption.inputs["Color"].default_value = color
        absorption.inputs["Density"].default_value = .08
        links.new(absorption.outputs["Volume"], output.inputs["Volume"])
        return material
    if surface == "emission":
        shader.inputs["Emission Color"].default_value = color
        shader.inputs["Emission Strength"].default_value = 4
        return material
    geometry = nodes.new("ShaderNodeNewGeometry")
    noise = nodes.new("ShaderNodeTexNoise")
    geometry.location, noise.location = (-950, 100), (-600, 100)
    # Position is in scene metres, so texel/grain scale does not depend on a
    # primitive's dimensions or on shared mesh datablocks.
    scales = {"plaster": 380, "concrete": 90, "stone": 65, "wood": 5, "metal": 450,
              "leaf": 140, "soil": 85, "paving": 100, "grass": 180}
    noise.inputs["Scale"].default_value = scales[surface]
    noise.inputs["Detail"].default_value = 3
    if surface == "wood":
        stretch = nodes.new("ShaderNodeVectorMath")
        stretch.operation = "MULTIPLY"
        stretch.inputs[1].default_value = (7, 7, .18)
        links.new(geometry.outputs["Position"], stretch.inputs[0])
        links.new(stretch.outputs["Vector"], noise.inputs["Vector"])
        shader.inputs["Coat Weight"].default_value = .18
        shader.inputs["Coat Roughness"].default_value = .32
    else:
        links.new(geometry.outputs["Position"], noise.inputs["Vector"])
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.location = (-250, 200)
    variation = .10 if surface in ("wood", "stone", "soil", "leaf") else .04
    for element, multiplier in zip(ramp.color_ramp.elements, (1 - variation, 1 + variation)):
        element.color = tuple(min(.95, c * multiplier) for c in color[:3]) + (1,)
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], shader.inputs["Base Color"])
    distances = {"plaster": .00035, "concrete": .0009, "stone": .0012, "wood": .0007,
                 "metal": .00005, "leaf": .00015, "soil": .003, "paving": .0008, "grass": .0015}
    bump = nodes.new("ShaderNodeBump")
    bump.location = (100, -150)
    bump.inputs["Strength"].default_value = .28
    bump.inputs["Distance"].default_value = distances[surface]
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    if surface == "leaf":
        shader.inputs["Subsurface Weight"].default_value = .08
        shader.inputs["Subsurface Radius"].default_value = (.05, .1, .03)
        shader.inputs["Sheen Weight"].default_value = .12
    return material


def create_materials(palette):
    resolved = resolve_palette(palette)
    specs = palette_specs(resolved)
    specs.update({"landscape": finish("#607553", "grass", .92),
                  "leaf": finish("#477448", "leaf", .58),
                  "soil": finish("#41372A", "soil", .96),
                  "paving": finish("#A7A49B", "paving", .8),
                  "tank": finish("#E6ECF0", "plaster", .42),
                  "tank_lid": finish("#2D6CA3", "plaster", .4),
                  "fabric": finish("#EADFC9", "plaster", .92),
                  "light_emission": finish("#FFD4A4", "emission", .35)})
    result = {role: _material(f"Arch_{resolved}_{role}", spec) for role, spec in specs.items()}
    result.update({alias: result[role] for alias, role in ALIASES.items()})
    return result


def apply_finish_composition(scene, building, targets):
    """Budget opaque exterior wall area; glazing and metal are excluded.

    Each source wall retains one finish across its piers, sill and header.
    Object geometry is unchanged and remains editable.
    """
    walls = {w["id"]: w for w in building["walls"] if w["kind"] == "exterior"}
    groups = []
    for wall_id, wall in walls.items():
        objects = sorted((o for o in scene.collections["WALLS"].objects if o.get("source_id") == wall_id), key=lambda o: o.name)
        horizontal = abs(wall["a"]["y"] - wall["b"]["y"]) <= 2
        area = sum((obj.dimensions.x if horizontal else obj.dimensions.y) * obj.dimensions.z for obj in objects)
        groups.append((wall_id, objects, area))
    total = sum(area for _, _, area in groups)
    used = {"primary": 0., "secondary": 0., "accent": 0.}
    roles = {"primary": "primary_wall", "secondary": "secondary_wall", "accent": "accent"}
    remaining = {key: value * total for key, value in targets.items()}
    # Largest-first area allocation stays close to targets without random paint.
    for _, objects, area in sorted(groups, key=lambda group: (-group[2], group[0])):
        role = max(remaining, key=lambda key: remaining[key])
        for obj in objects:
            scene.assign_material(obj, roles[role])
            obj["finish_group"] = role
        used[role] += area
        remaining[role] -= area
    result = {key: round(value / total, 4) if total else 0 for key, value in used.items()}
    return {"scope": "opaque source exterior wall area; facade features, glazing and roof excluded",
            "target": targets, "actual": result, "areaM2": round(total, 2)}
