"""Pure geometric placement gates for greenery and architectural fixtures."""

from geometry.plates import subtract_rectangles
from geometry.massing import mass_rect


def overlaps(a, b, clearance=0):
    return min(a["x"] + a["w"], b["x"] + b["w"] + clearance) > max(a["x"], b["x"] - clearance) and \
        min(a["y"] + a["h"], b["y"] + b["h"] + clearance) > max(a["y"], b["y"] - clearance)


def opening_box(o, clearance):
    half = o["width"] / 2 + 100
    x, y = o["at"]["x"], o["at"]["y"]
    return {"x": x - half if o["orient"] == "h" else x - clearance,
            "y": y - clearance if o["orient"] == "h" else y - half,
            "w": half * 2 if o["orient"] == "h" else clearance * 2,
            "h": clearance * 2 if o["orient"] == "h" else half * 2}


def within(rect, boundary):
    return rect["x"] >= boundary["x"] and rect["y"] >= boundary["y"] and rect["x"] + rect["w"] <= boundary["x"] + boundary["w"] and rect["y"] + rect["h"] <= boundary["y"] + boundary["h"]


def supported(rect, plates):
    return sum(r["w"] * r["h"] for r in subtract_rectangles(rect, plates)) < 1


def clear_roof_pad(building, massing, width=2400, depth=1800):
    top = max(building["floors"], key=lambda f: f["level"])
    stair = next((s for s in building["stairs"] if s["floorId"] == top["id"]), None)
    if not stair:
        return None
    r, half = stair["rect"], 400
    shafts = [s["rect"] for s in building["shafts"] if s["floorId"] == top["id"]]
    blocked = [piece for m in massing["masses"] if m["usage"] == "roof" and m["sourceFloorId"] == top["id"]
               for piece in subtract_rectangles(mass_rect(m), [r, *shafts])]
    blocked += [r, *shafts]
    side = stair.get("startSide", "N")
    sx = r["x"] + r["w"] + half if side == "E" else r["x"] - half if side == "W" else r["x"] + r["w"] / 2
    sy = r["y"] + r["h"] + half if side == "S" else r["y"] - half if side == "N" else r["y"] + r["h"] / 2
    def clear(p):
        return supported(p, top["footprint"]) and not any(overlaps(p, b) for b in blocked)
    def horizontal(x, y, to):
        return {"x": min(x, to) - half, "y": y - half, "w": abs(x - to) + half * 2, "h": half * 2}
    def vertical(x, y, to):
        return {"x": x - half, "y": min(y, to) - half, "w": half * 2, "h": abs(y - to) + half * 2}
    for plate in top["footprint"]:
        for x in range(round(plate["x"] + 200), round(plate["x"] + plate["w"] - width - 199), 400):
            for y in range(round(plate["y"] + 200), round(plate["y"] + plate["h"] - depth - 199), 400):
                pad = {"x": x, "y": y, "w": width, "h": depth}
                px, py = x + width / 2, y + depth / 2
                routes = [[horizontal(sx, sy, px), vertical(px, sy, py)], [vertical(sx, sy, py), horizontal(sx, py, px)]]
                for route in routes:
                    if clear(pad) and all(clear(leg) for leg in route):
                        return {"pad": pad, "routes": route, "floor": top}
    return None


def planting_layout(payload, options):
    b, m = payload["buildingModel"], payload["massingModel"]
    config = options["landscape"]
    if not config["enabled"]:
        return {"planters": [], "omissions": []}
    floors = {f["id"]: f for f in b["floors"]}
    ground = min(b["floors"], key=lambda f: f["level"])
    boundary = {"x": 0, "y": 0, "w": b["plot"]["widthMm"], "h": b["plot"]["depthMm"]}
    units = (payload["facadeGrammar"].get("specialized") or {}).get("assemblies", [])
    parts = [part["world"] for feature in payload["facadeGrammar"]["features"] for part in feature["parts"]]
    parts += [part["world"] for unit in units for part in unit["parts"] if part["operation"] == "ADD"]
    plans, omissions = [], []
    def accept(rect, z, category, source, plates=None, routes=()):
        # Reserve the complete foliage envelope, not only the planter base.
        envelope = {"x": rect["x"] - 50, "y": rect["y"] - 50, "w": rect["w"] + 100, "h": rect["h"] + 100}
        if len(plans) >= config["maxPlanters"] or not within(envelope, boundary) or (plates and not supported(envelope, plates)):
            return False
        if any(overlaps(envelope, leg) for leg in routes) or any(overlaps(envelope, p["envelope"], 100) and z < p["z"] + 1100 and z + 1100 > p["z"] for p in plans):
            return False
        if category in ("entry", "side"):
            if any(overlaps(envelope, room["rect"], 100) for room in b["rooms"] if room["floorId"] == ground["id"]):
                return False  # Includes parking and planned outdoor circulation.
            if any(overlaps(envelope, opening_box(o, config["clearanceMm"])) for o in [*b["doors"], *b["windows"]] if o["floorId"] == ground["id"]):
                return False
        elif category == "balcony":
            if any(overlaps(envelope, opening_box(o, config["clearanceMm"])) for o in b["doors"] if o["floorId"] == floors[source["floorId"]]["id"]):
                return False
        elif category == "terrace":
            if any(overlaps(envelope, mass_rect(mass)) and z < mass["elevation"] + mass["height"] and z + 1100 > mass["elevation"] for mass in m["masses"] if mass["usage"] == "roof"):
                return False
            top = max(b["floors"], key=lambda f: f["level"])
            if any(overlaps(envelope, item["rect"]) for item in [*b["stairs"], *b["shafts"]] if item["floorId"] == top["id"]):
                return False
        if any(overlaps(envelope, part) and z < part["z"] + part["height"] and z + 1100 > part["z"] for part in parts):
            return False
        plans.append({"rect": rect, "envelope": envelope, "z": z, "category": category,
                      "sourceId": source["semanticId"] if isinstance(source, dict) and "semanticId" in source else str(source)})
        return True
    if config["balcony"]:
        for room in b["rooms"]:
            if not room["outdoor"] or not room["id"].startswith("balcony"):
                continue
            if any(u["type"] == "PLANTER" and room["semanticId"] in u["sourceRoomIds"] for u in units):
                continue
            r, floor = room["rect"], floors[room["floorId"]]
            found = False
            for x in (r["x"] + 120, r["x"] + r["w"] / 2 - 400, r["x"] + r["w"] - 920):
                for y in (r["y"] + 140, r["y"] + r["h"] - 400):
                    if accept({"x": x, "y": y, "w": 800, "h": 240}, floor["elevationMm"], "balcony", room, [r]):
                        found = True; break
                if found:
                    break
            if not found:
                omissions.append("Balcony greenery omitted: no clear source balcony patch.")
    if config["entry"]:
        for door in (d for d in b["doors"] if d["kind"] == "entry" and d["floorId"] == ground["id"]):
            found = False
            for sign in (-1, 1):
                along = (door["at"]["x"] if door["orient"] == "h" else door["at"]["y"]) + sign * (door["width"] / 2 + 1100)
                for normal in (-800, 800):
                    x, y = (along, door["at"]["y"] + normal) if door["orient"] == "h" else (door["at"]["x"] + normal, along)
                    found = accept({"x": x - 300, "y": y - 250, "w": 600, "h": 500}, ground["elevationMm"] - 400, "entry", door["id"]) or found
            if not found:
                omissions.append("Entry planter omitted: door approach, parking or site margin protected.")
    if config["terrace"] and payload["villaDesignDNA"]["roofType"] not in ("gable", "hip", "mono-slope"):
        patch = clear_roof_pad(b, m)
        if patch:
            r, top = patch["pad"], patch["floor"]
            placed = False
            for x in (r["x"] + 180, r["x"] + r["w"] / 2 - 200, r["x"] + r["w"] - 780):
                placed = accept({"x": x, "y": r["y"] + r["h"] - 240, "w": 600, "h": 240},
                                top["elevationMm"] + top["heightMm"], "terrace", top["id"], top["footprint"], patch["routes"]) or placed
            if not placed:
                omissions.append("Terrace greenery omitted: clear stair route preserved.")
        else:
            omissions.append("Terrace greenery omitted: no supported clear pad and stair route.")
    if config["side"]:
        for x in (300, b["plot"]["widthMm"] - 900):
            for y in range(1200, round(b["plot"]["depthMm"] - 1200), 3000):
                accept({"x": x, "y": y, "w": 600, "h": 700}, ground["elevationMm"] - 400, "side", b["planId"])
    return {"planters": plans, "omissions": omissions}
