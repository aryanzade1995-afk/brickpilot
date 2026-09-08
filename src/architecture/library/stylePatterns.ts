/* ------------------------------------------------------------------ *
 *  stylePatterns — the per-style GENOME grammar.
 *
 *  `grammar.ts` (StyleGrammar) holds the geometry knobs the resolvers
 *  read. This file holds the *decision preferences*: for each style,
 *  a weighted distribution over every vocabulary field — which plan
 *  figures, massing compositions, roof forms, entrances, balconies,
 *  facade compositions, screens, palettes, glazing, courtyards,
 *  parking and landscape it favours — plus proportion, solid/void,
 *  privacy and climate rules.
 *
 *  `resolveGenome()` samples these (seeded, compatibility-filtered) to
 *  compose a DesignGenome. `scripts/sync-vocabulary.mts` serialises
 *  the patterns to the dataset so the analysis pipeline scores real
 *  references against the same distributions.
 * ------------------------------------------------------------------ */

import type { StyleId } from '../types.ts'
import type {
  BalconyType,
  Characteristic,
  CourtyardType,
  EntranceType,
  FacadeComposition,
  GlazingRatio,
  LandscapeStrategy,
  MassingComposition,
  MaterialPalette,
  ParkingIntegration,
  PlanFigure,
  RoofType,
  ScreenElement,
  UpperFloorStrategy,
  VoidStrategy,
  WindowStrategy,
} from './architecturalVocabulary.ts'
import type { Climate } from './roofLibrary.ts'

export type Weighted<T> = [T, number]

export type StylePattern = {
  id: StyleId
  label: string
  climate: Climate
  planFigure: Weighted<PlanFigure>[]
  massing: Weighted<MassingComposition>[]
  upperFloor: Weighted<UpperFloorStrategy>[]
  voidStrategy: Weighted<VoidStrategy>[]
  roof: Weighted<RoofType>[]
  entrance: Weighted<EntranceType>[]
  balcony: Weighted<BalconyType>[]
  facadeComposition: Weighted<FacadeComposition>[]
  screen: Weighted<ScreenElement>[]
  materialPalette: Weighted<MaterialPalette>[]
  glazing: Weighted<GlazingRatio>[]
  windowStrategy: Weighted<WindowStrategy>[]
  courtyard: Weighted<CourtyardType>[]
  parking: Weighted<ParkingIntegration>[]
  landscape: Weighted<LandscapeStrategy>[]
  volumeCount: [number, number]
  proportion: {
    maxAspect: number
    groundCoverage: [number, number]
    upperCoverage: [number, number]
    /** solid : void, higher = more solid facade */
    solidVoid: [number, number]
  }
  privacy: {
    streetGlazing: 'open' | 'controlled' | 'screened' | 'closed'
    /** 0..1 — how strongly upper street rooms shrink / raise openings */
    upperStreetBias: number
  }
  signatureCharacteristics: Characteristic[]
}

const P = (p: StylePattern): StylePattern => p

export const STYLE_PATTERNS: Record<StyleId, StylePattern> = {
  /* ============================================================ */
  modern_indian: P({
    id: 'modern_indian',
    label: 'Modern Indian',
    climate: 'composite',
    planFigure: [['rectangular', 4], ['l_shape', 3], ['square', 2], ['t_shape', 1], ['split', 1]],
    massing: [
      ['offset_volumes', 4],
      ['cantilevered_volumes', 3],
      ['stacked_volumes', 2],
      ['split_volumes', 2],
      ['floating_upper_volume', 2],
      ['stepped_volumes', 1],
    ],
    upperFloor: [['partial_cantilever', 3], ['front_setback', 2], ['asymmetric_setback', 2], ['partial_upper', 2], ['full_upper', 1]],
    voidStrategy: [['none', 3], ['double_height_entrance', 2], ['stair_void', 2], ['double_height_living', 1]],
    roof: [['floating_slab', 4], ['flat_slab', 3], ['roof_terrace', 2], ['parapet_roof', 1], ['mixed_roof', 1]],
    entrance: [['recessed', 4], ['offset', 2], ['framed', 2], ['double_height', 1], ['projecting', 1]],
    balcony: [['cantilever', 3], ['recessed', 3], ['corner_cantilever', 2], ['partial_width', 2], ['none', 1]],
    facadeComposition: [['layered_solid_void', 4], ['solid_void', 3], ['mixed_material', 2], ['stone_volume', 2], ['framed', 1]],
    screen: [['vertical_fins', 4], ['wood_screen', 2], ['jaali', 2], ['none', 2], ['perforated_screen', 1]],
    materialPalette: [['stone_white_wood', 4], ['white_stone', 3], ['plaster_stone_base', 2], ['concrete_wood', 2], ['white_minimal', 1]],
    glazing: [['controlled_large', 4], ['expansive', 2], ['modest', 1]],
    windowStrategy: [['floor_to_ceiling', 3], ['punched', 2], ['horizontal_ribbon', 2], ['recessed', 2], ['corner_glazing', 1]],
    courtyard: [['none', 4], ['side', 2], ['rear', 2], ['entrance_courtyard', 1]],
    parking: [['integrated_front', 4], ['open_pad', 2], ['integrated_side', 1], ['porte_cochere', 1]],
    landscape: [['front_lawn', 3], ['minimal', 2], ['courtyard_garden', 2], ['rear_pool', 1]],
    volumeCount: [2, 3],
    proportion: { maxAspect: 1.9, groundCoverage: [0.62, 0.82], upperCoverage: [0.5, 0.72], solidVoid: [1.4, 2.4] },
    privacy: { streetGlazing: 'controlled', upperStreetBias: 0.35 },
    signatureCharacteristics: ['asymmetric_balance', 'layered_facade', 'deep_shadows', 'strong_horizontal_lines'],
  }),

  /* ============================================================ */
  contemporary_indian: P({
    id: 'contemporary_indian',
    label: 'Contemporary Indian',
    climate: 'composite',
    planFigure: [['rectangular', 4], ['square', 3], ['l_shape', 2], ['t_shape', 1]],
    massing: [
      ['stacked_volumes', 4],
      ['cantilevered_volumes', 3],
      ['floating_upper_volume', 3],
      ['offset_volumes', 2],
      ['split_volumes', 1],
    ],
    upperFloor: [['stacked_plumb', 3], ['partial_cantilever', 3], ['front_setback', 2], ['full_upper', 2]],
    voidStrategy: [['double_height_entrance', 3], ['none', 2], ['double_height_living', 2], ['stair_void', 1]],
    roof: [['floating_slab', 4], ['deep_overhang_flat', 3], ['flat_slab', 2], ['roof_terrace', 2]],
    entrance: [['double_height', 4], ['recessed', 3], ['framed', 2], ['offset', 1]],
    balcony: [['recessed', 3], ['cantilever', 3], ['continuous', 2], ['partial_width', 2], ['none', 1]],
    facadeComposition: [['stacked_bands', 3], ['layered_solid_void', 3], ['framed', 2], ['stone_volume', 2], ['mixed_material', 2]],
    screen: [['none', 3], ['wood_screen', 3], ['vertical_fins', 2], ['jaali', 2], ['louvers', 1]],
    materialPalette: [['plaster_stone_base', 4], ['stone_white_wood', 3], ['concrete_wood', 2], ['white_stone', 2]],
    glazing: [['controlled_large', 4], ['expansive', 3], ['modest', 1]],
    windowStrategy: [['floor_to_ceiling', 3], ['horizontal_ribbon', 3], ['recessed', 2], ['punched', 2]],
    courtyard: [['none', 4], ['rear', 2], ['side', 2], ['garden_courtyard', 1]],
    parking: [['integrated_front', 4], ['integrated_side', 2], ['open_pad', 2], ['porte_cochere', 1]],
    landscape: [['minimal', 3], ['front_lawn', 2], ['rear_pool', 2], ['courtyard_garden', 1]],
    volumeCount: [2, 3],
    proportion: { maxAspect: 2.0, groundCoverage: [0.6, 0.82], upperCoverage: [0.55, 0.78], solidVoid: [1.2, 2.0] },
    privacy: { streetGlazing: 'controlled', upperStreetBias: 0.3 },
    signatureCharacteristics: ['strong_horizontal_lines', 'heavy_base_light_top', 'deep_shadows', 'solid_void_play'],
  }),

  /* ============================================================ */
  modern_kerala: P({
    id: 'modern_kerala',
    label: 'Modern Kerala',
    climate: 'warm_humid',
    planFigure: [['rectangular', 4], ['l_shape', 3], ['u_shape', 2], ['courtyard', 2], ['linear', 1]],
    massing: [['stacked_volumes', 4], ['side_wing', 3], ['linear_bar', 2], ['split_volumes', 2], ['stepped_volumes', 1]],
    upperFloor: [['partial_upper', 3], ['rear_setback', 2], ['stacked_plumb', 2], ['side_setback', 1]],
    voidStrategy: [['none', 4], ['stair_void', 2], ['double_height_living', 1]],
    // Kerala's signature IS the pitched tiled hip — a style invariant, not a diversity axis
    roof: [['kerala_tiled_hip', 6], ['hip', 4]],
    entrance: [['porch', 3], ['recessed', 2], ['covered_courtyard_entry', 2], ['framed', 2], ['centered', 1]],
    balcony: [['wrap_verandah', 3], ['continuous', 2], ['recessed', 2], ['partial_width', 2], ['none', 1]],
    facadeComposition: [['stacked_bands', 4], ['layered_solid_void', 2], ['framed', 2], ['mixed_material', 2]],
    screen: [['jaali', 3], ['wood_screen', 3], ['louvers', 2], ['pergola_screen', 2], ['none', 1]],
    materialPalette: [['laterite_white', 4], ['earth_timber', 3], ['white_stone', 2], ['brick_white', 1]],
    glazing: [['modest', 3], ['controlled_large', 3], ['minimal', 1]],
    windowStrategy: [['screened', 3], ['punched', 3], ['recessed', 2], ['clerestory', 1]],
    courtyard: [['central', 3], ['side', 3], ['garden_courtyard', 2], ['none', 2], ['entrance_courtyard', 1]],
    parking: [['open_pad', 3], ['integrated_side', 2], ['porte_cochere', 1], ['none', 1]],
    landscape: [['courtyard_garden', 3], ['front_lawn', 2], ['wrap_deck', 2], ['courtyard_pool', 1]],
    volumeCount: [2, 3],
    proportion: { maxAspect: 2.2, groundCoverage: [0.5, 0.72], upperCoverage: [0.4, 0.62], solidVoid: [1.8, 3.0] },
    privacy: { streetGlazing: 'screened', upperStreetBias: 0.2 },
    signatureCharacteristics: ['roof_as_feature', 'sheltered_verandah', 'climate_responsive', 'tropical_shading'],
  }),

  /* ============================================================ */
  kerala_contemporary: P({
    id: 'kerala_contemporary',
    label: 'Kerala Contemporary',
    climate: 'warm_humid',
    planFigure: [['rectangular', 4], ['l_shape', 3], ['square', 2], ['t_shape', 1]],
    massing: [['stepped_volumes', 4], ['stacked_volumes', 2], ['offset_volumes', 2], ['cantilevered_volumes', 1], ['side_wing', 1]],
    upperFloor: [['terrace_cutout', 3], ['front_setback', 3], ['partial_cantilever', 2], ['partial_upper', 2]],
    voidStrategy: [['double_height_entrance', 3], ['none', 2], ['stair_void', 2]],
    roof: [['roof_terrace', 4], ['flat_slab', 3], ['floating_slab', 2], ['mixed_roof', 2]],
    entrance: [['framed', 4], ['recessed', 3], ['double_height', 2], ['offset', 1]],
    balcony: [['recessed', 3], ['continuous', 2], ['partial_width', 2], ['cantilever', 2], ['none', 1]],
    facadeComposition: [['stacked_bands', 4], ['framed', 3], ['layered_solid_void', 2], ['mixed_material', 2]],
    screen: [['jaali', 3], ['wood_screen', 3], ['vertical_fins', 2], ['louvers', 1]],
    materialPalette: [['white_stone', 4], ['plaster_stone_base', 3], ['laterite_white', 2], ['stone_white_wood', 2]],
    glazing: [['controlled_large', 4], ['modest', 2], ['expansive', 1]],
    windowStrategy: [['recessed', 3], ['punched', 3], ['horizontal_ribbon', 2], ['screened', 2]],
    courtyard: [['side', 3], ['rear', 2], ['none', 3], ['garden_courtyard', 1]],
    parking: [['integrated_front', 3], ['integrated_side', 2], ['open_pad', 2]],
    landscape: [['front_lawn', 3], ['minimal', 2], ['courtyard_garden', 2], ['roof_garden', 1]],
    volumeCount: [2, 3],
    proportion: { maxAspect: 2.0, groundCoverage: [0.58, 0.8], upperCoverage: [0.45, 0.68], solidVoid: [1.6, 2.6] },
    privacy: { streetGlazing: 'screened', upperStreetBias: 0.3 },
    signatureCharacteristics: ['strong_horizontal_lines', 'roof_as_feature', 'screen_as_feature', 'deep_shadows'],
  }),

  /* ============================================================ */
  luxury_indian_villa: P({
    id: 'luxury_indian_villa',
    label: 'Luxury Indian villa',
    climate: 'composite',
    planFigure: [['rectangular', 3], ['l_shape', 3], ['u_shape', 3], ['courtyard', 2], ['t_shape', 2], ['h_shape', 1]],
    massing: [
      ['split_volumes', 4],
      ['cantilevered_volumes', 3],
      ['offset_volumes', 3],
      ['side_wing', 2],
      ['floating_upper_volume', 2],
      ['stacked_volumes', 1],
    ],
    upperFloor: [['partial_cantilever', 3], ['asymmetric_setback', 3], ['partial_upper', 2], ['terrace_cutout', 2], ['full_upper', 1]],
    voidStrategy: [['double_height_entrance', 4], ['double_height_living', 3], ['central_atrium', 2], ['vertical_void', 1]],
    roof: [['floating_slab', 3], ['deep_overhang_flat', 3], ['mixed_roof', 3], ['roof_terrace', 2], ['flat_slab', 1]],
    entrance: [['porte_cochere', 4], ['double_height', 4], ['framed', 2], ['projecting', 2]],
    balcony: [['cantilever', 3], ['corner_cantilever', 3], ['terrace_balcony', 2], ['wrap_verandah', 2], ['full_width', 2]],
    facadeComposition: [['layered_solid_void', 3], ['stone_volume', 3], ['mixed_material', 3], ['framed', 2], ['glass_box', 1]],
    screen: [['vertical_fins', 3], ['wood_screen', 2], ['louvers', 2], ['jaali', 2], ['none', 2]],
    materialPalette: [['travertine_granite', 4], ['stone_white_wood', 3], ['plaster_stone_base', 2], ['concrete_wood', 1]],
    glazing: [['expansive', 4], ['controlled_large', 3], ['full_glass', 2]],
    windowStrategy: [['floor_to_ceiling', 4], ['controlled_panoramic', 3], ['corner_glazing', 2], ['recessed', 1]],
    courtyard: [['pool_courtyard', 3], ['central', 3], ['entrance_courtyard', 2], ['garden_courtyard', 2], ['none', 1]],
    parking: [['porte_cochere', 4], ['basement', 2], ['integrated_side', 2], ['integrated_front', 2]],
    landscape: [['courtyard_pool', 4], ['water_court', 2], ['rear_pool', 2], ['front_lawn', 1]],
    volumeCount: [3, 4],
    proportion: { maxAspect: 2.4, groundCoverage: [0.5, 0.7], upperCoverage: [0.42, 0.64], solidVoid: [1.0, 1.8] },
    privacy: { streetGlazing: 'controlled', upperStreetBias: 0.2 },
    signatureCharacteristics: ['solid_void_play', 'deep_shadows', 'stone_as_feature', 'transparent_ground'],
  }),

  /* ============================================================ */
  tropical_indian_modern: P({
    id: 'tropical_indian_modern',
    label: 'Tropical Indian modern',
    climate: 'coastal',
    planFigure: [['linear', 4], ['rectangular', 3], ['l_shape', 3], ['courtyard', 2], ['pavilion', 2]],
    massing: [['linear_bar', 4], ['split_volumes', 3], ['pavilion_cluster', 2], ['stacked_volumes', 2], ['stepped_volumes', 1]],
    upperFloor: [['partial_upper', 3], ['rear_setback', 2], ['side_setback', 2], ['terrace_cutout', 2]],
    voidStrategy: [['none', 3], ['double_height_living', 2], ['stair_void', 2]],
    roof: [['mono_slope', 4], ['deep_overhang_flat', 3], ['butterfly', 2], ['contemporary_sloped', 2], ['hip', 1]],
    entrance: [['porch', 4], ['covered_courtyard_entry', 2], ['recessed', 2], ['side_entry', 2]],
    balcony: [['wrap_verandah', 4], ['planted_balcony', 2], ['continuous', 2], ['terrace_balcony', 2], ['none', 1]],
    facadeComposition: [['layered_solid_void', 3], ['stacked_bands', 3], ['framed', 2], ['glass_box', 2], ['mixed_material', 2]],
    screen: [['louvers', 4], ['pergola_screen', 3], ['jaali', 2], ['wood_screen', 2], ['vertical_fins', 1]],
    materialPalette: [['earth_timber', 4], ['concrete_wood', 3], ['white_minimal', 2], ['laterite_white', 2]],
    glazing: [['expansive', 3], ['controlled_large', 3], ['full_glass', 2]],
    windowStrategy: [['floor_to_ceiling', 3], ['screened', 3], ['horizontal_ribbon', 2], ['corner_glazing', 2]],
    courtyard: [['central', 3], ['garden_courtyard', 3], ['pool_courtyard', 2], ['side', 2], ['none', 1]],
    parking: [['stilt', 3], ['open_pad', 3], ['integrated_side', 2], ['none', 1]],
    landscape: [['wrap_deck', 4], ['courtyard_pool', 3], ['courtyard_garden', 2], ['rear_pool', 2]],
    volumeCount: [2, 3],
    proportion: { maxAspect: 2.6, groundCoverage: [0.45, 0.68], upperCoverage: [0.35, 0.58], solidVoid: [1.0, 1.7] },
    privacy: { streetGlazing: 'screened', upperStreetBias: 0.25 },
    signatureCharacteristics: ['tropical_shading', 'sheltered_verandah', 'deep_shadows', 'climate_responsive'],
  }),

  /* ============================================================ */
  minimal_indian: P({
    id: 'minimal_indian',
    label: 'Minimal Indian',
    climate: 'hot_dry',
    planFigure: [['rectangular', 4], ['square', 3], ['l_shape', 2], ['linear', 1]],
    massing: [['single_volume', 3], ['stacked_volumes', 4], ['linear_bar', 2], ['floating_upper_volume', 1], ['stepped_volumes', 1]],
    upperFloor: [['stacked_plumb', 4], ['partial_upper', 2], ['rear_setback', 1]],
    voidStrategy: [['none', 4], ['double_height_living', 2], ['stair_void', 1]],
    roof: [['flat_slab', 3], ['floating_slab', 4], ['parapet_roof', 2]],
    entrance: [['recessed', 4], ['framed', 2], ['centered', 2], ['side_entry', 1]],
    balcony: [['recessed', 3], ['none', 3], ['partial_width', 2], ['juliet', 1]],
    facadeComposition: [['flat_plane', 4], ['solid_void', 3], ['framed', 2], ['stone_volume', 1]],
    screen: [['wood_screen', 3], ['none', 3], ['vertical_fins', 1], ['perforated_screen', 1]],
    materialPalette: [['white_minimal', 4], ['earth_timber', 3], ['white_stone', 2], ['concrete_wood', 1]],
    glazing: [['modest', 3], ['minimal', 3], ['controlled_large', 2]],
    windowStrategy: [['punched', 4], ['controlled_panoramic', 2], ['vertical_slit', 2], ['clerestory', 1]],
    courtyard: [['none', 4], ['rear', 2], ['central', 1]],
    parking: [['open_pad', 3], ['integrated_front', 2], ['none', 2]],
    landscape: [['minimal', 4], ['front_lawn', 1], ['rear_pool', 1]],
    volumeCount: [1, 2],
    proportion: { maxAspect: 1.9, groundCoverage: [0.5, 0.72], upperCoverage: [0.48, 0.7], solidVoid: [2.2, 3.4] },
    privacy: { streetGlazing: 'closed', upperStreetBias: 0.4 },
    signatureCharacteristics: ['minimal_detailing', 'monolithic', 'deep_shadows', 'privacy_to_street'],
  }),

  /* ============================================================ */
  courtyard_indian_modern: P({
    id: 'courtyard_indian_modern',
    label: 'Courtyard Indian modern',
    climate: 'composite',
    planFigure: [['courtyard', 4], ['u_shape', 3], ['l_shape', 3], ['t_shape', 2], ['h_shape', 1]],
    massing: [['courtyard_ring', 4], ['side_wing', 3], ['split_volumes', 2], ['pavilion_cluster', 2], ['linear_bar', 1]],
    upperFloor: [['partial_upper', 4], ['side_setback', 2], ['rear_setback', 2], ['split_upper', 1]],
    voidStrategy: [['none', 3], ['central_atrium', 2], ['stair_void', 2], ['double_height_living', 2]],
    roof: [['flat_slab', 3], ['roof_terrace', 3], ['deep_overhang_flat', 2], ['mixed_roof', 2], ['floating_slab', 1]],
    entrance: [['covered_courtyard_entry', 4], ['recessed', 3], ['framed', 2], ['side_entry', 1]],
    balcony: [['continuous', 3], ['recessed', 3], ['wrap_verandah', 2], ['partial_width', 2], ['none', 1]],
    facadeComposition: [['solid_void', 3], ['layered_solid_void', 3], ['stacked_bands', 2], ['framed', 2]],
    screen: [['jaali', 4], ['perforated_screen', 3], ['wood_screen', 2], ['pergola_screen', 2]],
    materialPalette: [['brick_white', 3], ['white_stone', 3], ['earth_timber', 2], ['laterite_white', 2]],
    glazing: [['controlled_large', 3], ['modest', 3], ['expansive', 1]],
    windowStrategy: [['screened', 3], ['punched', 3], ['clerestory', 2], ['floor_to_ceiling', 2]],
    courtyard: [['central', 5], ['garden_courtyard', 3], ['pool_courtyard', 2], ['double_height_courtyard', 2]],
    parking: [['integrated_side', 3], ['open_pad', 2], ['porte_cochere', 1], ['none', 1]],
    landscape: [['courtyard_garden', 4], ['courtyard_pool', 3], ['water_court', 2], ['minimal', 1]],
    volumeCount: [2, 4],
    proportion: { maxAspect: 1.7, groundCoverage: [0.55, 0.78], upperCoverage: [0.35, 0.58], solidVoid: [1.8, 2.8] },
    privacy: { streetGlazing: 'screened', upperStreetBias: 0.5 },
    signatureCharacteristics: ['courtyard_focused', 'privacy_to_street', 'sheltered_verandah', 'climate_responsive'],
  }),
}

export function stylePattern(id: StyleId): StylePattern {
  return STYLE_PATTERNS[id]
}
