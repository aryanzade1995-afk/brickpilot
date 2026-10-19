import type { Rect } from '../geometry.ts'
import { rectUnionArea, rectUnionBBox } from '../geometry.ts'
import { compile } from '../model/canonical.ts'
import type { Brief } from '../model/brief.ts'
import { generate } from './generate.ts'
import { generateAlternativeDesign } from './generateAlternativeDesign.ts'
import { SITE_FORM_VERSION, compositionFamilies, siteFamilyOrder, setbackTerraceArea } from './siteForm.ts'
import { validate } from '../rules/index.ts'
import type { Design } from './types.ts'
import type { MassingType } from './massing/types.ts'
import { makeRng, fnv } from './massing/rng.ts'

export type BuildingShape = { key: string; floors: Rect[][] }
export type BuildingShapeInput = { brief: Brief; seed: number; current: Design; history: BuildingShape[] }
export const MIN_BUILDING_SHAPE_CHANGE = .12

/** The union of occupied floor plates, anchored at the building origin.
 * Room partitions, facade accessories, colours, seeds and plot translation
 * cannot create a new identity. Keep real dimensions and upper-floor offsets. */
export function buildingShape(design: Design): BuildingShape {
  const bounds = rectUnionBBox(design.floors.flatMap(f => f.footprint))
  const floors = design.floors.map(f => f.footprint.map(r => ({
    x: r.x - bounds.x, y: r.y - bounds.y, w: r.w, h: r.h,
  })))
  // Canonical grid occupancy represents the UNION, not the number of room rects.
  const cells: string[] = []
  for (const [level, plate] of floors.entries()) {
    const area = rectUnionArea(plate)
    const box = rectUnionBBox(plate)
    const grid = 32
    const mask = Array.from({ length: grid * grid }, (_, index) => {
      const x = bounds.w * ((index % grid) + .5) / grid
      const y = bounds.h * (Math.floor(index / grid) + .5) / grid
      return plate.some(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) ? '1' : '0'
    }).join('')
    cells.push(`${level}:${Math.round(area / 10000)}:${[box.x, box.y, box.w, box.h].map(n => Math.round(n / 100)).join(',')}:${mask}`)
  }
  return { key: fnv(cells.join('|')).toString(16), floors }
}

/** Exact union-area difference, so moving a partition or renaming a family
 * cannot pass the overall-building-shape check. */
export function buildingShapeDifference(a: BuildingShape, b: BuildingShape): number {
  let union = 0, difference = 0
  for (let level = 0; level < Math.max(a.floors.length, b.floors.length); level++) {
    const ap = a.floors[level] ?? [], bp = b.floors[level] ?? []
    const intersections: Rect[] = []
    for (const ar of ap) for (const br of bp) {
      const x = Math.max(ar.x, br.x), y = Math.max(ar.y, br.y)
      const w = Math.min(ar.x + ar.w, br.x + br.w) - x
      const h = Math.min(ar.y + ar.h, br.y + br.h) - y
      if (w > 0 && h > 0) intersections.push({ x, y, w, h })
    }
    const aa = rectUnionArea(ap), ba = rectUnionArea(bp), overlap = rectUnionArea(intersections)
    union += aa + ba - overlap
    difference += aa + ba - 2 * overlap
  }
  return difference / Math.max(1, union)
}

export function parseBuildingShapes(value: unknown): BuildingShape[] {
  if (!Array.isArray(value)) return []
  return value.filter((s): s is BuildingShape => typeof s?.key === 'string' && Array.isArray(s.floors) &&
    s.floors.length > 0 && s.floors.length <= 4 && s.floors.every((f: unknown) => Array.isArray(f) && f.length <= 500 && f.every((r: Rect) =>
      r && [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0))).slice(-1000)
}

/** Replan the actual house before building its exterior. Failed searches
 * return null; they never accept a decorative change as a new building. */
export function findNewBuildingShape(input: BuildingShapeInput): { design: Design; change: number; tried: number } | null {
  const model = compile(input.brief), rng = makeRng(input.seed, 'building-shapes-v1')
  const courtyard = input.brief.style.character === 'courtyard-indian' || input.brief.rooms.priorities.courtyard
  const wingSite = model.envelope.width >= 15000 && model.envelope.depth >= 18000
  const families: MassingType[] = courtyard ? ['courtyard-ring', 'courtyard']
    : [...(wingSite ? ['u-wing', 'pavilion', 'twin-wing', 'courtyard-ring'] as MassingType[] : []), 'l-shape', 'stepped', 'courtyard', 'rectangular']
  const ranked = compositionFamilies(model)??siteFamilyOrder(model, families as import('./planner/types.ts').PlateFamily[])
  const order = ranked.map((family,index) => ({ family, order: Math.floor(index/2)+rng.next() }))
    .sort((a, b) => Number(a.family === input.current.massingType) - Number(b.family === input.current.massingType) || a.order - b.order)
  const current = buildingShape(input.current), history = [...input.history, current]
  const keys = new Set(history.map(s => s.key))
  let tried = 0
  let fallback: { design: Design; change: number; tried: number } | null = null
  for (let round = 0; round < 3; round++) for (const { family } of order) {
    const seed = (input.seed + tried++ * 7919) >>> 0
    const design = generate(model, { massing: family, seed, formVersion:SITE_FORM_VERSION })
    if (!validate(design).hardChecksPass) continue
    const shape = buildingShape(design)
    if (keys.has(shape.key)) continue
    const change = buildingShapeDifference(shape, current)
    if (change < MIN_BUILDING_SHAPE_CHANGE || history.some(previous => buildingShapeDifference(shape, previous) < MIN_BUILDING_SHAPE_CHANGE)) continue
    try { generateAlternativeDesign(design, input.seed) } catch { continue }
    const result={design,change,tried}
    if(design.floors.length===1||setbackTerraceArea(design)>=6)return result
    fallback??=result
    if(tried>=6)return fallback
  }
  return fallback
}
