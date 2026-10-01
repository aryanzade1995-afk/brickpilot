"""Compatibility adapter from existing DNA finishes to curated PBR palettes."""

from visualization.palettes import PALETTES, palette_specs, color_rgba, ALIASES


def material_colors(palette):
    result = {key: color_rgba(spec["color"]) for key, spec in palette_specs(palette).items()}
    result.update({alias: result[role] for alias, role in ALIASES.items()})
    result["landscape"] = color_rgba("#607553")
    return result
