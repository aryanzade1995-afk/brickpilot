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
}

export function stylePattern(id: StyleId): StylePattern {
  return STYLE_PATTERNS[id]
}
