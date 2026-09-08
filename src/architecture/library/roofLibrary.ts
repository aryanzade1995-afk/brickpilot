/* ------------------------------------------------------------------ *
 *  roofLibrary — the catalogue of roof forms.
 *
 *  Each entry maps an architectural roof type to: pitch range, default
 *  overhang, whether it supports a usable deck / parapet, the climate
 *  it suits, the engine `RoofRule.kind` it resolves to, and the
 *  characteristics it imparts. `roofs.py` (Blender) builds the form;
 *  this library is what the genome + `massingResolver` agree on.
 * ------------------------------------------------------------------ */

import type { Characteristic, OverhangDepth, RoofType } from './architecturalVocabulary.ts'
import type { RoofRule } from '../types.ts'

export type Climate = 'hot_dry' | 'warm_humid' | 'composite' | 'coastal' | 'any'

export type RoofEntry = {
  id: RoofType
  label: string
  description: string
  pitchDeg: [number, number]
  overhang: OverhangDepth
  /** a usable roof terrace is possible */
  deckCapable: boolean
  parapet: boolean
  climates: Climate[]
  /** the engine RoofRule.kind this resolves to */
  engineKind: RoofRule['kind']
  characteristics: Characteristic[]
}

const overhangMm: Record<OverhangDepth, [number, number]> = {
  none: [0, 60],
  shallow: [150, 350],
  medium: [400, 700],
  deep: [800, 1100],
  very_deep: [1100, 1500],
}
export function overhangRange(d: OverhangDepth): [number, number] {
  return overhangMm[d]
}

const R = (e: RoofEntry): RoofEntry => e

export const ROOF_LIBRARY: Record<RoofType, RoofEntry> = {
  flat_slab: R({
    id: 'flat_slab',
    label: 'Flat slab',
    description: 'A plain flat RCC slab with a shallow parapet.',
    pitchDeg: [0, 0],
    overhang: 'shallow',
    deckCapable: true,
    parapet: true,
    climates: ['hot_dry', 'composite', 'any'],
    engineKind: 'flat_parapet',
    characteristics: ['strong_horizontal_lines', 'minimal_detailing'],
  }),
  floating_slab: R({
    id: 'floating_slab',
    label: 'Floating slab',
    description: 'A thin roof plane oversailing the walls on a shadow gap — reads as a hovering lid.',
    pitchDeg: [0, 0],
    overhang: 'deep',
    deckCapable: false,
    parapet: false,
    climates: ['hot_dry', 'composite', 'warm_humid', 'any'],
    engineKind: 'flat_eave',
    characteristics: ['floating_volume', 'deep_shadows', 'roof_as_feature', 'lightweight'],
  }),
  parapet_roof: R({
    id: 'parapet_roof',
    label: 'Parapet roof',
    description: 'Flat roof behind a raised parapet that hides the roofscape from the street.',
    pitchDeg: [0, 0],
    overhang: 'none',
    deckCapable: true,
    parapet: true,
    climates: ['hot_dry', 'composite', 'any'],
    engineKind: 'flat_parapet',
    characteristics: ['monolithic', 'privacy_to_street', 'strong_horizontal_lines'],
  }),
  roof_terrace: R({
    id: 'roof_terrace',
    label: 'Roof terrace',
    description: 'An occupiable flat roof — pergola, planting, a stair headroom box.',
    pitchDeg: [0, 0],
    overhang: 'shallow',
    deckCapable: true,
    parapet: true,
    climates: ['hot_dry', 'composite', 'coastal', 'any'],
    engineKind: 'flat_parapet',
    characteristics: ['roof_as_feature', 'climate_responsive'],
  }),
  deep_overhang_flat: R({
    id: 'deep_overhang_flat',
    label: 'Deep-overhang flat',
    description: 'Flat roof with a very deep shading overhang on exposed beams.',
    pitchDeg: [0, 0],
    overhang: 'very_deep',
    deckCapable: false,
    parapet: false,
    climates: ['warm_humid', 'coastal', 'composite'],
    engineKind: 'flat_eave',
    characteristics: ['deep_shadows', 'tropical_shading', 'climate_responsive', 'sheltered_verandah'],
  }),
  butterfly: R({
    id: 'butterfly',
    label: 'Butterfly roof',
    description: 'Two planes falling to a central valley — a mid-century move.',
    pitchDeg: [8, 16],
    overhang: 'deep',
    deckCapable: false,
    parapet: false,
    climates: ['warm_humid', 'coastal'],
    engineKind: 'mono_slope',
    characteristics: ['roof_as_feature', 'lightweight', 'strong_horizontal_lines'],
  }),
  gable: R({
    id: 'gable',
    label: 'Gable',
    description: 'A simple two-sided pitched roof with gable ends.',
    pitchDeg: [18, 30],
    overhang: 'medium',
    deckCapable: false,
    parapet: false,
    climates: ['warm_humid', 'coastal', 'composite'],
    engineKind: 'gable',
    characteristics: ['roof_as_feature', 'climate_responsive'],
  }),
  hip: R({
    id: 'hip',
    label: 'Hip',
    description: 'A four-sided pitched roof — slopes on every face.',
    pitchDeg: [18, 28],
    overhang: 'deep',
    deckCapable: false,
    parapet: false,
    climates: ['warm_humid', 'coastal', 'composite'],
    engineKind: 'hip',
    characteristics: ['roof_as_feature', 'sheltered_verandah', 'climate_responsive'],
  }),
  mono_slope: R({
    id: 'mono_slope',
    label: 'Mono-slope',
    description: 'A single plane tilted for drainage and a tall clerestory edge.',
    pitchDeg: [10, 20],
    overhang: 'deep',
    deckCapable: false,
    parapet: false,
    climates: ['warm_humid', 'coastal'],
    engineKind: 'mono_slope',
    characteristics: ['roof_as_feature', 'strong_horizontal_lines', 'tropical_shading'],
  }),
  kerala_tiled_hip: R({
    id: 'kerala_tiled_hip',
    label: 'Kerala tiled hip',
    description: 'A low clay-tile hip with wide overhanging eaves over a verandah.',
    pitchDeg: [22, 30],
    overhang: 'very_deep',
    deckCapable: false,
    parapet: false,
    climates: ['warm_humid', 'coastal'],
    engineKind: 'hip',
    characteristics: ['roof_as_feature', 'sheltered_verandah', 'climate_responsive', 'tropical_shading'],
  }),
  contemporary_sloped: R({
    id: 'contemporary_sloped',
    label: 'Contemporary sloped',
    description: 'A crisp low pitch in standing-seam metal or concrete, minimal eave.',
    pitchDeg: [12, 22],
    overhang: 'shallow',
    deckCapable: false,
    parapet: false,
    climates: ['warm_humid', 'coastal', 'composite'],
    engineKind: 'mono_slope',
    characteristics: ['roof_as_feature', 'minimal_detailing', 'strong_horizontal_lines'],
  }),
  mixed_roof: R({
    id: 'mixed_roof',
    label: 'Mixed roof',
    description: 'Flat over the main mass, a pitched or floating element over a feature wing.',
    pitchDeg: [0, 22],
    overhang: 'medium',
    deckCapable: true,
    parapet: true,
    climates: ['composite', 'warm_humid', 'any'],
    engineKind: 'mixed',
    characteristics: ['roof_as_feature', 'asymmetric_balance', 'solid_void_play'],
  }),
}

export function roofEntry(id: RoofType): RoofEntry {
  return ROOF_LIBRARY[id]
}

export function isFlatRoof(id: RoofType): boolean {
  return ROOF_LIBRARY[id].pitchDeg[1] === 0
}
