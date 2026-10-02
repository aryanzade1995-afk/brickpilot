"""Recheck specialized grammar anchors before any Blender mesh is created."""

import math
from geometry.massing import mass_rect
from geometry.plates import subtract_rectangles

TYPES = {
    "BALCONY": {"RECESSED", "PROJECTED", "FLOATING", "CORNER", "WRAP", "BOXED", "FRAME_INTEGRATED", "PLANTER", "PARTIAL_WIDTH", "FULL_WIDTH"},
    "ENTRANCE": {"RECESSED_ENTRY", "DOUBLE_HEIGHT_PORTAL", "STONE_ENTRY", "WOOD_PORTAL", "SIDE_ENTRY", "FLOATING_CANOPY", "COURTYARD_ENTRY"},
    "WINDOW": {"ALIGNED", "ASYMMETRIC", "HORIZONTAL_BAND", "VERTICAL_STACK", "CORNER_GLAZING", "FLOOR_TO_CEILING", "FRAME_GROUPED", "SCREENED"},
    "ROOFLINE": {"FLAT_PARAPET", "STEPPED_PARAPET", "OFFSET_PARAPET", "ROOFTOP_FRAME", "PERGOLA", "ROOF_TERRACE", "SCREENED_TERRACE", "PLANTER_PARAPET"},
    "DEPTH": {"DEEP_RECESS", "SHALLOW_RECESS", "MAIN_FACADE_PLANE", "CLADDING_PLANE", "PROJECTED_SLAB", "ARCHITECTURAL_FRAME", "CANTILEVERED_MASS"},
}


def wall_side(building, wall):
    floor = next(f for f in building["floors"] if f["id"] == wall["floorId"])
    horizontal = abs(wall["a"]["y"] - wall["b"]["y"]) <= 2
    x, y = (wall["a"]["x"] + wall["b"]["x"]) / 2, (wall["a"]["y"] + wall["b"]["y"]) / 2
    def inside(px, py):
        shell = [*floor["footprint"], *[void["rect"] for void in floor.get("doubleHeightVoids", [])]]
        return any(r["x"] < px < r["x"] + r["w"] and r["y"] < py < r["y"] + r["h"] for r in shell) and not (
            floor.get("courtyard") and floor["courtyard"]["x"] < px < floor["courtyard"]["x"] + floor["courtyard"]["w"] and
            floor["courtyard"]["y"] < py < floor["courtyard"]["y"] + floor["courtyard"]["h"])
    before, after = (inside(x, y - 1), inside(x, y + 1)) if horizontal else (inside(x - 1, y), inside(x + 1, y))
    if before == after:
        raise ValueError(f"{wall['id']} is not an exterior facade")
    return ("S" if before else "N") if horizontal else ("E" if before else "W")


def resolve_anchor(building, massing, anchor):
    floor = next(f for f in building["floors"] if f["id"] == anchor["floorId"])
    kind, source = anchor["kind"], anchor["sourceId"]
    if kind == "WALL":
        wall = next(w for w in building["walls"] if w["id"] == source and w["floorId"] == floor["id"] and w["kind"] == "exterior")
        side = wall_side(building, wall)
        horizontal = side in ("N", "S")
        lo, hi = sorted((wall["a"]["x"], wall["b"]["x"]) if horizontal else (wall["a"]["y"], wall["b"]["y"]))
        fixed = (wall["a"]["y"] if horizontal else wall["a"]["x"]) + (1 if side in ("S", "E") else -1) * wall["thickness"] / 2
        return {"x": lo if horizontal else fixed, "y": fixed if horizontal else lo, "z": floor["elevationMm"],
                "side": side, "w": hi - lo, "d": wall["thickness"], "h": floor["heightMm"], "wall": wall}
    if kind == "BALCONY":
        room = next(r for r in building["rooms"] if r["semanticId"] == source and r["floorId"] == floor["id"] and r["outdoor"] and r["id"].startswith("balcony"))
        door = next(d for d in building["doors"] if d["floorId"] == floor["id"] and room["id"] in (d.get("rooms") or []) and
                    any(r["floorId"] == floor["id"] and not r["outdoor"] and r["id"] in (d.get("rooms") or []) for r in building["rooms"]))
        r = room["rect"]
        if door["orient"] == "h":
            side = "S" if abs(door["at"]["y"] - r["y"]) <= 2 else "N" if abs(door["at"]["y"] - r["y"] - r["h"]) <= 2 else None
        else:
            side = "E" if abs(door["at"]["x"] - r["x"]) <= 2 else "W" if abs(door["at"]["x"] - r["x"] - r["w"]) <= 2 else None
        if not side:
            raise ValueError("Balcony access is not on its edge")
        return {"x": r["x"] + r["w"] if side == "W" else r["x"], "y": r["y"] + r["h"] if side == "N" else r["y"],
                "z": floor["elevationMm"], "side": side, "w": r["w"] if side in ("N", "S") else r["h"],
                "d": r["h"] if side in ("N", "S") else r["w"], "h": floor["heightMm"], "room": room, "door": door}
    if kind not in ("ROOF", "ROOF_MASS"):
        raise ValueError("Unknown grammar anchor")
    mass = next((m for m in massing["masses"] if m["id"] == source and m["sourceFloorId"] == floor["id"] and m["usage"] == "roof"), None) if kind == "ROOF_MASS" else None
    if (kind == "ROOF_MASS" and not mass) or (kind == "ROOF" and source != floor["id"]):
        raise ValueError("Invalid roof source")
    r = mass_rect(mass) if mass else floor["outline"]
    return {"x": r["x"], "y": r["y"], "z": mass["elevation"] + mass["height"] if mass else floor["elevationMm"] + floor["heightMm"],
            "side": "S", "w": r["w"], "d": r["h"], "h": 2400,
            "rects": [r] if mass else [*floor["footprint"], *[void["rect"] for void in floor.get("doubleHeightVoids", [])]]}


def derive_world(a, b):
    horizontal = a["side"] in ("N", "S")
    fixed, along = (a["y"], a["x"] + b["u"]) if horizontal else (a["x"], a["y"] + b["u"])
    normal = fixed + b["v"] if a["side"] in ("S", "E") else fixed - b["v"] - b["d"]
    return {"x": along if horizontal else normal, "y": normal if horizontal else along,
            "w": b["w"] if horizontal else b["d"], "h": b["d"] if horizontal else b["w"], "z": a["z"] + b["z"], "height": b["h"]}


def _intersects(a, b, tolerance=2):
    return all(min(a[k] + a[size], b[k] + b[size]) - max(a[k], b[k]) > tolerance
               for k, size in (("x", "w"), ("y", "h"), ("z", "height")))


def validate_specialized(payload, hosts):
    from validation import opening_vertical_span
    model = payload["facadeGrammar"].get("specialized")
    if model is None:  # Existing exported inputs retain their baseline components.
        return
    building, massing = payload["buildingModel"], payload["massingModel"]
    if model["schemaVersion"] != 1 or model["status"] != "valid" or model["issues"] or model["sourcePlanId"] != building["planId"] or model["seed"] != payload["villaDesignDNA"]["seed"]:
        raise ValueError("Specialized grammar is invalid or stale")
    limits = model["limits"]
    if not all(math.isfinite(n) and n > 0 for n in limits.values()):
        raise ValueError("Invalid grammar limits")
    tolerance = limits["toleranceMm"]
    floors = {f["id"]: f for f in building["floors"]}
    walls = {w["id"]: w for w in building["walls"]}
    openings = {o["id"]: o for o in [*building["doors"], *building["windows"]]}
    room_ids = {r["semanticId"] for r in building["rooms"]}
    ids, previous = set(), []
    for unit in model["assemblies"]:
        if unit["type"] not in TYPES.get(unit["category"], ()) or not unit["parts"] or unit["id"] in ids:
            raise ValueError("Unknown, empty or duplicate grammar assembly")
        ids.add(unit["id"])
        if not set(unit["openingIds"]).issubset(openings) or not set(unit["sourceRoomIds"]).issubset(room_ids):
            raise ValueError("Missing source room/opening")
        if unit["category"] == "ENTRANCE" and not any(openings[i]["kind"] == "entry" for i in unit["openingIds"]):
            raise ValueError("Entrance has no actual main door")
        if unit["category"] == "WINDOW" and (not unit["openingIds"] or any(openings[i]["kind"] != "window" or not any(
            r["semanticId"] in unit["sourceRoomIds"] and not r["outdoor"] and r["floorId"] == openings[i]["floorId"] and r["id"] in (openings[i].get("rooms") or [])
            for r in building["rooms"]) for i in unit["openingIds"])):
            raise ValueError("Window composition lost its actual indoor room")
        parts = []
        for part in unit["parts"]:
            if part["id"] in ids or part["operation"] not in ("ADD", "RECESS"):
                raise ValueError("Duplicate grammar part")
            ids.add(part["id"])
            a, b, r = resolve_anchor(building, massing, part["anchor"]), part["local"], part["world"]
            if not all(math.isfinite(n) for n in b.values()) or min(b["w"], b["d"], b["h"]) <= 0 or derive_world(a, b) != r:
                raise ValueError(f"Unanchored/invalid geometry: {part['id']}")
            env = building["plot"]["buildable"]
            if r["x"] < env["x"] - 2 or r["y"] < env["y"] - 2 or r["x"] + r["w"] > env["x"] + env["w"] + 2 or r["y"] + r["h"] > env["y"] + env["h"] + 2:
                raise ValueError("Grammar crosses setback envelope")
            kind = part["anchor"]["kind"]
            if kind == "WALL" and (b["u"] < -2 or b["u"] + b["w"] > a["w"] + 2 or b["z"] < -2 or b["z"] + b["h"] > a["h"] + 2):
                raise ValueError("Grammar leaves its source wall span")
            if kind == "BALCONY":
                if a["door"]["id"] not in unit["openingIds"] or b["u"] < 0 or b["v"] < 0 or b["u"] + b["w"] > a["w"] or b["v"] + b["d"] > a["d"] or b["z"] < -220 or b["z"] + b["h"] > a["h"]:
                    raise ValueError("Balcony exceeds its source room or loses access")
                if not any(m["usage"] == "terrace" and part["anchor"]["sourceId"] in m["sourceRoomIds"] for m in massing["masses"]):
                    raise ValueError("Source balcony support is missing")
            if kind in ("ROOF", "ROOF_MASS"):
                if sum(p["w"] * p["h"] for p in subtract_rectangles(r, a["rects"])) > tolerance or b["z"] < 0 or b["z"] + b["h"] > limits["maxRoofFeatureHeightMm"]:
                    raise ValueError("Roof detail leaves its supported source plate")
                for source in [*building["stairs"], *building["shafts"]]:
                    if source["floorId"] != part["anchor"]["floorId"]:
                        continue
                    cut = source["rect"]
                    if all(min(r[k] + r[size], cut[k] + cut[size]) - max(r[k], cut[k]) > tolerance for k, size in (("x", "w"), ("y", "h"))):
                        raise ValueError("Roof feature blocks a source stair or shaft")
            owned_mullion = unit["category"] == "WINDOW" and part["role"] == "frame" and b["v"] < 0 and b["w"] <= 80 and any(
                hosts[i] == part["anchor"]["sourceId"] and r["z"] >= floors[openings[i]["floorId"]]["elevationMm"] + opening_vertical_span(openings[i], floors[openings[i]["floorId"]])[0] and
                r["z"] + r["height"] <= floors[openings[i]["floorId"]]["elevationMm"] + opening_vertical_span(openings[i], floors[openings[i]["floorId"]])[1] and
                b["d"] <= a["wall"]["thickness"] and
                b["u"] >= openings[i]["at"]["x" if openings[i]["orient"] == "h" else "y"] - a["x" if openings[i]["orient"] == "h" else "y"] - openings[i]["width"] / 2 and
                b["u"] + b["w"] <= openings[i]["at"]["x" if openings[i]["orient"] == "h" else "y"] - a["x" if openings[i]["orient"] == "h" else "y"] + openings[i]["width"] / 2
                for i in unit["openingIds"])
            if part["operation"] == "RECESS":
                if kind != "WALL" or b["v"] != -b["d"] or b["d"] > a["wall"]["thickness"] - limits["minWallRemainderMm"]:
                    raise ValueError("Recess destroys the source wall")
            else:
                if kind == "WALL" and ((b["v"] < 0 and not owned_mullion) or b["v"] + b["d"] > limits["maxCantileverMm" if unit["type"] in ("CANTILEVERED_MASS", "FLOATING_CANOPY") else "maxProjectionMm"]):
                    raise ValueError("Invalid facade depth or cantilever")
                if not owned_mullion and any(_intersects(r, {**mass_rect(m), "z": m["elevation"], "height": m["height"]}) for m in massing["masses"] if m["usage"] != "terrace"):
                    raise ValueError("Specialized solid collides with source volume")
            balcony_joint = unit["category"] == "BALCONY" and part["role"] in ("slab", "beam") and (r["z"] + r["height"] <= a["z"] or b["z"] >= a["h"] - 360)
            for column in building["columns"]:
                f, half = floors[column["floorId"]], column["size"] / 2
                box = {"x": column["at"]["x"] - half, "y": column["at"]["y"] - half, "w": column["size"], "h": column["size"], "z": f["elevationMm"], "height": f["heightMm"]}
                if not balcony_joint and _intersects(r, box, tolerance):
                    raise ValueError("Grammar intersects a source column")
            for opening in openings.values():
                wall = walls[hosts[opening["id"]]]
                floor = floors[opening["floorId"]]
                sill, head = opening_vertical_span(opening, floor)
                horizontal = opening["orient"] == "h"
                along, fixed = (opening["at"]["x"], opening["at"]["y"]) if horizontal else (opening["at"]["y"], opening["at"]["x"])
                approach = wall["thickness"] / 2 + limits["openingClearanceMm"] if opening["kind"] == "window" and unit["category"] == "BALCONY" else limits["doorApproachMm"]
                box = {"x": along - opening["width"] / 2 - limits["openingClearanceMm"] if horizontal else fixed - approach,
                       "y": fixed - approach if horizontal else along - opening["width"] / 2 - limits["openingClearanceMm"],
                       "w": opening["width"] + 2 * limits["openingClearanceMm"] if horizontal else 2 * approach,
                       "h": 2 * approach if horizontal else opening["width"] + 2 * limits["openingClearanceMm"],
                       "z": floor["elevationMm"] + sill, "height": head - sill}
                screen = unit["category"] == "WINDOW" and opening["id"] in unit["openingIds"] and part["role"] == "screen" and b["w"] <= 70 and b["v"] >= 150
                if _intersects(r, box) and not owned_mullion and not screen:
                    raise ValueError(f"Grammar obstructs opening {opening['id']}")
            if any(_intersects(r, p["world"]) for f in payload["facadeGrammar"]["features"] for p in f["parts"]):
                raise ValueError("Grammar intersects the existing hero")
            if any(_intersects(r, other) for other in previous):
                raise ValueError("Specialized assemblies intersect")
            parts.append(r)
        previous.extend(parts)
