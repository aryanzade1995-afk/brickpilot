import type { ExistingStructure } from '../engine/planner/types.ts'
import { buildMapping } from './calibrate.ts'
import { CONFIDENCE_FLOOR, type Answers, type Calibration, type Detections, type MapElement, type Pt, type RoadSide } from './types.ts'

/** The As-Built Structural Map: everything physically built, in plan millimetres, every element LOCKED. */
export type AsBuilt = {
  structure: ExistingStructure
  elements: MapElement[]
  /** low-confidence detections the user has not confirmed or removed yet */
  needsConfirmation: string[]
  notes: string[]
  /** bounding box of the structure, mm */
  size: { w: number; d: number }
}
export type AsBuiltResult = { ok: true; value: AsBuilt } | { ok: false; error: string; needsConfirmation: string[] }

const ALIGN_MM = 150

/** snap values that are within `tol` of each other onto their mean (a measurement-noise clean up) */
function snapGroups(values: number[], tol = ALIGN_MM): (v: number) => number {
  const sorted = [...values].sort((a, b) => a - b)
  const groups: number[][] = []
  for (const v of sorted) {
    const last = groups[groups.length - 1]
    if (last && v - last[last.length - 1] <= tol) last.push(v)
    else groups.push([v])
  }
  const means = groups.map((g) => g.reduce((a, b) => a + b, 0) / g.length)
  return (v) => Math.round(means.reduce((best, m) => (Math.abs(m - v) < Math.abs(best - v) ? m : best), means[0] ?? v))
}

/** turn the structure so the road is at plan-south (+y), the direction the planner always faces the entry */
export const rotateToRoad = (p: Pt, road: RoadSide): Pt => {
  switch (road) {
    case 'E': return { x: -p.y, y: p.x }
    case 'W': return { x: p.y, y: -p.x }
    case 'N': return { x: -p.x, y: -p.y }
    default: return { ...p }
  }
}

export function buildAsBuilt(det: Detections, cal: Calibration, answers: Answers, opts: { align?: boolean } = {}): AsBuiltResult {
  const included = <T extends { confidence: number; confirmed: boolean }>(x: T) => x.confirmed || x.confidence >= CONFIDENCE_FLOOR
  const needsConfirmation = [...det.columns, ...det.footings, ...det.beams, ...det.walls].filter((x) => !included(x)).map((x) => x.id)
  const columns = det.columns.filter(included)
  const footings = det.footings.filter(included)
  if (columns.length + footings.length < 2) return { ok: false, error: 'At least two columns or footings are needed to build the structural map.', needsConfirmation }

  const mapping = buildMapping(cal, det.columns)
  if (!mapping.toPlan) return { ok: false, error: mapping.note, needsConfirmation }
  const toPlan = mapping.toPlan
  const raw = (p: Pt) => rotateToRoad(toPlan(p), answers.roadSide)

  const colPts = columns.map((c) => ({ id: c.id, at: raw(c.img) }))
  const footPts = footings.map((f) => ({ id: f.id, at: raw(f.img) }))
  const wallPts = det.walls.filter(included).map((w) => ({ id: w.id, a: raw(w.a), b: raw(w.b) }))
  const all = [...colPts.map((c) => c.at), ...footPts.map((f) => f.at), ...wallPts.flatMap((w) => [w.a, w.b])]
  const minX = Math.min(...all.map((p) => p.x)), minY = Math.min(...all.map((p) => p.y))
  const norm = (p: Pt): Pt => ({ x: Math.round(p.x - minX), y: Math.round(p.y - minY) })
  let placedCols = colPts.map((c) => ({ ...c, at: norm(c.at) }))
  let placedFoot = footPts.map((f) => ({ ...f, at: norm(f.at) }))
  let placedWalls = wallPts.map((w) => ({ ...w, a: norm(w.a), b: norm(w.b) }))
  const notes: string[] = [mapping.note]
  if (opts.align !== false) {
    const sx = snapGroups([...placedCols.map((c) => c.at.x), ...placedFoot.map((f) => f.at.x)])
    const sy = snapGroups([...placedCols.map((c) => c.at.y), ...placedFoot.map((f) => f.at.y)])
    const snap = (p: Pt): Pt => ({ x: sx(p.x), y: sy(p.y) })
    placedCols = placedCols.map((c) => ({ ...c, at: snap(c.at) }))
    placedFoot = placedFoot.map((f) => ({ ...f, at: snap(f.at) }))
    placedWalls = placedWalls.map((w) => ({ ...w, a: snap(w.a), b: snap(w.b) }))
    notes.push('Measured positions within 15 cm of each other were lined up into one clean grid.')
  }
  const at = new Map(placedCols.map((c) => [c.id, c.at]))
  const beams = det.beams.filter(included).filter((b) => at.has(b.a) && at.has(b.b))
    .map((b) => ({ id: b.id, a: at.get(b.a)!, b: at.get(b.b)!, width: answers.beamWidthMm }))
  const structure: ExistingStructure = {
    columns: placedCols.map((c) => ({ id: c.id, at: c.at, size: answers.columnSizeMm })),
    footings: placedFoot.map((f) => ({ id: f.id, at: f.at })),
    beams,
    walls: placedWalls.map((w) => ({ id: w.id, a: w.a, b: w.b, thickness: 230 })),
    storeysBuilt: Math.max(0, Math.min(answers.storeysBuilt, 3)),
  }
  const conf = new Map<string, { confidence: number; confirmed: boolean }>(
    [...det.columns, ...det.footings, ...det.beams, ...det.walls].map((x) => [x.id, { confidence: x.confidence, confirmed: x.confirmed }]))
  const meta = (id: string) => conf.get(id) ?? { confidence: 1, confirmed: true }
  const elements: MapElement[] = [
    ...structure.columns.map((c): MapElement => ({ kind: 'column', id: c.id, at: c.at, size: c.size, state: 'LOCKED', ...meta(c.id) })),
    ...structure.footings.map((f): MapElement => ({ kind: 'footing', id: f.id, at: f.at, state: 'LOCKED', ...meta(f.id) })),
    ...structure.beams.map((b): MapElement => ({ kind: 'beam', id: b.id, a: b.a, b: b.b, width: b.width, state: 'LOCKED', ...meta(b.id) })),
    ...structure.walls.map((w): MapElement => ({ kind: 'wall', id: w.id, a: w.a, b: w.b, thickness: w.thickness, state: 'LOCKED', ...meta(w.id) })),
  ]
  const xs = [...structure.columns.map((c) => c.at.x), ...structure.footings.map((f) => f.at.x)]
  const ys = [...structure.columns.map((c) => c.at.y), ...structure.footings.map((f) => f.at.y)]
  return { ok: true, value: { structure, elements, needsConfirmation, notes, size: { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...ys) - Math.min(...ys) } } }
}
