"""Exact rectangle subtraction for source slab and stair/shaft voids."""


def subtract_rectangles(rect, cutters):
    pieces = [dict(rect)]
    for cut in cutters:
        next_pieces = []
        for piece in pieces:
            x0, y0 = max(piece["x"], cut["x"]), max(piece["y"], cut["y"])
            x1 = min(piece["x"] + piece["w"], cut["x"] + cut["w"])
            y1 = min(piece["y"] + piece["h"], cut["y"] + cut["h"])
            if x1 <= x0 or y1 <= y0:
                next_pieces.append(piece)
                continue
            # Four disjoint bands cover the plate outside the intersection.
            bands = [
                (piece["x"], piece["y"], x0 - piece["x"], piece["h"]),
                (x1, piece["y"], piece["x"] + piece["w"] - x1, piece["h"]),
                (x0, piece["y"], x1 - x0, y0 - piece["y"]),
                (x0, y1, x1 - x0, piece["y"] + piece["h"] - y1),
            ]
            next_pieces.extend({"x": x, "y": y, "w": w, "h": h}
                               for x, y, w, h in bands if w > 0.01 and h > 0.01)
        pieces = next_pieces
    return pieces


def create_plate(scene, name, collection, rect, bottom, thickness, source_id, voids=()):
    objects = []
    for index, piece in enumerate(subtract_rectangles(rect, voids), 1):
        objects.append(scene.rect(name if index == 1 else f"{name}_Part_{index:02d}",
                                  collection, piece, bottom, thickness, source_id=source_id))
    return objects


def roof_plate_regions(floor, exterior_walls=()):
    """Centre-line plan plates plus the actual exterior wall bearing width.

    Union by subtraction, never a bounding rectangle over a courtyard/wing gap.
    Callers still subtract their stair, courtyard and shaft openings.
    """
    regions = []
    for rect in floor["footprint"]:
        regions.extend(subtract_rectangles(rect, regions))
    for wall in exterior_walls:
        a, b, t = wall["a"], wall["b"], wall["thickness"]
        horizontal = abs(a["y"] - b["y"]) <= 2
        strip = ({"x": min(a["x"], b["x"]), "y": a["y"] - t / 2,
                  "w": abs(b["x"] - a["x"]), "h": t} if horizontal else
                 {"x": a["x"] - t / 2, "y": min(a["y"], b["y"]),
                  "w": t, "h": abs(b["y"] - a["y"])})
        regions.extend(subtract_rectangles(strip, regions))
    return regions
