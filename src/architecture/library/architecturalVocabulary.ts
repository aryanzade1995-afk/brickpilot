/* ------------------------------------------------------------------ *
 *  architecturalVocabulary — the single source of truth for every
 *  architectural term BrickPilot reasons about.
 *
 *  Every other library file, the DesignGenome, the Architectural
 *  Fingerprint, the reference-dataset metadata schema and the Python
 *  analysis pipeline all draw their allowed values from here. Terms
 *  are declared as `as const` tuples (no TS enums — the project runs
 *  `erasableSyntaxOnly`) and the union types are derived from them.
 *
 *  `scripts/sync-vocabulary.mts` serialises this file to
 *  `brickpilot-architecture-dataset/metadata/vocabulary.json` so the
 *  offline pipeline validates against exactly the same taxonomy.
 * ------------------------------------------------------------------ */

/* ================================================================== *
 *  MASSING  — how the building's volumes are composed in plan + 3D
 * ================================================================== */

/** the plan figure — the footprint outline family */
export const PLAN_FIGURES = [
  'rectangular',
  'square',
  'l_shape',
  't_shape',
  'u_shape',
  'h_shape',
  'courtyard',
  'linear',
  'pavilion',
  'split',
] as const
export type PlanFigure = (typeof PLAN_FIGURES)[number]

/** how the storeys / wings relate as three-dimensional volumes */
export const MASSING_COMPOSITIONS = [
  'single_volume',
  'stacked_volumes',
  'offset_volumes',
  'split_volumes',
  'stepped_volumes',
  'interlocking_volumes',
  'cantilevered_volumes',
  'floating_upper_volume',
  'central_core',
  'side_wing',
  'courtyard_ring',
  'pavilion_cluster',
  'linear_bar',
] as const
export type MassingComposition = (typeof MASSING_COMPOSITIONS)[number]

/** overall composition balance */
export const COMPOSITION_BALANCE = ['symmetric', 'near_symmetric', 'asymmetric', 'dynamic_asymmetric'] as const
export type CompositionBalance = (typeof COMPOSITION_BALANCE)[number]

export const EMPHASIS = ['none', 'low', 'medium', 'strong'] as const
export type Emphasis = (typeof EMPHASIS)[number]

/* ================================================================== *
 *  FLOOR COMPOSITION — how upper floors sit on the ground floor
 * ================================================================== */

export const UPPER_FLOOR_STRATEGIES = [
  'full_upper',
  'partial_upper',
  'front_setback',
  'rear_setback',
  'side_setback',
  'asymmetric_setback',
  'split_upper',
  'partial_cantilever',
  'full_cantilever',
  'terrace_cutout',
  'stacked_plumb',
] as const
export type UpperFloorStrategy = (typeof UPPER_FLOOR_STRATEGIES)[number]

export const VOID_STRATEGIES = [
  'none',
  'double_height_living',
  'double_height_entrance',
  'vertical_void',
  'central_atrium',
  'stair_void',
] as const
export type VoidStrategy = (typeof VOID_STRATEGIES)[number]

/* ================================================================== *
 *  ROOFS
 * ================================================================== */

export const ROOF_TYPES = [
  'flat_slab',
  'floating_slab',
  'parapet_roof',
  'roof_terrace',
  'deep_overhang_flat',
  'butterfly',
  'gable',
  'hip',
  'mono_slope',
  'kerala_tiled_hip',
  'contemporary_sloped',
  'mixed_roof',
] as const
export type RoofType = (typeof ROOF_TYPES)[number]

export const OVERHANG_DEPTH = ['none', 'shallow', 'medium', 'deep', 'very_deep'] as const
export type OverhangDepth = (typeof OVERHANG_DEPTH)[number]

/* ================================================================== *
 *  ENTRANCES
 * ================================================================== */

export const ENTRANCE_TYPES = [
  'centered',
  'offset',
  'recessed',
  'projecting',
  'double_height',
  'porch',
  'covered_courtyard_entry',
  'side_entry',
  'framed',
  'porte_cochere',
] as const
export type EntranceType = (typeof ENTRANCE_TYPES)[number]

export const ENTRANCE_POSITIONS = [
  'left_front',
  'center_front',
  'right_front',
  'recessed_center',
  'corner',
  'side',
  'courtyard',
] as const
export type EntrancePosition = (typeof ENTRANCE_POSITIONS)[number]

/* ================================================================== *
 *  BALCONIES
 * ================================================================== */

export const BALCONY_TYPES = [
  'none',
  'cantilever',
  'recessed',
  'corner',
  'corner_cantilever',
  'full_width',
  'partial_width',
  'juliet',
  'terrace_balcony',
  'planted_balcony',
  'continuous',
  'wrap_verandah',
] as const
export type BalconyType = (typeof BALCONY_TYPES)[number]

export const BALCONY_POSITIONS = [
  'upper_front',
  'upper_front_corner',
  'upper_rear',
  'upper_side',
  'wrap',
  'court_facing',
] as const
export type BalconyPosition = (typeof BALCONY_POSITIONS)[number]

/* ================================================================== *
 *  FACADE
 * ================================================================== */

export const FACADE_COMPOSITIONS = [
  'flat_plane',
  'solid_void',
  'layered_solid_void',
  'framed',
  'stacked_bands',
  'stone_volume',
  'glass_box',
  'mixed_material',
] as const
export type FacadeComposition = (typeof FACADE_COMPOSITIONS)[number]

export const SCREEN_ELEMENTS = [
  'none',
  'vertical_fins',
  'horizontal_fins',
  'jaali',
  'perforated_screen',
  'louvers',
  'wood_screen',
  'pergola_screen',
] as const
export type ScreenElement = (typeof SCREEN_ELEMENTS)[number]

export const FACADE_MATERIALS = [
  'white_plaster',
  'sand_plaster',
  'off_white_plaster',
  'exposed_concrete',
  'natural_stone',
  'dark_stone',
  'laterite',
  'travertine',
  'granite',
  'brick',
  'wood',
  'teak_batten',
  'metal_panel',
  'glass',
] as const
export type FacadeMaterial = (typeof FACADE_MATERIALS)[number]

/** curated multi-material palettes (a named tuple of FacadeMaterial) */
export const MATERIAL_PALETTES = [
  'white_minimal',
  'white_stone',
  'stone_white_wood',
  'plaster_stone_base',
  'concrete_wood',
  'laterite_white',
  'travertine_granite',
  'brick_white',
  'earth_timber',
] as const
export type MaterialPalette = (typeof MATERIAL_PALETTES)[number]

/* ================================================================== *
 *  WINDOWS / GLAZING
 * ================================================================== */

export const WINDOW_STRATEGIES = [
  'punched',
  'horizontal_ribbon',
  'vertical_slit',
  'floor_to_ceiling',
  'corner_glazing',
  'recessed',
  'screened',
  'clerestory',
  'controlled_panoramic',
] as const
export type WindowStrategy = (typeof WINDOW_STRATEGIES)[number]

export const GLAZING_RATIOS = ['minimal', 'modest', 'controlled_large', 'expansive', 'full_glass'] as const
export type GlazingRatio = (typeof GLAZING_RATIOS)[number]

/* ================================================================== *
 *  COURTYARD / LANDSCAPE
 * ================================================================== */

export const COURTYARD_TYPES = [
  'none',
  'central',
  'side',
  'rear',
  'entrance_courtyard',
  'pool_courtyard',
  'garden_courtyard',
  'double_height_courtyard',
] as const
export type CourtyardType = (typeof COURTYARD_TYPES)[number]

export const PARKING_INTEGRATION = [
  'none',
  'open_pad',
  'integrated_front',
  'integrated_side',
  'porte_cochere',
  'stilt',
  'basement',
] as const
export type ParkingIntegration = (typeof PARKING_INTEGRATION)[number]

export const LANDSCAPE_STRATEGIES = [
  'minimal',
  'front_lawn',
  'courtyard_garden',
  'courtyard_pool',
  'rear_pool',
  'wrap_deck',
  'roof_garden',
  'water_court',
] as const
export type LandscapeStrategy = (typeof LANDSCAPE_STRATEGIES)[number]

/* ================================================================== *
 *  CHARACTERISTICS — free-ish descriptive tags, but drawn from a set
 * ================================================================== */

export const CHARACTERISTICS = [
  'strong_horizontal_lines',
  'strong_vertical_lines',
  'deep_shadows',
  'cantilever',
  'floating_volume',
  'asymmetric_balance',
  'symmetric_balance',
  'layered_facade',
  'solid_void_play',
  'monolithic',
  'lightweight',
  'transparent_ground',
  'heavy_base_light_top',
  'sheltered_verandah',
  'courtyard_focused',
  'roof_as_feature',
  'screen_as_feature',
  'stone_as_feature',
  'minimal_detailing',
  'tropical_shading',
  'climate_responsive',
  'privacy_to_street',
] as const
export type Characteristic = (typeof CHARACTERISTICS)[number]

/* ================================================================== *
 *  STYLES  (mirrors src/architecture/types.ts StyleId — kept in sync)
 * ================================================================== */

export const VOCAB_STYLES = [
  'modern_indian',
  'contemporary_indian',
  'modern_kerala',
  'kerala_contemporary',
  'luxury_indian_villa',
  'tropical_indian_modern',
  'minimal_indian',
  'courtyard_indian_modern',
] as const
export type VocabStyle = (typeof VOCAB_STYLES)[number]

/** international reference families — tagged, never a target output style */
export const INTERNATIONAL_TAGS = [
  'japanese_modern',
  'mediterranean_contemporary',
  'tropical_modern',
  'southeast_asian_modern',
  'australian_contemporary',
  'brazilian_modern',
  'european_minimalist',
] as const
export type InternationalTag = (typeof INTERNATIONAL_TAGS)[number]

/* ================================================================== *
 *  THE REGISTRY  — name → allowed values, for generic validation
 * ================================================================== */

export const VOCABULARY = {
  planFigure: PLAN_FIGURES,
  massingComposition: MASSING_COMPOSITIONS,
  compositionBalance: COMPOSITION_BALANCE,
  emphasis: EMPHASIS,
  upperFloorStrategy: UPPER_FLOOR_STRATEGIES,
  voidStrategy: VOID_STRATEGIES,
  roofType: ROOF_TYPES,
  overhangDepth: OVERHANG_DEPTH,
  entranceType: ENTRANCE_TYPES,
  entrancePosition: ENTRANCE_POSITIONS,
  balconyType: BALCONY_TYPES,
  balconyPosition: BALCONY_POSITIONS,
  facadeComposition: FACADE_COMPOSITIONS,
  screenElement: SCREEN_ELEMENTS,
  facadeMaterial: FACADE_MATERIALS,
  materialPalette: MATERIAL_PALETTES,
  windowStrategy: WINDOW_STRATEGIES,
  glazingRatio: GLAZING_RATIOS,
  courtyardType: COURTYARD_TYPES,
  parkingIntegration: PARKING_INTEGRATION,
  landscapeStrategy: LANDSCAPE_STRATEGIES,
  characteristic: CHARACTERISTICS,
  style: VOCAB_STYLES,
  internationalTag: INTERNATIONAL_TAGS,
} as const

export type VocabularyField = keyof typeof VOCABULARY

/** every term, flattened, with its field — useful for the dataset report */
export const ALL_TERMS: { field: VocabularyField; term: string }[] = Object.entries(VOCABULARY).flatMap(
  ([field, terms]) => (terms as readonly string[]).map((term) => ({ field: field as VocabularyField, term })),
)

/* ---- validators -------------------------------------------------- */

export function isValidTerm(field: VocabularyField, term: string): boolean {
  return (VOCABULARY[field] as readonly string[]).includes(term)
}

/** map a loose / legacy term onto the canonical vocabulary, else null */
export function normalizeTerm(field: VocabularyField, raw: string): string | null {
  const term = raw.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (isValidTerm(field, term)) return term
  const alias = (VOCAB_ALIASES[field] ?? {})[term]
  if (alias && isValidTerm(field, alias)) return alias
  return null
}

/** common alternative spellings the vision pipeline / spec prose may produce */
export const VOCAB_ALIASES: Partial<Record<VocabularyField, Record<string, string>>> = {
  planFigure: { l: 'l_shape', u: 'u_shape', t: 't_shape', h: 'h_shape', rectangle: 'rectangular', rect: 'rectangular' },
  massingComposition: {
    offset_box: 'offset_volumes',
    stacked_box: 'stacked_volumes',
    cantilevered_box: 'cantilevered_volumes',
    cantilever: 'cantilevered_volumes',
    floating_box: 'floating_upper_volume',
    linear: 'linear_bar',
  },
  compositionBalance: { low: 'asymmetric', high: 'symmetric', medium: 'near_symmetric' },
  roofType: {
    flat: 'flat_slab',
    flat_roof: 'flat_slab',
    floating_flat: 'floating_slab',
    terrace: 'roof_terrace',
    sloped: 'contemporary_sloped',
    tiled: 'kerala_tiled_hip',
    pitched: 'hip',
  },
  entranceType: { recessed_center: 'recessed', double_height_entrance: 'double_height', drive_through: 'porte_cochere' },
  balconyType: { corner_cantilever: 'corner_cantilever', verandah: 'wrap_verandah', wrap: 'wrap_verandah' },
  screenElement: { fins: 'vertical_fins', screen: 'perforated_screen', jali: 'jaali', brise_soleil: 'vertical_fins' },
  glazingRatio: { large: 'controlled_large', controlled: 'controlled_large', panoramic: 'expansive' },
  courtyardType: { court: 'central', internal_court: 'central' },
}
