"""Daylight/HDRI, warm wall fixtures and subtle source-room ceiling lights."""

import math
import bpy
from mathutils import Vector
from specialized_validation import wall_side
from validation import opening_vertical_span
from .placement import overlaps, within


def _light(scene, name, kind, position, energy, color, target=None):
    data = bpy.data.lights.new(name, kind)
    obj = bpy.data.objects.new(name, data)
    scene.collections["LIGHTING"].objects.link(obj)
    obj.location, data.energy, data.color = position, energy, color
    if target is not None:
        obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()
    obj["source_plan_id"] = scene.plan_id
    return obj


def _world(config):
    world = bpy.data.worlds.new("Architecture_World")
    bpy.context.scene.world = world
    world.use_nodes = True
    nodes, links = world.node_tree.nodes, world.node_tree.links
    nodes.clear()
    background, output = nodes.new("ShaderNodeBackground"), nodes.new("ShaderNodeOutputWorld")
    background.inputs["Strength"].default_value = config["skyStrength"]
    links.new(background.outputs["Background"], output.inputs["Surface"])
    if config["hdriPath"]:
        environment = nodes.new("ShaderNodeTexEnvironment")
        environment.image = bpy.data.images.load(config["hdriPath"], check_existing=True)
        environment.image.pack()
        coordinates, mapping = nodes.new("ShaderNodeTexCoord"), nodes.new("ShaderNodeMapping")
        mapping.inputs["Rotation"].default_value[2] = math.radians(config["hdriRotationDeg"])
        links.new(coordinates.outputs["Generated"], mapping.inputs["Vector"])
        links.new(mapping.outputs["Vector"], environment.inputs["Vector"])
        links.new(environment.outputs["Color"], background.inputs["Color"])
        world["environment_type"] = "HDRI"
    else:
        sky = nodes.new("ShaderNodeTexSky")
        sky.sky_type = "NISHITA" if bpy.app.version < (5, 1, 0) else "MULTIPLE_SCATTERING"
        sky.sun_disc = False  # The separate SUN provides a single direct light.
        sky.sun_elevation = math.radians(config["sunElevationDeg"])
        sky.sun_rotation = math.radians(config["sunAzimuthDeg"])
        sky.altitude = .1
        if hasattr(sky, "air_density"):
            sky.air_density = 1
        if hasattr(sky, "dust_density"):
            sky.dust_density = 1.5
        links.new(sky.outputs["Color"], background.inputs["Color"])
        world["environment_type"] = "PROCEDURAL_SKY"
    return world


def _fixtures(scene, payload, config):
    b = payload["buildingModel"]
    floors = {f["id"]: f for f in b["floors"]}
    reserved = [p["world"] for f in payload["facadeGrammar"]["features"] for p in f["parts"]]
    reserved += [p["world"] for u in (payload["facadeGrammar"].get("specialized") or {}).get("assemblies", []) for p in u["parts"]]
    result = []
    for entry in (o for o in b["doors"] if o["kind"] == "entry"):
        horizontal = entry["orient"] == "h"
        wall = next((w for w in b["walls"] if w["kind"] == "exterior" and w["floorId"] == entry["floorId"] and
                     abs((w["a"]["y"] if horizontal else w["a"]["x"]) - (entry["at"]["y"] if horizontal else entry["at"]["x"])) <= 2 and
                     min(w["a"]["x"] if horizontal else w["a"]["y"], w["b"]["x"] if horizontal else w["b"]["y"]) <= (entry["at"]["x"] if horizontal else entry["at"]["y"]) <=
                     max(w["a"]["x"] if horizontal else w["a"]["y"], w["b"]["x"] if horizontal else w["b"]["y"])), None)
        if not wall:
            continue
        floor, side = floors[entry["floorId"]], wall_side(b, wall)
        sign = 1 if side in ("S", "E") else -1
        for direction in (-1, 1):
            for margin in (300, 600, 900):
                along = (entry["at"]["x"] if horizontal else entry["at"]["y"]) + direction * (entry["width"] / 2 + margin)
                fixed = (entry["at"]["y"] if horizontal else entry["at"]["x"]) + sign * (wall["thickness"] / 2 + 45)
                x, y = (along, fixed) if horizontal else (fixed, along)
                r = {"x": x - (55 if horizontal else 25), "y": y - (25 if horizontal else 55),
                     "w": 110 if horizontal else 50, "h": 50 if horizontal else 110,
                     "z": floor["elevationMm"] + 1900, "height": 220}
                wall_lo = min(wall["a"]["x"] if horizontal else wall["a"]["y"], wall["b"]["x"] if horizontal else wall["b"]["y"])
                wall_hi = max(wall["a"]["x"] if horizontal else wall["a"]["y"], wall["b"]["x"] if horizontal else wall["b"]["y"])
                if along - 55 < wall_lo or along + 55 > wall_hi or not within(r, b["plot"]["buildable"]):
                    continue
                blocked = False
                for o in [*b["doors"], *b["windows"]]:
                    if o["floorId"] != floor["id"]:
                        continue
                    sill, head = opening_vertical_span(o, floor)
                    if min(r["z"] + r["height"], floor["elevationMm"] + head) <= max(r["z"], floor["elevationMm"] + sill):
                        continue
                    from .placement import opening_box
                    if overlaps(r, opening_box(o, 600)):
                        blocked = True
                if blocked or any(overlaps(r, p) and min(r["z"] + r["height"], p["z"] + p["height"]) > max(r["z"], p["z"]) for p in reserved):
                    continue
                name = f"Fixture_{entry['id']}_{'L' if direction < 0 else 'R'}"
                scene.box(name, "LIGHTING", x, y, r["z"], r["w"], r["h"], r["height"], "metal", wall["id"], bevel=6)
                scene.box(f"{name}_Diffuser", "LIGHTING", x, y, r["z"] - 4, r["w"] - 20, r["h"] - 10, 5, "light_emission", wall["id"], bevel=1)
                lamp = _light(scene, f"{name}_WarmWash", "AREA", (x / 1000, y / 1000, r["z"] / 1000 - .01),
                              22 if config["preset"] == "DUSK" else 6, (1, .64, .35))
                lamp.data.shape, lamp.data.size = "DISK", .15
                result.append(name)
                break
    return result


def create_lighting(scene, payload, options):
    config = options["lighting"]
    world = _world(config)
    elevation, azimuth = math.radians(config["sunElevationDeg"]), math.radians(config["sunAzimuthDeg"])
    direction = Vector((math.cos(azimuth) * math.cos(elevation), math.sin(azimuth) * math.cos(elevation), math.sin(elevation)))
    sun = _light(scene, "Sun_Architectural", "SUN", direction * 50, config["sunStrength"],
                 (1, .75, .50) if config["preset"] == "DUSK" else (1, .93, .83), (0, 0, 0))
    sun.data.angle = math.radians(.65)
    fixtures = _fixtures(scene, payload, config) if config["fixtures"] else []
    interiors = []
    if config["interiorEmission"]:
        b = payload["buildingModel"]
        floors = {f["id"]: f for f in b["floors"]}
        for room in (r for r in b["rooms"] if not r["outdoor"] and r["id"] in ("living", "dining", "familyLounge", "foyer")):
            floor, r = floors[room["floorId"]], room["rect"]
            x, y = (r["x"] + r["w"] / 2) / 1000, (r["y"] + r["h"] / 2) / 1000
            z = (floor["elevationMm"] + floor["heightMm"] - 330) / 1000
            name = f"Interior_{room['semanticId']}_WarmCeiling"
            light = _light(scene, name, "AREA", (x, y, z), min(180, r["w"] * r["h"] / 1e6 * 5) * (1 if config["preset"] == "DUSK" else .35), (1, .75, .52))
            light.data.shape, light.data.size = "DISK", .5
            scene.box(f"{name}_Diffuser", "LIGHTING", x * 1000, y * 1000, z * 1000 + 10,
                      400, 180, 12, "light_emission", room["semanticId"], bevel=3)
            interiors.append(name)
    return {"preset": config["preset"], "environment": world["environment_type"], "sunElevationDeg": config["sunElevationDeg"],
            "sunAzimuthDeg": config["sunAzimuthDeg"], "fixtures": fixtures, "interiorLights": interiors,
            "hdriPacked": bool(config["hdriPath"])}
