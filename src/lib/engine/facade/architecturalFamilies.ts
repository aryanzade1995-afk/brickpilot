import type { BuildingModel } from '../buildingModel.ts'
import { makeRng } from '../massing/rng.ts'
import type { Character } from '../../model/brief.ts'
import type { ArchitecturalFeatureType } from './proceduralTypes.ts'

/** Composition families are internal geometry recipes, not additional UI styles. */
export const ARCHITECTURAL_FAMILIES = [
  'FRAMED_MODERN', 'FLOATING_BOX', 'INTERLOCKING_MODERN', 'MINIMAL_LUXURY',
  'WARM_CONTEMPORARY', 'TROPICAL_MODERN', 'SCREEN_HOUSE',
  'INDIAN_CONTEMPORARY', 'VERTICAL_MONOLITH', 'HORIZONTAL_LAYERED',
  'COURTYARD_MODERN',
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
  COURTYARD_MODERN: { heroes: ['COURTYARD_SCREEN'], supports: ['PERGOLA_FRAME', 'WOOD_SPINE'], spanRatio: [0.65, 0.88], projectionScale: 0.9, requiresCourtyard: true },
}

const UI_FAMILY_POOL: Partial<Record<Character, readonly ArchitecturalFamily[]>> = {
  'modern-box': ['FRAMED_MODERN', 'FLOATING_BOX', 'INTERLOCKING_MODERN', 'MINIMAL_LUXURY', 'VERTICAL_MONOLITH', 'HORIZONTAL_LAYERED'],
  'contemporary-indian': ['WARM_CONTEMPORARY', 'TROPICAL_MODERN', 'SCREEN_HOUSE', 'INDIAN_CONTEMPORARY', 'VERTICAL_MONOLITH'],
  'courtyard-indian': ['COURTYARD_MODERN', 'TROPICAL_MODERN', 'SCREEN_HOUSE', 'INDIAN_CONTEMPORARY', 'WARM_CONTEMPORARY'],
}

export const architecturalFamilyFitsPlan = (building: BuildingModel, family: ArchitecturalFamily): boolean =>
  !ARCHITECTURAL_FAMILY_RECIPES[family].requiresCourtyard ||
  building.floors.some((floor) => floor.courtyard && floor.courtyard.w > 0 && floor.courtyard.h > 0)

export function chooseArchitecturalFamily(building: BuildingModel, seed: number, character?: Character): ArchitecturalFamily {
  const pool = (character && UI_FAMILY_POOL[character]) || ARCHITECTURAL_FAMILIES
  const compatible = pool.filter((family) => architecturalFamilyFitsPlan(building, family))
  if (!compatible.length) throw new Error('No architectural composition fits the source plan')
  return makeRng(seed, `${building.planId}|architectural-family-v1|${character ?? 'any'}`).pick(compatible)
}
