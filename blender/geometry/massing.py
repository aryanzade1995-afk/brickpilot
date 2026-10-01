"""World footprint of the MassingModel's orthogonally rotated blocks."""


def mass_rect(mass):
    rotation = mass.get("rotation", 0)
    if rotation not in (0, 90, 180, 270):
        raise ValueError(f"{mass.get('id')} has a non-orthogonal rotation")
    width, depth = (mass["depth"], mass["width"]) if rotation in (90, 270) else (mass["width"], mass["depth"])
    return {"x": mass["x"] + (mass["width"] - width) / 2,
            "y": mass["y"] + (mass["depth"] - depth) / 2, "w": width, "h": depth}
