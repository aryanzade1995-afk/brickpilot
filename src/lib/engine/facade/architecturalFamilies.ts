import type { BuildingModel } from '../buildingModel.ts'
import { makeRng } from '../massing/rng.ts'
import type { Character } from '../../model/brief.ts'
import type { ArchitecturalFeatureType } from './proceduralTypes.ts'

/** Composition families are internal geometry recipes, not additional UI styles. */
export const ARCHITECTURAL_FAMILIES = [
  'FRAMED_MODERN', 'FLOATING_BOX', 'INTERLOCKING_MODERN', 'MINIMAL_LUXURY',
  'WARM_CONTEMPORARY', 'TROPICAL_MODERN', 'SCREEN_HOUSE',
  'INDIAN_CONTEMPORARY', 'VERTICAL_MONOLITH', 'HORIZONTAL_LAYERED',
  'COURTYARD_MODERN', 'LAYERED_PORTICO', 'DEEP_REVEAL', 'FINNED_PAVILION', 'SCULPTED_CORNER',
  // compositions drawn from the reference photo set (docs/villa-precedents.md)
  'GLASS_PAVILION', 'STEEL_FRAME_GRID', 'RAISED_BAR',
  'STEPPED_WHITE', 'FREE_CANOPY',
  'STONE_COLONNADE', 'TIMBER_PORTICO',
  'FOLDED_PAVILION', 'GLAZED_BAY', 'SOLAR_TERRACE',
  'BRICK_VEIL', 'SCULPTED_TOWER', 'GARDEN_GATE',
  'COURT_PERGOLA', 'POOL_RETREAT',
] as const
export type ArchitecturalFamily = (typeof ARCHITECTURAL_FAMILIES)[number]

export type ArchitecturalFamilyRecipe = {
  heroes: readonly ArchitecturalFeatureType[]
  supports: readonly ArchitecturalFeatureType[]
  spanRatio: readonly [number, number]
  projectionScale: number
  /** A courtyard composition requires a real courtyard in the source plan. */
  requiresCourtyard?: true
}

export const ARCHITECTURAL_FAMILY_RECIPES: Record<ArchitecturalFamily, ArchitecturalFamilyRecipe> = {
  FOLDED_PAVILION: { heroes: ['FOLDED_CANOPY'], supports: ['STEEL_GRID'], spanRatio: [.7,.95], projectionScale: 1.2 },
  GLAZED_BAY: { heroes: ['BAY_WINDOW', 'CANTILEVER_STAIR_TOWER'], supports: ['STONE_PLINTH'], spanRatio: [.6,.85], projectionScale: 1 },
  SOLAR_TERRACE: { heroes: ['SOLAR_SHADE_ROOF', 'ROOF_GARDEN_EDGE'], supports: ['DEEP_OVERHANG'], spanRatio: [.7,.95], projectionScale: 1 },
  BRICK_VEIL: { heroes: ['PERFORATED_BRICK_WALL'], supports: ['WOOD_SPINE'], spanRatio: [.65,.9], projectionScale: 1 },
  SCULPTED_TOWER: { heroes: ['CHIMNEY_TOWER', 'CANTILEVER_STAIR_TOWER'], supports: ['TIMBER_BATTEN'], spanRatio: [.5,.75], projectionScale: 1 },
  GARDEN_GATE: { heroes: ['GATE_PORTAL'], supports: ['ROOF_GARDEN_EDGE'], spanRatio: [.75,.95], projectionScale: 1 },
  COURT_PERGOLA: { heroes: ['PERGOLA_COURT'], supports: ['PERFORATED_BRICK_WALL'], spanRatio: [.6,.9], projectionScale: 1, requiresCourtyard: true },
  POOL_RETREAT: { heroes: ['POOL_PAVILION'], supports: ['ROOF_GARDEN_EDGE'], spanRatio: [.7,.95], projectionScale: 1 },
  FRAMED_MODERN: { heroes: ['C_FRAME', 'RECTANGLE_FRAME'], supports: ['L_FRAME', 'ENTRY_PORTAL'], spanRatio: [0.72, 0.91], projectionScale: 1.05 },
  FLOATING_BOX: { heroes: ['FLOATING_BOX', 'FLOATING_FRAME'], supports: ['DEEP_OVERHANG', 'STONE_SPINE'], spanRatio: [0.68, 0.87], projectionScale: 1.35 },
  INTERLOCKING_MODERN: { heroes: ['INTERLOCKING_BOX', 'CORNER_WRAP_FRAME'], supports: ['PROJECTED_BOX', 'L_FRAME'], spanRatio: [0.67, 0.89], projectionScale: 1.15 },
  MINIMAL_LUXURY: { heroes: ['RECESSED_BOX', 'RECTANGLE_FRAME'], supports: ['ENTRY_PORTAL', 'STONE_SPINE'], spanRatio: [0.55, 0.76], projectionScale: 0.75 },
  WARM_CONTEMPORARY: { heroes: ['WOOD_SPINE', 'L_FRAME'], supports: ['PERGOLA_FRAME', 'DEEP_OVERHANG'], spanRatio: [0.53, 0.72], projectionScale: 0.85 },
  TROPICAL_MODERN: { heroes: ['DEEP_OVERHANG', 'PERGOLA_FRAME'], supports: ['VERTICAL_FIN_SCREEN', 'WOOD_SPINE'], spanRatio: [0.75, 0.94], projectionScale: 1.3 },
  SCREEN_HOUSE: { heroes: ['JALI_SCREEN', 'VERTICAL_FIN_SCREEN'], supports: ['HORIZONTAL_LOUVER', 'ENTRY_PORTAL'], spanRatio: [0.64, 0.87], projectionScale: 0.9 },
  INDIAN_CONTEMPORARY: { heroes: ['ENTRY_PORTAL', 'DOUBLE_HEIGHT_PORTAL'], supports: ['JALI_SCREEN', 'STONE_SPINE'], spanRatio: [0.63, 0.83], projectionScale: 1 },
  VERTICAL_MONOLITH: { heroes: ['VERTICAL_TOWER', 'STONE_SPINE'], supports: ['VERTICAL_FIN_SCREEN', 'ENTRY_PORTAL'], spanRatio: [0.48, 0.68], projectionScale: 1.2 },
  HORIZONTAL_LAYERED: { heroes: ['HORIZONTAL_LOUVER', 'DEEP_OVERHANG'], supports: ['ROOF_FRAME', 'PROJECTED_BOX'], spanRatio: [0.79, 0.95], projectionScale: 1.15 },
  LAYERED_PORTICO: { heroes: ['DOUBLE_HEIGHT_PORTAL', 'ENTRY_PORTAL'], supports: ['HORIZONTAL_LOUVER', 'L_FRAME'], spanRatio: [0.72, 0.94], projectionScale: 1.4 },
  DEEP_REVEAL: { heroes: ['RECESSED_BOX', 'C_FRAME'], supports: ['STONE_SPINE', 'VERTICAL_FIN_SCREEN'], spanRatio: [0.65, 0.88], projectionScale: 1.25 },
  FINNED_PAVILION: { heroes: ['VERTICAL_FIN_SCREEN', 'DEEP_OVERHANG'], supports: ['WOOD_SPINE', 'HORIZONTAL_LOUVER'], spanRatio: [0.78, 0.96], projectionScale: 1.35 },
  SCULPTED_CORNER: { heroes: ['CORNER_WRAP_FRAME', 'INTERLOCKING_BOX'], supports: ['FLOATING_FRAME', 'DEEP_OVERHANG'], spanRatio: [0.6, 0.84], projectionScale: 1.3 },
  COURTYARD_MODERN: { heroes: ['COURTYARD_SCREEN'], supports: ['PERGOLA_FRAME', 'WOOD_SPINE'], spanRatio: [0.65, 0.88], projectionScale: 0.9, requiresCourtyard: true },
  /* Farnsworth / Stahl: a deep thin roof slab on slim posts, a solid base */
  GLASS_PAVILION: { heroes: ['FREEFORM_CANOPY', 'DEEP_OVERHANG'], supports: ['STONE_PLINTH', 'HORIZONTAL_LOUVER'], spanRatio: [0.78, 0.96], projectionScale: 1.3 },
  /* Eames: a black steel grid of mullions and transoms over the walls */
  STEEL_FRAME_GRID: { heroes: ['STEEL_GRID'], supports: ['PROJECTED_BOX', 'DEEP_OVERHANG'], spanRatio: [0.62, 0.92], projectionScale: 1 },
  /* Kogelhof / Tugendhat: a long bar lifted over a stone plinth */
  RAISED_BAR: { heroes: ['FLOATING_BOX', 'FLOATING_FRAME'], supports: ['STONE_PLINTH', 'DEEP_OVERHANG'], spanRatio: [0.8, 0.96], projectionScale: 1.4 },
  /* Maison Louis Carré: stepped white volumes, timber in the openings */
  STEPPED_WHITE: { heroes: ['TIMBER_BATTEN', 'RECESSED_BOX'], supports: ['DEEP_OVERHANG', 'STONE_PLINTH'], spanRatio: [0.55, 0.8], projectionScale: 1 },
  /* Casa das Canoas: a free-standing canopy over the living terrace */
  FREE_CANOPY: { heroes: ['FREEFORM_CANOPY'], supports: ['VERTICAL_FIN_SCREEN', 'WOOD_SPINE'], spanRatio: [0.7, 0.95], projectionScale: 1.3 },
  /* Can Lis: a stone colonnade round an outdoor room */
  STONE_COLONNADE: { heroes: ['COLONNADE'], supports: ['STONE_PLINTH', 'PERGOLA_FRAME'], spanRatio: [0.75, 0.95], projectionScale: 1.2 },
  /* Villa Mairea: a timber porte-cochère, battened upper walls, a stone base */
  TIMBER_PORTICO: { heroes: ['FREEFORM_CANOPY', 'ENTRY_PORTAL'], supports: ['TIMBER_BATTEN', 'STONE_PLINTH'], spanRatio: [0.6, 0.85], projectionScale: 1.15 },
}

const UI_FAMILY_POOL: Partial<Record<Character, readonly ArchitecturalFamily[]>> = {
  'modern-box': ['FRAMED_MODERN', 'FLOATING_BOX', 'INTERLOCKING_MODERN', 'MINIMAL_LUXURY', 'VERTICAL_MONOLITH', 'HORIZONTAL_LAYERED', 'DEEP_REVEAL', 'SCULPTED_CORNER',
    'GLASS_PAVILION', 'STEEL_FRAME_GRID', 'RAISED_BAR', 'FOLDED_PAVILION', 'GLAZED_BAY', 'SOLAR_TERRACE'],
  'contemporary-indian': ['WARM_CONTEMPORARY', 'TROPICAL_MODERN', 'SCREEN_HOUSE', 'INDIAN_CONTEMPORARY', 'VERTICAL_MONOLITH', 'LAYERED_PORTICO', 'FINNED_PAVILION',
    'STEPPED_WHITE', 'FREE_CANOPY', 'BRICK_VEIL', 'SCULPTED_TOWER', 'GARDEN_GATE'],
  'courtyard-indian': ['COURTYARD_MODERN', 'TROPICAL_MODERN', 'SCREEN_HOUSE', 'INDIAN_CONTEMPORARY', 'WARM_CONTEMPORARY', 'LAYERED_PORTICO', 'FINNED_PAVILION',
    'STONE_COLONNADE', 'TIMBER_PORTICO', 'COURT_PERGOLA', 'POOL_RETREAT'],
}

/** the families a style draws from (every family when the style has no pool) */
export const styleFamilyPool = (character?: Character): readonly ArchitecturalFamily[] =>
  (character && UI_FAMILY_POOL[character]) || ARCHITECTURAL_FAMILIES

/** the families that define a style; chosen three times as often as the rest */
const SIGNATURE: Partial<Record<Character, readonly ArchitecturalFamily[]>> = {
  'contemporary-indian': ['STEPPED_WHITE', 'FREE_CANOPY', 'LAYERED_PORTICO'],
  'courtyard-indian': ['COURTYARD_MODERN', 'STONE_COLONNADE', 'TIMBER_PORTICO'],
}

export const architecturalFamilyFitsPlan = (building: BuildingModel, family: ArchitecturalFamily): boolean =>
  !ARCHITECTURAL_FAMILY_RECIPES[family].requiresCourtyard ||
  building.floors.some((floor) => floor.courtyard && floor.courtyard.w > 0 && floor.courtyard.h > 0)

export function chooseArchitecturalFamily(building: BuildingModel, seed: number, character?: Character): ArchitecturalFamily {
  const pool = (character && UI_FAMILY_POOL[character]) || ARCHITECTURAL_FAMILIES
  const compatible = pool.filter((family) => architecturalFamilyFitsPlan(building, family))
  if (!compatible.length) throw new Error('No architectural composition fits the source plan')
  const signature = (character && SIGNATURE[character]) ?? []
  const rng = makeRng(seed, `${building.compositionId ?? building.planId}|architectural-family-v1|${character ?? 'any'}`)
  return signature.length
    ? rng.weighted(compatible.map((family) => [family, signature.includes(family) ? 3 : 1] as [ArchitecturalFamily, number]))
    : rng.pick(compatible)
}
