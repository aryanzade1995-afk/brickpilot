"""Validated visualization settings. This module imports no Blender API."""

from copy import deepcopy
from pathlib import Path
import math
from .palettes import resolve_palette

CAMERAS = ("FrontCamera", "HeroPerspectiveCamera", "SideCamera", "AerialCamera")
PRESETS = {
    "preview": {"engine": "EEVEE", "samples": 32, "resolution": [1200, 900]},
    "final": {"engine": "CYCLES", "samples": 128, "resolution": [1800, 1350]},
}
DEFAULTS = {
    "schemaVersion": 1, "palette": None,
    "composition": {"primary": .65, "secondary": .25, "accent": .10},
    "render": {"quality": "preview", "camera": "HeroPerspectiveCamera", "renderAll": False},
    "surfaces": {"stoneCladding": True, "woodSlats": True, "flutedPanels": True,
                 "stoneTileWidthMm": 600, "stoneTileHeightMm": 300, "jointMm": 4,
                 "slatPitchMm": 65, "fluteDepthMm": 12},
    "landscape": {"enabled": True, "balcony": True, "entry": True, "side": True, "terrace": True,
                  "maxPlanters": 14, "leavesPerPlant": 36, "clearanceMm": 1000},
    "lighting": {"preset": "DAY", "hdriPath": None, "hdriRotationDeg": 0,
                 "fixtures": True, "interiorEmission": True},
}


def _number(value, lo, hi, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not lo <= value <= hi:
        raise ValueError(f"{name} must be between {lo} and {hi}")


def visualization_options(payload, overrides=None):
    options = deepcopy(DEFAULTS)
    for supplied in (payload.get("visualization", {}), overrides or {}):
        if not isinstance(supplied, dict) or set(supplied) - set(DEFAULTS):
            raise ValueError("Unknown visualization settings")
        for key, value in supplied.items():
            if isinstance(options[key], dict):
                allowed = set(DEFAULTS[key]) | ({"engine", "samples", "resolution"} if key == "render" else set()) | (
                    {"sunElevationDeg", "sunAzimuthDeg", "skyStrength", "sunStrength"} if key == "lighting" else set())
                if not isinstance(value, dict) or set(value) - allowed:
                    raise ValueError(f"Unknown {key} settings")
                options[key].update(value)
            else:
                options[key] = value
    if options["schemaVersion"] != 1:
        raise ValueError("Unsupported visualization schema")
    options["palette"] = resolve_palette(options["palette"] or payload["villaDesignDNA"]["materialPalette"])
    composition = options["composition"]
    for key, limits in {"primary": (.55, .75), "secondary": (.15, .30), "accent": (.05, .15)}.items():
        _number(composition[key], *limits, key)
    if abs(sum(composition.values()) - 1) > 1e-6:
        raise ValueError("Finish composition must sum to one")
    render = options["render"]
    if render["quality"] not in PRESETS:
        raise ValueError("Render quality must be preview or final")
    options["render"] = render = {**PRESETS[render["quality"]], **render}
    if render["engine"] not in ("EEVEE", "CYCLES") or render["camera"] not in CAMERAS:
        raise ValueError("Unknown render engine or camera")
    _number(render["samples"], 1, 4096, "samples")
    if not isinstance(render["samples"], int) or not isinstance(render["renderAll"], bool):
        raise ValueError("Samples must be an integer and renderAll a boolean")
    if not isinstance(render["resolution"], (list, tuple)) or len(render["resolution"]) != 2:
        raise ValueError("Resolution must be [width, height]")
    for dimension in render["resolution"]:
        _number(dimension, 128, 8192, "resolution")
        if not isinstance(dimension, int):
            raise ValueError("Resolution dimensions must be integers")
    surface = options["surfaces"]
    for key in ("stoneCladding", "woodSlats", "flutedPanels"):
        if not isinstance(surface[key], bool):
            raise ValueError(f"{key} must be a boolean")
    for key, bounds in {"stoneTileWidthMm": (150, 1500), "stoneTileHeightMm": (100, 1000), "jointMm": (1, 10),
                        "slatPitchMm": (35, 150), "fluteDepthMm": (4, 25)}.items():
        _number(surface[key], *bounds, key)
    landscape = options["landscape"]
    for key in ("enabled", "balcony", "entry", "side", "terrace"):
        if not isinstance(landscape[key], bool):
            raise ValueError(f"{key} must be a boolean")
    for key, lo, hi in (("maxPlanters", 0, 32), ("leavesPerPlant", 8, 96), ("clearanceMm", 800, 1800)):
        _number(landscape[key], lo, hi, key)
        if not isinstance(landscape[key], int):
            raise ValueError(f"{key} must be an integer")
    light = options["lighting"]
    if light["preset"] not in ("DAY", "DUSK"):
        raise ValueError("Lighting preset must be DAY or DUSK")
    if any(not isinstance(light[k], bool) for k in ("fixtures", "interiorEmission")):
        raise ValueError("Light toggles must be boolean")
    dusk = light["preset"] == "DUSK"
    light.setdefault("sunElevationDeg", 8 if dusk else 38)
    light.setdefault("sunAzimuthDeg", 120)
    light.setdefault("skyStrength", .12 if dusk else .35)
    light.setdefault("sunStrength", .45 if dusk else 3)
    for key, lo, hi in (("sunElevationDeg", 2, 85), ("sunAzimuthDeg", -360, 360),
                        ("skyStrength", .01, 5), ("sunStrength", .01, 10), ("hdriRotationDeg", -360, 360)):
        _number(light[key], lo, hi, key)
    if light["hdriPath"] is not None and not isinstance(light["hdriPath"], str):
        raise ValueError("HDRI path must be a local path string or null")
    if light["hdriPath"]:
        path = Path(light["hdriPath"]).expanduser().resolve()
        if not path.is_file() or path.suffix.lower() not in (".hdr", ".exr"):
            raise ValueError("HDRI must be an existing local .hdr or .exr file")
        light["hdriPath"] = str(path)
    return options
