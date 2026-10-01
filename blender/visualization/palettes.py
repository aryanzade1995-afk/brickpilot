"""Curated finishes. Color values are sRGB; shader inputs are converted to linear."""

from copy import deepcopy


def finish(color, surface, roughness, metallic=0, **extra):
    return {"color": color, "surface": surface, "roughness": roughness, "metallic": metallic, **extra}


def palette(primary, secondary, accent, stone, wood, metal="#34383A", door=None):
    return {
        "primary_wall": finish(primary, "plaster", .78),
        "secondary_wall": finish(secondary, "concrete", .67),
        "accent": finish(accent, "stone", .58),
        "stone": finish(stone, "stone", .62),
        "wood": finish(wood, "wood", .46),
        "metal": finish(metal, "metal", .29, .92),
        "glass": finish("#E8F1ED", "glass", .055, transmission=1, ior=1.45),
        "door": finish(door or wood, "wood", .38),
        "railing": finish(metal, "metal", .32, .92),
    }


PALETTES = {
    "WHITE_STONE_WOOD": palette("#EBE9E2", "#CDC9BD", "#A99D86", "#C7BCA5", "#795439"),
    "WARM_BEIGE_TIMBER": palette("#DED3C1", "#C5B9A6", "#99856B", "#C3B397", "#755039"),
    "GREY_CONCRETE_GLASS": palette("#C9CBC8", "#959B99", "#656F72", "#A3A6A0", "#806752"),
    "WHITE_FLUTED_STONE": palette("#EEECE4", "#D5D0C3", "#B5AC99", "#D7CEB9", "#8C6748"),
    "CHARCOAL_WOOD_WHITE": palette("#E4E3DD", "#565A59", "#303938", "#898C83", "#866043"),
    "SANDSTONE_PLASTER": palette("#E3D8C4", "#C7B18B", "#AD895B", "#C4A475", "#795139", "#575049"),
    "CONCRETE_TIMBER_GREEN": palette("#D3D3C9", "#A4AAA1", "#5C7061", "#B9B9A7", "#876343"),
}
LEGACY_PALETTES = {
    "warm-stone": "WHITE_STONE_WOOD", "lime-plaster": "WHITE_FLUTED_STONE",
    "earth": "SANDSTONE_PLASTER", "travertine-bronze": "WARM_BEIGE_TIMBER",
    "charcoal-oak": "CHARCOAL_WOOD_WHITE", "kerala-laterite": "SANDSTONE_PLASTER",
    "tropical-cream": "CONCRETE_TIMBER_GREEN", "classical-stone": "WHITE_FLUTED_STONE",
}
ALIASES = {"wall": "primary_wall", "timber": "wood", "concrete": "secondary_wall"}


def resolve_palette(name):
    resolved = LEGACY_PALETTES.get(name, name)
    if resolved not in PALETTES:
        raise ValueError(f"Unknown curated material palette: {name}")
    return resolved


def palette_specs(name):
    return deepcopy(PALETTES[resolve_palette(name)])


def srgb_linear(value):
    return value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4


def color_rgba(hex_color):
    return tuple(srgb_linear(int(hex_color[i:i + 2], 16) / 255) for i in (1, 3, 5)) + (1,)
