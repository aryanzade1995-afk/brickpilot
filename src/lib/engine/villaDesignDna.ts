import { rectUnionArea } from '../geometry.ts'
import type { DesignDNA } from './designDna.ts'
import type { BuildingModel } from './buildingModel.ts'
import { makeRng } from './massing/rng.ts'
import { assessMassingFamilies } from './massing/families.ts'
import type { MassingFamily } from './massing/model.ts'
import type { Character } from '../model/brief.ts'
import { chooseArchitecturalFamily, type ArchitecturalFamily } from './facade/architecturalFamilies.ts'

export type VillaDesignDNA = {
  schemaVersion: 3
  sourcePlanId: string
  seed: number
  /** A seeded choice among families compatible with the existing 2D plan. */
  massingFamily: MassingFamily
  sourcePlateFamily: BuildingModel['orientation']['plateFamily']
  compositionType: 'layered-terrace' | 'tower-and-wing' | 'interlocking-frames' | 'split-canopy' | 'courtyard-wrap'
  /** Articulation blocks are exterior features; they never replace plan rooms or slabs. */
  blockCount: number
  blockRatios: number[]
  blockOffsets: { xMm: number; yMm: number }[]
  blockRotations: (0 | 90 | 180 | 270)[]
  /** These three fields report the existing upper plate; they are not random edits. */
  upperFloorStrategy: 'single-storey' | 'full-stack' | 'setback' | 'split-plate'
  upperFloorCoverage: number
  upperFloorOffset: { xMm: number; yMm: number }
  /** Seeded limits for non-enclosed facade/roof elements, in millimetres. */
  recessDepth: number
  projectionDepth: number
  cantileverAmount: number
  facadeFamily: 'vertical' | 'horizontal' | 'layered' | 'screened' | 'framed'
  architecturalFamily: ArchitecturalFamily
  /** the brief's style; a family that cannot fit falls back within this style first */
  character?: Character
  heroFeature: 'entry-portal' | 'roof-frame' | 'screen-tower' | 'deep-canopy' | 'terrace-pergola'
  secondaryFeature: 'corner-frame' | 'planter-band' | 'shade-fins' | 'clerestory' | 'parapet-step'
  balconyType: 'none' | DesignDNA['balconyDesign']
  entranceType: DesignDNA['entranceDesign']
  roofType: 'flat-terrace' | 'raised-parapet' | 'mono-slope' | 'gable' | 'hip' | 'pergola-terrace'
  glazingPattern: 'paired' | 'ribbon' | 'vertical' | 'corner' | 'regular'
  materialPalette: DesignDNA['materialPalette']
  asymmetry: number
  landscapeStyle: DesignDNA['landscapeMood']
}

const round = (value: number, places = 3) => Number(value.toFixed(places))
const center = (r: { x: number; y: number; w: number; h: number }) =>
  ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

/** One numeric seed and one plan identity drive every variable design choice. */
export function createVillaDesignDNA(building: BuildingModel, seed: number, character?: Character): VillaDesignDNA {
  if (!Number.isSafeInteger(seed)) throw new RangeError('VillaDesignDNA seed must be a safe integer')
  if (!building.floors.length) throw new Error('VillaDesignDNA requires at least one plan floor')

  const rng = makeRng(seed, `${building.compositionId ?? building.planId}|villa-design-dna-v1`)
  const families = assessMassingFamilies(building).filter((f) => f.compatible)
  if (!families.length) throw new Error('No massing family is compatible with this floor plan')
  const floors = [...building.floors].sort((a, b) => a.level - b.level)
  const ground = floors[0]
  const upper = floors.at(-1)!
  const hasUpper = upper.level > ground.level
  const groundArea = rectUnionArea(ground.footprint)
  const upperArea = hasUpper ? rectUnionArea(upper.footprint) : 0
  const coverage = hasUpper && groundArea > 0 ? round(upperArea / groundArea, 4) : 0
  const groundCenter = center(ground.outline)
  const upperCenter = center(upper.outline)
  const upperFloorOffset = hasUpper
    ? { xMm: Math.round(upperCenter.x - groundCenter.x), yMm: Math.round(upperCenter.y - groundCenter.y) }
    : { xMm: 0, yMm: 0 }
  const upperFloorStrategy: VillaDesignDNA['upperFloorStrategy'] = !hasUpper ? 'single-storey'
    : upper.footprint.length > 1 ? 'split-plate'
      : coverage < 0.98 ? 'setback' : 'full-stack'

  const compositions: VillaDesignDNA['compositionType'][] = [
    'layered-terrace', 'tower-and-wing', 'interlocking-frames', 'split-canopy',
  ]
  if (building.orientation.plateFamily === 'courtyard') compositions.push('courtyard-wrap')
  const compositionType = rng.pick(compositions)
  const blockCount = rng.int(2, 4)
  const rawRatios = Array.from({ length: blockCount }, () => rng.range(0.6, 1.4))
  const ratioTotal = rawRatios.reduce((sum, ratio) => sum + ratio, 0)
  const blockRatios = rawRatios.slice(0, -1).map((ratio) => round(ratio / ratioTotal, 6))
  blockRatios.push(round(1 - blockRatios.reduce((sum, ratio) => sum + ratio, 0), 6))
  const blockOffsets = Array.from({ length: blockCount }, () => ({
    xMm: rng.int(-Math.min(1000, Math.floor(ground.outline.w / 10)), Math.min(1000, Math.floor(ground.outline.w / 10))),
    yMm: rng.int(-Math.min(1000, Math.floor(ground.outline.h / 10)), Math.min(1000, Math.floor(ground.outline.h / 10))),
  }))
  const blockRotations = Array.from({ length: blockCount }, () => rng.pick([0, 90, 180, 270] as const))
  const hasBalcony = building.rooms.some((room) => room.outdoor && room.id.startsWith('balcony'))

  return {
    schemaVersion: 3,
    sourcePlanId: building.planId,
    seed,
    massingFamily: makeRng(seed, `${building.compositionId ?? building.planId}|massing-family-v1`).pick(families).family,
    sourcePlateFamily: building.orientation.plateFamily,
    compositionType,
    blockCount,
    blockRatios,
    blockOffsets,
    blockRotations,
    upperFloorStrategy,
    upperFloorCoverage: coverage,
    upperFloorOffset,
    recessDepth: rng.int(180, 650),
    projectionDepth: rng.int(450, 1200),
    cantileverAmount: hasUpper ? rng.int(0, 900) : 0,
    facadeFamily: rng.pick(['vertical', 'horizontal', 'layered', 'screened', 'framed'] as const),
    architecturalFamily: chooseArchitecturalFamily(building, seed, character),
    ...(character ? { character } : {}),
    heroFeature: rng.pick(['entry-portal', 'roof-frame', 'screen-tower', 'deep-canopy', 'terrace-pergola'] as const),
    secondaryFeature: rng.pick(['corner-frame', 'planter-band', 'shade-fins', 'clerestory', 'parapet-step'] as const),
    balconyType: hasBalcony ? rng.pick([
      'glass-floating', 'recessed', 'solid-parapet', 'metal-rail', 'timber-screened', 'planter-balcony',
    ] as const) : 'none',
    entranceType: rng.pick([
      'vertical-portal', 'horizontal-canopy', 'stone-pier', 'timber-screen',
      'recessed-entry', 'floating-frame', 'column-portico', 'deep-shadow-entry',
    ] as const),
    roofType: rng.pick(['flat-terrace', 'raised-parapet', 'mono-slope', 'gable', 'hip', 'pergola-terrace'] as const),
    glazingPattern: rng.pick(['paired', 'ribbon', 'vertical', 'corner', 'regular'] as const),
    materialPalette: rng.pick([
      'warm-stone', 'lime-plaster', 'earth', 'travertine-bronze', 'charcoal-oak',
      'kerala-laterite', 'tropical-cream', 'classical-stone',
    ] as const),
    asymmetry: round(rng.range(0.15, 0.9), 4),
    landscapeStyle: rng.pick(['minimal', 'formal', 'natural', 'lush-tropical', 'courtyard'] as const),
  }
}

/** Excludes finishes so a caller can compare architectural proposals. */
export function villaGeometrySignature(dna: VillaDesignDNA): string {
  const {
    massingFamily, compositionType, blockCount, blockRatios, blockOffsets, blockRotations,
    upperFloorStrategy, upperFloorCoverage, upperFloorOffset,
    recessDepth, projectionDepth, cantileverAmount, facadeFamily, architecturalFamily,
    heroFeature, secondaryFeature, balconyType, entranceType, roofType, glazingPattern, asymmetry,
  } = dna
  return JSON.stringify({
    massingFamily, compositionType, blockCount, blockRatios, blockOffsets, blockRotations,
    upperFloorStrategy, upperFloorCoverage, upperFloorOffset,
    recessDepth, projectionDepth, cantileverAmount, facadeFamily, architecturalFamily,
    heroFeature, secondaryFeature, balconyType, entranceType, roofType, glazingPattern, asymmetry,
  })
}
