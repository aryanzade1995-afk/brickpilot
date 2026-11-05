"""Selected bathroom fixtures, inside the plan's existing fitted footprints.

Catalogue profiles describe form and finish; they are not manufacturer CAD.
Optional baths are fitted only where doors, columns and circulation remain clear.
"""
import math
import bpy
from bathroom_hardware import attach_hardware


def bowl(name, center, width, depth, height, mat, rectangular=False):
    """Closed ceramic shell with an open rim and an inner basin, not a solid cube."""
    x, y, z = center
    segments = 64
    rings = [(0, .78), (.12, .95), (1, 1), (1, .88), (.25, .61)]
    verts, faces = [], []
    for level, radius in rings:
        for i in range(segments):
            angle = i * math.tau / segments
            a, b = math.cos(angle), math.sin(angle)
            if rectangular:
                a, b = math.copysign(abs(a) ** .45, a), math.copysign(abs(b) ** .45, b)
            verts.append((x + a * width * radius / 2, -(z + b * depth * radius / 2), y - height / 2 + level * height))
    for r in range(len(rings) - 1):
        for i in range(segments):
            j = (i + 1) % segments
            faces.append((r * segments + i, r * segments + j, (r + 1) * segments + j, (r + 1) * segments + i))
    faces.append(tuple(range(segments - 1, -1, -1)))
    faces.append(tuple((len(rings) - 1) * segments + i for i in range(segments)))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces); mesh.update()
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh); bpy.context.scene.collection.objects.link(obj)
    for face in mesh.polygons: face.use_smooth = True
    return obj


def cylinder(name, pos, radius, height, mat):
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=radius, depth=height, location=(pos[0], -pos[2], pos[1]))
    obj = bpy.context.object; obj.name = name; obj.data.materials.append(mat)
    bevel = obj.modifiers.new('rounded', 'BEVEL'); bevel.width = min(.006, radius / 5); bevel.segments = 3
    for p in obj.data.polygons: p.use_smooth = True
    return obj


def tag(obj, item, value):
    obj['finish_item'], obj['finish_name'] = item, value['name']
    if value.get('profile'): obj['finish_model'] = value['profile']['model']; obj['finish_variant'] = value['profile']['variant']
    return obj


def apply_bathroom(data, box, principled, hex_rgb, out, metal):
    fin, furniture, dims = data['finishes'], data['furniture'], data['room']['dims']
    ceramic = principled('selected-bath-ceramic', hex_rgb('#F6F6F2'), .12)
    metal = metal or principled('selected-bath-chrome', (.82, .84, .86), .14, metal=1)
    skip = out.setdefault('skip', set())
    warnings = out.setdefault('warnings', [])
    find = lambda suffix: next((b for b in furniture if b['id'].endswith(suffix)), None)

    wc, sanitary = find('-wc'), fin.get('sanitary')
    if wc and sanitary:
        skip.add(wc['id'])
        cistern = find('-cistern')
        if cistern: skip.add(cistern['id'])
        x, _, z = wc['pos']; w, _, d = wc['size']
        kind = sanitary['wc']
        tag(bowl('selected-toilet', (x, .035 if kind == 'indian' else .39, z), w * .96, d * .91,
                 .06 if kind == 'indian' else .18, ceramic), 'sanitary', sanitary)
        if kind == 'floor':
            box('toilet-pedestal', (x, .16, z), (w * .5, .3, d * .56), ceramic, bevel=.065)
        if kind == 'indian':
            for side in (-1, 1):
                box(f'indian-pan-foot-{side}', (x + side * w * .33, .035, z), (w * .2, .05, d * .72), ceramic, bevel=.012)
        elif kind == 'wall':
            side = min('NSEW', key=lambda s: {'N': z + dims['d']/2, 'S': dims['d']/2-z, 'W': x+dims['w']/2, 'E': dims['w']/2-x}[s])
            pos = (x, 1.1, -dims['d']/2+.04) if side == 'N' else (x, 1.1, dims['d']/2-.04) if side == 'S' else (-dims['w']/2+.04, 1.1, z) if side == 'W' else (dims['w']/2-.04, 1.1, z)
            box('wc-flush-plate', pos, (.2,.12,.015) if side in 'NS' else (.015,.12,.2), metal, bevel=.006)
        if cistern and kind != 'wall':
            pos = list(cistern['pos']); pos[1] = 1.9 if kind == 'indian' else pos[1]
            box('selected-cistern', pos, cistern['size'], ceramic, bevel=.04)

    basin, value = find('-basin'), fin.get('basin')
    if value and basin:
        skip.add(basin['id'])
        profile = value.get('profile') or {}; model = profile.get('model', 'basin-oval')
        vanity = find('-vanity'); x, y, z = basin['pos']; w, h, d = basin['size']
        if model == 'basin-pedestal' and vanity:
            skip.add(vanity['id']); cylinder('basin-pedestal', (x,.37,z), min(w,d)*.19,.74,ceramic)
        if model == 'basin-square': w = d = min(w,d)
        if model == 'basin-undermount':
            y -= .10
            if vanity:
                pos, size = list(vanity['pos']), list(vanity['size']); size[1] -= .18; pos[1] -= .09
                out.setdefault('reshape', {})[vanity['id']] = (pos,size)
        tag(bowl('selected-basin', (x,y,z),w,d,h,ceramic,model in ('basin-rectangle','basin-square','basin-undermount')), 'bath-basin', value)
        # The mixer is fitted at the rear edge of the existing basin footprint.
        distances = {'N': z+dims['d']/2,'S':dims['d']/2-z,'W':x+dims['w']/2,'E':dims['w']/2-x}
        side = min(distances,key=distances.get); dx,dz = {'N':(0,-1),'S':(0,1),'W':(-1,0),'E':(1,0)}[side]
        depth=d if side in 'NS' else w
        rear=max(.03,depth/2-.035)
        mx, mz = x+dx*rear, z+dz*rear
        fittings=fin.get('fittings') or value
        profile=fittings.get('profile') or {}
        variant=profile.get('variant',0)
        wall_mixer=profile.get('model')=='faucet-wall' or 'exposed part' in fittings.get('name','').lower()
        tx=dx*(dims['w']/2-.14) if wall_mixer and dx else mx
        tz=dz*(dims['d']/2-.14) if wall_mixer and dz else mz
        if not attach_hardware('basin-tap',variant,(tx,y+h/2+(.16 if wall_mixer else 0),tz),(dx,dz),fittings,fittings.get('finish','chrome'),(w if side in 'NS' else d,depth)):
            cylinder('basin-mixer',(mx,y+h/2+.08,mz),.018,.16,metal)
            box('basin-spout',(mx-dx*.05,y+h/2+.14,mz-dz*.05),(.12 if dx else .025,.025,.12 if dz else .025),metal,bevel=.008)
    elif value: warnings.append('The selected basin cannot fit this bathroom without changing its clearances.')

    tray, shower = find('-shower-tray'), fin.get('shower')
    for part in furniture:
        if part['id'].endswith('-shower-glass') or '-enclosure-' in part['id']:
            skip.add(part['id'])
    if tray:
        x, y, z = tray['pos']; w, _, d = tray['size']
        if shower:
            variant=(shower.get('profile') or {}).get('variant',0)
            distances={'N':z+dims['d']/2,'S':dims['d']/2-z,'W':x+dims['w']/2,'E':dims['w']/2-x}
            side=min(distances,key=distances.get);dx,dz={'N':(0,-1),'S':(0,1),'W':(-1,0),'E':(1,0)}[side]
            wall_x=dx*(dims['w']/2-.14) if dx else x
            wall_z=dz*(dims['d']/2-.14) if dz else z
            if not attach_hardware('shower-set',variant,(wall_x,1.0,wall_z),(dx,dz),shower,(fin.get('fittings') or {}).get('finish','chrome')):
                tag(cylinder('selected-showerhead',(x,2.08,z),.0525,.024,metal),'bath-shower',shower)
    elif shower: warnings.append('The selected shower needs a clear shower area; this room has no safe fitted location.')

    tub=fin.get('tub')
    if tub:
        # Preserve all existing fittings and the door approach. Never force a tub
        # into a small bathroom or resize the room to hide a placement conflict.
        obstacles=[b for b in furniture if b['mat']!='glass']+[b for b in data['shell'] if b['id'].startswith('column')]
        spot=None
        for tw,td in ((1.70,.78),(.78,1.70)):
            for ix in range(9):
                for iz in range(9):
                    x=-dims['w']/2+.15+tw/2+ix*max(0,dims['w']-.3-tw)/8
                    z=-dims['d']/2+.15+td/2+iz*max(0,dims['d']-.3-td)/8
                    if dims['w']<tw+.3 or dims['d']<td+.3: continue
                    if any(abs(x-b['pos'][0])<(tw+b['size'][0])/2+.12 and abs(z-b['pos'][2])<(td+b['size'][2])/2+.12 for b in obstacles):continue
                    if abs(x-data['camera'][0])<tw/2+.3 and abs(z-data['camera'][2])<td/2+.3:continue
                    blocked=False
                    for o in data.get('openings',[]):
                        if o['kind']=='window':continue
                        along=o.get('alongM',0); side=o['side']; width=o['widthM']
                        near={'N':z-td/2 < -dims['d']/2+1.0,'S':z+td/2>dims['d']/2-1.0,'W':x-tw/2 < -dims['w']/2+1.0,'E':x+tw/2>dims['w']/2-1.0}[side]
                        if near and abs((x if side in 'NS' else z)-along)<(width+(tw if side in 'NS' else td))/2+.2:blocked=True
                    if not blocked:spot=(x,z,tw,td);break
                if spot:break
            if spot:break
        if spot:
            x,z,w,d=spot; profile=tub.get('profile') or {}; claw=profile.get('model')=='tub-claw'
            tag(bowl('selected-bathtub',(x,.37 if claw else .29,z),w,d,.52,ceramic),'bath-tub',tub)
            if claw:
                feet=principled('tub-feet',hex_rgb(profile.get('accent','#AEB8BD')),.18,metal=1)
                for a in (-1,1):
                    for b in (-1,1):cylinder(f'tub-foot-{a}-{b}',(x+a*w*.3,.07,z+b*d*.3),.035,.14,feet)
        else:warnings.append('The selected bathtub cannot fit while preserving the existing bathroom fittings, door and walking clearance.')
    return out
