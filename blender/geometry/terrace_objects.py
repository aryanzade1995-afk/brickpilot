"""Roof-terrace furniture and planting: sun loungers under a parasol, a bench, and planters.

Everything sits in clear deck, away from the stair headroom, the water tanks, shafts and the parapet.
"""

from .covered import _cylinder
from .plates import subtract_rectangles

EDGE = 750      # clear of the parapet
CLEAR = 600     # clear of services


def _free_rects(building, top):
    blockers = []
    terrace = building["roofTerrace"]
    from .roof_services import tank_bank
    blockers += [r for r in (terrace.get("mumty"), tank_bank(terrace)) if r]
    blockers += [s["rect"] for s in building["shafts"] if s["floorId"] == top["id"]]
    blockers += [s["rect"] for s in building["stairs"] if s["floorId"] == top["id"]]
    pieces = []
    for slab in terrace["slab"]:
        inner = {"x": slab["x"] + EDGE, "y": slab["y"] + EDGE, "w": slab["w"] - 2 * EDGE, "h": slab["h"] - 2 * EDGE}
        if inner["w"] <= 0 or inner["h"] <= 0:
            continue
        grown = [{"x": b["x"] - CLEAR, "y": b["y"] - CLEAR, "w": b["w"] + 2 * CLEAR, "h": b["h"] + 2 * CLEAR} for b in blockers]
        pieces += subtract_rectangles(inner, grown)
    return sorted(pieces, key=lambda r: -r["w"] * r["h"])


def _lounger(scene, name, x, y, z, along_x, source):
    length, width = 1900, 650
    w, d = (length, width) if along_x else (width, length)
    scene.box(f"{name}_Frame", "ROOF", x, y, z + 150, w, d, 120, "wood", source, bevel=15)
    scene.box(f"{name}_Cushion", "ROOF", x, y, z + 270, w - 80, d - 80, 90, "fabric", source, bevel=25)
    hx, hy = (x - length / 2 + 240, y) if along_x else (x, y - length / 2 + 240)
    hw, hd = (480, width - 80) if along_x else (width - 80, 480)
    scene.box(f"{name}_Back", "ROOF", hx, hy, z + 360, hw, hd, 150, "fabric", source, bevel=40)
    for sx in (-1, 1):
        for sy in (-1, 1):
            lx = x + sx * (w / 2 - 70)
            ly = y + sy * (d / 2 - 70)
            scene.box(f"{name}_Leg_{sx}{sy}", "ROOF", lx, ly, z, 50, 50, 150, "wood", source, bevel=5)


def _parasol(scene, name, x, y, z, source):
    _cylinder(scene, f"{name}_Base", x, y, z + 60, 260, 120, "z", "concrete", source)
    _cylinder(scene, f"{name}_Pole", x, y, z + 1150, 28, 2200, "z", "wood", source)
    _cylinder(scene, f"{name}_Canopy", x, y, z + 2250, 1250, 70, "z", "fabric", source)
    _cylinder(scene, f"{name}_Finial", x, y, z + 2330, 55, 90, "z", "wood", source)


def _bench(scene, name, x, y, z, along_x, source):
    w, d = (1600, 420) if along_x else (420, 1600)
    scene.box(f"{name}_Seat", "ROOF", x, y, z + 400, w, d, 60, "wood", source, bevel=10)
    for s in (-1, 1):
        lx, ly = (x + s * (w / 2 - 150), y) if along_x else (x, y + s * (d / 2 - 150))
        scene.box(f"{name}_Leg_{s}", "ROOF", lx, ly, z, 60 if along_x else d, d if along_x else 60, 400, "metal", source, bevel=5)


def create_terrace_objects(scene, building):
    terrace = building.get("roofTerrace")
    if not terrace:
        return {"terraceObjects": 0}
    from visualization.landscape import planter
    top = max(building["floors"], key=lambda f: f["level"])
    z = top["elevationMm"] + top["heightMm"]
    source = top["id"]
    free = _free_rects(building, top)
    count = 0
    if free:
        area = free[0]
        # a lounge corner: two loungers and a parasol in the largest clear space
        if area["w"] >= 3200 and area["h"] >= 2200:
            along_x = True
            cx, cy = area["x"] + 1400, area["y"] + 1100
            for i in range(2):
                _lounger(scene, f"Terrace_Lounger_{i + 1}", cx, cy + (i - .5) * 900, z, along_x, source)
            _parasol(scene, "Terrace_Parasol", cx + 1700 if area["w"] >= 4800 else cx, cy + (0 if area["w"] >= 4800 else 1700), z, source)
            count += 3
        if len(free) > 1 or area["w"] >= 6000:
            tgt = free[1] if len(free) > 1 else area
            bx = tgt["x"] + tgt["w"] / 2 if len(free) > 1 else area["x"] + area["w"] - 1400
            by = tgt["y"] + tgt["h"] - 450 if len(free) > 1 else area["y"] + area["h"] - 450
            if tgt["w"] >= 1800 and tgt["h"] >= 900:
                _bench(scene, "Terrace_Bench", bx, by, z, True, source)
                count += 1
    # planters along the parapet where the deck is clear
    deck = [s for s in terrace["slab"]]
    from .roof_services import tank_bank
    keep = [b for b in (terrace.get("mumty"), tank_bank(terrace)) if b]
    placed = 0
    for slab in deck:
        for index in range(max(0, int(slab["w"] // 2600))):
            if placed >= 6:
                break
            x = slab["x"] + 1300 + index * 2600
            rect = {"x": x - 650, "y": slab["y"] + slab["h"] - 600 - 420, "w": 1300, "h": 420}
            if any(rect["x"] < k["x"] + k["w"] + 300 and rect["x"] + rect["w"] > k["x"] - 300 and
                   rect["y"] < k["y"] + k["h"] + 300 and rect["y"] + rect["h"] > k["y"] - 300 for k in keep):
                continue
            if rect["x"] + rect["w"] > slab["x"] + slab["w"] - 200:
                continue
            planter(scene, f"Terrace_Planter_{placed + 1}", {"rect": rect, "z": z + 40, "sourceId": source, "category": "terrace"}, 11 + placed, 9)
            placed += 1
    return {"terraceObjects": count + placed}
