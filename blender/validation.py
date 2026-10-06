"""Blender-side checks for the four immutable procedural inputs.

This is a geometric consistency gate, not a structural engineering analysis.
It imports no Blender modules so the handoff can be tested before launching Blender.
"""

from __future__ import annotations

import math
from geometry.massing import mass_rect


class GeometryInputError(ValueError):
    pass


OPENING_LIMITS = {"windowHeadMm": 2200, "doorHeadMm": 2300, "entryHeadMm": 2500,
                  "defaultSillMm": 850, "lintelClearanceMm": 120,
                  "minWindowHeightMm": 150, "minDoorHeightMm": 1800}


def opening_vertical_span(opening, floor, limits=OPENING_LIMITS):
    limits = floor.get("openingLimits", limits)
    kind = opening["kind"]
    sill = opening.get("sill", limits["defaultSillMm"]) if kind == "window" else 0
    head = min(opening.get("head", limits[f"{kind}HeadMm"]), floor["heightMm"] - limits["lintelClearanceMm"])
    minimum = limits["minWindowHeightMm"] if kind == "window" else limits["minDoorHeightMm"]
    if not math.isfinite(sill) or not math.isfinite(head) or sill < 0 or head - sill < minimum:
        raise GeometryInputError(f"Opening {opening['id']} has no usable height")
    return sill, head


def _rect(rect):
    return all(math.isfinite(rect[k]) for k in ("x", "y", "w", "h")) and rect["w"] > 0 and rect["h"] > 0


def _wall_axis(wall):
    a, b = wall["a"], wall["b"]
    if abs(a["y"] - b["y"]) <= 2:
        return "h", a["y"], sorted((a["x"], b["x"]))
    if abs(a["x"] - b["x"]) <= 2:
        return "v", a["x"], sorted((a["y"], b["y"]))
    raise GeometryInputError(f"Wall {wall.get('id')} is not axis-aligned")


def opening_hosts(building):
    """Map each source opening to its real wall; fail rather than invent a host."""
    hosts = {}
    walls = building["walls"]
    for opening in [*building["doors"], *building["windows"]]:
        width = opening["width"]
        if not math.isfinite(width) or width < 400:
            raise GeometryInputError(f"Opening {opening.get('id')} has invalid width")
        along = opening["at"]["x" if opening["orient"] == "h" else "y"]
        fixed = opening["at"]["y" if opening["orient"] == "h" else "x"]
        matches = []
        for wall in walls:
            if wall["floorId"] != opening["floorId"]:
                continue
            axis, line, (lo, hi) = _wall_axis(wall)
            if axis == opening["orient"] and abs(line - fixed) <= 2 and along - width / 2 >= lo - 2 and along + width / 2 <= hi + 2:
                matches.append(wall)
        if len(matches) != 1:
            raise GeometryInputError(f"Opening {opening.get('id')} must have exactly one source wall; found {len(matches)}")
        hosts[opening["id"]] = matches[0]["id"]
    return hosts


def validate_concept_sizing(building, floors):
    """Dimension/source consistency only; not loading or structural certification."""
    sizing, rules = building.get("structuralSizing"), building.get("quantityRules")
    if not sizing and not rules:
        return  # Legacy source models remain loadable.
    if not sizing or not rules:
        raise GeometryInputError("Incomplete concept sizing")
    positive = lambda x: isinstance(x, (float, int)) and math.isfinite(x) and x > 0
    if not positive(sizing.get("plinthHeightMm")) or sizing["qualification"] != rules["qualification"]:
        raise GeometryInputError("Invalid plinth sizing or qualification")
    for floor in floors.values():
        if not positive(floor.get("slabThicknessMm")) or floor["slabThicknessMm"] >= floor["heightMm"]:
            raise GeometryInputError("Invalid sized slab thickness")
    for column in building["columns"]:
        if not positive(column["size"]):
            raise GeometryInputError("Invalid sized column")
    for beam in building["beams"]:
        floor = floors[beam["floorId"]]
        if not positive(beam.get("widthMm")) or not positive(beam.get("depthMm")) or \
                beam["depthMm"] <= floor["slabThicknessMm"] or beam["depthMm"] >= floor["heightMm"]:
            raise GeometryInputError("Invalid sized beam")
    ground = min(floors.values(), key=lambda f:f["level"])
    columns = {c["id"]:c for c in building["columns"] if c["floorId"] == ground["id"]}
    pads = sizing["footings"]
    if len(pads) != len(columns) or len({p["columnId"] for p in pads}) != len(columns):
        raise GeometryInputError("Footings do not match the ground grid")
    for pad in pads:
        c, r = columns.get(pad["columnId"]), pad["rect"]
        if not c or not _rect(r) or not positive(pad["thicknessMm"]) or not math.isfinite(pad["bottomMm"]) or \
                pad["bottomMm"]+pad["thicknessMm"] >= -sizing["plinthHeightMm"] or \
                abs(r["x"]+r["w"]/2-c["at"]["x"]) > rules["toleranceMm"] or \
                abs(r["y"]+r["h"]/2-c["at"]["y"]) > rules["toleranceMm"]:
            raise GeometryInputError("Invalid source footing position or dimensions")
    for slab in building["slabs"]:
        if slab["thicknessMm"] != floors[slab["floorId"]]["slabThicknessMm"]:
            raise GeometryInputError("Slab dimensions disagree with shared sizing")


def validate_payload(payload):
    building = payload["buildingModel"]
    massing = payload["massingModel"]
    dna = payload["villaDesignDNA"]
    facade = payload["facadeGrammar"]
    plan_id = building["planId"]
    if building["units"] != "mm" or building["coordinates"] != "plan-x-east-y-south-z-up":
        raise GeometryInputError("Unsupported source coordinate system")
    if any(item["sourcePlanId"] != plan_id for item in (massing, dna, facade)):
        raise GeometryInputError("The four inputs do not describe the same plan")
    if massing["status"] != "valid" or facade["status"] != "valid" or not (massing.get("architectureReport") or {}).get("valid") or massing.get("issues") or facade.get("issues"):
        raise GeometryInputError("Rejected massing or facade cannot be exported")
    if massing["seed"] != dna["seed"] or facade["massingSeed"] != dna["seed"]:
        raise GeometryInputError("Design seeds do not match")
    floors = {floor["id"]: floor for floor in building["floors"]}
    if not floors or len(floors) != len(building["floors"]):
        raise GeometryInputError("Source floors are missing or duplicated")
    if any(not _rect(rect) for floor in floors.values() for rect in floor["footprint"]):
        raise GeometryInputError("Invalid source floor plate")
    validate_concept_sizing(building, floors)
    for floor in floors.values():
        for void in floor.get("doubleHeightVoids", []):
            limits = building.get("doubleHeightLimits", {})
            r = void["rect"]
            host = next((room for room in building["rooms"] if room["semanticId"] == void["sourceRoomId"]
                         and floors[room["floorId"]]["level"] == floor["level"] - 1), None)
            if not limits or not _rect(r) or not host or host["id"] not in ("living", "livingDining"):
                raise GeometryInputError("Invalid double-height source room or limits")
            h = host["rect"]
            if min(r["w"], r["h"]) < limits["minimumMm"] or max(r["w"], r["h"]) > limits["maximumSpanMm"] or \
                    r["x"] < h["x"] or r["y"] < h["y"] or r["x"] + r["w"] > h["x"] + h["w"] or r["y"] + r["h"] > h["y"] + h["h"]:
                raise GeometryInputError("Double-height cut crosses its living room or span limits")
            def overlaps_void(p):
                return min(r["x"] + r["w"], p["x"] + p["w"]) > max(r["x"], p["x"]) and \
                    min(r["y"] + r["h"], p["y"] + p["h"]) > max(r["y"], p["y"])
            if any(overlaps_void(p) for p in floor["footprint"]):
                raise GeometryInputError("Double-height cut contains a slab")
            guards = [w for w in building["walls"] if w["floorId"] == floor["id"] and w["kind"] == "parapet"
                      and void["roomId"] in w.get("rooms", [])]
            if not guards or any(w.get("heightMm", 0) < limits["guardHeightMm"] for w in guards):
                raise GeometryInputError("Double-height gallery lacks its guard")
    from geometry.site import validate_site_features
    validate_site_features(building)
    bounds = building["plot"]["buildable"]
    if not _rect(bounds):
        raise GeometryInputError("Invalid setback envelope")
    for mass in massing["masses"]:
        rect = mass_rect(mass)
        if not _rect(rect) or mass["height"] <= 0 or mass["sourceFloorId"] not in floors:
            raise GeometryInputError(f"Invalid mass {mass.get('id')}")
        if rect["x"] < bounds["x"] - 2 or rect["y"] < bounds["y"] - 2 or rect["x"] + rect["w"] > bounds["x"] + bounds["w"] + 2 or rect["y"] + rect["h"] > bounds["y"] + bounds["h"] + 2:
            raise GeometryInputError(f"Mass {mass.get('id')} crosses a setback")
    from terrace_validation import validate_terrace
    validate_terrace(payload)
    hosts = opening_hosts(building)
    openings = [*building["doors"], *building["windows"]]
    for opening in openings:
        opening_vertical_span(opening, floors[opening["floorId"]])
    for index, first in enumerate(openings):
        for second in openings[index + 1:]:
            if hosts[first["id"]] != hosts[second["id"]]:
                continue
            axis = "x" if first["orient"] == "h" else "y"
            gap = abs(first["at"][axis] - second["at"][axis]) - (first["width"] + second["width"]) / 2
            if gap < -2:
                raise GeometryInputError(f"Openings {first['id']} and {second['id']} overlap")
    zone_ids = {zone["id"] for zone in facade["zones"]}
    for feature in facade["features"]:
        if not feature["parts"] or not set(feature["zoneIds"]).issubset(zone_ids):
            raise GeometryInputError(f"Facade feature {feature['id']} lacks a real host")
        for part in feature["parts"]:
            if part["zoneId"] not in zone_ids or not _rect(part["world"]) or part["world"]["height"] <= 0:
                raise GeometryInputError(f"Invalid facade part {part['id']}")
    from specialized_validation import validate_specialized
    from element_validation import validate_elements
    from covered_validation import validate_covered_outdoor
    validate_elements(payload)
    validate_specialized(payload, hosts)
    validate_covered_outdoor(payload)
    return hosts
