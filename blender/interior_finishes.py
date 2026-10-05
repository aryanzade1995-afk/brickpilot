"""The person's Finishes & Cost choices, drawn into the 360 room: real product textures where the catalogue has a surface
photo, the colour of each fixture read from its product photo, and every fitted item placed by rule in the source room.
Architecture is never changed here: cladding sits on the inner face of the existing walls, fixtures sit against them."""

from __future__ import annotations

import math
from pathlib import Path

import bpy
import numpy as np


def srgb_to_linear(c):
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for c_ in [c] for x in c_]


def product_colour(path, fallback):
    """the main colour of a product photo: transparent and near-white studio background ignored, median of the rest"""
    if not path or not Path(path).exists():
        return fallback
    try:
        img = bpy.data.images.load(str(path), check_existing=True)
        w, h = img.size
        px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
        step = max(1, int(max(w, h) / 160))
        px = px[::step, ::step]
        border = np.concatenate([px[0], px[-1], px[:, 0], px[:, -1]])
        bg = np.median(border[:, :3], axis=0)
        flat = px.reshape(-1, 4)
        # the product: opaque and clearly different from the photo's background (a white product on grey still counts)
        keep = flat[(flat[:, 3] > 0.5) & (np.abs(flat[:, :3] - bg).max(axis=1) > 0.06)]
        if len(keep) < 20:
            return fallback
        # its body colour, not its shadows or small dark details
        lum = keep[:, :3].mean(axis=1)
        body = keep[lum >= np.percentile(lum, 60)]
        return tuple(srgb_to_linear(np.median(body[:, :3], axis=0).tolist()))
    except Exception:
        return fallback


def image_material(name, path, tile_m, rough, plank=False, grout=None, gloss=False, wall=None):
    """a surface photo laid at real size in metres (object coordinates), with thin grout joints for tiles"""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    coord = nt.nodes.new('ShaderNodeTexCoord')
    mapping = nt.nodes.new('ShaderNodeMapping')
    sx, sy = (tile_m, tile_m / 5) if plank else (tile_m, tile_m)
    mapping.inputs['Scale'].default_value = (1 / sx, 1 / sy, 1 / tile_m)
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(str(path), check_existing=True)
    tex.projection = 'BOX'
    tex.projection_blend = 0.2
    nt.links.new(coord.outputs['Object'], mapping.inputs['Vector'])
    wall_plane(mapping, wall)
    if wall:
        tex.projection = 'FLAT'
    nt.links.new(mapping.outputs['Vector'], tex.inputs['Vector'])
    colour = tex.outputs['Color']
    if grout:
        brick = nt.nodes.new('ShaderNodeTexBrick')
        brick.offset = 0.5 if plank else 0.0
        brick.inputs['Scale'].default_value = 1.0
        brick.inputs['Mortar Size'].default_value = 0.0025
        brick.inputs['Brick Width'].default_value = sx
        brick.inputs['Row Height'].default_value = sy
        brick.inputs['Color1'].default_value = (1, 1, 1, 1)
        brick.inputs['Color2'].default_value = (1, 1, 1, 1)
        brick.inputs['Mortar'].default_value = (*grout, 1)
        bmap = nt.nodes.new('ShaderNodeMapping')
        nt.links.new(coord.outputs['Object'], bmap.inputs['Vector'])
        wall_plane(bmap, wall)
        nt.links.new(bmap.outputs['Vector'], brick.inputs['Vector'])
        mult = nt.nodes.new('ShaderNodeMix')
        mult.data_type, mult.blend_type = 'RGBA', 'MULTIPLY'
        mult.inputs['Factor'].default_value = 1.0
        nt.links.new(colour, mult.inputs[6])
        nt.links.new(brick.outputs['Color'], mult.inputs[7])
        colour = mult.outputs[2]
    nt.links.new(colour, bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = rough
    if gloss:
        bsdf.inputs['Coat Weight'].default_value = 0.35
    return mat


def pattern_material(name, surface, hex_rgb, wall=None):
    """tiles without a photo: the chosen tone laid in the chosen pattern (subway, mosaic, large slab, planks, square tile)"""
    color = hex_rgb(surface['color'])
    pattern = surface.get('pattern', 'tile')
    size = {'subway': (0.3, 0.1), 'mosaic': (0.05, 0.05), 'large': (1.2, 0.6), 'plank': (1.2, 0.2)}.get(pattern, (surface['tileM'], surface['tileM']))
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    coord = nt.nodes.new('ShaderNodeTexCoord')
    brick = nt.nodes.new('ShaderNodeTexBrick')
    brick.offset = 0.5 if pattern in ('subway', 'plank') else 0.0
    brick.inputs['Scale'].default_value = 1.0
    brick.inputs['Mortar Size'].default_value = 0.004 if pattern != 'mosaic' else 0.002
    brick.inputs['Brick Width'].default_value, brick.inputs['Row Height'].default_value = size
    brick.inputs['Color1'].default_value = (*color, 1)
    brick.inputs['Color2'].default_value = (*[c * 0.94 for c in color], 1)
    brick.inputs['Mortar'].default_value = (*[c * 0.62 for c in color], 1)
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 6
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type, mix.blend_type = 'RGBA', 'OVERLAY'
    mix.inputs['Factor'].default_value = 0.08
    pmap = nt.nodes.new('ShaderNodeMapping')
    nt.links.new(coord.outputs['Object'], pmap.inputs['Vector'])
    wall_plane(pmap, wall)
    nt.links.new(pmap.outputs['Vector'], brick.inputs['Vector'])
    nt.links.new(coord.outputs['Object'], noise.inputs['Vector'])
    nt.links.new(brick.outputs['Color'], mix.inputs[6])
    nt.links.new(noise.outputs['Color'], mix.inputs[7])
    nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = surface.get('rough', 0.3)
    return mat


def wall_plane(mapping, wall):
    """lay a pattern on a wall: its along-wall axis and the vertical become the pattern's x and y"""
    if not wall:
        return
    nt = mapping.id_data
    link = next((l for l in nt.links if l.to_node == mapping and l.to_socket.name == 'Vector'), None)
    if not link:
        return
    source = link.from_socket
    nt.links.remove(link)
    sep_ = nt.nodes.new('ShaderNodeSeparateXYZ')
    comb = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(source, sep_.inputs['Vector'])
    nt.links.new(sep_.outputs['X' if wall == 'NS' else 'Y'], comb.inputs['X'])
    nt.links.new(sep_.outputs['Z'], comb.inputs['Y'])
    nt.links.new(comb.outputs['Vector'], mapping.inputs['Vector'])


def surface_material(name, surface, hex_rgb, kind, wall=None):
    if not surface:
        return None
    if surface.get('image') and Path(surface['image']).exists():
        plank = surface.get('pattern') == 'plank' or 'wood' in surface['name'].lower()
        grout = None if kind == 'counter' else [c * 0.62 for c in hex_rgb(surface['color'])]
        return image_material(name, surface['image'], surface['tileM'], surface['rough'], plank=plank, grout=grout, gloss=surface['rough'] < 0.2, wall=wall)
    return pattern_material(name, surface, hex_rgb, wall=wall)


# ------------------------------------------------------------------ the product's own photo on its front face

def to_blender(pos):
    return (pos[0], -pos[2], pos[1])


def product_decal(name, path, centre, side, width, height):
    """the chosen product's photo, background cut away, on a plane facing into the room: the fixture looks like the product"""
    if not path or not Path(path).exists():
        return False
    try:
        src = bpy.data.images.load(str(path), check_existing=False)
        w, h = src.size
        px = np.array(src.pixels[:], dtype=np.float32).reshape(h, w, 4)
        border = np.concatenate([px[0], px[-1], px[:, 0], px[:, -1]])
        bg = np.median(border[:, :3], axis=0)
        mask = (px[..., 3] > 0.5) & (np.abs(px[..., :3] - bg).max(axis=-1) > 0.05)
        rows, cols = np.where(mask)
        if len(rows) < 50:
            return False
        r0, r1, c0, c1 = rows.min(), rows.max() + 1, cols.min(), cols.max() + 1
        crop = px[r0:r1, c0:c1].copy()
        crop[..., 3] = np.where(mask[r0:r1, c0:c1], 1.0, 0.0)
        ch, cw = crop.shape[:2]
        img = bpy.data.images.new(f'{name}-photo', width=cw, height=ch, alpha=True)
        img.pixels.foreach_set(crop.ravel())
        img.pack()
        bpy.data.images.remove(src)
    except Exception:
        return False
    # fit the photo inside the fixture's front, keeping its proportions
    aspect = cw / ch
    pw, ph = (width, width / aspect) if width / aspect <= height else (height * aspect, height)
    x, y, z = centre
    if side in 'NS':
        face = [(x - pw / 2, y - ph / 2, z), (x + pw / 2, y - ph / 2, z), (x + pw / 2, y + ph / 2, z), (x - pw / 2, y + ph / 2, z)]
        if side == 'S':
            face = [face[1], face[0], face[3], face[2]]
    else:
        face = [(x, y - ph / 2, z + pw / 2), (x, y - ph / 2, z - pw / 2), (x, y + ph / 2, z - pw / 2), (x, y + ph / 2, z + pw / 2)]
        if side == 'W':
            face = [face[1], face[0], face[3], face[2]]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([to_blender(p) for p in face], [], [(0, 1, 2, 3)])
    uv = mesh.uv_layers.new()
    for loop, coord in zip(uv.data, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        loop.uv = coord
    mat = bpy.data.materials.new(f'{name}-mat')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
    bsdf.inputs['Roughness'].default_value = 0.3
    if hasattr(mat, 'surface_render_method'):
        mat.surface_render_method = 'DITHERED'
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return True


def front_of(side, centre, depth):
    """just in front of a fixture of this depth, facing into the room"""
    x, y, z = centre
    off = depth / 2 + 0.002
    return {'N': (x, y, z + off), 'S': (x, y, z - off), 'W': (x + off, y, z), 'E': (x - off, y, z)}[side]


# ------------------------------------------------------------------ placement helpers

DIMS = {}


def wall_side(b):
    """which of this room's four walls a box stands in, from where it sits on the room boundary (None if it is not one)"""
    if b['id'].startswith('column') or not DIMS:
        return None
    (x, _, z), (sx, _, sz) = b['pos'], b['size']
    hw, hd = DIMS['w'] / 2, DIMS['d'] / 2
    if sz <= sx and abs(abs(z) - hd) < 0.2 and abs(x) <= hw + 0.05:
        return 'N' if z < 0 else 'S'
    if sx < sz and abs(abs(x) - hw) < 0.2 and abs(z) <= hd + 0.05:
        return 'W' if x < 0 else 'E'
    return None


def inner_face(b):
    """(axis, face coordinate, inward sign) for a wall box of this room"""
    pos, size = b['pos'], b['size']
    if size[2] < size[0]:   # wall along x: thickness along z
        inward = -1 if pos[2] > 0 else 1
        return 2, pos[2] + inward * size[2] / 2, inward
    inward = -1 if pos[0] > 0 else 1
    return 0, pos[0] + inward * size[0] / 2, inward


def clad_walls(shell, box, mats, y0, y1, sides=None, name='tile'):
    """tile the inner face of this room's own walls between y0 and y1 (never over a door or window: they are separate boxes)"""
    n = 0
    for b in shell:
        side = wall_side(b)
        if b['mat'] != 'wall' or not side or (sides and side not in sides):
            continue
        lo, hi = b['pos'][1] - b['size'][1] / 2, b['pos'][1] + b['size'][1] / 2
        a, c = max(lo, y0), min(hi, y1)
        if c - a < 0.02:
            continue
        axis, face, inward = inner_face(b)
        pos = list(b['pos'])
        pos[axis] = face + inward * 0.005
        pos[1] = (a + c) / 2
        size = list(b['size'])
        size[axis] = 0.01
        size[1] = c - a
        box(f'{name}-{b["id"]}', pos, size, mats['NS' if side in 'NS' else 'EW'])
        n += 1
    return n


def free_wall(shell, dims, prefer=None):
    """a stretch of this room's wall with no opening: (side, along-centre, length)"""
    best = None
    for b in shell:
        side = wall_side(b)
        if b['mat'] != 'wall' or not side or b['size'][1] < 2.0:
            continue
        along = b['size'][0] if side in 'NS' else b['size'][2]
        centre = b['pos'][0] if side in 'NS' else b['pos'][2]
        score = along + (1.0 if prefer and side in prefer else 0)
        if along > 0.7 and (best is None or score > best[3]):
            best = (side, centre, along, score)
    return best


def on_wall(side, along, y, dims, depth, standoff=0.0):
    """centre of a fixture of this depth standing on the inner face of a wall"""
    half_w, half_d = dims['w'] / 2, dims['d'] / 2
    t = 0.06  # half the thinnest wall: fixtures sit just proud of the finish
    if side == 'N':
        return (along, y, -half_d + t + depth / 2 + standoff)
    if side == 'S':
        return (along, y, half_d - t - depth / 2 - standoff)
    if side == 'W':
        return (-half_w + t + depth / 2 + standoff, y, along)
    return (half_w - t - depth / 2 - standoff, y, along)


def oriented(side, w, h, d):
    return (w, h, d) if side in 'NS' else (d, h, w)


# ------------------------------------------------------------------ the dressing itself

def note(text):
    print(f'@@note {text}', flush=True)


def apply_finishes(data, box, principled, hex_rgb, kelvin_rgb, mats, shell_mats):
    """returns overrides the main renderer uses: fixture style for the ceiling lights and the lamp colour temperature"""
    fin = data.get('finishes')
    if not fin:
        return {}
    dims, shell, furniture = data['room']['dims'], data['shell'], data['furniture']
    DIMS.update(dims)
    out = {}

    # floor: the chosen flooring, real texture at real size
    floor = surface_material('finish-floor', fin['floor'], hex_rgb, 'floor')
    if floor:
        shell_mats['slab'] = floor

    # doors: the chosen internal door (texture, painted or glass leaf)
    door = fin['door']
    if door.get('glass'):
        shell_mats['reveal'] = principled('finish-door', (0.85, 0.92, 0.95), .03, transmission=1)
    elif door.get('image') and Path(door['image']).exists():
        shell_mats['reveal'] = image_material('finish-door', door['image'], 1.0, 0.45, plank=True)
    else:
        shell_mats['reveal'] = principled('finish-door', hex_rgb(door['color']), .45)

    # window frames: trims around glass take the chosen frame colour, door trims stay with the walls
    frame = principled('finish-window-frame', hex_rgb(fin['windowFrame']['color']), .35, metal=0.6 if fin['windowFrame']['color'] == '#B9BDC1' else 0)
    for b in shell:
        side = wall_side(b)
        if b['mat'] != 'glass' or not side:
            continue
        (x, y, z), (sx, sy, sz) = b['pos'], b['size']
        width = sx if side in 'NS' else sz
        along = x if side in 'NS' else z
        bars = [(along, y + sy / 2 - 0.03, width + 0.1, 0.06), (along, y - sy / 2 + 0.03, width + 0.1, 0.06),
                (along - width / 2 - 0.02, y, 0.06, sy), (along + width / 2 + 0.02, y, 0.06, sy), (along, y, 0.035, sy)]
        for k, (a, cy, w, h) in enumerate(bars):
            p = (a, cy, z) if side in 'NS' else (x, cy, a)
            box(f'frame-{b["id"]}-{k}', p, oriented(side, w, h, 0.07), frame)
    out['trim_for'] = {}

    # wall tiles: full height in a bathroom, a backsplash over the counters in a kitchen
    tiles = fin.get('wallTiles')
    if tiles:
        tmat = {o: surface_material(f'finish-wall-tiles-{o}', tiles, hex_rgb, 'wall', wall=o) for o in ('NS', 'EW')}
        if tiles['zone'] == 'full':
            clad_walls(shell, box, tmat, 0.0, min(tiles['heightM'], dims['h'] - 0.05), name='walltile')
        else:
            sides = set()
            for f in furniture:
                if f['id'].endswith(tuple(f'-counter{i}' for i in range(6))) or '-counter' in f['id'] and f['mat'] == 'panel':
                    x, _, z = f['pos']
                    gaps = {'N': z + dims['d'] / 2, 'S': dims['d'] / 2 - z, 'W': x + dims['w'] / 2, 'E': dims['w'] / 2 - x}
                    sides.add(min(gaps, key=gaps.get))
            clad_walls(shell, box, tmat, 0.9, 1.5, sides or None, name='backsplash')

    # kitchen: the chosen counter on the worktops, the chosen cabinet finish on the carcasses
    counter = surface_material('finish-counter', fin.get('counter'), hex_rgb, 'counter') if fin.get('counter') else None
    cab = fin.get('cabinets')
    cab_mat = None
    if cab:
        if cab.get('image') and Path(cab['image']).exists():
            cab_mat = image_material('finish-cabinets', cab['image'], 0.8, 0.4)
        elif cab.get('glass'):
            cab_mat = principled('finish-cabinets', (0.8, 0.86, 0.88), .05, transmission=0.6)
        else:
            cab_mat = principled('finish-cabinets', hex_rgb(cab['color']), .18 if cab.get('gloss') else .55)
    fittings = fin.get('fittings')
    metal = None
    if fittings:
        metal = {'chrome': principled('finish-taps', (0.85, 0.86, 0.88), .12, metal=1),
                 'black': principled('finish-taps', (0.03, 0.03, 0.03), .4, metal=0.6),
                 'gold': principled('finish-taps', hex_rgb('#C9A15A'), .22, metal=1)}[fittings['finish']]
    ceramic = principled('finish-sanitary', hex_rgb('#F7F6F2'), .12)
    sanitary = fin.get('sanitary')
    for f in furniture:
        fid = f['id']
        if counter and '-top' in fid and f['mat'] == 'stone':
            out.setdefault('furniture', {})[fid] = counter
        elif cab_mat and ('-counter' in fid or 'wall-cabinet' in fid) and f['mat'] == 'panel':
            out.setdefault('furniture', {})[fid] = cab_mat
        elif metal and f['mat'] == 'metal' and ('tap' in fid or 'shower' in fid or 'sink' in fid):
            out.setdefault('furniture', {})[fid] = metal
        elif sanitary and f['mat'] == 'ceramic':
            out.setdefault('furniture', {})[fid] = ceramic
            if fid.endswith('-wc') or fid.endswith('-cistern'):
                pos, size = list(f['pos']), list(f['size'])
                if sanitary['wc'] == 'wall':   # wall-hung: the bowl floats, the cistern is concealed in the wall
                    if fid.endswith('-cistern'):
                        out.setdefault('skip', set()).add(fid)
                    else:
                        size[1] = min(size[1], 0.38)
                        pos[1] = 0.25 + size[1] / 2
                elif sanitary['wc'] == 'indian':   # an Indian pan sits in the floor
                    if fid.endswith('-cistern'):
                        pos[1] = 1.9
                    else:
                        size[1], pos[1] = 0.06, 0.03
                out.setdefault('reshape', {})[fid] = (pos, size)

    # bathroom: the chosen water heater on a clear wall, above head height
    heater = fin.get('waterHeater')
    if heater:
        spot = free_wall(shell, dims)
        if spot:
            side, along, _, _ = spot
            w, h, d = (0.32, 0.42, 0.14) if heater['kind'] == 'instant' else (0.42, 0.5, 0.36)
            col = product_colour(heater.get('image'), hex_rgb('#F4F3F0'))
            c = on_wall(side, along, 2.0, dims, d)
            box('water-heater', c, oriented(side, w, h, d), principled('finish-heater', col, .25), bevel=0.02)
            product_decal('water-heater-front', heater.get('image'), front_of(side, c, d), side, w * 0.98, h * 0.98)
            note(f'water heater on {side} wall at {along:.2f}')
        else:
            note('water heater: no clear wall')

    # exhaust fan high on a wall
    exhaust = fin.get('exhaust')
    if exhaust:
        spot = free_wall(shell, dims, prefer='NS')
        if spot:
            side, along, length, _ = spot
            col = product_colour(exhaust.get('image'), hex_rgb('#F2F1EE'))
            offset = along + (length / 2 - 0.4 if length > 1.0 else 0)
            c = on_wall(side, offset, min(dims['h'] - 0.35, 2.4), dims, 0.05)
            box('exhaust-fan', c, oriented(side, 0.3, 0.3, 0.05), principled('finish-exhaust', col, .4), bevel=0.01)
            note(f'exhaust on {side} wall')
            if not product_decal('exhaust-front', exhaust.get('image'), front_of(side, c, 0.05), side, 0.29, 0.29):
                box('exhaust-grille', on_wall(side, offset, min(dims['h'] - 0.35, 2.4), dims, 0.06), oriented(side, 0.22, 0.22, 0.012), principled('finish-grille', (0.08, 0.08, 0.08), .6))

    # switch plates beside every door, at 1.2 m, in the chosen product's colour
    switch_col = product_colour(fin['switches'].get('image'), hex_rgb('#F5F4F0'))
    plate = principled('finish-switch', switch_col, .25)
    # beside every door of this room, open passage or leaf, on the latch side
    for o in data.get('openings', []):
        if o.get('kind') not in ('door', 'entry') or o.get('alongM') is None:
            continue
        side, along = o['side'], o['alongM'] + o['widthM'] / 2 + 0.18
        span = dims['w'] / 2 if side in 'NS' else dims['d'] / 2
        if abs(along) > span - 0.12:
            along = o['alongM'] - o['widthM'] / 2 - 0.18
        c = on_wall(side, along, 1.2, dims, 0.012)
        box(f'switch-{o.get("id", side)}', c, oriented(side, 0.086, 0.086, 0.012), plate, bevel=0.003)
        product_decal(f'switch-front-{o.get("id", side)}', fin['switches'].get('image'), front_of(side, c, 0.012), side, 0.085, 0.085)
        note(f'switch plate by door on {side} wall')

    # ceiling fan in the middle of the room, coloured like the chosen fan
    fan = fin.get('fan')
    if fan:
        col = product_colour(fan.get('image'), hex_rgb('#6B5B4E'))
        fmat = principled('finish-fan', col, .35, metal=0.3)
        top = dims['h'] - 0.02
        cx, _, cz = data['camera']
        fx = fz = 0.0
        if math.hypot(cx, cz) < 1.0:   # over the half of the room away from where the photo is taken
            if dims['w'] >= dims['d']:
                fx = -math.copysign(dims['w'] / 4, cx or 1)
            else:
                fz = -math.copysign(dims['d'] / 4, cz or 1)
        box('fan-rod', (fx, top - 0.18, fz), (0.025, 0.36, 0.025), fmat)
        bx, by = fx, -fz   # Blender x / y of the fan centre
        hub_y = top - 0.4
        bpy.ops.mesh.primitive_cylinder_add(radius=0.11, depth=0.12, location=(bx, by, hub_y))
        hub = bpy.context.active_object
        hub.data.materials.append(fmat)
        for k in range(3):
            a = k * 2 * math.pi / 3
            bpy.ops.mesh.primitive_cube_add(size=1, location=(bx + math.cos(a) * 0.45, by + math.sin(a) * 0.45, hub_y - 0.02))
            blade = bpy.context.active_object
            blade.scale = (0.62, 0.11, 0.01)
            blade.rotation_euler = (0.08, 0, a)
            blade.data.materials.append(fmat)
        if fan['style'] in ('underlight', 'chandelier'):
            glow = principled('fan-light', (1, 1, 1), .3, emission=kelvin_rgb(3500), strength=6)
            bpy.ops.mesh.primitive_uv_sphere_add(radius=0.1 if fan['style'] == 'underlight' else 0.16, location=(bx, by, hub_y - 0.12))
            bpy.context.active_object.data.materials.append(glow)

    # a batten light over the kitchen / utility counter wall
    batten = fin.get('batten')
    if batten:
        spot = free_wall(shell, dims)
        if spot:
            side, along, length, _ = spot
            glow = principled('finish-batten', (1, 1, 1), .3, emission=kelvin_rgb(6000), strength=8)
            note(f'batten on {side} wall')
            box('batten', on_wall(side, along, min(dims['h'] - 0.3, 2.3), dims, 0.035), oriented(side, min(1.2, length - 0.2), 0.035, 0.035), glow)

    out['lights_kind'] = fin['lights']['kind']
    bulb = (fin.get('bulb') or {}).get('name', '')
    out['lamp_kelvin'] = 2700 if 'candle' in bulb.lower() else 6000 if bulb else None
    return out
