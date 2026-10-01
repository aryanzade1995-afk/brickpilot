import { rectUnionArea, rectUnionBBox, type Rect } from '../../geometry.ts'
import type { BuildingModel } from '../buildingModel.ts'
import type { VillaDesignDNA } from '../villaDesignDna.ts'
import { massRect } from '../massing/transforms.ts'
import { MASSING_FAMILIES, type MassingModel } from '../massing/model.ts'
import { ARCHITECTURAL_FAMILIES } from '../facade/architecturalFamilies.ts'
import { ARCHITECTURAL_FEATURE_TYPES, type ProceduralFacadeModel } from '../facade/proceduralTypes.ts'
import { ROOFLINE_TYPES } from '../facade/specialized/types.ts'

/** Schema constants belong to the fingerprint, never to architectural limits.
 * Changing the sampling/layout requires a new schema version and fresh history. */
export const FINGERPRINT_SCHEMA_VERSION = 2 as const
const GRID = 16, MAX_FLOORS = 8, MAX_BLOCKS = 64
const MAX_HEIGHT_MM = 30000, MAX_SPAN_MM = 60000, ROOF_RANGE_MM = 5000
const HERO_TYPES = [...ARCHITECTURAL_FEATURE_TYPES, 'NONE']
const ROOFS = [...ROOFLINE_TYPES, 'NONE']
const clamp = (x: number) => Math.max(0, Math.min(1, x))
const normalized = (x: number) => Number(clamp(x).toFixed(6))
type Box = Rect & { z: number; height: number }
type Block = { ratio: number; position: [number, number, number]; dimensions: [number, number, number] }
type OutdoorTopology = { count: number; accessCount: number; footprint: number[]; floorFootprints: number[][]; accessPoints: number[][] }

export type VillaShapeFingerprint = {
  schemaVersion: 2; sourcePlanId: string; seed: number
  massingFamily: string; blockCount: number; blockRatios: number[]; blockPositions: number[][]
  floorFootprints: number[][]; upperFloorCoverage: number; upperFloorOffsets: number[][]
  frontSilhouette: number[]; sideSilhouette: number[]
  courtyardPresence: boolean; courtyardRatio: number; cantileverAmount: number
  terraceTopology: OutdoorTopology; balconyTopology: OutdoorTopology
  heroFeature: string; facadeFamily: string; rooflineType: string; verticalFeature: number[]
  voidRatio: number; overallHeight: number
  /** Every element is in [0,1]. Units, colors, finishes and seed are not inputs. */
  vector: number[]
}
export type ShapeFingerprintRecord = Pick<VillaShapeFingerprint,
  'schemaVersion' | 'sourcePlanId' | 'seed' | 'massingFamily' | 'heroFeature' | 'facadeFamily' | 'rooflineType' | 'vector'>

/** Each group is compared separately, so padding/empty cells cannot swamp shape.
 * 94% of the score measures realized geometry; labels contribute at most 6%. */
export const FINGERPRINT_GROUPS = [
  { name: 'floorFootprints', size: GRID * GRID * MAX_FLOORS, weight: 0.14, metric: 'iou' },
  { name: 'frontSilhouette', size: GRID * GRID, weight: 0.13, metric: 'iou' },
  { name: 'sideSilhouette', size: GRID * GRID, weight: 0.13, metric: 'iou' },
  { name: 'roofShape', size: GRID * GRID, weight: 0.18, metric: 'iou' },
  { name: 'upperFloors', size: MAX_FLOORS * 3, weight: 0.08, metric: 'distance' },
  { name: 'heroGeometry', size: GRID * GRID * 2, weight: 0.10, metric: 'iou' },
  { name: 'terraces', size: GRID * GRID * MAX_FLOORS + MAX_BLOCKS * 3 + 2, weight: 0.035, metric: 'iou' },
  { name: 'balconies', size: GRID * GRID * MAX_FLOORS + MAX_BLOCKS * 3 + 2, weight: 0.035, metric: 'iou' },
  { name: 'blocks', size: MAX_BLOCKS * 7 + 1, weight: 0.03, metric: 'distance' },
  { name: 'dimensionsAndVoids', size: 8, weight: 0.04, metric: 'distance' },
  { name: 'verticalGeometry', size: GRID * GRID * 2, weight: 0.04, metric: 'iou' },
  { name: 'identity', size: MASSING_FAMILIES.length + ARCHITECTURAL_FAMILIES.length + HERO_TYPES.length + ROOFS.length,
    weight: 0.06, metric: 'identity' },
] as const
export const FINGERPRINT_VECTOR_LENGTH = FINGERPRINT_GROUPS.reduce((n, g) => n + g.size, 0)

function intersection(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y)
  const w = Math.min(a.x + a.w, b.x + b.w) - x, h = Math.min(a.y + a.h, b.y + b.h) - y
  return w > 0 && h > 0 ? { x, y, w, h } : null
}

/** Fractional cell coverage, rather than point samples that miss thin frames. */
function raster(rects: Rect[], bounds: Rect): number[] {
  const values: number[] = [], w = bounds.w / GRID, h = bounds.h / GRID
  for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
    const cell = { x: bounds.x + i * w, y: bounds.y + j * h, w, h }
    const pieces = rects.map((r) => intersection(r, cell)).filter((r): r is Rect => r !== null)
    values.push(normalized(rectUnionArea(pieces) / (w * h)))
  }
  return values
}
const oneHot = (value: string, choices: readonly string[]) => choices.map((v) => Number(v === value))
const pad = (values: number[], size: number) => values.concat(Array(Math.max(0, size - values.length)).fill(0)).slice(0, size)
const projected = (boxes: Box[], side: boolean): Rect[] => boxes.map((b) => ({
  x: side ? b.y : b.x, y: b.z, w: side ? b.h : b.w, h: b.height,
}))

/** Distance from upper-plate vertices/cell centres to the lower union. Unlike
 * bounding boxes this detects unsupported projections into L/U-shaped voids. */
function unsupportedProjection(upper: Rect[], lower: Rect[]): number {
  const xs = [...new Set([...upper, ...lower].flatMap((r) => [r.x, r.x + r.w]))].sort((a, b) => a - b)
  const ys = [...new Set([...upper, ...lower].flatMap((r) => [r.y, r.y + r.h]))].sort((a, b) => a - b)
  const samples = (values: number[]) => values.flatMap((v, i) => i ? [(v + values[i - 1]) / 2, v] : [v])
  let projection = 0
  for (const x of samples(xs)) for (const y of samples(ys)) {
    if (!upper.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)) continue
    const distance = Math.min(...lower.map((r) => Math.hypot(Math.max(r.x - x, 0, x - r.x - r.w),
      Math.max(r.y - y, 0, y - r.y - r.h))))
    projection = Math.max(projection, distance)
  }
  return projection
}

/** Measures the final valid masses/feature solids, not unrealized random DNA
 * parameters. The authoritative plan is never changed by this adapter. */
export function createVillaShapeFingerprint(building: BuildingModel, dna: VillaDesignDNA,
  massing: MassingModel, facade: ProceduralFacadeModel): VillaShapeFingerprint {
  if (massing.status !== 'valid' || facade.status !== 'valid' || facade.specialized?.status === 'rejected')
    throw new Error('Only valid architecture can be fingerprinted')
  if (dna.sourcePlanId !== building.planId || massing.sourcePlanId !== building.planId || facade.sourcePlanId !== building.planId ||
    massing.seed !== dna.seed || facade.massingSeed !== dna.seed)
    throw new Error('Fingerprint inputs must share one plan and seed')
  const floors = [...building.floors].sort((a, b) => a.level - b.level)
  if (!floors.length || floors.length > MAX_FLOORS) throw new RangeError(`Fingerprint supports 1–${MAX_FLOORS} floors`)
  const ground = rectUnionBBox(floors[0].footprint)
  if (!(ground.w > 0 && ground.h > 0)) throw new RangeError('Fingerprint requires a nonempty floor plate')
  const baseZ = floors[0].elevationMm
  const topZ = Math.max(...floors.map((f) => f.elevationMm + f.heightMm))
  // Same plan means the same coordinate frame for every seed, including roof height.
  const bounds = { x: ground.x - ground.w * 0.2, y: ground.y - ground.h * 0.2, w: ground.w * 1.4, h: ground.h * 1.4 }
  const frontBounds = { x: bounds.x, y: baseZ, w: bounds.w, h: topZ - baseZ + ROOF_RANGE_MM }
  const sideBounds = { ...frontBounds, x: bounds.y, w: bounds.h }
  const boxes: Box[] = massing.masses.map((m) => ({ ...massRect(m), z: m.elevation, height: m.height }))
  const features = facade.features.flatMap((f) => f.parts.map((p) => p.world))
  const assemblies = facade.specialized?.assemblies ?? []
  // Include actual architectural depth. Fine window trims and landscaping are
  // deliberately excluded; no material or collection color enters this score.
  const architecturalParts = assemblies.filter((a) => a.category !== 'WINDOW')
    .flatMap((a) => a.parts.filter((p) => p.operation === 'ADD' && !['finish', 'cladding', 'glass', 'planter'].includes(p.role))
      .map((p) => p.world))
  const silhouetteBoxes = [...boxes, ...features, ...architecturalParts]
  const frontSilhouette = raster(projected(silhouetteBoxes, false), frontBounds)
  const sideSilhouette = raster(projected(silhouetteBoxes, true), sideBounds)
  const hero = facade.features.find((f) => f.importance === 'hero')
  const heroBoxes = hero?.parts.map((p) => p.world) ?? []
  const heroGeometry = [...raster(projected(heroBoxes, false), frontBounds), ...raster(projected(heroBoxes, true), sideBounds)]
  const roofBoxes = massing.masses.filter((m) => m.usage === 'roof').map((m) => ({ ...massRect(m),
    bottom: m.elevation - topZ, height: m.elevation + m.height - topZ }))
  // Area-integrated height map of exposed roof volumes. Internal mass splits
  // produce identical maps; heights/step-backs affect the vector directly.
  const roofShape = Array(GRID * GRID).fill(0) as number[]
  const heightLevels = [...new Set(roofBoxes.flatMap((b) => [b.bottom, b.height]))].sort((a, b) => a - b)
  let previous = 0
  for (const height of heightLevels) {
    const mid = (previous + height) / 2
    const coverage = raster(roofBoxes.filter((b) => b.height >= mid && b.bottom <= mid), bounds)
    coverage.forEach((value, i) => { roofShape[i] += value * (height - previous) / ROOF_RANGE_MM })
    previous = height
  }
  const floorFootprints = floors.map((f) => raster(f.footprint, bounds))
  const groundArea = rectUnionArea(floors[0].footprint)
  const upper = floors.slice(1).map((f) => {
    const b = rectUnionBBox(f.footprint)
    return [rectUnionArea(f.footprint) / groundArea,
      0.5 + (b.x + b.w / 2 - ground.x - ground.w / 2) / (2 * ground.w),
      0.5 + (b.y + b.h / 2 - ground.y - ground.h / 2) / (2 * ground.h)]
  })
  const blocks = massing.masses.map((m): Block => {
    const r = massRect(m)
    return { ratio: r.w * r.h / groundArea,
      position: [(r.x + r.w / 2 - bounds.x) / bounds.w, (r.y + r.h / 2 - bounds.y) / bounds.h,
        (m.elevation - baseZ) / MAX_HEIGHT_MM],
      dimensions: [r.w / MAX_SPAN_MM, r.h / MAX_SPAN_MM, m.height / MAX_HEIGHT_MM] }
  }).sort((a, b) => b.ratio - a.ratio || a.position[2] - b.position[2] || a.position[1] - b.position[1] || a.position[0] - b.position[0])
  const outdoor = (kind: 'balcony' | 'terrace'): OutdoorTopology => {
    const rooms = building.rooms.filter((r) => r.outdoor && r.id.startsWith(kind))
    const terraces = kind === 'terrace' ? massing.masses.filter((m) => m.usage === 'terrace') : []
    const accessDoors = building.doors.filter((d) => rooms.some((r) => d.floorId === r.floorId &&
      d.rooms?.some((id) => id === r.semanticId || id === r.id)))
    const accessPoints = accessDoors.map((d) => [(d.at.x - bounds.x) / bounds.w, (d.at.y - bounds.y) / bounds.h,
      floors.findIndex((f) => f.id === d.floorId) / MAX_FLOORS]).sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0])
    // Roof terrace assemblies have already passed access validation.
    const roofTerraces = kind === 'terrace' ? assemblies.filter((a) => a.category === 'ROOFLINE' &&
      ['ROOF_TERRACE', 'SCREENED_TERRACE'].includes(a.type)) : []
    const roofRects = roofTerraces.flatMap((a) => a.parts.map((p) => p.world))
    const rects = [...rooms.map((r) => r.rect), ...terraces.map(massRect), ...roofRects]
    const floorFootprints = floors.map((f, i) => raster([...rooms.filter((r) => r.floorId === f.id).map((r) => r.rect),
      ...terraces.filter((m) => m.floor === f.level).map(massRect), ...(i === floors.length - 1 ? roofRects : [])], bounds))
    for (const a of roofTerraces) {
      const stair = building.stairs.find((s) => a.parts.some((p) => p.anchor.floorId === s.floorId))
      if (stair) accessPoints.push([(stair.rect.x + stair.rect.w / 2 - bounds.x) / bounds.w,
        (stair.rect.y + stair.rect.h / 2 - bounds.y) / bounds.h, (floors.length - 1) / MAX_FLOORS])
    }
    return { count: rooms.length + terraces.length + roofTerraces.length,
      accessCount: accessDoors.length + roofTerraces.length, footprint: raster(rects, bounds), floorFootprints,
      accessPoints: accessPoints.map((p) => p.map(normalized)) }
  }
  const balconyTopology = outdoor('balcony'), terraceTopology = outdoor('terrace')
  const courtyards = floors.flatMap((f) => f.courtyard ? [f.courtyard] : [])
  const courtyardArea = rectUnionArea(courtyards), courtyardRatio = courtyardArea / (groundArea + courtyardArea)
  // Measure upper-plate projection beyond the supported footprint, not DNA intent.
  let cantileverAmount = 0
  floors.slice(1).forEach((f, i) => {
    cantileverAmount = Math.max(cantileverAmount, unsupportedProjection(f.footprint, floors[i].footprint))
  })
  for (const mass of massing.masses.filter((m) => m.usage === 'roof' && m.elevation > topZ)) {
    const supports = massing.masses.filter((m) => m.usage === 'roof' && Math.abs(m.elevation + m.height - mass.elevation) < 2)
    if (supports.length) cantileverAmount = Math.max(cantileverAmount, unsupportedProjection([massRect(mass)], supports.map(massRect)))
  }
  const verticalBoxes = [...massing.masses.filter((m) => m.role === 'verticalFeature').map((m) => ({
    ...massRect(m), z: m.elevation, height: m.height })),
    ...facade.features.filter((f) => ['STONE_SPINE', 'WOOD_SPINE', 'VERTICAL_TOWER'].includes(f.type))
      .flatMap((f) => f.parts.map((p) => p.world))]
  const verticalFeature = [...raster(projected(verticalBoxes, false), frontBounds), ...raster(projected(verticalBoxes, true), sideBounds)]
  const voidRatio = 1 - floors.reduce((sum, f) => sum + rectUnionArea(f.footprint) * f.heightMm, 0) /
    (ground.w * ground.h * floors.reduce((sum, f) => sum + f.heightMm, 0))
  const overallHeight = Math.max(...silhouetteBoxes.map((b) => b.z + b.height)) - baseZ
  const rooflineType = assemblies.find((a) => a.category === 'ROOFLINE')?.type ?? 'NONE'
  const identity = [...oneHot(massing.family, MASSING_FAMILIES), ...oneHot(facade.architecturalFamily, ARCHITECTURAL_FAMILIES),
    ...oneHot(hero?.type ?? 'NONE', HERO_TYPES), ...oneHot(rooflineType, ROOFS)]
  const vector = [...pad(floorFootprints.flat(), GRID * GRID * MAX_FLOORS), ...frontSilhouette, ...sideSilhouette,
    ...roofShape, ...pad(upper.flat(), MAX_FLOORS * 3), ...heroGeometry,
    ...pad(terraceTopology.floorFootprints.flat(), GRID * GRID * MAX_FLOORS),
    ...pad(terraceTopology.accessPoints.flat(), MAX_BLOCKS * 3), terraceTopology.count / MAX_BLOCKS, terraceTopology.accessCount / MAX_BLOCKS,
    ...pad(balconyTopology.floorFootprints.flat(), GRID * GRID * MAX_FLOORS),
    ...pad(balconyTopology.accessPoints.flat(), MAX_BLOCKS * 3), balconyTopology.count / MAX_BLOCKS, balconyTopology.accessCount / MAX_BLOCKS,
    blocks.length / MAX_BLOCKS, ...pad(blocks.flatMap((b) => [b.ratio, ...b.position, ...b.dimensions]), MAX_BLOCKS * 7),
    ground.w / MAX_SPAN_MM, ground.h / MAX_SPAN_MM, overallHeight / MAX_HEIGHT_MM,
    Number(courtyards.length > 0), courtyardRatio, cantileverAmount / MAX_SPAN_MM, voidRatio, floors.length / MAX_FLOORS,
    ...verticalFeature, ...identity].map(normalized)
  if (vector.length !== FINGERPRINT_VECTOR_LENGTH || vector.some((n) => !Number.isFinite(n)))
    throw new Error('Geometry could not be normalized into a valid fingerprint')
  return { schemaVersion: FINGERPRINT_SCHEMA_VERSION, sourcePlanId: building.planId, seed: dna.seed,
    massingFamily: massing.family, blockCount: blocks.length, blockRatios: blocks.map((b) => normalized(b.ratio)),
    blockPositions: blocks.map((b) => b.position.map(normalized)), floorFootprints,
    upperFloorCoverage: upper.at(-1)?.[0] ?? 0, upperFloorOffsets: upper.map((u) => u.slice(1).map(normalized)),
    frontSilhouette, sideSilhouette, courtyardPresence: courtyards.length > 0, courtyardRatio: normalized(courtyardRatio),
    cantileverAmount, terraceTopology, balconyTopology, heroFeature: hero?.type ?? 'NONE',
    facadeFamily: facade.architecturalFamily, rooflineType, verticalFeature, voidRatio: normalized(voidRatio), overallHeight, vector }
}

export function fingerprintRecord(f: VillaShapeFingerprint): ShapeFingerprintRecord {
  return { schemaVersion: f.schemaVersion, sourcePlanId: f.sourcePlanId, seed: f.seed,
    massingFamily: f.massingFamily, heroFeature: f.heroFeature, facadeFamily: f.facadeFamily,
    rooflineType: f.rooflineType, vector: [...f.vector] }
}

/** Weighted fractional intersection/union for occupancy maps, absolute distance
 * for descriptors. Unlike cosine, common empty cells add no similarity. */
export function villaShapeSimilarity(a: ShapeFingerprintRecord, b: ShapeFingerprintRecord): number {
  if (a.schemaVersion !== FINGERPRINT_SCHEMA_VERSION || b.schemaVersion !== FINGERPRINT_SCHEMA_VERSION ||
    a.vector.length !== FINGERPRINT_VECTOR_LENGTH || b.vector.length !== FINGERPRINT_VECTOR_LENGTH ||
    [...a.vector, ...b.vector].some((x) => !Number.isFinite(x) || x < 0 || x > 1))
    throw new Error('Incompatible or invalid shape fingerprint')
  let at = 0, score = 0
  const groupScores = new Map<string, number>()
  for (const group of FINGERPRINT_GROUPS) {
    let intersection = 0, union = 0, distance = 0
    for (let i = at; i < at + group.size; i++) {
      intersection += Math.min(a.vector[i], b.vector[i]); union += Math.max(a.vector[i], b.vector[i])
      distance += Math.abs(a.vector[i] - b.vector[i])
    }
    const similarity = group.metric === 'distance' ? 1 - distance / group.size : union ? intersection / union : 1
    score += group.weight * similarity
    groupScores.set(group.name, similarity)
    at += group.size
  }
  // Renaming a family/hero or splitting identical solids cannot make an exact
  // physical duplicate novel. Block count remains available for diagnostics.
  const surfaces = ['floorFootprints', 'frontSilhouette', 'sideSilhouette', 'roofShape', 'heroGeometry',
    'terraces', 'balconies', 'dimensionsAndVoids', 'upperFloors']
  if (surfaces.every((name) => groupScores.get(name) === 1)) return 1
  return normalized(score)
}

/** Whitelist persisted fields, discard stale/malformed records; never trust
 * vectors restored from browser storage or an external history JSON file. */
export function parseFingerprintHistory(value: unknown, limit = 50): ShapeFingerprintRecord[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new RangeError('Invalid fingerprint history limit')
  if (!Array.isArray(value)) return []
  return value.slice(-limit).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const f = item as ShapeFingerprintRecord
    if (f.schemaVersion !== FINGERPRINT_SCHEMA_VERSION || !Number.isSafeInteger(f.seed) ||
      typeof f.sourcePlanId !== 'string' || !f.sourcePlanId.length || f.sourcePlanId.length > 128 ||
      !MASSING_FAMILIES.some((v) => v === f.massingFamily) || !ARCHITECTURAL_FAMILIES.some((v) => v === f.facadeFamily) ||
      !HERO_TYPES.some((v) => v === f.heroFeature) || !ROOFS.some((v) => v === f.rooflineType) ||
      !Array.isArray(f.vector) || f.vector.length !== FINGERPRINT_VECTOR_LENGTH ||
      f.vector.some((n) => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1)) return []
    return [{ schemaVersion: FINGERPRINT_SCHEMA_VERSION, sourcePlanId: f.sourcePlanId, seed: f.seed,
      massingFamily: f.massingFamily, heroFeature: f.heroFeature, facadeFamily: f.facadeFamily,
      rooflineType: f.rooflineType, vector: [...f.vector] }]
  })
}
