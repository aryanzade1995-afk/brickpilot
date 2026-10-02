"""Geometric checks for new site, window and terrace element anchors."""
import math
from geometry.plates import subtract_rectangles


def validate_elements(payload):
    b, facade = payload['buildingModel'], payload['facadeGrammar']
    zones = {z['id']: z for z in facade['zones']}
    site = {f['id']: f for f in b.get('siteFeatures', [])}
    for feature in facade['features']:
        for p in feature['parts']:
            z = zones[p['zoneId']]
            u, width, offset, depth = p['u0Mm'], p['u1Mm']-p['u0Mm'], p['offsetMm'], p['depthMm']
            r = p['world']
            if z['side'] in ('N', 'S'):
                expected = {'x': u, 'y': z['fixedMm']-offset-depth if z['side']=='N' else z['fixedMm']+offset, 'w': width, 'h': depth}
            else:
                expected = {'x': z['fixedMm']-offset-depth if z['side']=='W' else z['fixedMm']+offset, 'y': u, 'w': depth, 'h': width}
            expected.update(z=p['z0Mm'], height=p['z1Mm']-p['z0Mm'])
            if any(not math.isfinite(r[k]) or r[k] != v for k,v in expected.items()):
                raise ValueError('Facade part differs from its local anchor')
            env = b['plot']['buildable']
            if z.get('anchorKind') == 'gate':
                f = site.get(z.get('sourceSiteId'))
                if feature['type'] != 'GATE_PORTAL' or not b.get('siteRequirements', {}).get('compoundWall') or not f or f['kind'] not in ('path','driveway') or z['side'] != 'N' or z['fixedMm'] != b['plot']['depthMm']:
                    raise ValueError('Gate portal is not anchored to the source road edge')
                env = {'x':0, 'y':0, 'w':b['plot']['widthMm'], 'h':b['plot']['depthMm']}
            if r['x'] < env['x'] or r['y'] < env['y'] or r['x']+r['w'] > env['x']+env['w'] or r['y']+r['h'] > env['y']+env['h']:
                raise ValueError('Facade part crosses its boundary')
            if z.get('anchorKind') == 'pool-sitout':
                f = site.get(z.get('sourceSiteId'))
                if not f or f['kind'] != 'sitOut' or feature['type'] != 'POOL_PAVILION' or subtract_rectangles(r,[f['rect']]):
                    raise ValueError('Pool pavilion leaves the source sit-out')
            if z.get('anchorKind') == 'roof-interior':
                floor = next(f for f in b['floors'] if f['id']==z['floorId'])
                if feature['type'] not in ('SOLAR_SHADE_ROOF','ROOF_GARDEN_EDGE') or subtract_rectangles(r,floor['footprint']):
                    raise ValueError('Terrace element has no supporting slab')
                for service in ('mumty','tank'):
                    s = (b.get('roofTerrace') or {}).get(service)
                    if s and min(r['x']+r['w'],s['x']+s['w']+300)>max(r['x'],s['x']-300) and min(r['y']+r['h'],s['y']+s['h']+300)>max(r['y'],s['y']-300):
                        raise ValueError('Terrace element blocks a roof service')
