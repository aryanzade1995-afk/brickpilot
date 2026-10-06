"""Covered outdoor rooms (car porch, verandah), the parked car, the pool deck
and garden trees — all anchored to the planner's own rooms and site features.

A covered room the upper floor does not already shelter gets a real roof slab
on slim posts at the first-floor level. Where that roof adjoins the upper
floor, it is finished as a balcony (paving and a glass rail) instead of a
plain roof. Every material is a palette role, so it follows the house theme.
"""

import math

import bmesh
import bpy

from .common import MM
from .outdoor import boundary_edges, create_railing
from .plates import subtract_rectangles
from .site import SITE_LEVELS
from .sizing import slab_thickness
from .massing import mass_rect

COVERED_ROOMS = ("parking", "verandah")
SLAB = 200
POST = 250
MAX_POST_SPAN = 4800
# footprints run on wall centrelines: a slab or deck beside a wall stops
# clear of its outer half and any cladding on it
WALL_CLEAR = 160


def _overlap(a, b):
    return min(a["x"] + a["w"], b["x"] + b["w"]) > max(a["x"], b["x"]) and \
        min(a["y"] + a["h"], b["y"] + b["h"]) > max(a["y"], b["y"])


def _touch_length(rect, others):
    """Length of `rect`'s boundary that runs along any of `others`."""
    total = 0
    for o in others:
        for fixed_a, fixed_b, lo_a, hi_a, lo_b, hi_b in (
            (rect["y"], o["y"] + o["h"], rect["x"], rect["x"] + rect["w"], o["x"], o["x"] + o["w"]),
            (rect["y"] + rect["h"], o["y"], rect["x"], rect["x"] + rect["w"], o["x"], o["x"] + o["w"]),
            (rect["x"], o["x"] + o["w"], rect["y"], rect["y"] + rect["h"], o["y"], o["y"] + o["h"]),
            (rect["x"] + rect["w"], o["x"], rect["y"], rect["y"] + rect["h"], o["y"], o["y"] + o["h"]),
        ):
            if abs(fixed_a - fixed_b) <= 2:
                total += max(0, min(hi_a, hi_b) - max(lo_a, lo_b))
    return total


def _near(x, y, rects, gap):
    return any(r["x"] - gap <= x <= r["x"] + r["w"] + gap and r["y"] - gap <= y <= r["y"] + r["h"] + gap for r in rects)


def _cylinder(scene, name, x, y, z, radius, length, axis, material, source):
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=20, radius1=radius * MM, radius2=radius * MM, depth=length * MM)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(scene.materials[material])
    obj = bpy.data.objects.new(name, mesh)
    scene.collections["LANDSCAPE"].objects.link(obj)
    obj.location = (x * MM, y * MM, z * MM)
    if axis == "x":
        obj.rotation_euler = (0, math.pi / 2, 0)
    elif axis == "y":
        obj.rotation_euler = (math.pi / 2, 0, 0)
    obj["source_plan_id"], obj["source_id"], obj["material_role"] = scene.plan_id, source, material
    return obj


def _sphere(scene, name, x, y, z, radius, material, source):
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=radius * MM)
    bm.to_mesh(mesh)
    bm.free()
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    mesh.materials.append(scene.materials[material])
    obj = bpy.data.objects.new(name, mesh)
    scene.collections["LANDSCAPE"].objects.link(obj)
    obj.location = (x * MM, y * MM, z * MM)
    obj.scale = (1, 1, .82)
    obj["source_plan_id"], obj["source_id"], obj["material_role"] = scene.plan_id, source, material
    return obj


def create_car(scene, name, x, y, grade, along_y):
    """A full-scale detailed real car; its mirrors are part of the checked envelope."""
    from .realistic_props import create_real_car
    return create_real_car(scene,name,x,y,grade,along_y)


def _has_access(piece, doors, floor_id):
    """A roof is only a balcony when a door of the floor above opens onto it."""
    return any(d["floorId"] == floor_id and d.get("kind") != "entry" and
               piece["x"] - 450 <= d["at"]["x"] <= piece["x"] + piece["w"] + 450 and
               piece["y"] - 450 <= d["at"]["y"] <= piece["y"] + piece["h"] + 450 for d in doors)


def _plant_edges(scene, name, spans, top, source, seed):
    """A planter box with a small shrub along each open balcony edge, just inside the rail."""
    from visualization.landscape import planter
    for index, (axis, fixed, lo, hi, out) in enumerate(spans, 1):
        length = min(hi - lo - 500, 1800)
        if length < 600:
            continue
        mid = (lo + hi) / 2
        depth, gap = 340, 90
        inner = fixed - out * (gap + depth / 2)
        rect = {"x": mid - length / 2, "y": inner - depth / 2, "w": length, "h": depth} if axis == "h" else                {"x": inner - depth / 2, "y": mid - length / 2, "w": depth, "h": length}
        planter(scene, f"{name}_Planter_{index}", {"rect": rect, "z": top + 40, "sourceId": source, "category": "balcony"}, seed, 7)


def _feature_cutters(facade, z0, z1):
    """Plan rectangles of facade parts — architectural features and the
    balcony / entrance / depth assemblies — passing through the band z0..z1."""
    facade = facade or {}
    parts = [p for f in facade.get("features", []) for p in f["parts"]]
    parts += [p for unit in (facade.get("specialized") or {}).get("assemblies", [])
              if unit["category"] in ("BALCONY", "ENTRANCE", "DEPTH")
              for p in unit["parts"] if p.get("operation", "ADD") == "ADD"]
    cuts = []
    for part in parts:
        w = part["world"]
        if w["z"] < z1 and w["z"] + w["height"] > z0:
            cuts.append({"x": w["x"] - 20, "y": w["y"] - 20, "w": w["w"] + 40, "h": w["h"] + 40})
    return cuts


def _open_spans(edge, blockers, pad):
    """The stretches of an edge clear of every blocker (grown by `pad`): a
    rail or parapet stops short of a wall it meets instead of running into it."""
    axis, fixed, lo, hi, _out = edge
    spans = [(lo, hi)]
    for b in blockers:
        x0, y0, x1, y1 = b["x"] - pad, b["y"] - pad, b["x"] + b["w"] + pad, b["y"] + b["h"] + pad
        on_line = (y0 - 2 <= fixed <= y1 + 2) if axis == "h" else (x0 - 2 <= fixed <= x1 + 2)
        if not on_line:
            continue
        c0, c1 = (x0, x1) if axis == "h" else (y0, y1)
        spans = [s for a, b2 in spans for s in ((a, min(b2, c0)), (max(a, c1), b2)) if s[1] - s[0] > 1]
    return [(a, b2) for a, b2 in spans if b2 - a >= 400]


def _inset_from(piece, rects, d):
    """Pull a slab's sides back by `d` where they meet a wall (cladding, frames)."""
    x0, y0, x1, y1 = piece["x"], piece["y"], piece["x"] + piece["w"], piece["y"] + piece["h"]
    side = lambda r: _touch_length(r, rects) > 0
    if side({"x": x0, "y": y0, "w": 0, "h": y1 - y0}):
        x0 += d
    if side({"x": x1, "y": y0, "w": 0, "h": y1 - y0}):
        x1 -= d
    if side({"x": x0, "y": y0, "w": x1 - x0, "h": 0}):
        y0 += d
    if side({"x": x0, "y": y1, "w": x1 - x0, "h": 0}):
        y1 -= d
    return {"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0}


def _drop_covered_entry_canopies(scene, roofed):
    """A main door under a porch roof needs no canopy of its own."""
    for obj in [o for o in scene.collections["FACADE"].objects if o.name.startswith("MainEntry_") and o.name.endswith("_Canopy")]:
        x, y = obj.location.x / MM, obj.location.y / MM
        w, d = obj.dimensions.x / MM, obj.dimensions.y / MM
        rect = {"x": x - w / 2, "y": y - d / 2, "w": w, "h": d}
        if any(_overlap(rect, r) for r in roofed):
            bpy.data.objects.remove(obj, do_unlink=True)


def create_covered_outdoor(scene, building, massing, facade=None):
    floors = sorted(building["floors"], key=lambda f: f["level"])
    ground = floors[0]
    upper = floors[1] if len(floors) > 1 else None
    grade = ground["elevationMm"] - building.get("structuralSizing", {}).get("plinthHeightMm", -SITE_LEVELS["grade"])
    top = ground["elevationMm"] + ground["heightMm"]
    house = ground["footprint"]
    sheltering = [*(upper["footprint"] if upper else []),
                  *[mass_rect(m) for m in massing["masses"]
                    if m["usage"] in ("terrace", "canopy") and m["elevation"] < top + 400]]
    report = {"roofs": 0, "balconies": 0, "cars": 0}
    checked = (facade or {}).get("coveredOutdoor")
    if checked:
        if checked.get("sourcePlanId") != building["planId"] or checked.get("issues"):
            raise ValueError("Porch supports do not pass validation for the current plan")
        scene.warnings.extend(checked.get("omissions", []))
    roofed = []
    for room in building["rooms"]:
        if room["floorId"] != ground["id"] or not room["outdoor"] or not (room["id"] in COVERED_ROOMS or room["id"].startswith("verandahWing")):
            continue
        r = room["rect"]
        # the floor of the porch: paving, level with the approach
        scene.rect(f"GF_{room['id']}_Floor", "LANDSCAPE", r, grade + 10, 60, "paving", room["semanticId"], bevel=3)
        if room["id"] == "parking" and checked:
            for car in checked["cars"]:
                if car["roomId"] != room["semanticId"]:
                    continue
                cr = car["rect"]
                create_car(scene, car["id"], cr["x"] + cr["w"]/2, cr["y"] + cr["h"]/2,
                           grade + 70, car["alongY"])
                report["cars"] += 1
        elif room["id"] == "parking":
            # cars face the driveway: nose-out along the axis it runs on
            drive = next((f["rect"] for f in building.get("siteFeatures", []) if f["kind"] == "driveway" and
                          _touch_length(r, [f["rect"]]) > 0), None)
            along_y = (abs(drive["y"] - (r["y"] + r["h"])) <= 2 or abs(drive["y"] + drive["h"] - r["y"]) <= 2) \
                if drive else r["h"] >= r["w"]
            span = r["w"] if along_y else r["h"]
            cars = 2 if span >= 4600 else 1
            for i in range(cars):
                offset = span * (i + .5) / cars
                cx = r["x"] + (offset if along_y else r["w"] / 2)
                cy = r["y"] + (r["h"] / 2 if along_y else offset)
                create_car(scene, f"GF_Parking_Car_{i + 1}", cx, cy, grade + 70, along_y)
                report["cars"] += 1
        # an entrance frame rising through the roof: the slab and deck are cut
        # round it; posts and rails follow the porch outline
        cuts = _feature_cutters(facade, top - SLAB, top + 1100)
        for index, piece in enumerate(subtract_rectangles(r, sheltering), 1):
            if piece["w"] < 600 or piece["h"] < 600:
                continue
            name = f"GF_{room['id']}_Roof_{index:02d}"
            if checked and name in checked.get("openRoofs", []):
                continue  # no safe pillar layout exists: this piece is deliberately left open to the sky
            source_roof = next((roof for roof in checked["roofs"] if roof["id"] == name), None) if checked else None
            if checked and source_roof is None:
                raise ValueError(f"{name} has no checked support layout")
            if source_roof and (source_roof["rect"] != piece or source_roof["roomId"] != room["semanticId"]):
                raise ValueError(f"{name} support layout does not follow its current room")
            slabs = source_roof["slabs"] if source_roof else [s for s in subtract_rectangles(_inset_from(piece, house, WALL_CLEAR), cuts) if s["w"] >= 50 and s["h"] >= 50]
            for s_index, s in enumerate(slabs, 1):
                scene.rect(f"{name}_Slab_{s_index:02d}", "ROOF", s, top - SLAB, SLAB, "concrete", room["semanticId"])
            report["roofs"] += 1
            roofed.extend(slabs)
            # posts carry every corner the house walls do not
            corners = [(piece["x"] + POST / 2, piece["y"] + POST / 2), (piece["x"] + piece["w"] - POST / 2, piece["y"] + POST / 2),
                       (piece["x"] + POST / 2, piece["y"] + piece["h"] - POST / 2),
                       (piece["x"] + piece["w"] - POST / 2, piece["y"] + piece["h"] - POST / 2)]
            free = [c for c in corners if not _near(c[0], c[1], house, 200)]
            posts = list(free)
            for (ax, ay), (bx, by) in ((free[i], free[j]) for i in range(len(free)) for j in range(i + 1, len(free))):
                gap = abs(ax - bx) + abs(ay - by)
                if (ax == bx or ay == by) and gap > MAX_POST_SPAN:
                    extra = int(gap // MAX_POST_SPAN)
                    posts += [(ax + (bx - ax) * k / (extra + 1), ay + (by - ay) * k / (extra + 1)) for k in range(1, extra + 1)]
            if source_roof:
                posts = [(p["x"] + p["w"]/2, p["y"] + p["h"]/2) for p in source_roof["posts"]]
            for p_index, (px, py) in enumerate(posts, 1):
                scene.box(f"{name}_Post_{p_index:02d}", "ROOF", px, py, grade + 70, POST, POST,
                          top - SLAB - grade - 70, "concrete", room["semanticId"])
            # a roof the upper floor opens onto becomes a balcony; otherwise a
            # neat upstand finishes the roof edge
            balcony = upper is not None and _touch_length(piece, upper["footprint"]) >= 1200 and \
                _has_access(piece, building["doors"], upper["id"])
            if balcony:
                for s_index, s in enumerate(slabs, 1):
                    scene.rect(f"{name}_Deck_{s_index:02d}", "ROOF", s, top, 40, "paving", room["semanticId"], bevel=3)
                report["balconies"] += 1
            # rails / upstands on the open edges only, stopping short of the
            # house walls and of any frame or balcony crossing them
            walls = (upper["footprint"] if upper else []) + house + sheltering
            for e_index, edge in enumerate(boundary_edges([piece]), 1):
                axis, fixed, _lo, _hi, out = edge
                spans = [s for s in _open_spans(edge, walls, 150) for s in _open_spans((axis, fixed, *s, out), cuts, 0)]
                for s_index, (lo, hi) in enumerate(spans, 1):
                    if balcony:
                        if s_index == 1:
                            _plant_edges(scene, f"{name}_E{e_index}", [(axis, fixed, lo, hi, out)], top, room["semanticId"], index)
                        create_railing(scene, f"{name}_Rail_{e_index}_{s_index}", ground, (axis, fixed, lo, hi, out), top + 40)
                    else:
                        cx, cy = ((lo + hi) / 2, fixed) if axis == "h" else (fixed, (lo + hi) / 2)
                        w, d = ((hi - lo, 150) if axis == "h" else (150, hi - lo))
                        scene.box(f"{name}_Upstand_{e_index}_{s_index}", "ROOF", cx, cy, top, w, d, 300, "wall", room["semanticId"])
    _drop_covered_entry_canopies(scene, roofed)
    return report


def create_exposed_roofs(scene, building):
    """Close every lower floor the floor above does not cover.

    The part of a storey left open to the sky gets a roof slab at its ceiling.
    Where the upper floor opens onto it, it is a usable balcony terrace —
    paving and a glass rail on its open edges; elsewhere a parapet.
    """
    floors = sorted(building["floors"], key=lambda f: f["level"])
    report = {"exposedRoofs": 0, "terraces": 0}
    for floor, above in zip(floors, floors[1:]):
        top = floor["elevationMm"] + floor["heightMm"]
        cutters = [*above["footprint"], *[void["rect"] for void in above.get("doubleHeightVoids", [])]]
        pieces = [p for rect in floor["footprint"] for p in subtract_rectangles(rect, cutters)
                  if p["w"] >= 300 and p["h"] >= 300]
        if not pieces:
            continue
        name = f"{floor['id']}_ExposedRoof"
        for index, piece in enumerate(pieces, 1):
            thickness = slab_thickness(floor, SLAB)
            scene.rect(f"{name}_Slab_{index:02d}", "ROOF", piece, top - thickness, thickness, "concrete", floor["id"])
        report["exposedRoofs"] += len(pieces)
        # usable when the upper floor runs alongside it for at least 1.2 m
        terrace = any(_touch_length(p, above["footprint"]) >= 1200 and _has_access(p, building["doors"], above["id"]) for p in pieces)
        if terrace:
            for index, piece in enumerate(pieces, 1):
                scene.rect(f"{name}_Deck_{index:02d}", "ROOF", _inset_from(piece, above["footprint"], WALL_CLEAR), top, 40, "paving", floor["id"], bevel=3)
            report["terraces"] += 1
        # the open edges of the exposed area: not where the upper floor's walls rise
        for index, edge in enumerate(boundary_edges(pieces), 1):
            axis, fixed, _lo, _hi, out = edge
            for s_index, (lo, hi) in enumerate(_open_spans(edge, above["footprint"], 150), 1):
                if terrace:
                    if s_index == 1:
                        _plant_edges(scene, f"{name}_E{index}", [(axis, fixed, lo, hi, out)], top, floor["id"], index)
                    create_railing(scene, f"{name}_Rail_{index:03d}_{s_index}", floor, (axis, fixed, lo, hi, out), top + 40)
                else:
                    cx, cy = ((lo + hi) / 2, fixed) if axis == "h" else (fixed, (lo + hi) / 2)
                    w, d = ((hi - lo, 120) if axis == "h" else (120, hi - lo))
                    scene.box(f"{name}_Parapet_{index:03d}_{s_index}", "ROOF", cx, cy, top, w, d, 600, "wall", floor["id"])
    return report


def create_pool_deck(scene, building):
    """A stone deck round the pool, clipped to the plot and clear of the house."""
    ground = min(building["floors"], key=lambda f: f["level"])
    grade = ground["elevationMm"] - building.get("structuralSizing", {}).get("plinthHeightMm", -SITE_LEVELS["grade"])
    plot = {"x": 0, "y": 0, "w": building["plot"]["widthMm"], "h": building["plot"]["depthMm"]}
    blocked = [room["rect"] for room in building["rooms"] if room["floorId"] == ground["id"]]
    blocked += [f["rect"] for f in building.get("siteFeatures", []) if f["kind"] in ("parking", "driveway", "path", "pool")]
    count = 0
    for pool in (f for f in building.get("siteFeatures", []) if f["kind"] == "pool"):
        r = pool["rect"]
        ring = {"x": max(0, r["x"] - 900), "y": max(0, r["y"] - 900), "w": 0, "h": 0}
        ring["w"] = min(plot["w"], r["x"] + r["w"] + 900) - ring["x"]
        ring["h"] = min(plot["h"], r["y"] + r["h"] + 900) - ring["y"]
        for index, piece in enumerate(subtract_rectangles(ring, blocked), 1):
            if piece["w"] >= 200 and piece["h"] >= 200:
                scene.rect(f"{pool['id']}_Deck_{index:02d}", "LANDSCAPE", piece, grade + 10, 70, "stone", pool["id"], bevel=3)
                count += 1
    return count


def create_garden_trees(scene, building, seed, stream_class, limit=10):
    """Shade trees on the open lawns, clear of the house, paths and boundary."""
    ground = min(building["floors"], key=lambda f: f["level"])
    grade = ground["elevationMm"] - building.get("structuralSizing", {}).get("plinthHeightMm", -SITE_LEVELS["grade"])
    house = [room["rect"] for room in building["rooms"] if room["floorId"] == ground["id"]]
    # Forecourt lawns can carry trees too; the complete crown must keep paths,
    # parking, door approaches and the house clear below.
    lawns = sorted((f for f in building.get("siteFeatures", []) if f["kind"] == "lawn"),
                   key=lambda f: -f["rect"]["w"] * f["rect"]["h"])
    trees = []
    for lawn in lawns:
        r = lawn["rect"]
        if r["w"] < 2200 or r["h"] < 2200:
            continue
        nx, ny = max(1, int(r["w"] // 4500)), max(1, int(r["h"] // 4500))
        for i in range(nx):
            for j in range(ny):
                if len(trees) >= limit:
                    return len(trees)
                stream = stream_class(seed, f"tree|{lawn['id']}|{i}|{j}")
                # a seeded offset inside each cell, so the garden is not a grid
                cell_w, cell_h = r["w"] / nx, r["h"] / ny
                x = r["x"] + cell_w * (i + .5) + (stream.next() - .5) * max(0, cell_w - 2400)
                y = r["y"] + cell_h * (j + .5) + (stream.next() - .5) * max(0, cell_h - 2400)
                if _near(x, y, house, 1500) or any(math.hypot(x - tx, y - ty) < 3600 for tx, ty in trees):
                    continue
                height = 2600 + stream.next() * 1400
                name = f"Garden_Tree_{len(trees) + 1:02d}"
                from .realistic_props import create_real_tree
                boundary = {'x':0,'y':0,'w':building['plot']['widthMm'],'h':building['plot']['depthMm']}
                reserved = house + [f['rect'] for f in building.get('siteFeatures',[]) if f['kind'] != 'lawn']
                reserved += [{'x':o.location.x*1000-o.dimensions.x*500,'y':o.location.y*1000-o.dimensions.y*500,
                              'w':o.dimensions.x*1000,'h':o.dimensions.y*1000}
                             for o in scene.collections['MASSING'].objects if o.name.startswith('EnvelopePier_')]
                objects = create_real_tree(scene,name,x,y,grade+10,height+1000,stream.next()*math.tau,lawn['id'],reserved,boundary)
                if not objects:
                    continue
                trees.append((x, y))
    return len(trees)
