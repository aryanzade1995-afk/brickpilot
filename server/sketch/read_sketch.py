"""Turn a photographed / scanned hand-drawn house plan into a measured draft.

python read_sketch.py <image> <labels.json>      -> JSON draft on stdout

labels.json is what the local vision model read: [{"text": "BED ROOM", "bbox_2d": [x0, y0, x1, y1]}, ...] in image pixels.
The geometry comes from the drawing itself (OpenCV): wall strokes, the rooms they enclose, gaps that are doors, and
window symbols on outer walls. The scale comes from dimension labels (30', 9.1 m ...) and their dimension lines.
Output coordinates are normalised 0..1000 over the building's outer wall rectangle, in the survey format the
Existing Structure page already reviews (src/lib/existing/survey.ts).
"""
import json
import re
import sys

import cv2
import numpy as np

FT = 0.3048

ROOM_WORDS = [  # (pattern, type, default name)
    (r'drawing|living|lounge|hall|lobby|family|sitting', 'living', 'Living room'),
    (r'dining', 'dining', 'Dining'),
    (r'kitchen|kitchn|cook', 'kitchen', 'Kitchen'),
    (r'bed|master|guest|kids|bd\s*rm', 'bed', 'Bedroom'),
    (r'toilet|bath|wc|w\.c|washroom|lav', 'bath', 'Toilet'),
    (r'study|office|library', 'study', 'Study'),
    (r'pooja|puja|mandir|prayer', 'pooja', 'Pooja'),
    (r'store|utility|wash\s*area|laundry', 'utility', 'Store'),
    (r'stair|staircase|steps up', 'stair', 'Stair'),
    (r'passage|corridor', 'corridor', 'Passage'),
    (r'foyer|entrance|entry', 'foyer', 'Foyer'),
]
GATE = re.compile(r'gate|road|street|entrance|main\s*entry', re.I)


def parse_length(text):
    """30' / 30 ft / 12'6" / 9.1 m / 9100 mm -> metres, or None"""
    t = text.lower().replace('’', "'").replace('′', "'").replace('”', '"').replace('″', '"').replace(' ', '')
    m = re.fullmatch(r"(\d+(?:\.\d+)?)(?:'|ft|feet)(?:(\d+(?:\.\d+)?)(?:\"|in)?)?", t)
    if m:
        return float(m.group(1)) * FT + (float(m.group(2)) * 0.0254 if m.group(2) else 0)
    m = re.fullmatch(r'(\d+(?:\.\d+)?)(mm|cm|m)', t)
    if m:
        return float(m.group(1)) * {'mm': .001, 'cm': .01, 'm': 1}[m.group(2)]
    return None


def room_kind(text):
    t = text.lower()
    for pattern, kind, name in ROOM_WORDS:
        if re.search(pattern, t):
            return kind
    return None


def segments(mask, horizontal, min_len):
    """connected strokes of a direction mask -> [(pos, a, b, thickness)]"""
    n, lab, st, _ = cv2.connectedComponentsWithStats(mask, 8)
    out = []
    for i in range(1, n):
        x, y, w, h, _ = st[i]
        if horizontal and w >= min_len:
            out.append([y + h / 2, x, x + w, h])
        elif not horizontal and h >= min_len:
            out.append([x + w / 2, y, y + h, w])
    return out


def merge_parallel(segs, max_gap):
    """the two pen lines of a double-line wall become one wall: centre line and thickness. Stretches where only one of
    the lines is drawn (a threshold across a doorway, a window) are kept as `holes` for the opening finder"""
    segs = sorted(segs, key=lambda s: s[0])
    used = [False] * len(segs)
    walls = []
    for i, s in enumerate(segs):
        if used[i]:
            continue
        group = [s]
        used[i] = True
        for j in range(i + 1, len(segs)):
            t = segs[j]
            if used[j] or t[0] - group[-1][0] > max_gap:
                continue
            overlap = min(s[2], t[2]) - max(s[1], t[1])
            if overlap > 0.5 * min(s[2] - s[1], t[2] - t[1]):
                group.append(t)
                used[j] = True
        lo = min(g[0] - g[3] / 2 for g in group)
        hi = max(g[0] + g[3] / 2 for g in group)
        a, b = min(g[1] for g in group), max(g[2] for g in group)
        holes = []
        rows = sorted({round(g[0]) for g in group})
        if len(rows) >= 2:  # per pen line, where it is missing along the wall
            cover = np.zeros(int(b - a) + 1, np.int16)
            for row in rows:
                line = np.zeros_like(cover)
                for g in group:
                    if abs(round(g[0]) - row) <= 1:
                        line[int(g[1] - a):int(g[2] - a) + 1] = 1
                cover += line
            short = cover < cover.max()
            k = 0
            while k < len(short):
                if short[k]:
                    e = k
                    while e < len(short) and short[e]:
                        e += 1
                    if 0 < k and e < len(short):
                        holes.append((a + k, a + e))
                    k = e
                else:
                    k += 1
        walls.append({'pos': (lo + hi) / 2, 'a': a, 'b': b, 'thick': hi - lo, 'lines': len(group), 'holes': holes})
    return walls


def cluster(values, weights, tol):
    """coordinates closer than tol are the same sketched line: snap them to their length-weighted mean"""
    order = sorted(range(len(values)), key=lambda i: values[i])
    groups, mapping = [], {}
    for i in order:
        if groups and values[i] - groups[-1]['last'] <= tol:
            g = groups[-1]
        else:
            g = {'members': [], 'last': values[i]}
            groups.append(g)
        g['members'].append(i)
        g['last'] = values[i]
    for g in groups:
        total = sum(weights[i] for i in g['members']) or 1
        mean = sum(values[i] * weights[i] for i in g['members']) / total
        for i in g['members']:
            mapping[i] = mean
    return [mapping[i] for i in range(len(values))]


def rect_pieces(cells, xs, ys):
    """an orthogonal region on a grid -> guillotine partitions into rectangles (search all cut sequences, memoised)"""
    memo = {}

    def is_rect(cs):
        if not cs:
            return None
        i0 = min(c[0] for c in cs); i1 = max(c[0] for c in cs)
        j0 = min(c[1] for c in cs); j1 = max(c[1] for c in cs)
        return (i0, i1, j0, j1) if len(cs) == (i1 - i0 + 1) * (j1 - j0 + 1) else None

    def split(cs):
        key = frozenset(cs)
        if key in memo:
            return memo[key]
        options = []
        if is_rect(cs):
            options.append([cs])
        i_vals = sorted({c[0] for c in cs}); j_vals = sorted({c[1] for c in cs})
        for cut in i_vals[1:]:
            a = [c for c in cs if c[0] < cut]; b = [c for c in cs if c[0] >= cut]
            for pa in split(a)[:6]:
                for pb in split(b)[:6]:
                    options.append(pa + pb)
        for cut in j_vals[1:]:
            a = [c for c in cs if c[1] < cut]; b = [c for c in cs if c[1] >= cut]
            for pa in split(a)[:6]:
                for pb in split(b)[:6]:
                    options.append(pa + pb)
        options.sort(key=len)
        memo[key] = options[:40]
        return memo[key]

    return [[is_rect(p) for p in parts] for parts in split(list(cells))]


def read(image_path, labels, moves=(), depth=0):
    im = cv2.imread(image_path)
    if im is None:
        raise ValueError('The drawing could not be opened.')
    gray = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    H, W = gray.shape
    side = min(H, W)
    # --- what the labels say
    texts = []
    for item in labels:
        t, b = str(item.get('text', '')).strip(), item.get('bbox_2d')
        if not t or not isinstance(b, list) or len(b) != 4:
            continue
        x0, y0, x1, y1 = [float(v) for v in b]
        if any(abs(o['cx'] - (x0 + x1) / 2) < 6 and abs(o['cy'] - (y0 + y1) / 2) < 6 and o['text'] == t for o in texts):
            continue
        texts.append({'text': t, 'box': (x0, y0, x1, y1), 'cx': (x0 + x1) / 2, 'cy': (y0 + y1) / 2,
                      'kind': room_kind(t), 'length': parse_length(t), 'gate': bool(GATE.search(t))})
    room_labels = [t for t in texts if t['kind'] and not t['gate'] or (t['kind'] and re.search(r'foyer', t['text'], re.I))]
    if not room_labels:
        raise ValueError('No room names could be read on the drawing.')

    ink = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 31, 15)
    # long strokes from the drawing as drawn; short strokes (door jambs, wall stubs) only away from the lettering
    erased = ink.copy()
    for t in texts:
        x0, y0, x1, y1 = t['box']
        erased[max(0, int(y0) - 3):int(y1) + 4, max(0, int(x0) - 3):int(x1) + 4] = 0
    L = max(18, int(side * 0.025))
    long_l = max(25, int(side * 0.045))
    kh = lambda n: cv2.getStructuringElement(cv2.MORPH_RECT, (n, 1))
    kv = lambda n: cv2.getStructuringElement(cv2.MORPH_RECT, (1, n))
    hor = cv2.morphologyEx(ink, cv2.MORPH_OPEN, kh(long_l)) | cv2.morphologyEx(erased, cv2.MORPH_OPEN, kh(L))
    ver = cv2.morphologyEx(ink, cv2.MORPH_OPEN, kv(long_l)) | cv2.morphologyEx(erased, cv2.MORPH_OPEN, kv(L))
    hw = merge_parallel(segments(hor, True, L), side * 0.016)
    vw = merge_parallel(segments(ver, False, L), side * 0.016)

    # --- the enclosed spaces of the raw strokes, to find the building among dimension lines and page edges
    def raster(hws, vws, close_px, thick=5):
        m = np.zeros((H, W), np.uint8)
        hm = np.zeros_like(m); vm = np.zeros_like(m)
        for w in hws:
            cv2.line(hm, (int(w['a']), int(w['pos'])), (int(w['b']), int(w['pos'])), 255, thick)
        for w in vws:
            cv2.line(vm, (int(w['pos']), int(w['a'])), (int(w['pos']), int(w['b'])), 255, thick)
        if close_px:
            hm = cv2.morphologyEx(hm, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (close_px, 1)))
            vm = cv2.morphologyEx(vm, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (1, close_px)))
        return m | hm | vm

    def regions(mask):
        free = (mask == 0).astype(np.uint8)
        n, lab, st, _ = cv2.connectedComponentsWithStats(free, 4)
        border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])).tolist())
        return n, lab, st, border

    rough = raster(hw, vw, int(side * 0.11))
    n, lab, st, border = regions(rough)
    keep = set()
    for t in room_labels:
        i = int(lab[int(min(H - 1, max(0, t['cy']))), int(min(W - 1, max(0, t['cx'])))])
        if i and i not in border:
            keep.add(i)
    if not keep:
        raise ValueError('The outer walls of the house could not be traced. Use a straight, well-lit photo of the drawing.')
    xs0 = [st[i][0] for i in keep]; ys0 = [st[i][1] for i in keep]
    xs1 = [st[i][0] + st[i][2] for i in keep]; ys1 = [st[i][1] + st[i][3] for i in keep]
    bx0, by0, bx1, by1 = min(xs0), min(ys0), max(xs1), max(ys1)
    pad = side * 0.03
    inside_h = lambda w: by0 - pad <= w['pos'] <= by1 + pad and min(w['b'], bx1 + pad) - max(w['a'], bx0 - pad) > L
    inside_v = lambda w: bx0 - pad <= w['pos'] <= bx1 + pad and min(w['b'], by1 + pad) - max(w['a'], by0 - pad) > L
    house_h = [dict(w, a=max(w['a'], bx0 - pad), b=min(w['b'], bx1 + pad)) for w in hw if inside_h(w)]
    house_v = [dict(w, a=max(w['a'], by0 - pad), b=min(w['b'], by1 + pad)) for w in vw if inside_v(w)]
    # the outer wall lines
    # the outer walls: the long line nearest each edge of the traced rooms (not plinth, step or ground lines beyond it)
    def edge(ws, target, span):
        # an outer wall is broken by windows and doors: add up the pieces lying on one line
        near = sorted([w for w in ws if abs(w['pos'] - target) < pad], key=lambda w: w['pos'])
        lines = []
        for w in near:
            if lines and w['pos'] - lines[-1][-1]['pos'] < 6:
                lines[-1].append(w)
            else:
                lines.append([w])
        good = [l for l in lines if sum(w['b'] - w['a'] for w in l) > 0.5 * span]
        if not good:
            return None
        l = min(good, key=lambda l: abs(sum(w['pos'] for w in l) / len(l) - target))
        total = sum(w['b'] - w['a'] for w in l)
        return {'pos': sum(w['pos'] * (w['b'] - w['a']) for w in l) / total, 'a': min(w['a'] for w in l), 'b': max(w['b'] for w in l),
                'thick': max(w['thick'] for w in l), 'lines': 2}
    top, bottom = edge(house_h, by0, bx1 - bx0), edge(house_h, by1, bx1 - bx0)
    left, right = edge(house_v, bx0, by1 - by0), edge(house_v, bx1, by1 - by0)
    if not (top and bottom and left and right):
        raise ValueError('The outer walls of the house could not be traced.')
    X0, X1, Y0, Y1 = left['pos'], right['pos'], top['pos'], bottom['pos']
    house_h = [w for w in house_h if Y0 - 3 <= w['pos'] <= Y1 + 3]
    house_v = [w for w in house_v if X0 - 3 <= w['pos'] <= X1 + 3]

    # --- scale from dimension labels and their dimension lines (each axis separately: sketches are rarely in proportion)
    notes = []
    sx = sy = None
    # dimension lines: long lines just outside the house, parallel to a side (the reader's text positions are not
    # reliable enough to pair a length with its line, so lengths are paired with lines by the scale they imply)
    def dim_line(ws, lo_edge, hi_edge, span_ref):
        clear = side * 0.025  # well clear of the wall's own pen lines
        cands = [w for w in ws if (w['pos'] < lo_edge - clear or w['pos'] > hi_edge + clear) and w['b'] - w['a'] > 0.5 * span_ref
                 and min(abs(w['pos'] - lo_edge), abs(w['pos'] - hi_edge)) < side * 0.2]
        return min(cands, key=lambda w: min(abs(w['pos'] - lo_edge), abs(w['pos'] - hi_edge)), default=None)
    hline, vline = dim_line(hw, Y0, Y1, X1 - X0), dim_line(vw, X0, X1, Y1 - Y0)
    lengths = [t for t in texts if t['length']]
    def seg_dist(t, w, horizontal):
        a_, b_ = (t['cx'], t['cy']) if horizontal else (t['cy'], t['cx'])
        along = min(max(a_, w['a']), w['b'])
        return np.hypot(a_ - along, b_ - w['pos'])
    # a dimension line whose length was not read: the server asks the reader about just that spot
    unread = []
    def box_of(w, horizontal):
        mid, half = (w['a'] + w['b']) / 2, 0.22 * (w['b'] - w['a'])
        across = side * 0.09
        return [int(mid - half), int(w['pos'] - across), int(mid + half), int(w['pos'] + across)] if horizontal else             [int(w['pos'] - across), int(mid - half), int(w['pos'] + across), int(mid + half)]
    if hline and vline and len(lengths) < 2:
        if lengths:  # one length read: it belongs to the nearer line, the other line is unread
            near_h = seg_dist(lengths[0], hline, True) <= seg_dist(lengths[0], vline, False)
            unread.append(box_of(vline, False) if near_h else box_of(hline, True))
        else:
            unread += [box_of(hline, True), box_of(vline, False)]
    if hline and vline and len(lengths) >= 2:
        best = None
        for i, th in enumerate(lengths):
            for j, tv in enumerate(lengths):
                if i == j:
                    continue
                gx_, gy_ = th['length'] / (hline['b'] - hline['a']), tv['length'] / (vline['b'] - vline['a'])
                score = abs(np.log(gx_ / gy_)) + 0.2 * (seg_dist(th, hline, True) + seg_dist(tv, vline, False)) / side
                if not best or score < best[0]:
                    best = (score, gx_, gy_)
        sx, sy = best[1], best[2]
    elif (hline or vline) and lengths:
        line, horizontal = (hline, True) if hline else (vline, False)
        t = min(lengths, key=lambda t: seg_dist(t, line, horizontal))
        if horizontal:
            sx = t['length'] / (line['b'] - line['a'])
        else:
            sy = t['length'] / (line['b'] - line['a'])
    if not sx and not sy:
        sx = sy = 9.0 / (X1 - X0)
        notes.append('No dimension could be read: the house width was assumed to be 9 m. Enter the real width and depth.')
    sx, sy = sx or sy, sy or sx
    widthM, depthM = (X1 - X0) * sx, (Y1 - Y0) * sy

    # --- snap pen jitter: lines closer than 0.3 m are the same wall
    tol_x, tol_y = 0.3 / sx, 0.3 / sy
    hp = cluster([w['pos'] for w in house_h], [w['b'] - w['a'] for w in house_h], tol_y)
    vp = cluster([w['pos'] for w in house_v], [w['b'] - w['a'] for w in house_v], tol_x)
    for w, p in zip(house_h, hp):
        w['pos'] = p
    for w, p in zip(house_v, vp):
        w['pos'] = p
    for e, ws in ((left, house_v), (right, house_v), (top, house_h), (bottom, house_h)):  # outer lines follow the snap
        e['pos'] = min((w['pos'] for w in ws), key=lambda p: abs(p - e['pos']))
    X0, X1, Y0, Y1 = left['pos'], right['pos'], top['pos'], bottom['pos']
    # walls slid to line up with a nearly aligned sketch line (decided on an earlier pass, see the end of read)
    for axis, old, new, lo, hi in moves:
        movers, others = (house_h, house_v) if axis == 'h' else (house_v, house_h)
        for w in movers:
            if abs(w['pos'] - old) < 3 and min(w['b'], hi) - max(w['a'], lo) > 0.5 * (w['b'] - w['a']):
                w['pos'] = new
        for o in others:
            for end in ('a', 'b'):
                if abs(o[end] - old) < 3 and lo - 3 <= o['pos'] <= hi + 3:
                    o[end] = new
    # wall ends land on the walls they meet
    for w in house_h:
        w['a'], w['b'] = max(w['a'], X0), min(w['b'], X1)
        for v in house_v:
            for end in ('a', 'b'):
                if abs(w[end] - v['pos']) < tol_x / 2 and v['a'] - tol_y <= w['pos'] <= v['b'] + tol_y:
                    w[end] = v['pos']
    for v in house_v:
        v['a'], v['b'] = max(v['a'], Y0), min(v['b'], Y1)
        for w in house_h:
            for end in ('a', 'b'):
                if abs(v[end] - w['pos']) < tol_y / 2 and w['a'] - tol_x <= v['pos'] <= w['b'] + tol_x:
                    v[end] = w['pos']
    house_h = [w for w in house_h if w['b'] - w['a'] > 0.4 / sx]
    house_v = [v for v in house_v if v['b'] - v['a'] > 0.4 / sy]

    # --- doors: gaps in a wall line, bridged so the rooms close
    door_max_x, door_max_y = 1.9 / sx, 1.9 / sy
    clean = raster(house_h, house_v, 0, 3)
    hm = np.zeros((H, W), np.uint8); vm = np.zeros((H, W), np.uint8)
    openings = []

    # double-line walls sitting on top of each other after snapping become one
    def dedupe(ws):
        out = []
        for w in sorted(ws, key=lambda w: (round(w['pos']), w['a'])):
            prev = out[-1] if out else None
            if prev and abs(prev['pos'] - w['pos']) < 6 and w['a'] <= prev['b'] + 2:
                prev['b'] = max(prev['b'], w['b']); prev['lines'] = max(prev.get('lines', 1), w.get('lines', 1))
            else:
                out.append(dict(w))
        return out
    # door leaves drawn as a straight stroke: short, one end free in the room, not in line with another wall
    def touches(x, y, skip):
        return any(w is not skip and abs(w['pos'] - y) < 4 and w['a'] - 4 <= x <= w['b'] + 4 for w in house_h) or             any(v is not skip and abs(v['pos'] - x) < 4 and v['a'] - 4 <= y <= v['b'] + 4 for v in house_v)
    def collinear(w, ws, reach):
        return any(o is not w and abs(o['pos'] - w['pos']) < 4 and max(o['a'] - w['b'], w['a'] - o['b']) <= reach for o in ws)
    house_h = [w for w in house_h if w['b'] - w['a'] >= 1.2 / sx or (touches(w['a'], w['pos'], w) and touches(w['b'], w['pos'], w)) or collinear(w, house_h, door_max_x)]
    house_v = [v for v in house_v if v['b'] - v['a'] >= 1.2 / sy or (touches(v['pos'], v['a'], v) and touches(v['pos'], v['b'], v)) or collinear(v, house_v, door_max_y)]

    def bridge(walls, cross, horizontal, max_gap):
        """a wall that stops short of the next wall on its line, or of a crossing wall, leaves a door"""
        seen = set()
        for w in walls:
            for end, direction in (('a', -1), ('b', 1)):
                tip = w[end]
                # another piece of this line already runs on past the tip: no gap here
                if any(o is not w and abs(o['pos'] - w['pos']) < 4 and o['a'] - 3 <= tip <= o['b'] + 3 and
                       ((o['b'] > tip + 3) if direction > 0 else (o['a'] < tip - 3)) for o in walls):
                    continue
                stops = []
                for o in walls:  # the next stretch of the same wall line
                    if o is not w and abs(o['pos'] - w['pos']) < 4:
                        edge = o['a'] if direction > 0 else o['b']
                        if (edge - tip) * direction > 0:
                            stops.append(edge)
                for c in cross:  # a wall crossing the line
                    if c['a'] - 4 <= w['pos'] <= c['b'] + 4 and (c['pos'] - tip) * direction > 0:
                        stops.append(c['pos'])
                if not stops:
                    continue
                stop = min(stops, key=lambda v: abs(v - tip))
                gap = abs(stop - tip)
                lo, hi = sorted((tip, stop))
                key = (horizontal, round(w['pos']), round(lo), round(hi))
                if 0.5 * max_gap / 1.9 <= gap <= max_gap and key not in seen:
                    seen.add(key)
                    openings.append({'horizontal': horizontal, 'pos': w['pos'], 'a': lo, 'b': hi, 'kind': 'door', 'gap': (lo, hi)})

    bridge(house_h, house_v, True, door_max_x)
    bridge(house_v, house_h, False, door_max_y)
    # a door leaf: a stroke hinged at the edge of a door gap, about as long as the gap, its other end free
    def leaf(w, horizontal):
        free_a, free_b = not touches(*((w['a'], w['pos']) if horizontal else (w['pos'], w['a'])), w),             not touches(*((w['b'], w['pos']) if horizontal else (w['pos'], w['b'])), w)
        if free_a == free_b:
            return False
        hinge = w['b'] if free_a else w['a']
        length = w['b'] - w['a']
        return any(o['horizontal'] != horizontal and abs(o['pos'] - hinge) < 6 and
                   (abs(o['a'] - w['pos']) < 6 or abs(o['b'] - w['pos']) < 6) and 0.5 <= length / (o['b'] - o['a']) <= 1.8
                   for o in openings)
    leaves_h = [w for w in house_h if leaf(w, True)]
    leaves_v = [v for v in house_v if leaf(v, False)]
    if leaves_h or leaves_v:
        house_h = [w for w in house_h if w not in leaves_h]
        house_v = [v for v in house_v if v not in leaves_v]
        openings.clear()
        bridge(house_h, house_v, True, door_max_x)
        bridge(house_v, house_h, False, door_max_y)
    # door swings: the quarter-circle arc (and leaf) drawn beside every hinged door marks its opening exactly
    walls_px = cv2.dilate(raster(house_h, house_v, 0, 3), np.ones((9, 9), np.uint8))
    loose = cv2.bitwise_and(ink, cv2.bitwise_not(walls_px))
    for t in texts:
        x0, y0, x1, y1 = t['box']
        loose[max(0, int(y0) - 2):int(y1) + 3, max(0, int(x0) - 2):int(x1) + 3] = 0
    inside_only = np.zeros_like(loose)  # swings open into the house: steps, gate and dimension lines stay out
    inset = int(max(8, 0.5 * max(top['thick'], bottom['thick'], left['thick'], right['thick']) + 6))
    inside_only[int(Y0) + inset:int(Y1) - inset, int(X0) + inset:int(X1) - inset] = 255
    loose = cv2.bitwise_and(loose, inside_only)
    n_c, lab_c, st_c, _ = cv2.connectedComponentsWithStats(cv2.dilate(loose, np.ones((3, 3), np.uint8)), 8)
    arcs = []
    for k in range(1, n_c):
        x, y, w, h, area = st_c[k]
        wm, hm_ = w * sx, h * sy
        if not (0.45 <= wm <= 1.8 and 0.45 <= hm_ <= 1.8 and 0.65 <= wm / hm_ <= 1.5 and area / (w * h) < 0.3):
            continue
        if not (X0 - 4 <= x and x + w <= X1 + 4 and Y0 - 4 <= y and y + h <= Y1 + 4):
            continue
        # the wall the swing opens: a wall line along one side of the arc's box
        best = None
        # the leaf is a stroke ending freely inside the swing: never the wall the door is in
        def leaf_end(wall, horizontal, lo, hi):
            for end in (wall['a'], wall['b']):
                if lo - 6 <= end <= hi + 6:
                    pt = (end, wall['pos']) if horizontal else (wall['pos'], end)
                    if not touches(pt[0], pt[1], wall):
                        return True
            return False
        for o in openings:  # a gap already found on a wall beside the swing is its doorway
            lo, hi = (x, x + w) if o['horizontal'] else (y, y + h)
            edges = (y, y + h) if o['horizontal'] else (x, x + w)
            if any(abs(o['pos'] - e) < inset + 8 for e in edges) and min(o['b'], hi) - max(o['a'], lo) > 0.5 * (hi - lo):
                cand = {'horizontal': o['horizontal'], 'pos': o['pos'], 'a': lo, 'b': hi, 'kind': 'door', 'swing': True,
                        'side': 1 if ((y + h / 2) if o['horizontal'] else (x + w / 2)) > o['pos'] else -1}
                if not best or best[0] > -1:
                    best = (-1, cand)
        for wall in house_h:
            if leaf_end(wall, True, x, x + w):
                continue
            for edge_y in (y, y + h):
                if abs(wall['pos'] - edge_y) < inset + 8 and wall['a'] - 10 <= x and x + w <= wall['b'] + 10:
                    band = ink[max(0, int(wall['pos']) - 2):int(wall['pos']) + 3, int(x) + 4:int(x + w) - 4]
                    d = float(np.mean(band.max(axis=0) > 0)) if band.size else 1.0  # the open wall has no ink across the swing
                    if not best or d < best[0]:
                        best = (d, {'horizontal': True, 'pos': wall['pos'], 'a': x, 'b': x + w, 'kind': 'door', 'swing': True, 'side': 1 if y + h / 2 > wall['pos'] else -1})
        for wall in house_v:
            if leaf_end(wall, False, y, y + h):
                continue
            for edge_x in (x, x + w):
                if abs(wall['pos'] - edge_x) < inset + 8 and wall['a'] - 10 <= y and y + h <= wall['b'] + 10:
                    band = ink[int(y) + 4:int(y + h) - 4, max(0, int(wall['pos']) - 2):int(wall['pos']) + 3]
                    d = float(np.mean(band.max(axis=1) > 0)) if band.size else 1.0
                    if not best or d < best[0]:
                        best = (d, {'horizontal': False, 'pos': wall['pos'], 'a': y, 'b': y + h, 'kind': 'door', 'swing': True, 'side': 1 if x + w / 2 > wall['pos'] else -1})
        if best:
            arcs.append(best[1])
    for arc in arcs:
        same = [o for o in openings if o['horizontal'] == arc['horizontal'] and abs(o['pos'] - arc['pos']) < 4 and
                min(o['b'], arc['b']) > max(o['a'], arc['a'])]
        if same:
            for o in same:  # the swing gives the door's true width inside a wider gap
                o['swing'] = True
                o['side'] = arc.get('side', 1)
                o['a'], o['b'] = max(o['a'], arc['a']), min(o['b'], arc['b'])
        else:
            openings.append(arc)
    # the leaf strokes of the found swings are not walls
    def in_swing(wall, horizontal):
        for o in arcs + [o for o in openings if o.get('swing')]:
            if o['horizontal'] == horizontal:
                continue
            g = o['b'] - o['a']
            for end in (wall['a'], wall['b']):
                pt = (end, wall['pos']) if horizontal else (wall['pos'], end)
                along, across = (pt[1], pt[0]) if o['horizontal'] else (pt[0], pt[1])
                if o['a'] - 6 <= (pt[0] if o['horizontal'] else pt[1]) <= o['b'] + 6 and abs((pt[1] if o['horizontal'] else pt[0]) - o['pos']) <= g + 6                         and wall['b'] - wall['a'] <= 1.4 * g and not touches(pt[0], pt[1], wall):
                    return True
        return False
    # a leaf drawn flat along its wall continues that wall: keep it
    house_h = [w for w in house_h if not in_swing(w, True) or collinear(w, house_h, 10)]
    house_v = [v for v in house_v if not in_swing(v, False) or collinear(v, house_v, 10)]
    clean = raster(house_h, house_v, 0, 3)
    # a gap that is only where a neighbouring door's leaf is drawn is wall, not a second doorway
    swung = [o for o in openings if o.get('swing')]
    def under_leaf(o):
        if o.get('swing'):
            return False
        for d in swung:
            if d['horizontal'] == o['horizontal']:
                continue
            g = d['b'] - d['a']
            side = d.get('side', 1)
            near = min(d['pos'], d['pos'] + side * g) - 12, max(d['pos'], d['pos'] + side * g) + 12
            inside = min(o['b'], near[1]) - max(o['a'], near[0])
            if d['a'] - 12 <= o['pos'] <= d['b'] + 12 and inside >= 0.6 * (o['b'] - o['a']):
                return True
        return False
    leaf_gaps = [o for o in openings if under_leaf(o)]
    for o in openings:  # every gap is closed for finding rooms, at its full drawn width
        lo, hi = o.get('gap', (o['a'], o['b']))
        if o['horizontal']:
            cv2.line(clean, (int(lo), int(o['pos'])), (int(hi), int(o['pos'])), 255, 3)
        else:
            cv2.line(clean, (int(o['pos']), int(lo)), (int(o['pos']), int(hi)), 255, 3)
    openings[:] = [o for o in openings if o not in leaf_gaps]
    cv2.rectangle(clean, (int(X0), int(Y0)), (int(X1), int(Y1)), 255, 3)

    # --- rooms: the enclosed spaces, split into rectangles that each carry at most one name
    n, lab, st, border = regions(clean)
    def strip_move(x0, y0, x1, y1):
        """a too-thin strip between two nearly aligned lines: slide the one real wall along it onto the other line"""
        flat = (y1 - y0) * sy < (x1 - x0) * sx
        ws, (e0, e1), (lo, hi) = (house_h, (y0, y1), (x0, x1)) if flat else (house_v, (x0, x1), (y0, y1))
        on = lambda e: [w for w in ws if abs(w['pos'] - e) < 3 and min(w['b'], hi) - max(w['a'], lo) > 0.6 * (hi - lo)]
        a, b = on(e0), on(e1)
        if bool(a) == bool(b):
            return None
        old, new, walls = (e0, e1, a) if a else (e1, e0, b)
        # the whole wall line moves, joined through its doorways, never one piece of it
        line = [w for w in ws if abs(w['pos'] - old) < 3]
        reach = 1.9 / (sx if flat else sy)
        grown = True
        while grown:
            grown = False
            for w in line:
                if w not in walls and any(max(w['a'] - o['b'], o['a'] - w['b']) <= reach for o in walls):
                    walls.append(w); grown = True
        if any(m[0] == ('h' if flat else 'v') and abs(m[1] - new) < 3 and abs(m[2] - old) < 3 for m in moves):
            return None  # already moved the other way: do not swing back and forth
        length = sum(w['b'] - w['a'] for w in walls) * (sx if flat else sy)
        return ('h' if flat else 'v', old, new, min(w['a'] for w in walls), max(w['b'] for w in walls), length)

    rooms = []
    extra_walls = []
    for i in range(1, n):
        if i in border:
            continue
        x, y, w, h, area = st[i]
        if x < X0 - 2 or y < Y0 - 2 or x + w > X1 + 2 or y + h > Y1 + 2 or area < (0.6 / sx) * (0.6 / sy):
            continue
        names = [t for t in room_labels if lab[int(min(H - 1, t['cy'])), int(min(W - 1, t['cx']))] == i]
        if not names:  # the label may sit on a line: use the text box overlap
            names = [t for t in room_labels if x <= t['cx'] <= x + w and y <= t['cy'] <= y + h and
                     np.mean(lab[int(t['box'][1]):int(t['box'][3]), int(t['box'][0]):int(t['box'][2])] == i) > 0.3]
        region = lab == i
        # grid lines of this region: the corners of its own outline, put back on the wall lines they belong to
        contours, _ = cv2.findContours(region.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        pts = cv2.approxPolyDP(max(contours, key=cv2.contourArea), 4, True).reshape(-1, 2)
        vxs = [X0, X1] + [v['pos'] for v in house_v]
        hys = [Y0, Y1] + [w_['pos'] for w_ in house_h]
        snap = lambda v, lines: min(lines, key=lambda p: abs(p - v)) if min(abs(p - v) for p in lines) < 10 else v
        gx = sorted({round(snap(float(p[0]), vxs), 1) for p in pts})
        gy = sorted({round(snap(float(p[1]), hys), 1) for p in pts})
        gx = [v for i, v in enumerate(gx) if i == 0 or v - gx[i - 1] > 4]
        gy = [v for i, v in enumerate(gy) if i == 0 or v - gy[i - 1] > 4]
        if len(gx) < 2 or len(gy) < 2:
            continue
        cells = set()
        for a in range(len(gx) - 1):
            for b in range(len(gy) - 1):
                cx, cy = (gx[a] + gx[a + 1]) / 2, (gy[b] + gy[b + 1]) / 2
                if region[int(cy), int(cx)]:
                    cells.add((a, b))
        if not cells:
            continue
        best, best_cost = None, None
        for parts in rect_pieces(cells, gx, gy)[:200]:
            cost, assigned = 0, []
            for (a0, a1, b0, b1) in parts:
                rx0, rx1, ry0, ry1 = gx[a0], gx[a1 + 1], gy[b0], gy[b1 + 1]
                inside = [t for t in names if rx0 <= t['cx'] <= rx1 and ry0 <= t['cy'] <= ry1]
                wm, hm_ = (rx1 - rx0) * sx, (ry1 - ry0) * sy
                if len(inside) > 1:
                    cost += 50
                for t in inside:  # a piece that cuts its own name in half is the wrong room outline
                    x0_, y0_, x1_, y1_ = t['box']
                    if (min(x1_, rx1) - max(x0_, rx0)) < 0.7 * (x1_ - x0_):
                        cost += 40
                if min(wm, hm_) < 0.9:
                    move = None if inside else strip_move(rx0, ry0, rx1, ry1)
                    cost += 100 if move is None else 8 + 0.5 * move[5]
                if not inside:
                    cost += 6
                if 0.9 <= min(wm, hm_) < 1.2:  # a squeezed leftover is never what the sketch meant
                    cost += 5
                if inside and inside[0]['kind'] in ('living', 'bed', 'kitchen', 'dining') and min(wm, hm_) < 2.4:
                    cost += 20
                assigned.append(((rx0, ry0, rx1, ry1), inside))
            cost += len(parts)
            if best_cost is None or cost < best_cost:
                best, best_cost = assigned, cost
        pieces = []
        for (rx0, ry0, rx1, ry1), inside in best:
            label = inside[0] if inside else None
            pieces.append({'x0': rx0, 'y0': ry0, 'x1': rx1, 'y1': ry1, 'label': label})
        # an unnamed part of an open space takes the name of the largest named part it opens into
        named = sorted([p for p in pieces if p['label']], key=lambda p: -(p['x1'] - p['x0']) * (p['y1'] - p['y0']))
        for p in pieces:
            if not p['label'] and named:
                p['partOf'] = named[0]['label']['text']
        # pieces of one space are open to each other: a wall line with a wide open arch between them
        for p in pieces:
            for q in pieces:
                if p is q:
                    continue
                if abs(p['x1'] - q['x0']) < 1:
                    lo, hi = max(p['y0'], q['y0']), min(p['y1'], q['y1'])
                    if hi - lo > 1:
                        extra_walls.append(('v', p['x1'], lo, hi))
                if abs(p['y1'] - q['y0']) < 1:
                    lo, hi = max(p['x0'], q['x0']), min(p['x1'], q['x1'])
                    if hi - lo > 1:
                        extra_walls.append(('h', p['y1'], lo, hi))
        rooms.extend(pieces)

    # a strip too thin to be a room is a sketch line drawn a little off: slide that wall and read again
    if depth < 3:
        repairs = []
        for r in rooms:
            if not r['label'] and min((r['x1'] - r['x0']) * sx, (r['y1'] - r['y0']) * sy) < 0.9:
                m = strip_move(r['x0'], r['y0'], r['x1'], r['y1'])
                if m:
                    repairs.append(m[:5])
        if repairs:
            result = read(image_path, labels, tuple(moves) + tuple(repairs), depth + 1)
            for axis, old, new, lo, hi in repairs:
                result['notes'].insert(0, f"Lined up a wall the sketch drew {abs(new - old) * (sy if axis == 'h' else sx):.2f} m off its neighbour, so no unusable sliver of room is left.")
            return result

    # --- name and type each room
    unnamed = []
    counts = {}
    out_rooms = []
    for r in rooms:
        t = r['label']
        kind = t['kind'] if t else ('corridor' if min((r['x1'] - r['x0']) * sx, (r['y1'] - r['y0']) * sy) < 1.8 else 'foyer')
        name = t['text'].title().replace('Bed Room', 'Bedroom') if t else             (f"{r['partOf'].title()} ({'passage' if kind == 'corridor' else 'part'})" if r.get('partOf') else ('Passage' if kind == 'corridor' else 'Foyer'))
        area = (r['x1'] - r['x0']) * sx * (r['y1'] - r['y0']) * sy
        narrow = min((r['x1'] - r['x0']) * sx, (r['y1'] - r['y0']) * sy) < 1.8
        if not t and not r.get('partOf') and area >= 2 and not narrow:
            # a closed room whose name could not be read: a sensible type from its size, and flagged for the reader
            kind = 'bath' if area < 4.5 else 'study' if area < 7.5 else 'bed'
            name = {'bath': 'Toilet', 'study': 'Room', 'bed': 'Bedroom'}[kind] + ' (name not read)'
            unnamed.append([int(r['x0']), int(r['y0']), int(r['x1']), int(r['y1'])])
        counts[kind] = counts.get(kind, 0) + 1
        out_rooms.append({'name': name, 'type': kind, 'x0': r['x0'], 'y0': r['y0'], 'x1': r['x1'], 'y1': r['y1']})
    # an open living space beside a "drawing room" is the living-dining: keep one living, the other is dining
    livings = [r for r in out_rooms if r['type'] == 'living']
    if len(livings) > 1:
        livings.sort(key=lambda r: -(r['x1'] - r['x0']) * (r['y1'] - r['y0']))
        for r in livings[1:]:
            r['type'] = 'livingDining' if not re.search(r'drawing|hall|lounge|family', r['name'], re.I) else 'living'
        if sum(r['type'] == 'living' for r in out_rooms) > 1:
            for r in [r for r in out_rooms if r['type'] == 'living'][1:]:
                r['type'] = 'livingDining' if not any(o['type'] == 'livingDining' for o in out_rooms) else 'dining'

    # --- windows: outer-wall stretches drawn with a third (glazing) line inside the wall
    def window_runs(wall, horizontal):
        runs, start = [], None
        step = 2
        lo, hi = int(wall['a']), int(wall['b'])
        half = max(4, int(wall['thick'] / 2 + 3))
        for p in range(lo, hi, step):
            if horizontal:
                prof = ink[max(0, int(wall['pos']) - half):int(wall['pos']) + half + 1, min(W - 1, p)]
            else:
                prof = ink[min(H - 1, p), max(0, int(wall['pos']) - half):int(wall['pos']) + half + 1]
            lines = int(np.sum(np.diff((prof > 0).astype(np.int8)) == 1)) + int(prof[0] > 0)
            if lines >= 3:
                start = p if start is None else start
            elif start is not None:
                runs.append((start, p)); start = None
        if start is not None:
            runs.append((start, hi))
        # join short breaks, keep window-sized runs
        merged = []
        for a, b in runs:
            if merged and a - merged[-1][1] < 8:
                merged[-1] = (merged[-1][0], b)
            else:
                merged.append((a, b))
        scale = sx if horizontal else sy
        return [(a, b) for a, b in merged if 0.45 <= (b - a) * scale <= 3.0]

    # what is drawn beside each gap says what it is: a swing (arc and leaf) is a door, glazing in an outer wall a window,
    # nothing at all inside the house an open archway
    def swing(o):
        g = o['b'] - o['a']
        best = 0
        for sign in (-1, 1):
            if o['horizontal']:
                y0, y1 = sorted((int(o['pos'] + sign * 6), int(o['pos'] + sign * g)))
                box = loose[max(0, y0):min(H, y1), max(0, int(o['a'])):min(W, int(o['b']))]
            else:
                x0, x1 = sorted((int(o['pos'] + sign * 6), int(o['pos'] + sign * g)))
                box = loose[max(0, int(o['a'])):min(H, int(o['b'])), max(0, x0):min(W, x1)]
            if box.size:
                best = max(best, float(np.mean(box > 0)))
        return best
    on_outer = lambda o: (o['horizontal'] and (abs(o['pos'] - Y0) < 3 or abs(o['pos'] - Y1) < 3)) or         (not o['horizontal'] and (abs(o['pos'] - X0) < 3 or abs(o['pos'] - X1) < 3))
    for o in openings:
        swung = o.get('swing') or (not on_outer(o) and swing(o) > 0.025)
        if on_outer(o):
            o['kind'] = 'door' if swung else 'window'
        elif not swung:
            o['open'] = True

    raw_outer = {'top': top, 'bottom': bottom, 'left': left, 'right': right}
    for name, wall in raw_outer.items():
        horizontal = name in ('top', 'bottom')
        for a, b in window_runs(wall, horizontal):
            if any(o['horizontal'] == horizontal and abs(o['pos'] - wall['pos']) < 3 and min(o['b'], b) > max(o['a'], a) for o in openings):
                continue
            openings.append({'horizontal': horizontal, 'pos': wall['pos'], 'a': a, 'b': b, 'kind': 'window'})

    # windows sit inside one room's stretch of outer wall, clear of the corners and of any door
    def clip_window(o):
        spans = []
        for r in rooms:
            if o['horizontal'] and (abs(r['y0'] - o['pos']) < 3 or abs(r['y1'] - o['pos']) < 3):
                spans.append((r['x0'], r['x1']))
            elif not o['horizontal'] and (abs(r['x0'] - o['pos']) < 3 or abs(r['x1'] - o['pos']) < 3):
                spans.append((r['y0'], r['y1']))
        margin = 0.15 / (sx if o['horizontal'] else sy)
        best = max(spans, key=lambda sp: min(sp[1], o['b']) - max(sp[0], o['a']), default=None)
        if best is None:
            return False
        o['a'], o['b'] = max(o['a'], best[0] + margin), min(o['b'], best[1] - margin)
        return (o['b'] - o['a']) * (sx if o['horizontal'] else sy) >= 0.45
    doors_now = [o for o in openings if o['kind'] != 'window']
    kept = []
    for o in openings:
        if o['kind'] != 'window':
            kept.append(o); continue
        if not clip_window(o):
            continue
        clash = lambda q: q['horizontal'] == o['horizontal'] and abs(q['pos'] - o['pos']) < 4 and min(q['b'], o['b']) > max(q['a'], o['a']) - 4
        if any(clash(q) for q in doors_now) or any(clash(q) for q in kept if q['kind'] == 'window'):
            continue
        kept.append(o)
    openings[:] = kept

    # --- the main entrance: the outer door nearest the gate / road note, else on the bottom wall
    gate = next((t for t in texts if t['gate']), None)
    outer_doors = [o for o in openings if o['kind'] == 'door' and (
        (o['horizontal'] and (abs(o['pos'] - Y0) < 3 or abs(o['pos'] - Y1) < 3)) or
        (not o['horizontal'] and (abs(o['pos'] - X0) < 3 or abs(o['pos'] - X1) < 3)))]
    if outer_doors:
        ref = (gate['cx'], gate['cy']) if gate else ((X0 + X1) / 2, Y1 + 1000)
        mid = lambda o: ((o['a'] + o['b']) / 2, o['pos']) if o['horizontal'] else (o['pos'], (o['a'] + o['b']) / 2)
        entry = min(outer_doors, key=lambda o: np.hypot(mid(o)[0] - ref[0], mid(o)[1] - ref[1]))
        entry['kind'] = 'entry'
        for o in outer_doors:
            if o is not entry:
                o['kind'] = 'entry'  # a second outside door is an exit, never an internal door
                o['secondary'] = True
    else:
        notes.append('No outside door was found in the drawing; mark the main entrance before continuing.')
    if gate and not (gate['cy'] > Y1):
        notes.append('The road / gate note is not below the house. Rotate the drawing so the entrance is at the bottom.')

    # --- output, normalised to the outer wall rectangle
    nx = lambda v: round(min(1000.0, max(0.0, (v - X0) / (X1 - X0) * 1000)), 2)
    ny = lambda v: round(min(1000.0, max(0.0, (v - Y0) / (Y1 - Y0) * 1000)), 2)
    outer_ids = {id(top), id(bottom), id(left), id(right)}
    walls_out = []
    for w in house_h:
        walls_out.append({'a': {'x': nx(w['a']), 'y': ny(w['pos'])}, 'b': {'x': nx(w['b']), 'y': ny(w['pos'])},
                          'kind': 'exterior' if abs(w['pos'] - Y0) < 2 or abs(w['pos'] - Y1) < 2 else 'interior'})
    for w in house_v:
        walls_out.append({'a': {'x': nx(w['pos']), 'y': ny(w['a'])}, 'b': {'x': nx(w['pos']), 'y': ny(w['b'])},
                          'kind': 'exterior' if abs(w['pos'] - X0) < 2 or abs(w['pos'] - X1) < 2 else 'interior'})
    for o in openings:  # a door bridges its wall: the wall is continuous through the opening
        if o['horizontal']:
            walls_out.append({'a': {'x': nx(o['a']), 'y': ny(o['pos'])}, 'b': {'x': nx(o['b']), 'y': ny(o['pos'])}, 'kind': 'interior', 'bridge': True})
        else:
            walls_out.append({'a': {'x': nx(o['pos']), 'y': ny(o['a'])}, 'b': {'x': nx(o['pos']), 'y': ny(o['b'])}, 'kind': 'interior', 'bridge': True})
    open_arches = []
    for d, p, lo, hi in extra_walls:
        if d == 'h':
            walls_out.append({'a': {'x': nx(lo), 'y': ny(p)}, 'b': {'x': nx(hi), 'y': ny(p)}, 'kind': 'interior', 'bridge': True})
            open_arches.append({'x': nx((lo + hi) / 2), 'y': ny(p), 'orient': 'h', 'widthM': round((hi - lo) * sx - 0.1, 3)})
        else:
            walls_out.append({'a': {'x': nx(p), 'y': ny(lo)}, 'b': {'x': nx(p), 'y': ny(hi)}, 'kind': 'interior', 'bridge': True})
            open_arches.append({'x': nx(p), 'y': ny((lo + hi) / 2), 'orient': 'v', 'widthM': round((hi - lo) * sy - 0.1, 3)})
    # one wall per straight run: pieces, door bridges and archways on the same line join up
    def join(ws):
        out = []
        lines = {}
        for w in ws:
            flat = abs(w['a']['y'] - w['b']['y']) < 0.01
            pos = round(w['a']['y'] if flat else w['a']['x'], 1)
            lo, hi = sorted((w['a']['x'], w['b']['x']) if flat else (w['a']['y'], w['b']['y']))
            lines.setdefault((flat, pos), []).append([lo, hi, w['kind']])
        for (flat, pos), spans in lines.items():
            spans.sort()
            run = None
            for lo, hi, kind in spans:
                if run and lo <= run[1] + 0.6:
                    run[1] = max(run[1], hi); run[2] = 'exterior' if 'exterior' in (run[2], kind) else 'interior'
                else:
                    if run: out.append((flat, pos, *run))
                    run = [lo, hi, kind]
            if run: out.append((flat, pos, *run))
        return [{'a': {'x': lo, 'y': pos}, 'b': {'x': hi, 'y': pos}, 'kind': kind, 'thicknessMm': None} if flat else
                {'a': {'x': pos, 'y': lo}, 'b': {'x': pos, 'y': hi}, 'kind': kind, 'thicknessMm': None} for flat, pos, lo, hi, kind in out if hi - lo > 0.5]
    walls_out = join(walls_out)
    rooms_out = [{'name': r['name'], 'type': r['type'], 'x': nx(r['x0']), 'y': ny(r['y0']),
                  'w': round(nx(r['x1']) - nx(r['x0']), 2), 'h': round(ny(r['y1']) - ny(r['y0']), 2)} for r in out_rooms]
    openings_out = []
    for o in openings:
        scale = sx if o['horizontal'] else sy
        if not o.get('swing') and o['kind'] != 'window':  # an open gap sits just inside the wall it opens
            trim = min(0.05 / scale, (o['b'] - o['a']) * 0.1)
            o['a'], o['b'] = o['a'] + trim, o['b'] - trim
        mid = (o['a'] + o['b']) / 2
        openings_out.append({'x': nx(mid) if o['horizontal'] else nx(o['pos']), 'y': ny(o['pos']) if o['horizontal'] else ny(mid),
                             'kind': o['kind'], 'orient': 'h' if o['horizontal'] else 'v', 'widthM': round((o['b'] - o['a']) * scale, 3), 'headM': None, 'sillM': None,
                             **({'emergencyExit': True} if o.get('secondary') else {}), **({'leaf': False} if o.get('open') else {}),
                             **({'swing': o['side']} if o.get('side') else {})})
    for a in open_arches:
        openings_out.append({'x': a['x'], 'y': a['y'], 'kind': 'door', 'orient': a['orient'], 'widthM': a['widthM'], 'headM': None, 'sillM': None, 'leaf': False})
    if unnamed:
        notes.append(f"{len(unnamed)} room name(s) could not be read; they are typed from their size. Check them in the room list.")
    notes.append(f"Read from the drawing: {len(rooms_out)} rooms, {sum(o['kind'] != 'window' for o in openings_out)} doors and openings, "
                 f"{sum(o['kind'] == 'window' for o in openings_out)} windows; house {widthM:.2f} x {depthM:.2f} m.")
    return {'widthM': round(widthM, 3), 'depthM': round(depthM, 3), 'heightM': None, 'columns': [], 'footings': [], 'beams': [],
            'walls': walls_out, 'rooms': rooms_out, 'openings': openings_out, 'notes': notes, 'unnamed': unnamed, 'unreadDimensions': unread,
            'source': {'imageBox': [X0, Y0, X1, Y1], 'imageSize': [W, H]}}


if __name__ == '__main__':
    try:
        labels = json.load(open(sys.argv[2], encoding='utf8'))
        print(json.dumps(read(sys.argv[1], labels)))
    except Exception as error:  # the server shows this message to the person
        print(json.dumps({'error': str(error)}))
        sys.exit(1)
