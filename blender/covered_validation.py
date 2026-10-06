"""Independent preflight for source-anchored porch supports, without Blender imports."""
import math
from geometry.massing import mass_rect
from geometry.plates import subtract_rectangles


def intersects(a, b, clearance=0):
    return all(min(a[k]+a[size]+clearance, b[k]+b[size])-max(a[k]-clearance, b[k]) > 1
               for k, size in (("x", "w"), ("y", "h"))) and \
        min(a["z"]+a["height"], b["z"]+b["height"])-max(a["z"], b["z"]) > 1


def outdoor_blockers(building, massing, facade):
    floors = {f["id"]: f for f in building["floors"]}
    parts = [p["world"] for f in facade["features"] for p in f["parts"]]
    parts += [p["world"] for a in (facade.get("specialized") or {}).get("assemblies", [])
              for p in a["parts"] if p.get("operation") == "ADD"]
    for c in building["columns"]:
        f, half = floors[c["floorId"]], c["size"]/2
        parts.append({"x": c["at"]["x"]-half, "y": c["at"]["y"]-half, "w": c["size"], "h": c["size"],
                      "z": f["elevationMm"], "height": f["heightMm"]})
    for w in building["walls"]:
        a, b, f, t = w["a"], w["b"], floors[w["floorId"]], w["thickness"]
        h = abs(a["y"]-b["y"]) <= 2
        parts.append({"x": min(a["x"], b["x"]) if h else a["x"]-t/2,
                      "y": a["y"]-t/2 if h else min(a["y"], b["y"]),
                      "w": abs(a["x"]-b["x"]) if h else t, "h": t if h else abs(a["y"]-b["y"]),
                      "z": f["elevationMm"], "height": w.get("heightMm", f["heightMm"])})
    for o in building["doors"]:
        f, h, at = floors[o["floorId"]], o["orient"] == "h", o["at"]
        parts.append({"x": at["x"]-(o["width"]/2+100 if h else 900),
                      "y": at["y"]-(900 if h else o["width"]/2+100),
                      "w": o["width"]+200 if h else 1800, "h": 1800 if h else o["width"]+200,
                      "z": f["elevationMm"], "height": o.get("head", 2300)})
    ground = min(floors.values(), key=lambda f: f["level"])
    parts += [{**f["rect"], "z": ground["elevationMm"]-500, "height": ground["heightMm"]+500}
              for f in building.get("siteFeatures", []) if f["kind"] in ("driveway", "path", "pool", "utilityYard")]
    parts += [{**mass_rect(m), "z": m["elevation"], "height": m["height"]}
              for m in massing["masses"] if m["usage"] != "terrace"]
    return parts


def validate_covered_outdoor(payload):
    building, massing, facade = payload["buildingModel"], payload["massingModel"], payload["facadeGrammar"]
    layout = facade.get("coveredOutdoor")
    if layout is None:
        return  # Legacy exports still receive the final mesh collision gate.
    if layout.get("schemaVersion") != 1 or layout.get("sourcePlanId") != building["planId"] or layout.get("issues"):
        raise ValueError("Porch support layout is invalid or stale")
    ground = min(building["floors"], key=lambda f: f["level"])
    rooms = {r["semanticId"]: r for r in building["rooms"] if r["floorId"] == ground["id"] and r["outdoor"]}
    grade = ground["elevationMm"]-building.get("structuralSizing", {}).get("plinthHeightMm", 400)
    z, height = grade+70, ground["elevationMm"]+ground["heightMm"]-200-grade-70
    blockers = outdoor_blockers(building, massing, facade)
    def valid_rect(r):
        return all(isinstance(r.get(k), (int, float)) and math.isfinite(r[k]) for k in ("x", "y", "w", "h")) and r["w"] > 0 and r["h"] > 0
    def within(r, plates):
        return not subtract_rectangles(r, plates)
    cars, posts, ids = [], [], set()
    for car in layout["cars"]:
        room, r = rooms.get(car["roomId"]), car["rect"]
        expected = (2260, 4540) if car["alongY"] else (4540, 2260)
        padded = {"x": r["x"]-200, "y": r["y"]-200, "w": r["w"]+400, "h": r["h"]+400}
        solid = {**r, "z": z, "height": 1240}
        if not room or room["id"] != "parking" or not valid_rect(r) or (r["w"], r["h"]) != expected or \
                not within(padded, [room["rect"]]) or any(intersects(solid, b, 40) for b in blockers+cars):
            raise ValueError("Display car does not fit the current parking bay")
        if car["id"] in ids:
            raise ValueError("Duplicate outdoor object")
        ids.add(car["id"])
        cars.append(solid)
    for roof in layout["roofs"]:
        room, r = rooms.get(roof["roomId"]), roof["rect"]
        if not room or room["id"] not in ("parking", "verandah") and not room["id"].startswith("verandahWing") or \
                not valid_rect(r) or not within(r, [room["rect"]]) or not roof["slabs"] or roof["id"] in ids:
            raise ValueError("Porch roof has no valid current source room")
        ids.add(roof["id"])
        for slab in roof["slabs"]:
            if not valid_rect(slab) or not within(slab, [r]):
                raise ValueError("Porch slab leaves its current source roof")
        for p in roof["posts"]:
            solid = {**p, "z": z, "height": height}
            if not valid_rect(p) or p["w"] != 250 or p["h"] != 250 or not within(p, roof["slabs"]) or \
                    any(intersects(solid, b, 40) for b in blockers+cars+posts):
                raise ValueError(f"Porch pillar intersects an object or loses its roof bearing: {roof['id']}")
            posts.append(solid)
    upper = next((f for f in sorted(building['floors'], key=lambda f: f['level']) if f['level'] > ground['level']), None)
    shelters = (upper['footprint'] if upper else []) + [mass_rect(m) for m in massing['masses']
                if m['usage'] in ('terrace', 'canopy') and m['elevation'] < ground['elevationMm']+ground['heightMm']+400]
    expected = {f"GF_{room['id']}_Roof_{i:02d}": piece for room in rooms.values()
                if room['id'] in ('parking', 'verandah') or room['id'].startswith('verandahWing')
                for i, piece in enumerate(subtract_rectangles(room['rect'], shelters), 1)
                if piece['w'] >= 600 and piece['h'] >= 600}
    open_roofs = set(layout.get('openRoofs', []))
    if not open_roofs <= set(expected) or set(expected) - open_roofs != {r['id'] for r in layout['roofs']}:
        raise ValueError('Porch roofs no longer match the edited source rooms')
    for roof in layout['roofs']:
        r = roof['rect']
        if r != expected[roof['id']]:
            raise ValueError('Porch roof coordinates changed')
        free = [(x, y) for x in (r['x']+125, r['x']+r['w']-125) for y in (r['y']+125, r['y']+r['h']-125)
                if not any(p['x']-200 <= x <= p['x']+p['w']+200 and p['y']-200 <= y <= p['y']+p['h']+200 for p in ground['footprint'])]
        anchors = list(free)
        edges = []
        for i, a in enumerate(free):
            for b in free[i+1:]:
                if a[0] != b[0] and a[1] != b[1]:
                    continue
                n = int((abs(a[0]-b[0])+abs(a[1]-b[1]))//4800)
                mid = [(a[0]+(b[0]-a[0])*k/(n+1), a[1]+(b[1]-a[1])*k/(n+1)) for k in range(1, n+1)]
                anchors += mid
                edges.append([a, *mid, b])
        def bearing(a):
            centers = [(p['x']+125, p['y']+125) for p in posts if within(p, roof['slabs'])]
            candidates = [p for p in centers if math.dist(a, p) <= 700.01]
            if not candidates:
                raise ValueError('Porch roof is missing a required pillar bearing')
            return min(candidates, key=lambda p: math.dist(a, p))
        for a in anchors:
            bearing(a)
        for edge in edges:
            centers = list(map(bearing, edge))
            if any(math.dist(a, b) > 4801 for a, b in zip(centers, centers[1:])):
                raise ValueError('Porch roof support span exceeds 4.8 m')
    return layout


def validate_outdoor_meshes(payload):
    """Check the generated solids too, including renderer-added aperture details."""
    import bpy
    from mathutils import Vector
    bpy.context.view_layer.update()
    objects = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    def bounds(obj):
        pts = [obj.matrix_world @ Vector(p) for p in obj.bound_box]
        lo = [min(p[i] for p in pts)*1000 for i in range(3)]
        hi = [max(p[i] for p in pts)*1000 for i in range(3)]
        return dict(x=lo[0], y=lo[1], z=lo[2], w=hi[0]-lo[0], h=hi[1]-lo[1], height=hi[2]-lo[2])
    posts = [o for o in objects if (o.name.startswith('GF_') and '_Roof_' in o.name and '_Post_' in o.name)
             or o.name.startswith('EnvelopePier_')]
    blockers = [o for o in objects if any(c.name in ('FACADE', 'WALLS', 'WINDOWS', 'DOORS', 'LANDSCAPE') for c in o.users_collection)
                or o.name.startswith(('GF_Parking_Car_', 'Column_'))]
    boxes = {o.name: bounds(o) for o in posts+blockers}
    building = payload['buildingModel']
    layout = payload['facadeGrammar'].get('coveredOutdoor')
    if layout:
        ground = min(building['floors'], key=lambda f: f['level'])
        z = ground['elevationMm']-building.get('structuralSizing', {}).get('plinthHeightMm', 400)+70
        expected = {f"{roof['id']}_Post_{i:02d}": {**p, 'z': z, 'height': ground['elevationMm']+ground['heightMm']-200-z}
                    for roof in layout['roofs'] for i, p in enumerate(roof['posts'], 1)}
        expected.update({f"EnvelopePier_{m['id']}": {**mass_rect(m), 'z': m['elevation'], 'height': m['height']}
                         for m in payload['massingModel']['masses'] if m['usage'] == 'support'})
        if set(expected) != {p.name for p in posts}:
            raise ValueError('Exterior pillar meshes do not match the current validated supports')
        for name, solid in expected.items():
            if any(abs(boxes[name][k]-solid[k]) > .05 for k in solid):
                raise ValueError(f'Exterior pillar {name} changed from its checked placement')
    for i, post in enumerate(posts):
        if post.get('source_plan_id') != building['planId']:
            raise ValueError('Exterior pillar belongs to an obsolete source plan')
        for other in blockers+posts[:i]:
            if post == other:
                continue
            if intersects(boxes[post.name], boxes[other.name]):
                raise ValueError(f'Exterior pillar {post.name} intersects {other.name}; regenerate the edited design')
    return len(posts)
