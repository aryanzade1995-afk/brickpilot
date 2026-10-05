"""Furniture for the 360 interior, built as composed models from the layout planner's pieces.

Each piece arrives as a footprint (centre, width across its front, depth, height) and the direction its front faces.
Here it becomes a recognisable piece of furniture: a sofa with its frame, seat and back cushions, arms and legs; a bed with
plinth, mattress, duvet, pillows and padded headboard; a wardrobe with shutters and handles; and so on. Wood uses the
project's real wood textures; upholstery is a soft fabric. Nothing here moves a piece: the planner has fitted them."""

from __future__ import annotations

import hashlib
import math
from pathlib import Path

import bpy

TEXTURES = Path(__file__).resolve().parent / 'assets' / 'textures'
ANGLE = {'S': 0.0, 'E': math.pi / 2, 'N': math.pi, 'W': 3 * math.pi / 2}


def to_blender(pos):
    return (pos[0], -pos[2], pos[1])


def seeded(text, n):
    return int(hashlib.sha256(text.encode()).hexdigest()[:8], 16) % n


# ------------------------------------------------------------------ materials

class Materials:
    """the furniture palette for a style, built once"""

    def __init__(self, style, hex_rgb, principled):
        self.hex, self.principled = hex_rgb, principled
        self.cache = {}
        self.style = style

    def get(self, key):
        if key not in self.cache:
            self.cache[key] = self.make(key)
        return self.cache[key]

    def colour(self, role):
        return self.hex(self.style[role][0]) if role in self.style else (0.8, 0.8, 0.8)

    def make(self, key):
        p = self.principled
        if key == 'wood':
            return self.wood('furn-wood', self.colour('wood'))
        if key == 'wood-light':
            return self.wood('furn-wood-light', tuple(min(1, c * 1.5) for c in self.colour('wood')))
        if key in ('fabric', 'fabric-accent', 'fabric-cream', 'rug'):
            role = {'fabric': 'soft', 'fabric-accent': 'accent', 'fabric-cream': 'cream', 'rug': 'rug'}[key]
            return self.fabric(f'furn-{key}', self.colour(role), rug=key == 'rug')
        if key == 'rug-border':
            return self.fabric('furn-rug-border', tuple(c * 0.55 for c in self.colour('rug')), rug=True)
        if key == 'panel':
            return p('furn-panel', self.colour('panel'), .42)
        if key == 'stone':
            return p('furn-stone', self.colour('stone'), .18)
        if key == 'metal':
            m = self.style.get('metal', ('#2B2B2B', .35, 1))
            return p('furn-metal', self.hex(m[0]), m[1], metal=m[2])
        if key == 'screen':
            return p('furn-screen', (0.01, 0.01, 0.012), .08)
        if key == 'groove':
            return p('furn-groove', (0.02, 0.02, 0.02), .8)
        if key == 'ceramic':
            return p('furn-ceramic', self.hex('#EDE8DF'), .2)
        if key == 'leaf':
            return p('furn-leaf', self.hex('#3C6534'), .6)
        if key == 'soil':
            return p('furn-soil', self.hex('#3B2A1E'), .95)
        if key == 'shade':
            return p('furn-shade', self.hex('#F3E9D6'), .7, emission=(1.0, 0.78, 0.52), strength=2.5)
        if key == 'linen':
            return self.fabric('furn-linen', self.hex('#EFE9DF'))
        if key == 'curtain':
            mat = self.fabric('furn-curtain', self.hex('#E6DCCB'))
            bsdf = mat.node_tree.nodes['Principled BSDF']
            bsdf.inputs['Transmission Weight'].default_value = 0.25
            return mat
        if key == 'canvas':
            return self.canvas('furn-canvas')
        if key == 'book':
            return p('furn-book', (0.5, 0.5, 0.5), .7)
        return p(f'furn-{key}', (0.8, 0.8, 0.8), .5)

    def wood(self, name, tint):
        image = TEXTURES / ('dark_wood' if sum(tint) / 3 < 0.12 else 'teak_wood') / 'color.jpg'
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = nt.nodes['Principled BSDF']
        coord = nt.nodes.new('ShaderNodeTexCoord')
        mapping = nt.nodes.new('ShaderNodeMapping')
        mapping.inputs['Scale'].default_value = (0.8, 3.0, 0.8)
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(str(image), check_existing=True)
        tex.projection = 'BOX'
        tex.projection_blend = 0.3
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type, mix.blend_type = 'RGBA', 'MULTIPLY'
        mix.inputs['Factor'].default_value = 0.85
        lift = tuple(min(1.0, c * 2.2) for c in tint)
        mix.inputs[7].default_value = (*lift, 1)
        nt.links.new(coord.outputs['Object'], mapping.inputs['Vector'])
        nt.links.new(mapping.outputs['Vector'], tex.inputs['Vector'])
        nt.links.new(tex.outputs['Color'], mix.inputs[6])
        nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 0.42
        bsdf.inputs['Coat Weight'].default_value = 0.15
        return mat

    def fabric(self, name, colour, rug=False):
        """woven upholstery: fine weave bump, soft sheen, a little colour variation"""
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = nt.nodes['Principled BSDF']
        coord = nt.nodes.new('ShaderNodeTexCoord')
        noise = nt.nodes.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value = 900 if not rug else 260
        noise.inputs['Detail'].default_value = 2
        bump = nt.nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = 0.25 if not rug else 0.5
        var = nt.nodes.new('ShaderNodeTexNoise')
        var.inputs['Scale'].default_value = 4
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type, mix.blend_type = 'RGBA', 'OVERLAY'
        mix.inputs['Factor'].default_value = 0.12
        mix.inputs[6].default_value = (*colour, 1)
        nt.links.new(coord.outputs['Object'], noise.inputs['Vector'])
        nt.links.new(coord.outputs['Object'], var.inputs['Vector'])
        nt.links.new(noise.outputs['Fac'], bump.inputs['Height'])
        nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
        nt.links.new(var.outputs['Color'], mix.inputs[7])
        nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 0.92
        if 'Sheen Weight' in bsdf.inputs:
            bsdf.inputs['Sheen Weight'].default_value = 0.6
        return mat

    def canvas(self, name):
        """an abstract painting in the style's accent colours"""
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = nt.nodes['Principled BSDF']
        coord = nt.nodes.new('ShaderNodeTexCoord')
        noise = nt.nodes.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value = 2.2
        noise.inputs['Distortion'].default_value = 3
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        cols = [self.colour('cream'), self.colour('accent'), self.colour('soft'), self.colour('wood')]
        ramp.color_ramp.elements[0].color = (*cols[0], 1)
        ramp.color_ramp.elements[1].color = (*cols[1], 1)
        e = ramp.color_ramp.elements.new(0.5)
        e.color = (*cols[2], 1)
        e2 = ramp.color_ramp.elements.new(0.8)
        e2.color = (*cols[3], 1)
        nt.links.new(coord.outputs['Object'], noise.inputs['Vector'])
        nt.links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
        nt.links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 0.85
        return mat


# ------------------------------------------------------------------ building blocks

class Builder:
    def __init__(self, box, mats, add_light=None):
        self.box, self.m, self.add_light = box, mats, add_light

    def at(self, piece, lx, lz):
        """a point given across (lx) and front-back (lz, + towards the front) of the piece, in room coordinates"""
        a = ANGLE[piece['face']]
        return (piece['x'] + lx * math.cos(a) + lz * math.sin(a), piece['z'] - lx * math.sin(a) + lz * math.cos(a))

    def part(self, piece, name, lx, lz, y0, y1, sx, sz, mat, bevel=0.004):
        x, z = self.at(piece, lx, lz)
        size = (sx, y1 - y0, sz) if piece['face'] in 'NS' else (sz, y1 - y0, sx)
        return self.box(f'{piece["id"]}-{name}', (x, (y0 + y1) / 2, z), size, self.m.get(mat), bevel=bevel)

    def cylinder(self, piece, name, lx, lz, y0, y1, r, mat, verts=24):
        x, z = self.at(piece, lx, lz)
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=y1 - y0, location=to_blender((x, (y0 + y1) / 2, z)))
        obj = bpy.context.active_object
        obj.name = f'{piece["id"]}-{name}'
        obj.data.materials.append(self.m.get(mat))
        bpy.ops.object.shade_smooth()
        return obj

    def sphere(self, piece, name, lx, lz, y, scale, mat):
        x, z = self.at(piece, lx, lz)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, radius=1, location=to_blender((x, y, z)))
        obj = bpy.context.active_object
        obj.name = f'{piece["id"]}-{name}'
        obj.scale = (scale[0], scale[2], scale[1])
        obj.data.materials.append(self.m.get(mat))
        bpy.ops.object.shade_smooth()
        return obj

    def light(self, piece, lx, lz, y, power, colour=(1.0, 0.8, 0.6)):
        if not self.add_light:
            return
        x, z = self.at(piece, lx, lz)
        data = bpy.data.lights.new(f'{piece["id"]}-light', 'POINT')
        data.energy, data.color, data.shadow_soft_size = power, colour, 0.08
        obj = bpy.data.objects.new(f'{piece["id"]}-light', data)
        obj.location = to_blender((x, y, z))
        bpy.context.scene.collection.objects.link(obj)

    def legs(self, piece, w, d, y0, y1, size, mat, inset=0.06):
        for i, (sx, sz) in enumerate([(-1, -1), (1, -1), (-1, 1), (1, 1)]):
            self.part(piece, f'leg{i}', sx * (w / 2 - inset), sz * (d / 2 - inset), y0, y1, size, size, mat, bevel=0)

    # -------------------------------------------------------------- the pieces

    def sofa(self, p, seats=None, armchair=False):
        w, d, h = p['w'], p['d'], p['h']
        arm = 0.16 if not armchair else 0.14
        self.legs(p, w - 0.1, d - 0.1, 0, 0.1, 0.05, 'wood')
        self.part(p, 'base', 0, 0, 0.1, 0.3, w, d, 'fabric', bevel=0.02)
        n = seats or (1 if armchair else 3 if w >= 1.9 else 2)
        inner = w - 2 * arm
        cw = inner / n
        for i in range(n):
            lx = -inner / 2 + cw * (i + 0.5)
            self.part(p, f'seat{i}', lx, 0.08, 0.3, 0.46, cw - 0.012, d - 0.24, 'fabric', bevel=0.045)
            self.part(p, f'back{i}', lx, -d / 2 + 0.17, 0.42, h, cw - 0.012, 0.2, 'fabric', bevel=0.06)
        self.part(p, 'backframe', 0, -d / 2 + 0.06, 0.3, h - 0.06, w, 0.12, 'fabric', bevel=0.02)
        for side in (-1, 1):
            self.part(p, f'arm{side}', side * (w / 2 - arm / 2), 0, 0.1, 0.62 if not armchair else 0.6, arm, d, 'fabric', bevel=0.04)
        if not armchair:
            for side in (-1, 1):
                self.part(p, f'cushion{side}', side * (inner / 2 - 0.26), -d / 2 + 0.33, 0.46, 0.86, 0.42, 0.13, 'fabric-accent', bevel=0.06)

    def coffee_table(self, p):
        w, d, h = p['w'], p['d'], p['h']
        self.part(p, 'top', 0, 0, h - 0.04, h, w, d, 'wood', bevel=0.006)
        self.part(p, 'shelf', 0, 0, 0.12, 0.14, w - 0.12, d - 0.12, 'wood', bevel=0.003)
        self.legs(p, w, d, 0, h - 0.04, 0.035, 'metal', inset=0.04)
        self.part(p, 'book1', -w * 0.2, 0.02, h, h + 0.035, 0.26, 0.2, 'fabric-accent', bevel=0.003)
        self.part(p, 'book2', -w * 0.2, 0.02, h + 0.035, h + 0.06, 0.22, 0.17, 'fabric-cream', bevel=0.003)
        self.cylinder(p, 'vase', w * 0.22, 0, h, h + 0.22, 0.05, 'ceramic')

    def tv_unit(self, p):
        w, d, h = p['w'], p['d'], p['h']
        self.part(p, 'plinth', 0, -0.02, 0, 0.06, w - 0.04, d - 0.06, 'groove', bevel=0)
        self.part(p, 'body', 0, 0, 0.06, h, w, d, 'wood', bevel=0.005)
        n = max(2, round(w / 0.6))
        for i in range(1, n):
            self.part(p, f'groove{i}', -w / 2 + w * i / n, d / 2 + 0.001, 0.08, h - 0.03, 0.006, 0.004, 'groove', bevel=0)
        self.part(p, 'groove-h', 0, d / 2 + 0.001, h - 0.12, h - 0.115, w - 0.04, 0.004, 'groove', bevel=0)
        self.cylinder(p, 'decor', w * 0.38, 0, h, h + 0.28, 0.06, 'ceramic')

    def tv(self, p):
        w, h, y = p['w'], p['h'], p.get('y', 0.95)
        self.part(p, 'bezel', 0, 0, y, y + h, w, 0.035, 'groove', bevel=0.004)
        self.part(p, 'screen', 0, 0.019, y + 0.012, y + h - 0.012, w - 0.024, 0.002, 'screen', bevel=0)

    def rug(self, p):
        self.part(p, 'rug', 0, 0, 0, 0.012, p['w'], p['d'], 'rug-border', bevel=0.004)
        self.part(p, 'rug-field', 0, 0, 0.012, 0.0135, p['w'] - 0.2, p['d'] - 0.2, 'rug', bevel=0)

    def side_table(self, p):
        h = p['h']
        self.cylinder(p, 'top', 0, 0, h - 0.03, h, p['w'] / 2, 'wood')
        self.cylinder(p, 'stem', 0, 0, 0.02, h - 0.03, 0.025, 'metal', verts=12)
        self.cylinder(p, 'foot', 0, 0, 0, 0.02, p['w'] * 0.32, 'metal')

    def floor_lamp(self, p):
        h = p['h']
        self.cylinder(p, 'foot', 0, 0, 0, 0.025, 0.15, 'metal')
        self.cylinder(p, 'pole', 0, 0, 0.025, h - 0.3, 0.012, 'metal', verts=10)
        self.cylinder(p, 'shade', 0, 0, h - 0.34, h, 0.2, 'shade')
        self.light(p, 0, 0, h - 0.25, 25)

    def table_lamp(self, p):
        y = p.get('y', 0.5)
        self.cylinder(p, 'base', 0, 0, y, y + 0.22, 0.06, 'ceramic')
        self.cylinder(p, 'shade', 0, 0, y + 0.22, y + 0.45, 0.14, 'shade')
        self.light(p, 0, 0, y + 0.33, 12)

    def plant(self, p):
        self.cylinder(p, 'pot', 0, 0, 0, 0.36, 0.17, 'ceramic')
        self.cylinder(p, 'soil', 0, 0, 0.34, 0.36, 0.15, 'soil')
        for i in range(7):
            a = i * 2.4
            r = 0.05 + 0.03 * (i % 3)
            self.sphere(p, f'leaf{i}', math.cos(a) * r, math.sin(a) * r, 0.62 + 0.09 * (i % 4), (0.09, 0.3, 0.09), 'leaf')

    def bed(self, p):
        w, d, h = p['w'], p['d'], p['h']
        low = 'low' in p.get('variant', '')
        bed_w = w - 0.1
        self.part(p, 'plinth', 0, 0.02, 0, 0.08, bed_w - 0.1, d - 0.14, 'groove', bevel=0)
        self.part(p, 'frame', 0, 0.03, 0.08, 0.3, bed_w, d - 0.06, 'wood', bevel=0.01)
        self.part(p, 'mattress', 0, 0.05, 0.3, 0.52, bed_w - 0.06, d - 0.16, 'linen', bevel=0.05)
        # the duvet covers the lower two thirds and falls over the sides
        duvet_len = (d - 0.16) * 0.68
        dz = d / 2 - 0.08 - duvet_len / 2
        self.part(p, 'duvet', 0, dz, 0.5, 0.57, bed_w + 0.02, duvet_len, 'fabric-cream', bevel=0.03)
        for side in (-1, 1):
            self.part(p, f'drape{side}', side * (bed_w / 2 + 0.015), dz, 0.3, 0.57, 0.03, duvet_len, 'fabric-cream', bevel=0.01)
        self.part(p, 'throw', 0, d / 2 - 0.4, 0.57, 0.6, bed_w + 0.03, 0.42, 'fabric-accent', bevel=0.012)
        n = 1 if bed_w < 1.4 else 2
        for i in range(n):
            lx = 0 if n == 1 else (i - 0.5) * (bed_w / 2)
            self.part(p, f'pillow{i}', lx, -d / 2 + 0.33, 0.52, 0.68, min(0.62, bed_w / n - 0.12), 0.4, 'linen', bevel=0.07)
        top = 0.85 if low else h + 0.0
        self.part(p, 'headboard', 0, -d / 2 + 0.04, 0.08, top, w, 0.08, 'wood', bevel=0.006)
        self.part(p, 'headpad', 0, -d / 2 + 0.1, 0.5, top - 0.06, w - 0.12, 0.06, 'fabric', bevel=0.03)

    def nightstand(self, p):
        w, d, h = p['w'], p['d'], p['h']
        self.legs(p, w, d, 0, 0.1, 0.03, 'metal', inset=0.03)
        self.part(p, 'body', 0, 0, 0.1, h, w, d, 'wood', bevel=0.005)
        self.part(p, 'drawer', 0, d / 2 + 0.001, h - 0.18, h - 0.175, w - 0.04, 0.004, 'groove', bevel=0)
        self.part(p, 'knob', 0, d / 2 + 0.01, h - 0.11, h - 0.09, 0.08, 0.015, 'metal', bevel=0)

    def wardrobe(self, p):
        w, d, h = p['w'], p['d'], p['h']
        self.part(p, 'plinth', 0, -0.03, 0, 0.08, w - 0.02, d - 0.06, 'groove', bevel=0)
        self.part(p, 'body', 0, 0, 0.08, h, w, d, 'panel', bevel=0.004)
        n = max(2, round(w / 0.55))
        for i in range(1, n):
            self.part(p, f'joint{i}', -w / 2 + w * i / n, d / 2 + 0.001, 0.1, h - 0.02, 0.005, 0.004, 'groove', bevel=0)
        for i in range(n):
            lx = -w / 2 + w * (i + 0.5) / n + (w / n / 2 - 0.06) * (1 if i % 2 == 0 else -1)
            self.part(p, f'handle{i}', lx, d / 2 + 0.015, 0.95, 1.35, 0.016, 0.02, 'metal', bevel=0)

    def desk(self, p):
        w, d, h = p['w'], p['d'], p['h']
        self.part(p, 'top', 0, 0, h - 0.03, h, w, d, 'wood', bevel=0.004)
        for side in (-1, 1):
            self.part(p, f'side{side}', side * (w / 2 - 0.02), 0, 0, h - 0.03, 0.035, d - 0.04, 'wood', bevel=0.003)
        self.part(p, 'laptop', -w * 0.15, 0.02, h, h + 0.018, 0.33, 0.23, 'groove', bevel=0.003)
        self.cylinder(p, 'cup', w * 0.3, -0.1, h, h + 0.1, 0.04, 'ceramic', verts=16)

    def chair(self, p, dining=False):
        self.legs(p, 0.42, 0.42, 0, 0.44, 0.03, 'wood' if dining else 'metal', inset=0.03)
        self.part(p, 'seat', 0, 0.02, 0.44, 0.5, 0.46, 0.46, 'fabric' if dining else 'fabric-accent', bevel=0.02)
        self.part(p, 'back', 0, -0.2, 0.5, p['h'], 0.44, 0.04, 'wood' if dining else 'fabric-accent', bevel=0.012)

    def dining_table(self, p):
        w, d, h = p['w'], p['d'], p['h']
        self.part(p, 'top', 0, 0, h - 0.04, h, w, d, 'wood', bevel=0.006)
        self.legs(p, w, d, 0, h - 0.04, 0.06, 'wood', inset=0.1)
        self.part(p, 'runner', 0, 0, h, h + 0.004, (w if w > d else 0.32) * (0.6 if w > d else 1), (0.32 if w > d else d * 0.6), 'linen', bevel=0)
        self.cylinder(p, 'bowl', 0, 0, h + 0.004, h + 0.09, 0.14, 'ceramic')

    def sideboard(self, p):
        w, d, h = p['w'], p['d'], p['h']
        self.legs(p, w, d, 0, 0.14, 0.035, 'metal', inset=0.05)
        self.part(p, 'body', 0, 0, 0.14, h, w, d, 'wood', bevel=0.005)
        n = max(2, round(w / 0.45))
        for i in range(1, n):
            self.part(p, f'joint{i}', -w / 2 + w * i / n, d / 2 + 0.001, 0.16, h - 0.02, 0.005, 0.004, 'groove', bevel=0)
        self.cylinder(p, 'vase', -w * 0.3, 0, h, h + 0.32, 0.07, 'ceramic')

    def bookshelf(self, p):
        w, d, h = p['w'], p['d'], p['h']
        for side in (-1, 1):
            self.part(p, f'side{side}', side * (w / 2 - 0.012), 0, 0, h, 0.025, d, 'wood', bevel=0.002)
        self.part(p, 'back', 0, -d / 2 + 0.01, 0, h, w, 0.02, 'wood', bevel=0)
        levels = 5
        for k in range(levels + 1):
            y = 0.04 + k * (h - 0.06) / levels
            self.part(p, f'shelf{k}', 0, 0, y, y + 0.022, w - 0.03, d - 0.01, 'wood', bevel=0.002)
            if k == levels:
                continue
            x = -w / 2 + 0.05
            i = 0
            # books: deterministic by the piece id, so the same room always looks the same
            while x < w / 2 - 0.12 and i < 40:
                bw = 0.025 + 0.02 * seeded(f'{p["id"]}{k}{i}w', 3)
                bh = 0.2 + 0.03 * seeded(f'{p["id"]}{k}{i}h', 4)
                if seeded(f'{p["id"]}{k}{i}gap', 9) == 0:
                    x += 0.12
                mat = ['fabric-accent', 'fabric', 'fabric-cream', 'wood'][seeded(f'{p["id"]}{k}{i}c', 4)]
                self.part(p, f'book{k}-{i}', x + bw / 2, 0.02, y + 0.022, y + 0.022 + bh, bw, d - 0.08, mat, bevel=0.002)
                x += bw + 0.004
                i += 1

    def curtain(self, p):
        """a softly pleated drop from just under the ceiling to the floor"""
        w, h = p['w'], p['h']
        folds = max(6, int(w / 0.09))
        verts, faces = [], []
        for i in range(folds + 1):
            lx = -w / 2 + w * i / folds
            off = 0.035 * math.sin(i * math.pi)  # alternating pleat in and out
            off = 0.035 if i % 2 else -0.035
            for y in (0.01, h):
                x, z = self.at(p, lx, off)
                verts.append(to_blender((x, y, z)))
        for i in range(folds):
            a = i * 2
            faces.append((a, a + 2, a + 3, a + 1))
        mesh = bpy.data.meshes.new(f'{p["id"]}-drape')
        mesh.from_pydata(verts, [], faces)
        mesh.update()
        obj = bpy.data.objects.new(f'{p["id"]}-drape', mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.data.materials.append(self.m.get('curtain'))
        mod = obj.modifiers.new('soften', 'SUBSURF')
        mod.levels = mod.render_levels = 2
        obj.data.polygons.foreach_set('use_smooth', [True] * len(obj.data.polygons))
        x, z = self.at(p, 0, -0.03)
        self.box(f'{p["id"]}-rod', (x, h + 0.01, z), (w + 0.1, 0.025, 0.025) if p['face'] in 'NS' else (0.025, 0.025, w + 0.1), self.m.get('metal'), bevel=0)

    def art(self, p):
        w, h, y = p['w'], p['h'], p.get('y', 1.4)
        self.part(p, 'frame', 0, 0, y, y + h, w, 0.03, 'groove', bevel=0.003)
        self.part(p, 'canvas', 0, 0.016, y + 0.04, y + h - 0.04, w - 0.08, 0.004, 'canvas', bevel=0)

    def pendant(self, p, ceiling):
        y = p.get('y', 1.6)
        self.cylinder(p, 'cord', 0, 0, y + 0.3, ceiling, 0.004, 'groove', verts=8)
        self.sphere(p, 'shade', 0, 0, y + 0.18, (0.24, 0.16, 0.24), 'metal')
        self.cylinder(p, 'diffuser', 0, 0, y + 0.03, y + 0.06, 0.18, 'shade')
        self.light(p, 0, 0, y, 35)


def build_pieces(pieces, box, principled, hex_rgb, style, ceiling, add_light=True):
    mats = Materials(style, hex_rgb, principled)
    b = Builder(box, mats, add_light)
    for p in pieces:
        t = p['type']
        if t == 'sofa':
            b.sofa(p)
        elif t == 'armchair':
            b.sofa(p, armchair=True)
        elif t == 'coffee-table':
            b.coffee_table(p)
        elif t == 'tv-unit':
            b.tv_unit(p)
        elif t == 'tv':
            b.tv(p)
        elif t == 'rug':
            b.rug(p)
        elif t == 'side-table':
            b.side_table(p)
        elif t == 'floor-lamp':
            b.floor_lamp(p)
        elif t == 'table-lamp':
            b.table_lamp(p)
        elif t == 'plant':
            b.plant(p)
        elif t == 'bed':
            b.bed(p)
        elif t == 'nightstand':
            b.nightstand(p)
        elif t == 'wardrobe':
            b.wardrobe(p)
        elif t == 'desk':
            b.desk(p)
        elif t == 'chair':
            b.chair(p)
        elif t == 'dining-chair':
            b.chair(p, dining=True)
        elif t == 'dining-table':
            b.dining_table(p)
        elif t in ('sideboard', 'console'):
            b.sideboard(p)
        elif t == 'bookshelf':
            b.bookshelf(p)
        elif t == 'curtain':
            b.curtain(p)
        elif t == 'art':
            b.art(p)
        elif t == 'pendant':
            b.pendant(p, ceiling)
