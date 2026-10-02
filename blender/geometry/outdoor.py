"""Plan-anchored balconies, accessible terraces, parapets, railings and planters."""

from .common import floor_prefix
from .plates import create_plate
from .stairs import stair_opening
from .massing import mass_rect


def _inside(rects, x, y):
    return any(rect["x"] < x < rect["x"] + rect["w"] and
               rect["y"] < y < rect["y"] + rect["h"] for rect in rects)


def boundary_edges(rects):
    """Only exterior union edges, avoiding rails through joined floor blocks."""
    xs = sorted({v for rect in rects for v in (rect["x"], rect["x"] + rect["w"])})
    ys = sorted({v for rect in rects for v in (rect["y"], rect["y"] + rect["h"])})
    edges = []
    for x in xs:
        for lo, hi in zip(ys, ys[1:]):
            mid = (lo + hi) / 2
            left, right = _inside(rects, x - 1, mid), _inside(rects, x + 1, mid)
            if left != right:
                edges.append(("v", x, lo, hi, 1 if left else -1))
    for y in ys:
        for lo, hi in zip(xs, xs[1:]):
            mid = (lo + hi) / 2
            north, south = _inside(rects, mid, y - 1), _inside(rects, mid, y + 1)
            if north != south:
                edges.append(("h", y, lo, hi, 1 if north else -1))
    return edges


def _overlap(a, b):
    return min(a["x"] + a["w"], b["x"] + b["w"]) > max(a["x"], b["x"]) and \
           min(a["y"] + a["h"], b["y"] + b["h"]) > max(a["y"], b["y"])


def _covered(rect, plates):
    if rect["w"] <= 0 or rect["h"] <= 0:
        return True
    xs = sorted({rect["x"], rect["x"] + rect["w"], *[x for p in plates for x in (p["x"], p["x"] + p["w"]) if rect["x"] < x < rect["x"] + rect["w"]]})
    ys = sorted({rect["y"], rect["y"] + rect["h"], *[y for p in plates for y in (p["y"], p["y"] + p["h"]) if rect["y"] < y < rect["y"] + rect["h"]]})
    return all(_inside(plates, (x0 + x1) / 2, (y0 + y1) / 2)
               for x0, x1 in zip(xs, xs[1:]) for y0, y1 in zip(ys, ys[1:]))


def accessible_roof_pad(floor, stairs, masses, shafts=(), width=2400, depth=2000):
    """Find a clear roof patch and a clear 800 mm route from its source stair."""
    stair = next((s for s in stairs if s["floorId"] == floor["id"]), None)
    if not stair:
        return None
    blocked = [mass_rect(m)
               for m in masses if m["usage"] == "roof" and m["sourceFloorId"] == floor["id"]]
    blocked += [shaft["rect"] for shaft in shafts if shaft["floorId"] == floor["id"]]
    origin = stair["rect"]
    sx, sy = origin["x"] + origin["w"] / 2, origin["y"] + origin["h"] / 2
    for plate in floor["footprint"]:
        x = plate["x"] + 250
        while x + width <= plate["x"] + plate["w"] - 250:
            y = plate["y"] + 250
            while y + depth <= plate["y"] + plate["h"] - 250:
                pad = {"x": x, "y": y, "w": width, "h": depth}
                px, py = x + width / 2, y + depth / 2
                legs = [
                    ({"x": min(sx, px), "y": sy - 400, "w": abs(px - sx), "h": 800},
                     {"x": px - 400, "y": min(sy, py), "w": 800, "h": abs(py - sy)}),
                    ({"x": sx - 400, "y": min(sy, py), "w": 800, "h": abs(py - sy)},
                     {"x": min(sx, px), "y": py - 400, "w": abs(px - sx), "h": 800}),
                ]
                if not _overlap(pad, origin) and not any(_overlap(pad, mass) for mass in blocked) and \
                   any(all(_covered(leg, floor["footprint"]) and not any(_overlap(leg, mass) for mass in blocked)
                           for leg in route) for route in legs):
                    return pad
                y += 500
            x += 500
    return None


def create_railing(scene, name, floor, edge, elevation, height_mm=980):
    axis, fixed, lo, hi, _outward = edge
    if hi - lo < 400:
        return
    center = (lo + hi) / 2
    x, y = (center, fixed) if axis == "h" else (fixed, center)
    width, depth = ((hi - lo, 42) if axis == "h" else (42, hi - lo))
    scene.box(f"{name}_Top", "BALCONIES", x, y, elevation + height_mm - 45,
              width, depth, 45, "railing", name)
    for at in (lo, hi):
        px, py = (at, fixed) if axis == "h" else (fixed, at)
        scene.box(f"{name}_Post_{int(at)}", "BALCONIES", px, py, elevation,
                  50, 50, height_mm, "railing", name)
    pane_w, pane_d = ((hi - lo - 80, 24) if axis == "h" else (24, hi - lo - 80))
    scene.box(f"{name}_Glass", "BALCONIES", x, y, elevation + 90,
              pane_w, pane_d, height_mm - 160, "glass", name, bevel=2)


def create_planter(scene, name, x, y, z, width=1100, depth=340):
    scene.box(name, "LANDSCAPE", x, y, z, width, depth, 360, "concrete", name)
    scene.box(f"{name}_Planting", "LANDSCAPE", x, y, z + 340,
              width - 80, depth - 80, 120, "landscape", name, bevel=12)


def create_balcony(scene, room, floor, terrace_mass, doors, with_railing=True):
    if terrace_mass is None:
        raise ValueError(f"{room['semanticId']} has no source terrace slab")
    access = [door for door in doors if door["floorId"] == floor["id"] and
              room["id"] in (door.get("rooms") or [])]
    if not access:
        raise ValueError(f"{room['semanticId']} has no accessible source door")
    rect = room["rect"]
    scene.rect(f"{floor_prefix(floor)}_Balcony_{room['id']}_Slab", "BALCONIES",
               rect, terrace_mass["elevation"], terrace_mass["height"],
               source_id=room["semanticId"])
    if not with_railing:
        return
    for index, edge in enumerate(boundary_edges([rect]), 1):
        axis, fixed, lo, hi, _ = edge
        # Never put a guard rail across the door that makes this balcony usable.
        if any(door["orient"] == axis and abs((door["at"]["y"] if axis == "h" else door["at"]["x"]) - fixed) <= 2 and
               lo <= (door["at"]["x"] if axis == "h" else door["at"]["y"]) <= hi for door in access):
            continue
        create_railing(scene, f"{floor_prefix(floor)}_Balcony_{room['id']}_Rail_{index}",
                       floor, edge, floor["elevationMm"])


def create_terrace(scene, floor, stairs, shafts=()):
    stair = next((stair for stair in stairs if stair["floorId"] == floor["id"]), None)
    if not stair:
        return False
    top = floor["elevationMm"] + floor["heightMm"]
    opening = stair_opening(stair)
    voids = [opening, *[shaft["rect"] for shaft in shafts if shaft["floorId"] == floor["id"]]]
    for index, rect in enumerate(floor["footprint"], 1):
        create_plate(scene, f"{floor_prefix(floor)}_Terrace_Deck_{index:03d}", "ROOF",
                     rect, top - 180, 180, floor["id"], voids)
    exit_side = stair.get("startSide", "N")
    for index, edge in enumerate(boundary_edges([opening]), 1):
        axis, fixed, _lo, _hi, outward = edge
        side = ("N" if outward < 0 else "S") if axis == "h" else ("W" if outward < 0 else "E")
        if side != exit_side:
            create_railing(scene, f"{floor_prefix(floor)}_Roof_StairGuard_{index}", floor, edge, top)
    return True


def create_parapet(scene, floor, top, masses=(), height_mm=900):
    shell = [*floor["footprint"], *[void["rect"] for void in floor.get("doubleHeightVoids", [])]]
    for index, (axis, fixed, lo, hi, _outward) in enumerate(boundary_edges(shell), 1):
        inside = fixed - _outward if axis == "h" else fixed - _outward
        edge_strip = ({"x": lo, "y": inside - 1, "w": hi - lo, "h": 2} if axis == "h" else
                      {"x": inside - 1, "y": lo, "w": 2, "h": hi - lo})
        if any(mass["usage"] == "roof" and mass["sourceFloorId"] == floor["id"] and
               _overlap(edge_strip, mass_rect(mass)) for mass in masses):
            continue
        center = (lo + hi) / 2
        x, y = (center, fixed) if axis == "h" else (fixed, center)
        width, depth = ((hi - lo, 120) if axis == "h" else (120, hi - lo))
        scene.box(f"{floor_prefix(floor)}_Parapet_{index:03d}", "ROOF",
                  x, y, top, width, depth, height_mm, "wall", floor["id"])


def create_pergola(scene, name, rect, bottom, height_mm=2300):
    """Four posts and repeated slats; shared mesh data makes the slats instances."""
    x0, x1 = rect["x"], rect["x"] + rect["w"]
    y0, y1 = rect["y"], rect["y"] + rect["h"]
    for i, x in enumerate((x0, x1), 1):
        for j, y in enumerate((y0, y1), 1):
            scene.box(f"{name}_Post_{i}{j}", "ROOF", x, y, bottom,
                      140, 140, height_mm, "timber", name)
    count = max(2, int(rect["w"] // 450))
    for i in range(count + 1):
        x = x0 + rect["w"] * i / count
        scene.box(f"{name}_Slat_{i:02d}", "ROOF", x, (y0 + y1) / 2,
                  bottom + height_mm - 120, 90, rect["h"], 120, "timber", name)
