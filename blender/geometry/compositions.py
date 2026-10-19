"""Build the planner's attached roof planes, including their timber soffits."""
from .site import overlaps


def create_composition_canopies(scene, building):
    composition = building.get('modernComposition')
    if not composition:
        return 0
    env = building['plot']['buildable']
    for canopy in composition['canopies']:
        floor = next(f for f in building['floors'] if f['id'] == canopy['floorId'])
        window = next(w for w in building['windows'] if w['id'] == canopy['sourceWindowId'])
        r = canopy['rect']
        if min(r['w'], r['h']) <= 0 or r['x'] < env['x'] or r['y'] < env['y'] or \
                r['x']+r['w'] > env['x']+env['w'] or r['y']+r['h'] > env['y']+env['h'] or \
                floor.get('courtyard') and overlaps(r, floor['courtyard']):
            raise ValueError('Composition canopy crosses its source envelope or courtyard')
        if canopy['bottomMm'] < floor['elevationMm'] + window.get('head', 2250) + 100:
            raise ValueError('Composition canopy blocks its source glazing')
        obj = scene.rect(canopy['id'], 'ROOF', r, canopy['bottomMm'], canopy['thicknessMm'], 'wall', canopy['sourceRoomId'], bevel=12)
        obj['composition_canopy'] = True
        obj['source_window_id'] = canopy['sourceWindowId']
        inset = 70
        soffit = dict(x=r['x']+inset, y=r['y']+inset, w=r['w']-2*inset, h=r['h']-2*inset)
        scene.rect(canopy['id']+'_TimberSoffit', 'ROOF', soffit, canopy['bottomMm']-25, 25, 'wood', canopy['sourceRoomId'], bevel=3)
    return len(composition['canopies'])
