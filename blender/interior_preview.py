"""Fast 360 interior preview of ONE room of the validated Formstead plan.

blender -b --factory-startup --python blender/interior_preview.py -- --scene scene.json --out preview-360.webp

The room shell (walls, doors, windows, ceiling height) and the rule-placed furniture arrive ready-made from the
plan; this script only dresses them: materials, ceiling detail, lighting. It never moves or resizes architecture.
EEVEE does not render panoramic cameras, so the panorama is six 90 degree cube faces stitched to equirectangular.
Progress lines start with '@@stage ' so the server can report the real state.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parent
TEXTURES = ROOT / 'assets' / 'textures'


def stage(name, detail=''):
    print(f'@@stage {name}{(" " + detail) if detail else ""}', flush=True)


def hex_rgb(value, fallback=(0.9, 0.9, 0.9)):
    try:
        v = value.lstrip('#')
        srgb = [int(v[i:i + 2], 16) / 255 for i in (0, 2, 4)]
        return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb)
    except Exception:
        return fallback


def kelvin_rgb(k):
    """approximate blackbody colour (linear), for the warm / neutral interior lights"""
    t = k / 100
    r = 255 if t <= 66 else 329.7 * ((t - 60) ** -0.1332)
    g = 99.47 * math.log(t) - 161.12 if t <= 66 else 288.12 * ((t - 60) ** -0.0755)
    b = 255 if t >= 66 else (0 if t <= 19 else 138.52 * math.log(t - 10) - 305.04)
    return tuple(max(0.0, min(1.0, c / 255)) ** 2.2 for c in (r, g, b))


# ---------------------------------------------------------------- scene helpers

def to_blender(pos):
    """scene metres (x east, y up, z south) -> Blender (x east, y north, z up)"""
    return (pos[0], -pos[2], pos[1])


def box(name, pos, size, mat, bevel=0.0):
    sx, sy, sz = size[0], size[2], size[1]
    mesh = bpy.data.meshes.new(name)
    x, y, z = sx / 2, sy / 2, sz / 2
    verts = [(-x, -y, -z), (x, -y, -z), (x, y, -z), (-x, y, -z), (-x, -y, z), (x, -y, z), (x, y, z), (-x, y, z)]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = to_blender(pos)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    if bevel > 0 and min(sx, sy, sz) > bevel * 3:
        mod = obj.modifiers.new('bevel', 'BEVEL')
        mod.width, mod.segments, mod.limit_method = bevel, 2, 'ANGLE'
    return obj


def principled(name, color, rough=0.6, metal=0.0, emission=None, strength=0.0, transmission=0.0, alpha=1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if transmission:
        bsdf.inputs['Transmission Weight'].default_value = transmission
        bsdf.inputs['IOR'].default_value = 1.45
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*emission, 1)
        bsdf.inputs['Emission Strength'].default_value = strength
    if alpha < 1:
        bsdf.inputs['Alpha'].default_value = alpha
        mat.surface_render_method = 'BLENDED' if hasattr(mat, 'surface_render_method') else mat.blend_method
    return mat


def textured(name, image, tile_m, tint, tint_amount, rough, rotate=0.0):
    """a local PBR colour texture laid in real metres (object coordinates), tinted toward the chosen colour"""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    coord = nt.nodes.new('ShaderNodeTexCoord')
    mapping = nt.nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (1 / tile_m, 1 / tile_m, 1 / tile_m)
    mapping.inputs['Rotation'].default_value = (0, 0, rotate)
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(str(image), check_existing=True)
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = tint_amount
    mix.inputs[7].default_value = (*tint, 1)
    nt.links.new(coord.outputs['Object'], mapping.inputs['Vector'])
    nt.links.new(mapping.outputs['Vector'], tex.inputs['Vector'])
    nt.links.new(tex.outputs['Color'], mix.inputs[6])
    nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = rough
    return mat


def marble(name, color, vein_color, rough=0.12, slab=(1.2, 0.6)):
    """polished marble: noise-distorted veins over the chosen base colour, with fine slab joints"""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    coord = nt.nodes.new('ShaderNodeTexCoord')
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 1.6
    noise.inputs['Detail'].default_value = 9
    noise.inputs['Distortion'].default_value = 2.4
    wave = nt.nodes.new('ShaderNodeTexWave')
    wave.inputs['Scale'].default_value = 0.9
    wave.inputs['Distortion'].default_value = 9
    wave.inputs['Detail'].default_value = 6
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[0].color = 0.0, (*vein_color, 1)
    ramp.color_ramp.elements[1].position, ramp.color_ramp.elements[1].color = 0.12, (*color, 1)
    brick = nt.nodes.new('ShaderNodeTexBrick')
    brick.inputs['Scale'].default_value = 1.0
    brick.inputs['Mortar Size'].default_value = 0.0025
    brick.inputs['Brick Width'].default_value = slab[0]
    brick.inputs['Row Height'].default_value = slab[1]
    brick.offset = 0.5
    brick.inputs['Color1'].default_value = (1, 1, 1, 1)
    brick.inputs['Color2'].default_value = (0.97, 0.97, 0.97, 1)
    brick.inputs['Mortar'].default_value = (*[c * 0.7 for c in color], 1)
    mult = nt.nodes.new('ShaderNodeMix')
    mult.data_type, mult.blend_type = 'RGBA', 'MULTIPLY'
    mult.inputs['Factor'].default_value = 1.0
    nt.links.new(coord.outputs['Object'], noise.inputs['Vector'])
    nt.links.new(noise.outputs['Color'], wave.inputs['Vector'])
    nt.links.new(wave.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(coord.outputs['Object'], brick.inputs['Vector'])
    nt.links.new(ramp.outputs['Color'], mult.inputs[6])
    nt.links.new(brick.outputs['Color'], mult.inputs[7])
    nt.links.new(mult.outputs[2], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Coat Weight'].default_value = 0.3
    return mat


def floor_material(flooring):
    kind, color = flooring['material'], hex_rgb(flooring['color'])
    darker = tuple(c * 0.55 for c in color)
    if kind == 'beige-marble':
        return marble('floor', color, tuple(c * 0.72 for c in color))
    if kind == 'white-marble':
        return marble('floor', color, (0.42, 0.42, 0.44))
    if kind == 'grey-marble':
        return marble('floor', color, (0.95, 0.95, 0.95), slab=(1.2, 1.2))
    texture = {'light-wood': 'teak_wood', 'dark-wood': 'dark_wood', 'travertine': 'travertine',
               'concrete': 'exposed_concrete', 'ceramic-tile': 'floor_tiles_02'}[kind]
    image = TEXTURES / texture / 'color.jpg'
    tile = {'light-wood': 1.6, 'dark-wood': 1.6, 'travertine': 1.2, 'concrete': 2.4, 'ceramic-tile': 1.2}[kind]
    rough = {'light-wood': 0.45, 'dark-wood': 0.4, 'travertine': 0.5, 'concrete': 0.75, 'ceramic-tile': 0.3}[kind]
    tint = 0.55 if kind in ('ceramic-tile', 'concrete') else 0.35
    # the chosen colour leads: multiply the texture by it, then lift so the texture keeps its own value range
    return textured('floor', image, tile, color, tint, rough, rotate=math.pi / 2 if 'wood' in kind else 0)


# per style: the look of the furniture by role (colour hex, roughness, metallic)
STYLES = {
    'modern': {'wood': ('#5A4636', .45, 0), 'panel': ('#E8E5E0', .4, 0), 'soft': ('#8E8A84', .85, 0), 'accent': ('#3F5A57', .8, 0),
               'cream': ('#EEEAE2', .9, 0), 'stone': ('#D9D6D0', .2, 0), 'metal': ('#2B2B2B', .35, 1), 'rug': ('#B8B1A6', .95, 0)},
    'contemporary': {'wood': ('#7A5C44', .45, 0), 'panel': ('#D8D1C7', .45, 0), 'soft': ('#A39B8F', .85, 0), 'accent': ('#8A6E5A', .8, 0),
                     'cream': ('#F1ECE3', .9, 0), 'stone': ('#CFC8BD', .25, 0), 'metal': ('#6B6B6B', .3, 1), 'rug': ('#C9BFB0', .95, 0)},
    'minimal': {'wood': ('#C8AE8C', .5, 0), 'panel': ('#F3F2EF', .45, 0), 'soft': ('#DAD6CF', .9, 0), 'accent': ('#BFB8AC', .85, 0),
                'cream': ('#F7F5F1', .9, 0), 'stone': ('#EDEBE7', .2, 0), 'metal': ('#D9D9D9', .3, 1), 'rug': ('#E6E1D8', .95, 0)},
    'luxury': {'wood': ('#3B2A20', .3, 0), 'panel': ('#2F2B28', .3, 0), 'soft': ('#5B4A3E', .7, 0), 'accent': ('#1F3A3D', .6, 0),
               'cream': ('#E9E1D3', .8, 0), 'stone': ('#EDE7DF', .1, 0), 'metal': ('#C9A15A', .25, 1), 'rug': ('#7D6B5B', .95, 0)},
    'indian-contemporary': {'wood': ('#6E4426', .4, 0), 'panel': ('#E4D7C3', .45, 0), 'soft': ('#B3563A', .8, 0), 'accent': ('#C68A2E', .75, 0),
                            'cream': ('#F0E6D6', .9, 0), 'stone': ('#D8CDBB', .3, 0), 'metal': ('#B08D57', .3, 1), 'rug': ('#9E3B2E', .95, 0)},
    'scandinavian': {'wood': ('#D2B48C', .55, 0), 'panel': ('#F4F3F0', .5, 0), 'soft': ('#C9C6BF', .9, 0), 'accent': ('#93A69A', .85, 0),
                     'cream': ('#FAF8F4', .9, 0), 'stone': ('#E8E6E1', .3, 0), 'metal': ('#1E1E1E', .4, 1), 'rug': ('#E3DDD2', .95, 0)},
}
ROLE = {'wood': 'wood', 'door': 'wood', 'panel': 'panel', 'sage': 'accent', 'blush': 'accent', 'clay': 'soft', 'cream': 'cream',
        'stone': 'stone', 'metal': 'metal', 'ceramic': 'cream', 'rug': 'rug', 'art': 'accent', 'glass': 'glass', 'stair': 'wood',
        'floor': 'stone', 'wall': 'panel', 'plant': 'plant', 'lamp': 'lamp'}


def furniture_materials(style):
    s = STYLES.get(style, STYLES['modern'])
    mats = {key: principled(f'f-{key}', hex_rgb(c), r, m) for key, (c, r, m) in s.items()}
    mats['plant'] = principled('f-plant', hex_rgb('#3E6B3A'), .7)
    mats['lamp'] = principled('f-lamp', hex_rgb('#F2E6D0'), .8, emission=kelvin_rgb(2900), strength=3)
    mats['glass'] = principled('f-glass', (0.9, 0.95, 0.97), .05, transmission=1)
    return mats


# ---------------------------------------------------------------- ceiling detail (never below a window or door head)

def ceiling_detail(kind, color, dims, clear_top, wood_mat, light_color, add_light):
    w, d, h = dims['w'], dims['d'], dims['h']
    ceil_mat = principled('ceiling-drop', hex_rgb(color), .9)
    lowest = clear_top + 0.05
    band = min(0.6, w * 0.18, d * 0.18)

    def ring(width, drop, inset, tag):
        y = h - drop / 2
        if h - drop < lowest:
            drop = max(0.04, h - lowest)
            y = h - drop / 2
        inner_w, inner_d = w - 2 * inset, d - 2 * inset
        for name, pos, size in (
            ('n', (0, y, -inner_d / 2 + width / 2), (inner_w, drop, width)),
            ('s', (0, y, inner_d / 2 - width / 2), (inner_w, drop, width)),
            ('w', (-inner_w / 2 + width / 2, y, 0), (width, drop, inner_d - 2 * width)),
            ('e', (inner_w / 2 - width / 2, y, 0), (width, drop, inner_d - 2 * width)),
        ):
            box(f'ceil-{tag}-{name}', pos, size, ceil_mat)
        return h - drop

    if kind == 'false':
        bottom = ring(band, 0.15, 0, 'false')
        return [('down', bottom)]
    if kind == 'cove':
        bottom = ring(band, 0.22, 0, 'cove')
        # the hidden light: an emissive strip behind the drop's inner lip, washing the ceiling
        strip = principled('cove-led', (1, 1, 1), .5, emission=light_color, strength=5)
        iw, idd = w - 2 * band, d - 2 * band
        y = bottom + 0.06
        for name, pos, size in (('n', (0, y, -idd / 2 + 0.03), (iw, 0.02, 0.03)), ('s', (0, y, idd / 2 - 0.03), (iw, 0.02, 0.03)),
                                ('w', (-iw / 2 + 0.03, y, 0), (0.03, 0.02, idd)), ('e', (iw / 2 - 0.03, y, 0), (0.03, 0.02, idd))):
            box(f'cove-led-{name}', pos, size, strip)
        for i, (x, z, sx, sz) in enumerate(((0, -idd / 2 + 0.08, iw, 0.05), (0, idd / 2 - 0.08, iw, 0.05),
                                            (-iw / 2 + 0.08, 0, 0.05, idd), (iw / 2 - 0.08, 0, 0.05, idd))):
            add_light(f'cove-{i}', (x, bottom + 0.1, z), 'AREA', 22 * max(sx, sz), size=(max(sx, 0.05), max(sz, 0.05)), up=True)
        return [('down', bottom)]
    if kind == 'tray':
        ring(band, 0.22, 0, 'tray1')
        bottom = ring(band * 0.55, 0.11, band, 'tray2')
        return [('down', h - 0.22)]
    if kind == 'wooden':
        # a timber slatted panel over the middle of the room
        pw, pd = w * 0.6, d * 0.6
        n = max(4, int(pw / 0.14))
        for i in range(n):
            x = -pw / 2 + (i + 0.5) * pw / n
            box(f'slat-{i}', (x, h - 0.05, 0), (0.06, 0.06, pd), wood_mat, bevel=0.004)
        return [('down', h)]
    return [('down', h)]


# ---------------------------------------------------------------- lighting

def build_lighting(scene_data, cfg, ceiling_bottom):
    dims = scene_data['room']['dims']
    w, d = dims['w'], dims['d']
    lighting = cfg['lighting']
    temp = {'warm': 3200, 'neutral': 4300, 'evening': 3000, 'daylight': 4000}[lighting]
    color = kelvin_rgb(temp)
    world = bpy.context.scene.world or bpy.data.worlds.new('world')
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    sky_strength = {'daylight': 1.0, 'neutral': 0.6, 'warm': 0.45, 'evening': 0.04}[lighting]
    try:
        sky = world.node_tree.nodes.new('ShaderNodeTexSky')
        sky.sky_type = 'NISHITA'
        sky.sun_elevation = math.radians(38 if lighting != 'evening' else -4)
        sky.sun_rotation = math.atan2(scene_data['daylightDir'][0], -scene_data['daylightDir'][2])
        world.node_tree.links.new(sky.outputs['Color'], bg.inputs['Color'])
    except Exception:
        bg.inputs['Color'].default_value = (0.55, 0.7, 0.9, 1)
    bg.inputs['Strength'].default_value = sky_strength if lighting != 'evening' else 1.0
    if lighting == 'evening':
        bg.inputs['Strength'].default_value = 0.02

    lights = []

    def add_light(name, pos, kind, power, size=(0.2, 0.2), up=False, rgb=None):
        data = bpy.data.lights.new(name, kind)
        data.energy = power
        data.color = rgb or color
        if kind == 'AREA':
            data.shape = 'RECTANGLE'
            data.size, data.size_y = size
        if hasattr(data, 'use_soft_falloff'):
            data.use_soft_falloff = True
        obj = bpy.data.objects.new(name, data)
        obj.location = to_blender(pos)
        if up:
            obj.rotation_euler = (math.pi, 0, 0)
        bpy.context.scene.collection.objects.link(obj)
        lights.append(obj)
        return obj

    if lighting != 'evening':
        # the sun comes in through the room's main window
        dx, dy, dz = scene_data['daylightDir']
        sun = bpy.data.lights.new('sun', 'SUN')
        sun.energy = {'daylight': 3.5, 'neutral': 2.2, 'warm': 1.6}[lighting]
        sun.angle = math.radians(2)
        sun_obj = bpy.data.objects.new('sun', sun)
        direction = np.array(to_blender((dx, max(dy, 0.45), dz)))
        direction = direction / np.linalg.norm(direction)
        sun_obj.rotation_mode = 'QUATERNION'
        from mathutils import Vector
        sun_obj.rotation_quaternion = Vector((-direction[0], -direction[1], -direction[2])).to_track_quat('-Z', 'Y')
        bpy.context.scene.collection.objects.link(sun_obj)

    # practical ceiling lights on a grid sized to the room, as downlights in the ceiling
    nx, nz = max(1, round(w / 1.9)), max(1, round(d / 1.9))
    fixture = principled('downlight', (1, 1, 1), .4, emission=color, strength=12)
    per = {'daylight': 10, 'neutral': 22, 'warm': 20, 'evening': 30}[lighting]
    for i in range(nx):
        for j in range(nz):
            x = -w / 2 + (i + 0.5) * w / nx
            z = -d / 2 + (j + 0.5) * d / nz
            y = ceiling_bottom - 0.02
            box(f'fixture-{i}-{j}', (x, y + 0.012, z), (0.09, 0.012, 0.09), fixture)
            add_light(f'down-{i}-{j}', (x, y - 0.02, z), 'AREA', per, size=(0.12, 0.12))
            add_light(f'bounce-{i}-{j}', (x, y - 0.6, z), 'AREA', per * 0.35, size=(0.6, 0.6), up=True)
    return add_light


# ---------------------------------------------------------------- render: six cube faces -> equirectangular

FACES = {  # Blender camera Euler for looking along each world axis
    'px': (math.pi / 2, 0, -math.pi / 2), 'nx': (math.pi / 2, 0, math.pi / 2),
    'py': (math.pi / 2, 0, 0), 'ny': (math.pi / 2, 0, math.pi),
    'pz': (math.pi, 0, 0), 'nz': (0, 0, 0),
}


def configure_eevee(scene, face_px, quality):
    scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
    scene.render.resolution_x = scene.render.resolution_y = face_px
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Punchy'
    scene.view_settings.exposure = -0.15
    e = scene.eevee
    e.taa_render_samples = 32 if quality == 'fast' else 96
    for attr, value in (('use_raytracing', True), ('use_shadows', True), ('use_fast_gi', True), ('use_gtao', True),
                        ('shadow_ray_count', 2 if quality == 'fast' else 3), ('shadow_step_count', 6),
                        ('fast_gi_method', 'GLOBAL_ILLUMINATION'), ('horizon_quality', 0.5)):
        if hasattr(e, attr):
            try:
                setattr(e, attr, value)
            except Exception:
                pass
    if hasattr(e, 'ray_tracing_method'):
        e.ray_tracing_method = 'SCREEN'
    if hasattr(e, 'ray_tracing_options'):
        e.ray_tracing_options.resolution_scale = '2' if quality == 'fast' else '1'
        e.ray_tracing_options.use_denoise = True
    scene.render.filter_size = 1.2


def render_faces(scene, cam_pos, work, face_px):
    cam_data = bpy.data.cameras.new('cube')
    cam_data.type = 'PERSP'
    cam_data.sensor_fit = 'HORIZONTAL'
    cam_data.angle = math.pi / 2
    cam_data.clip_start = 0.03
    cam_data.clip_end = 200
    cam = bpy.data.objects.new('cube', cam_data)
    cam.location = to_blender(cam_pos)
    scene.collection.objects.link(cam)
    scene.camera = cam
    faces = {}
    for k, (name, euler) in enumerate(FACES.items()):
        stage('rendering', f'{k + 1}/6')
        cam.rotation_euler = euler
        bpy.context.view_layer.update()
        path = work / f'face_{name}.png'
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(str(path))
        px = np.array(img.pixels[:], dtype=np.float32).reshape(face_px, face_px, 4)  # rows bottom-up
        rot = np.array(cam.matrix_world.to_3x3())
        faces[name] = (px, rot)
        bpy.data.images.remove(img)
    return faces


def equirect_band(faces, width, height, start, end):
    """sample the six faces into an equirectangular image: centre = north, right = east, top = up"""
    u = (np.arange(width, dtype=np.float32) + 0.5) / width
    v = (np.arange(start, end, dtype=np.float32) + 0.5) / height
    lon = (u - 0.5) * 2 * math.pi
    lat = (0.5 - v) * math.pi            # row 0 = top
    lon, lat = np.meshgrid(lon, lat)
    d = np.stack([np.cos(lat) * np.sin(lon), np.cos(lat) * np.cos(lon), np.sin(lat)], axis=-1)
    out = np.zeros((end-start, width, 4), dtype=np.float32)
    best = np.full((end-start, width), -np.inf, dtype=np.float32)
    for name, (px, rot) in faces.items():
        c = d @ rot                      # camera-space direction (rows are world dirs, rot columns are camera axes)
        depth = -c[..., 2]
        ok = depth > best
        with np.errstate(divide='ignore', invalid='ignore'):
            x = c[..., 0] / depth
            y = c[..., 1] / depth
        inside = ok & (depth > 0) & (np.abs(x) <= 1.0001) & (np.abs(y) <= 1.0001)
        n = px.shape[0]
        fx = np.clip((x + 1) / 2 * n - 0.5, 0, n - 1.001)
        fy = np.clip((y + 1) / 2 * n - 0.5, 0, n - 1.001)   # bottom-up rows match y up
        x0, y0 = np.floor(fx).astype(int), np.floor(fy).astype(int)
        tx, ty = (fx - x0)[..., None], (fy - y0)[..., None]
        x1, y1 = np.minimum(x0 + 1, n - 1), np.minimum(y0 + 1, n - 1)
        sample = (px[y0, x0] * (1 - tx) * (1 - ty) + px[y0, x1] * tx * (1 - ty) + px[y1, x0] * (1 - tx) * ty + px[y1, x1] * tx * ty)
        out[inside] = sample[inside]
        best[inside] = depth[inside]
    out[..., 3] = 1
    return out


def equirect(faces, width, height):
    # Stitch in strips so the 4K mode does not allocate multi-gigabyte temporaries.
    out = np.empty((height, width, 4), dtype=np.float32)
    for start in range(0, height, 128):
        end = min(height, start + 128)
        out[start:end] = equirect_band(faces, width, height, start, end)
    return out


def save_webp(pixels, path, quality):
    h, w = pixels.shape[:2]
    img = bpy.data.images.new('panorama', width=w, height=h, alpha=False)
    img.colorspace_settings.name = 'sRGB'
    img.pixels.foreach_set(np.flipud(pixels).ravel())   # Blender rows are bottom-up
    scene = bpy.context.scene
    settings = scene.render.image_settings
    settings.file_format = 'WEBP'
    settings.color_mode = 'RGB'
    settings.quality = quality
    img.file_format = 'WEBP'
    img.filepath_raw = str(path)
    img.save()


# ---------------------------------------------------------------- main

def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--scene', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args(argv)
    started = time.time()
    data = json.loads(Path(args.scene).read_text(encoding='utf-8'))
    cfg, dims = data['config'], data['room']['dims']
    out = Path(args.out)
    work = out.parent / 'faces'
    work.mkdir(parents=True, exist_ok=True)

    stage('preparing')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    fast = data.get('quality', 'fast') == 'fast'
    width, height = (2048, 1024) if fast else (4096, 2048)
    face_px = width // 4
    configure_eevee(scene, face_px, data.get('quality', 'fast'))
    if data.get('fallback'):
        for attr in ('use_raytracing', 'use_fast_gi'):
            if hasattr(scene.eevee, attr):
                setattr(scene.eevee, attr, False)

    style = STYLES.get(cfg['style'], STYLES['modern'])
    stage('flooring')
    floor_mat = floor_material(cfg['flooring'])
    stage('walls')
    wall_mat = principled('walls', hex_rgb(cfg['walls']['color']), .78)
    ceil_mat = principled('ceiling', hex_rgb(cfg['ceiling']['color']), .9)
    door_mat = principled('door-leaf', hex_rgb(style['wood'][0]), style['wood'][1])
    trim_mat = principled('trim', tuple(c * 0.92 for c in hex_rgb(cfg['walls']['color'])), .5)
    glass_mat = principled('window-glass', (0.85, 0.92, 0.95), .02, transmission=1)
    shell_mats = {'wall': wall_mat, 'slab': floor_mat, 'ceil': ceil_mat, 'glass': glass_mat, 'reveal': door_mat, 'trim': trim_mat}
    clear_top = max((o['headM'] for o in data['openings']), default=0.0)
    for b in data['shell']:
        if b['mat'] in ('glass', 'reveal'):
            clear_top = max(clear_top, b['pos'][1] + b['size'][1] / 2)
        # a wide opening is a passage, not a door: leave it open and show the space beyond it
        box(b['id'], b['pos'], b['size'], shell_mats.get(b['mat'], wall_mat))
    # the world outside the windows: ground beyond the house, so glass shows a garden and sky, not a void
    ground = principled('outside-ground', hex_rgb('#6E8B4E'), .95)
    box('outside-ground', (0, -0.3, 0), (80, 0.1, 80), ground)

    stage('ceiling')
    temp = {'warm': 3200, 'neutral': 4300, 'evening': 3000, 'daylight': 4000}[cfg['lighting']]
    mats = furniture_materials(cfg['style'])
    lights_pending = []
    bottoms = ceiling_detail(cfg['ceiling']['type'], cfg['ceiling']['color'], dims, clear_top, mats['wood'], kelvin_rgb(temp),
                             lambda *a, **k: lights_pending.append((a, k)))

    stage('furniture')
    for b in data['furniture']:
        mat = mats.get(ROLE.get(b['mat'], 'panel'), mats['panel'])
        box(b['id'], b['pos'], b['size'], mat, bevel=0.008)

    stage('lighting')
    add_light = build_lighting(data, cfg, bottoms[0][1])
    for a, k in lights_pending:
        add_light(*a, **k)

    stage('rendering', '0/6')
    faces = render_faces(scene, data['camera'], work, face_px)
    stage('saving')
    pano = equirect(faces, width, height)
    save_webp(pano, out, 88 if fast else 92)
    for f in work.glob('face_*.png'):
        f.unlink()
    work.rmdir()
    print(f'@@done {time.time() - started:.1f}s', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:  # the server shows this line to the person
        print(f'@@error {type(error).__name__}: {error}', flush=True)
        raise

