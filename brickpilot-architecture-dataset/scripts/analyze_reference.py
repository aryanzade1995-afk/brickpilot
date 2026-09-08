#!/usr/bin/env python3
"""
analyze_reference — §8 IMAGE ANALYSIS PIPELINE.

Take an architectural reference image and extract structured DNA:
style, massing, floors, volume count, roof, balcony, entrance, window
strategy, glazing ratio, facade composition, materials, courtyard,
symmetry, solid/void, cantilever, setbacks, characteristics.

    python analyze_reference.py IMAGE [--style-hint modern_indian] [--json OUT]

Vision:
  * If GEMINI_API_KEY is set, an AI vision model performs the initial
    architectural classification (structured JSON per the schema).
  * Otherwise a heuristic pre-fill runs (aspect / brightness / edge
    density / colour) and the entry is flagged needs_vision=true.

Every field is then NORMALISED against metadata/vocabulary.json, so the
output only ever contains canonical vocabulary terms.

Deps: Pillow, numpy (present). Optional: google-genai OR just requests.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
META = os.path.normpath(os.path.join(HERE, "..", "metadata"))

# ---- the schema the vision model must return -----------------------
SCHEMA_FIELDS = {
    "style": "one of the 8 BrickPilot styles or 'international'",
    "internationalTag": "japanese_modern|mediterranean_contemporary|tropical_modern|southeast_asian_modern|australian_contemporary|brazilian_modern|european_minimalist|null",
    "floors": "integer 1-4",
    "planFigure": "rectangular|square|l_shape|t_shape|u_shape|h_shape|courtyard|linear|pavilion|split",
    "massingComposition": "single_volume|stacked_volumes|offset_volumes|split_volumes|stepped_volumes|interlocking_volumes|cantilevered_volumes|floating_upper_volume|central_core|side_wing|courtyard_ring|pavilion_cluster|linear_bar",
    "volumeCount": "integer 1-4",
    "compositionBalance": "symmetric|near_symmetric|asymmetric|dynamic_asymmetric",
    "upperFloorStrategy": "full_upper|partial_upper|front_setback|rear_setback|side_setback|asymmetric_setback|split_upper|partial_cantilever|full_cantilever|terrace_cutout|stacked_plumb",
    "roof": "flat_slab|floating_slab|parapet_roof|roof_terrace|deep_overhang_flat|butterfly|gable|hip|mono_slope|kerala_tiled_hip|contemporary_sloped|mixed_roof",
    "overhang": "none|shallow|medium|deep|very_deep",
    "entrance": "centered|offset|recessed|projecting|double_height|porch|covered_courtyard_entry|side_entry|framed|porte_cochere",
    "doubleHeightEntrance": "boolean",
    "balcony": "none|cantilever|recessed|corner|corner_cantilever|full_width|partial_width|juliet|terrace_balcony|planted_balcony|continuous|wrap_verandah",
    "balconyPosition": "upper_front|upper_front_corner|upper_rear|upper_side|wrap|court_facing",
    "facadeComposition": "flat_plane|solid_void|layered_solid_void|framed|stacked_bands|stone_volume|glass_box|mixed_material",
    "screen": "none|vertical_fins|horizontal_fins|jaali|perforated_screen|louvers|wood_screen|pergola_screen",
    "materialPalette": "white_minimal|white_stone|stone_white_wood|plaster_stone_base|concrete_wood|laterite_white|travertine_granite|brick_white|earth_timber",
    "materials": "array of facade materials seen",
    "glazing": "minimal|modest|controlled_large|expansive|full_glass",
    "windowStrategy": "punched|horizontal_ribbon|vertical_slit|floor_to_ceiling|corner_glazing|recessed|screened|clerestory|controlled_panoramic",
    "cornerGlazing": "boolean",
    "courtyard": "none|central|side|rear|entrance_courtyard|pool_courtyard|garden_courtyard|double_height_courtyard",
    "cantilever": "boolean",
    "characteristics": "array from the characteristics vocabulary",
}

VISION_PROMPT = (
    "You are an architectural analyst. Look at this photo of a house / villa exterior and "
    "return ONLY a JSON object describing its architectural DNA. Use exactly these fields and "
    "pick values from the allowed sets (no prose, no extra keys):\n\n"
    + "\n".join(f"  {k}: {v}" for k, v in SCHEMA_FIELDS.items())
    + "\n\nJudge massing and volume relationships, roof form, how the upper floor sits on the "
    "ground floor, the entrance treatment, balconies, the facade composition and screening, the "
    "glazing amount, any courtyard, and the overall symmetry / solid-void character. If a feature "
    "is not visible, use the most neutral allowed value. Return the JSON object only."
)


def load_vocab() -> dict:
    p = os.path.join(META, "vocabulary.json")
    if not os.path.exists(p):
        print("! metadata/vocabulary.json missing - run: npx tsx scripts/sync-vocabulary.mts", file=sys.stderr)
        return {"fields": {}, "aliases": {}}
    with open(p, encoding="utf-8") as fh:
        return json.load(fh)


def normalise(raw: dict, vocab: dict) -> tuple[dict, list[str]]:
    fields = vocab.get("fields", {})
    aliases = vocab.get("aliases", {})
    out: dict = {}
    warnings: list[str] = []

    def norm_one(field: str, value):
        allowed = fields.get(field)
        if allowed is None:
            return value
        if isinstance(value, bool) or value is None:
            return value
        v = str(value).strip().lower().replace(" ", "_").replace("-", "_")
        if v in allowed:
            return v
        alias = (aliases.get(field) or {}).get(v)
        if alias and alias in allowed:
            return alias
        warnings.append(f"{field}={value!r} not in vocabulary")
        return None

    field_map = {
        "planFigure": "planFigure", "massingComposition": "massingComposition",
        "compositionBalance": "compositionBalance", "upperFloorStrategy": "upperFloorStrategy",
        "roof": "roofType", "overhang": "overhangDepth", "entrance": "entranceType",
        "balcony": "balconyType", "balconyPosition": "balconyPosition",
        "facadeComposition": "facadeComposition", "screen": "screenElement",
        "materialPalette": "materialPalette", "glazing": "glazingRatio",
        "windowStrategy": "windowStrategy", "courtyard": "courtyardType",
        "style": "style", "internationalTag": "internationalTag",
    }
    for key, val in raw.items():
        if key in field_map:
            out[key] = norm_one(field_map[key], val)
        elif key == "materials" and isinstance(val, list):
            out[key] = [norm_one("facadeMaterial", m) for m in val]
            out[key] = [m for m in out[key] if m]
        elif key == "characteristics" and isinstance(val, list):
            out[key] = [norm_one("characteristic", c) for c in val]
            out[key] = [c for c in out[key] if c]
        else:
            out[key] = val
    return out, warnings


# ---- heuristic fallback ------------------------------------------
def heuristic(path: str, style_hint: str | None) -> dict:
    try:
        from PIL import Image  # type: ignore
        import numpy as np  # type: ignore
    except Exception:
        return {"style": style_hint or "modern_indian", "floors": 2, "needs_vision": True}

    im = Image.open(path).convert("RGB")
    w, h = im.size
    arr = np.asarray(im.resize((160, 160))).astype("float32")
    gray = arr.mean(axis=2)
    brightness = float(gray.mean() / 255)
    # edge density (Sobel-ish) -> proxy for facade busyness
    gx = np.abs(np.diff(gray, axis=1)).mean()
    gy = np.abs(np.diff(gray, axis=0)).mean()
    edge = float((gx + gy) / 2)
    # vertical symmetry
    left, right = gray[:, :80], gray[:, 80:][:, ::-1]
    symmetry = 1.0 - float(np.abs(left - right).mean() / 255)
    warm = float((arr[..., 0].mean() - arr[..., 2].mean()) / 255)

    return {
        "style": style_hint or ("modern_kerala" if warm > 0.06 else "modern_indian"),
        "floors": 2 if h / max(w, 1) > 0.7 else 1,
        "compositionBalance": "symmetric" if symmetry > 0.82 else "near_symmetric" if symmetry > 0.7 else "asymmetric",
        "roof": "kerala_tiled_hip" if warm > 0.08 else "flat_slab",
        "facadeComposition": "layered_solid_void" if edge > 14 else "solid_void" if edge > 9 else "flat_plane",
        "glazing": "expansive" if brightness > 0.62 else "controlled_large" if brightness > 0.5 else "modest",
        "materialPalette": "white_minimal" if brightness > 0.68 and warm < 0.03 else "earth_timber" if warm > 0.08 else "white_stone",
        "screen": "vertical_fins" if edge > 16 else "none",
        "characteristics": (["strong_horizontal_lines"] if w > h else []) + (["deep_shadows"] if edge > 15 else []),
        "needs_vision": True,
        "_heuristic": {"brightness": round(brightness, 3), "edge": round(edge, 2), "symmetry": round(symmetry, 3), "warm": round(warm, 3)},
    }


# ---- vision -----------------------------------------------------
def run_vision(path: str) -> dict | None:
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        return None
    with open(path, "rb") as fh:
        img_b64 = base64.b64encode(fh.read()).decode()
    mime = "image/png" if path.lower().endswith(".png") else "image/jpeg"

    # try the google-genai SDK, else the REST API via requests / urllib
    try:
        from google import genai  # type: ignore
        from google.genai import types  # type: ignore

        client = genai.Client(api_key=key)
        resp = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[VISION_PROMPT, types.Part.from_bytes(data=base64.b64decode(img_b64), mime_type=mime)],
        )
        return _extract_json(resp.text)
    except Exception:
        pass

    try:
        import requests  # type: ignore

        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={key}"
        body = {
            "contents": [{"parts": [{"text": VISION_PROMPT}, {"inline_data": {"mime_type": mime, "data": img_b64}}]}]
        }
        r = requests.post(url, json=body, timeout=60)
        r.raise_for_status()
        text = r.json()["candidates"][0]["content"]["parts"][0]["text"]
        return _extract_json(text)
    except Exception as e:  # noqa: BLE001
        print(f"! vision call failed: {e}", file=sys.stderr)
        return None


def _extract_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1]
        if text.startswith("json"):
            text = text[4:]
    start, end = text.find("{"), text.rfind("}")
    return json.loads(text[start : end + 1])


def analyze(path: str, style_hint: str | None) -> dict:
    vocab = load_vocab()
    raw = run_vision(path)
    source = "vision"
    if raw is None:
        raw = heuristic(path, style_hint)
        source = "heuristic"
    if style_hint and not raw.get("style"):
        raw["style"] = style_hint

    dna, warnings = normalise(raw, vocab)
    dna.setdefault("characteristics", [])
    return {
        "image": os.path.basename(path),
        "analyzed": date.today().isoformat(),
        "analysis_source": source,
        "needs_vision": source == "heuristic",
        "dna": dna,
        "vocab_warnings": warnings,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--style-hint", default=None)
    ap.add_argument("--json", default=None, help="write result here instead of stdout")
    args = ap.parse_args()

    if not os.path.exists(args.image):
        sys.exit(f"no such image: {args.image}")
    result = analyze(args.image, args.style_hint)
    text = json.dumps(result, indent=2)
    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
        print(f"wrote {args.json}  (source={result['analysis_source']})")
    else:
        print(text)


if __name__ == "__main__":
    main()
