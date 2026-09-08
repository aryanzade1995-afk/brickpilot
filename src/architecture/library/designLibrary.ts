/* ------------------------------------------------------------------ *
 *  designLibrary — the reference-design schema + the in-repo seed set.
 *
 *  §3: "the images are NOT the data" — a ReferenceDesign is the
 *  STRUCTURED DNA extracted from a reference, plus its licence record
 *  and fingerprint. The full 500+ corpus lives in
 *  `brickpilot-architecture-dataset/`; this file carries a small
 *  hand-authored seed set (built from the written brief in §1/§4) so
 *  the runtime generator has real references to bias toward even
 *  before the dataset is collected.
 *
 *  §15: the library INFLUENCES the generator — `referenceHints()`
 *  returns extra weighted picks merged onto the style pattern.
 *  §16: it never overrides the user's plot / rooms / floors.
 * ------------------------------------------------------------------ */

import type { ArchitecturalFingerprint, DesignGenome, StyleId } from '../types.ts'
import type { InternationalTag } from './architecturalVocabulary.ts'
import { architecturalFingerprint } from './fingerprint.ts'
import { planShapeToFigure } from './designGenome.ts'
import type { Weighted } from './stylePatterns.ts'

/* ---- licence record (§2) --------------------------------------- */

export type LicenseStatus = 'verified_open' | 'verified_permissive' | 'user_provided' | 'synthetic' | 'unknown'

export type ReferenceSource = {
  url: string
  domain: string
  license: string
  licenseUrl: string
  creator: string
  attributionRequired: boolean
  commercialUseAllowed: boolean
  modificationAllowed: boolean
  dateCollected: string
  licenseStatus: LicenseStatus
}

/** synthetic / seed sources carry no external URL */
export function internalSource(kind: 'synthetic' | 'seed'): ReferenceSource {
  return {
    url: '',
    domain: 'brickpilot',
    license: kind === 'synthetic' ? 'CC0-1.0 (BrickPilot synthetic)' : 'BrickPilot seed (spec-derived)',
    licenseUrl: '',
    creator: 'BrickPilot',
    attributionRequired: false,
    commercialUseAllowed: true,
    modificationAllowed: true,
    dateCollected: '2026-09-08',
    licenseStatus: 'synthetic',
  }
}

/* ---- extracted DNA (§3) --------------------------------------- *
 *  a compact projection onto the genome's decision fields — every
 *  value is a vocabulary term. Optional fields = "not legible in the
 *  reference".                                                     */

export type ReferenceDNA = Partial<
  Pick<
    DesignGenome,
    | 'planFigure'
    | 'massingComposition'
    | 'volumeCount'
    | 'compositionBalance'
    | 'upperFloorStrategy'
    | 'voidStrategy'
    | 'roof'
    | 'overhang'
    | 'entrance'
    | 'doubleHeightEntrance'
    | 'balcony'
    | 'balconyPosition'
    | 'facadeComposition'
    | 'screen'
    | 'materialPalette'
    | 'glazing'
    | 'windowStrategy'
    | 'courtyard'
    | 'parking'
    | 'landscape'
  >
> & { characteristics: string[] }

export type ReferenceDesign = {
  id: string
  style: StyleId
  /** international composition tag, if this is a non-Indian reference (§13) */
  international?: InternationalTag
  source: ReferenceSource
  dna: ReferenceDNA
  /** relative path under brickpilot-architecture-dataset/images/, if an image exists */
  imagePath?: string
}

/* ================================================================== *
 *  SEED REFERENCES — spec-derived, one or two per style, capturing
 *  the "architectural DNA" the brief describes. Extend via the dataset.
 * ================================================================== */

const R = (r: ReferenceDesign): ReferenceDesign => r

export const SEED_REFERENCES: ReferenceDesign[] = [
  R({
    id: 'seed_modern_indian_offset_cantilever',
    style: 'modern_indian',
    source: internalSource('seed'),
    dna: {
      planFigure: 'l_shape',
      massingComposition: 'offset_volumes',
      volumeCount: 3,
      compositionBalance: 'asymmetric',
      upperFloorStrategy: 'partial_cantilever',
      voidStrategy: 'double_height_entrance',
      roof: 'floating_slab',
      overhang: 'deep',
      entrance: 'recessed',
      doubleHeightEntrance: true,
      balcony: 'corner_cantilever',
      balconyPosition: 'upper_front_corner',
      facadeComposition: 'layered_solid_void',
      screen: 'vertical_fins',
      materialPalette: 'stone_white_wood',
      glazing: 'controlled_large',
      windowStrategy: 'floor_to_ceiling',
      courtyard: 'side',
      parking: 'integrated_front',
      landscape: 'courtyard_pool',
      characteristics: ['cantilever', 'asymmetric_balance', 'layered_facade', 'deep_shadows', 'strong_horizontal_lines'],
    },
  }),
  R({
    id: 'seed_modern_indian_stacked_white',
    style: 'modern_indian',
    source: internalSource('seed'),
    dna: {
      planFigure: 'rectangular',
      massingComposition: 'stacked_volumes',
      volumeCount: 2,
      upperFloorStrategy: 'front_setback',
      roof: 'flat_slab',
      overhang: 'shallow',
      entrance: 'framed',
      balcony: 'recessed',
      facadeComposition: 'solid_void',
      screen: 'vertical_fins',
      materialPalette: 'white_stone',
      glazing: 'controlled_large',
      windowStrategy: 'punched',
      courtyard: 'none',
      parking: 'integrated_front',
      landscape: 'front_lawn',
      characteristics: ['strong_horizontal_lines', 'solid_void_play', 'deep_shadows', 'minimal_detailing'],
    },
  }),
  R({
    id: 'seed_contemporary_indian_floating',
    style: 'contemporary_indian',
    source: internalSource('seed'),
    dna: {
      planFigure: 'rectangular',
      massingComposition: 'floating_upper_volume',
      volumeCount: 2,
      upperFloorStrategy: 'partial_cantilever',
      voidStrategy: 'double_height_entrance',
      roof: 'floating_slab',
      overhang: 'deep',
      entrance: 'double_height',
      doubleHeightEntrance: true,
      balcony: 'cantilever',
      facadeComposition: 'stacked_bands',
      screen: 'wood_screen',
      materialPalette: 'plaster_stone_base',
      glazing: 'expansive',
      windowStrategy: 'horizontal_ribbon',
      courtyard: 'rear',
      parking: 'integrated_front',
      landscape: 'rear_pool',
      characteristics: ['floating_volume', 'heavy_base_light_top', 'transparent_ground', 'deep_shadows'],
    },
  }),
  R({
    id: 'seed_modern_kerala_tiled_verandah',
    style: 'modern_kerala',
    source: internalSource('seed'),
    dna: {
      planFigure: 'l_shape',
      massingComposition: 'side_wing',
      volumeCount: 2,
      upperFloorStrategy: 'partial_upper',
      roof: 'kerala_tiled_hip',
      overhang: 'very_deep',
      entrance: 'porch',
      balcony: 'wrap_verandah',
      facadeComposition: 'stacked_bands',
      screen: 'jaali',
      materialPalette: 'laterite_white',
      glazing: 'modest',
      windowStrategy: 'screened',
      courtyard: 'central',
      parking: 'open_pad',
      landscape: 'courtyard_garden',
      characteristics: ['roof_as_feature', 'sheltered_verandah', 'climate_responsive', 'tropical_shading'],
    },
  }),
  R({
    id: 'seed_kerala_contemporary_stepped',
    style: 'kerala_contemporary',
    source: internalSource('seed'),
    dna: {
      planFigure: 'rectangular',
      massingComposition: 'stepped_volumes',
      volumeCount: 3,
      upperFloorStrategy: 'terrace_cutout',
      roof: 'roof_terrace',
      entrance: 'framed',
      balcony: 'continuous',
      facadeComposition: 'stacked_bands',
      screen: 'wood_screen',
      materialPalette: 'white_stone',
      glazing: 'controlled_large',
      windowStrategy: 'recessed',
      courtyard: 'side',
      parking: 'integrated_front',
      landscape: 'front_lawn',
      characteristics: ['strong_horizontal_lines', 'roof_as_feature', 'screen_as_feature', 'deep_shadows'],
    },
  }),
  R({
    id: 'seed_luxury_villa_portico',
    style: 'luxury_indian_villa',
    source: internalSource('seed'),
    dna: {
      planFigure: 'u_shape',
      massingComposition: 'split_volumes',
      volumeCount: 4,
      compositionBalance: 'asymmetric',
      upperFloorStrategy: 'asymmetric_setback',
      voidStrategy: 'double_height_living',
      roof: 'mixed_roof',
      overhang: 'deep',
      entrance: 'porte_cochere',
      doubleHeightEntrance: true,
      balcony: 'terrace_balcony',
      facadeComposition: 'stone_volume',
      screen: 'vertical_fins',
      materialPalette: 'travertine_granite',
      glazing: 'expansive',
      windowStrategy: 'floor_to_ceiling',
      courtyard: 'pool_courtyard',
      parking: 'porte_cochere',
      landscape: 'courtyard_pool',
      characteristics: ['solid_void_play', 'stone_as_feature', 'deep_shadows', 'transparent_ground'],
    },
  }),
  R({
    id: 'seed_tropical_modern_verandah_bar',
    style: 'tropical_indian_modern',
    source: internalSource('seed'),
    dna: {
      planFigure: 'linear',
      massingComposition: 'linear_bar',
      volumeCount: 2,
      upperFloorStrategy: 'partial_upper',
      roof: 'mono_slope',
      overhang: 'very_deep',
      entrance: 'porch',
      balcony: 'wrap_verandah',
      facadeComposition: 'layered_solid_void',
      screen: 'louvers',
      materialPalette: 'earth_timber',
      glazing: 'expansive',
      windowStrategy: 'floor_to_ceiling',
      courtyard: 'garden_courtyard',
      parking: 'stilt',
      landscape: 'wrap_deck',
      characteristics: ['tropical_shading', 'sheltered_verandah', 'deep_shadows', 'climate_responsive', 'strong_horizontal_lines'],
    },
  }),
  R({
    id: 'seed_minimal_indian_one_roof',
    style: 'minimal_indian',
    source: internalSource('seed'),
    dna: {
      planFigure: 'rectangular',
      massingComposition: 'stacked_volumes',
      volumeCount: 1,
      upperFloorStrategy: 'stacked_plumb',
      roof: 'floating_slab',
      overhang: 'deep',
      entrance: 'recessed',
      balcony: 'none',
      facadeComposition: 'flat_plane',
      screen: 'wood_screen',
      materialPalette: 'white_minimal',
      glazing: 'modest',
      windowStrategy: 'controlled_panoramic',
      courtyard: 'none',
      parking: 'open_pad',
      landscape: 'minimal',
      characteristics: ['minimal_detailing', 'monolithic', 'deep_shadows', 'privacy_to_street'],
    },
  }),
  R({
    id: 'seed_courtyard_modern_ring',
    style: 'courtyard_indian_modern',
    source: internalSource('seed'),
    dna: {
      planFigure: 'courtyard',
      massingComposition: 'courtyard_ring',
      volumeCount: 3,
      upperFloorStrategy: 'partial_upper',
      roof: 'flat_slab',
      entrance: 'covered_courtyard_entry',
      balcony: 'continuous',
      facadeComposition: 'solid_void',
      screen: 'jaali',
      materialPalette: 'brick_white',
      glazing: 'controlled_large',
      windowStrategy: 'screened',
      courtyard: 'central',
      parking: 'integrated_side',
      landscape: 'courtyard_garden',
      characteristics: ['courtyard_focused', 'privacy_to_street', 'sheltered_verandah', 'climate_responsive'],
    },
  }),
  /* ---- international composition references (§13) — tagged, never a target style ---- */
  R({
    id: 'seed_intl_japanese_pavilion',
    style: 'minimal_indian',
    international: 'japanese_modern',
    source: internalSource('seed'),
    dna: {
      planFigure: 'linear',
      massingComposition: 'single_volume',
      roof: 'mono_slope',
      overhang: 'very_deep',
      entrance: 'recessed',
      balcony: 'none',
      facadeComposition: 'framed',
      screen: 'wood_screen',
      materialPalette: 'concrete_wood',
      glazing: 'expansive',
      windowStrategy: 'floor_to_ceiling',
      courtyard: 'central',
      characteristics: ['minimal_detailing', 'deep_shadows', 'courtyard_focused', 'lightweight'],
    },
  }),
  R({
    id: 'seed_intl_brazilian_cantilever',
    style: 'modern_indian',
    international: 'brazilian_modern',
    source: internalSource('seed'),
    dna: {
      planFigure: 'rectangular',
      massingComposition: 'cantilevered_volumes',
      roof: 'floating_slab',
      overhang: 'very_deep',
      entrance: 'recessed',
      balcony: 'full_width',
      facadeComposition: 'layered_solid_void',
      screen: 'horizontal_fins',
      materialPalette: 'concrete_wood',
      glazing: 'full_glass',
      windowStrategy: 'floor_to_ceiling',
      courtyard: 'none',
      characteristics: ['cantilever', 'floating_volume', 'strong_horizontal_lines', 'transparent_ground'],
    },
  }),
]

/* ---- fingerprints for the seed set ------------------------------ */

export function referenceFingerprint(ref: ReferenceDesign, floors = 2): ArchitecturalFingerprint {
  const dna = ref.dna
  const g = {
    massingComposition: dna.massingComposition ?? 'stacked_volumes',
    planFigure: dna.planFigure ?? 'rectangular',
    upperFloorStrategy: dna.upperFloorStrategy ?? 'full_upper',
    roof: dna.roof ?? 'flat_slab',
    entrance: dna.entrance ?? 'centered',
    doubleHeightEntrance: dna.doubleHeightEntrance ?? false,
    balcony: dna.balcony ?? 'none',
    balconyPosition: dna.balconyPosition ?? 'upper_front',
    facadeComposition: dna.facadeComposition ?? 'flat_plane',
    screen: dna.screen ?? 'none',
    materialPalette: dna.materialPalette ?? 'white_minimal',
    courtyard: dna.courtyard ?? 'none',
  } as DesignGenome
  return architecturalFingerprint(g, floors)
}

export function referencesForStyle(style: StyleId): ReferenceDesign[] {
  return SEED_REFERENCES.filter((r) => r.style === style)
}

/* ================================================================== *
 *  referenceHints — how the library influences generation (§15)
 * ================================================================== */

/** fields a reference is allowed to bias */
const HINTABLE = [
  'massing',
  'upperFloor',
  'roof',
  'entrance',
  'balcony',
  'facadeComposition',
  'screen',
  'materialPalette',
  'glazing',
  'windowStrategy',
  'courtyard',
] as const

const DNA_TO_PATTERN_FIELD: Record<string, (typeof HINTABLE)[number]> = {
  massingComposition: 'massing',
  upperFloorStrategy: 'upperFloor',
  roof: 'roof',
  entrance: 'entrance',
  balcony: 'balcony',
  facadeComposition: 'facadeComposition',
  screen: 'screen',
  materialPalette: 'materialPalette',
  glazing: 'glazing',
  windowStrategy: 'windowStrategy',
  courtyard: 'courtyard',
}

/** §13: international references only expand COMPOSITION vocabulary — never the
 *  style-defining roof / entrance / material / courtyard picks */
const INTERNATIONAL_HINTABLE = new Set<(typeof HINTABLE)[number]>([
  'massing',
  'upperFloor',
  'facadeComposition',
  'screen',
  'balcony',
  'glazing',
  'windowStrategy',
])

/**
 * Soft bias: for a style + the plot's plan figure, collect the DNA of
 * every seed reference whose figure matches (or is unspecified) and
 * return extra `[term, weight]` picks to concat onto the style
 * pattern. A reference nudges the seed; it never forces the design,
 * and the user's plot / rooms / floors are resolved elsewhere (§16).
 */
/** figure families — a reference on any figure in the family still hints */
const FIGURE_FAMILY: Record<string, string> = {
  rectangular: 'compact',
  square: 'compact',
  linear: 'compact',
  l_shape: 'wing',
  t_shape: 'wing',
  u_shape: 'court',
  h_shape: 'court',
  courtyard: 'court',
  pavilion: 'court',
  split: 'wing',
}

export function referenceHints(
  style: StyleId,
  planShape: string,
  boost = 2,
): Partial<Record<(typeof HINTABLE)[number], Weighted<string>[]>> {
  const figure = planShapeToFigure(planShape as never)
  const fam = FIGURE_FAMILY[figure]
  const out: Partial<Record<(typeof HINTABLE)[number], Weighted<string>[]>> = {}
  for (const ref of SEED_REFERENCES) {
    if (ref.style !== style && !ref.international) continue
    // weight: exact figure > same family > international > cross-family
    let w: number
    if (ref.international) w = boost * 0.5
    else if (!ref.dna.planFigure || ref.dna.planFigure === figure) w = boost
    else if (FIGURE_FAMILY[ref.dna.planFigure] === fam) w = boost * 0.75
    else w = boost * 0.4
    for (const [dnaField, patternField] of Object.entries(DNA_TO_PATTERN_FIELD)) {
      if (ref.international && !INTERNATIONAL_HINTABLE.has(patternField)) continue
      const term = (ref.dna as Record<string, unknown>)[dnaField]
      if (typeof term !== 'string') continue
      ;(out[patternField] ??= []).push([term, w])
    }
  }
  return out
}
