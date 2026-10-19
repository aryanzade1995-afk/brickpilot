"""Connected roof regions and exact door access; no Blender dependency."""


def roof_components(rects, minimum_connection=800):
    def joined(a, b):
        overlap_x = min(a['x']+a['w'], b['x']+b['w'])-max(a['x'], b['x'])
        overlap_y = min(a['y']+a['h'], b['y']+b['h'])-max(a['y'], b['y'])
        return (overlap_x > 0 and overlap_y > 0) or \
            (abs(overlap_x) <= 2 and overlap_y >= minimum_connection) or \
            (abs(overlap_y) <= 2 and overlap_x >= minimum_connection)
    remaining = list(rects)
    groups = []
    while remaining:
        group = [remaining.pop(0)]
        index = 0
        while index < len(group):
            neighbours = [r for r in remaining if joined(group[index], r)]
            group.extend(neighbours)
            remaining = [r for r in remaining if r not in neighbours]
            index += 1
        groups.append(group)
    return groups


def roof_has_access(rects, doors, floor_id):
    """A whole door aperture must meet an actual roof edge, including seams."""
    for door in doors:
        if door['floorId'] != floor_id or door.get('kind') == 'entry':
            continue
        horizontal = door['orient'] == 'h'
        fixed = door['at']['y' if horizontal else 'x']
        along = door['at']['x' if horizontal else 'y']
        half = door.get('width', 900)/2
        spans = []
        for rect in rects:
            for edge in (rect['y' if horizontal else 'x'],
                         rect['y' if horizontal else 'x'] + rect['h' if horizontal else 'w']):
                if abs(fixed-edge) <= 2:
                    lo = rect['x' if horizontal else 'y']
                    spans.append((lo, lo+rect['w' if horizontal else 'h']))
        cursor = along-half
        for lo, hi in sorted(spans):
            if lo > cursor+2:
                break
            if hi > cursor:
                cursor = hi
            if cursor >= along+half-2:
                return True
    return False
