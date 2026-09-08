# Dataset schema

## `metadata/designs.json` — the master record

```jsonc
{
  "generated": "2026-09-08",
  "count": 650,
  "byKind":  { "synthetic": 650, "harvested": 0, "user_provided": 0 },
  "byStyle": { "modern_indian": 98, ... },
  "designs": [ ReferenceDesign, ... ]
}
```

### `ReferenceDesign`

```jsonc
{
  "id": "modern_indian_0042",              // <style|bucket>_<n> or <bucket>_<filehash>
  "kind": "synthetic",                      // synthetic | harvested | user_provided
  "style": "modern_indian",                 // one of the 8 styles, or "international"
  "internationalTag": null,                 // §13 — set only for images/international/*

  "source": {                               // §2 — licence record, always present
    "url": "https://...",
    "domain": "commons.wikimedia.org",
    "license": "CC-BY-SA",
    "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
    "creator": "Jane Doe",
    "attributionRequired": true,
    "commercialUseAllowed": true,
    "modificationAllowed": true,
    "dateCollected": "2026-09-08",
    "licenseStatus": "verified_permissive"  // verified_open | verified_permissive
  },                                        //   | user_provided | synthetic | unknown

  "requirements": {                         // synthetic only — the plot it was resolved for
    "plotWidthMm": 12192, "plotDepthMm": 18288,
    "floors": 2, "bedrooms": 4, "bathrooms": 3, "parking": 2
  },

  "dna": { ReferenceDNA },                  // §3 — the extracted / resolved architecture
  "genome": { DesignGenome },               // synthetic only — the full seeded decision set
  "fingerprint": { ArchitecturalFingerprint },
  "perceptualHash": "b3c1...",              // real images only (dHash, 64-bit hex)

  "imagePath": "modern_indian/ab12cd34.jpg", // relative to images/, or null for synthetic
  "analysis_source": "vision",              // vision | heuristic | none   (real images)
  "needs_vision": false,                    // true when only the heuristic ran
  "vocab_warnings": []                      // terms the analyser produced that were dropped
}
```

### `ReferenceDNA` (§3) — every value is a vocabulary term

| field | vocabulary field | notes |
|---|---|---|
| `style` | `style` | 8 styles + `international` |
| `internationalTag` | `internationalTag` | japanese_modern … european_minimalist \| null |
| `floors` | — | integer 1–4 |
| `planFigure` | `planFigure` | rectangular · square · l_shape · t_shape · u_shape · h_shape · courtyard · linear · pavilion · split |
| `massingComposition` | `massingComposition` | 13 terms — the primary 3D move |
| `volumeCount` | — | integer 1–4 |
| `compositionBalance` | `compositionBalance` | symmetric · near_symmetric · asymmetric · dynamic_asymmetric |
| `upperFloorStrategy` | `upperFloorStrategy` | full_upper · partial_upper · *_setback · partial_cantilever · terrace_cutout · stacked_plumb … |
| `voidStrategy` | `voidStrategy` | none · double_height_entrance · double_height_living · vertical_void · central_atrium · stair_void |
| `roof` | `roofType` | flat_slab · floating_slab · roof_terrace · hip · kerala_tiled_hip · mono_slope · butterfly … (12) |
| `overhang` | `overhangDepth` | none · shallow · medium · deep · very_deep |
| `entrance` | `entranceType` | centered · offset · recessed · projecting · double_height · porch · framed · porte_cochere … |
| `doubleHeightEntrance` | — | boolean |
| `balcony` | `balconyType` | none · cantilever · recessed · corner · corner_cantilever · full_width · juliet · terrace_balcony · continuous · wrap_verandah … |
| `balconyPosition` | `balconyPosition` | upper_front · upper_front_corner · upper_side · wrap · court_facing |
| `facadeComposition` | `facadeComposition` | flat_plane · solid_void · layered_solid_void · framed · stacked_bands · stone_volume · glass_box · mixed_material |
| `screen` | `screenElement` | none · vertical_fins · horizontal_fins · jaali · perforated_screen · louvers · wood_screen · pergola_screen |
| `materialPalette` | `materialPalette` | white_minimal · white_stone · stone_white_wood · plaster_stone_base · concrete_wood · laterite_white · travertine_granite · brick_white · earth_timber |
| `materials` | `facadeMaterial[]` | the individual materials seen |
| `glazing` | `glazingRatio` | minimal · modest · controlled_large · expansive · full_glass |
| `windowStrategy` | `windowStrategy` | punched · horizontal_ribbon · vertical_slit · floor_to_ceiling · corner_glazing · recessed · screened · clerestory · controlled_panoramic |
| `cornerGlazing` | — | boolean |
| `courtyard` | `courtyardType` | none · central · side · rear · entrance_courtyard · pool_courtyard · garden_courtyard · double_height_courtyard |
| `cantilever` | — | boolean |
| `characteristics` | `characteristic[]` | descriptive tags — deep_shadows, cantilever, layered_facade, courtyard_focused … |

### `ArchitecturalFingerprint` (§9) — the dedup / similarity key

```jsonc
{
  "massing":   "offset_volumes_l_shape",         // ${massingComposition}_${planFigure}
  "floors":    "2f_partial_cantilever",          // ${floors}f_${upperFloorStrategy}
  "roof":      "floating_slab",
  "entrance":  "recessed_dh",                    // ${entrance}_(dh|sh)
  "balcony":   "corner_cantilever_upper_front_corner",
  "facade":    "layered_solid_void_vertical_fins_stone_white_wood",
  "courtyard": "side",
  "hash":      "1e777de026b9"                    // FNV-1a of the six axes, 12 hex chars
}
```

Identical to `src/architecture/library/fingerprint.ts` — Python and TS agree.
`fingerprintSimilarity(a,b)` weights massing 0.30, floors/roof 0.16 each,
balcony/facade 0.12, entrance 0.10, courtyard 0.04. `>= 0.86` ⇒ "same design".

## `metadata/vocabulary.json` / `compatibility.json` / `styles.json`

Serialised straight from `src/architecture/library/` by
`scripts/sync-vocabulary.mts`. Do not hand-edit — edit the TS and re-sync.
