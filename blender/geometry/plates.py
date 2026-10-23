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
                                  collection, piece, bottom, thickness, source_id=source_id, bevel=0))
    return objects


def union_plate_mesh(rects, bottom, thickness, voids=()):
    """One watertight, level plate in mm, with real union/void boundaries.

    Shared grid vertices join adjacent rectangles. Only exposed cells receive
    side faces: internal partitions never become grooves, bevels or raised ribs.
    Disconnected wings and courtyard/stair/shaft holes remain disconnected/empty.
    """
    if thickness <= 0:
        raise ValueError("Plate thickness must be positive")
    pieces = []
    for rect in rects:
        pieces.extend(subtract_rectangles(rect, [*voids, *pieces]))
    if not pieces:
        return [], []
    xs = sorted({round(v, 6) for r in pieces for v in (r["x"], r["x"] + r["w"])})
    ys = sorted({round(v, 6) for r in pieces for v in (r["y"], r["y"] + r["h"])})
    cells = {(i, j) for i in range(len(xs) - 1) for j in range(len(ys) - 1)
             if any(r["x"] < (xs[i]+xs[i+1])/2 < r["x"]+r["w"] and
                    r["y"] < (ys[j]+ys[j+1])/2 < r["y"]+r["h"] for r in pieces)}
    vertices, faces, indices = [], [], {}

    def vertex(i, j, top):
        key = (i, j, top)
        if key not in indices:
            indices[key] = len(vertices)
            vertices.append((xs[i], ys[j], bottom + (thickness if top else 0)))
        return indices[key]

    for i, j in sorted(cells):
        lower = [vertex(i, j, False), vertex(i+1, j, False), vertex(i+1, j+1, False), vertex(i, j+1, False)]
        upper = [vertex(i, j, True), vertex(i+1, j, True), vertex(i+1, j+1, True), vertex(i, j+1, True)]
        faces.extend([tuple(reversed(lower)), tuple(upper)])
        for a, b, neighbour in ((0, 1, (i, j-1)), (1, 2, (i+1, j)), (2, 3, (i, j+1)), (3, 0, (i-1, j))):
            if neighbour not in cells:
                faces.append((lower[a], lower[b], upper[b], upper[a]))
    return vertices, faces


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
