import type { Design, FloorPlan, Opening, Wall } from '../types.ts'

type Axis = 'h' | 'v'
type Interval = [number, number]
export type FacadeFeature = {
  id: string
  type: 'entry-jamb' | 'entry-lintel' | 'tower' | 'screen-fin' | 'horizontal-band' | 'canopy' | 'planter-band'
  hostFloorId: string
  hostWallId: string
  anchorType: 'main-door' | 'wall-segment' | 'roof-edge'
  orient: Axis
  /** plan position at the wall centreline, mm */
  at: { x: number; y: number }
  width: number
  height: number
  depth: number
  bottom: number
  requiredClearance: number
  priority: number
}
export type FacadePlan = { features: FacadeFeature[]; errors: string[]; warnings: string[]; score: number }

const axis = (wall: Wall): Axis => Math.abs(wall.a.y - wall.b.y) < 2 ? 'h' : 'v'
const fixed = (wall: Wall) => axis(wall) === 'h' ? wall.a.y : wall.a.x
const interval = (wall: Wall): Interval => axis(wall) === 'h'
  ? [Math.min(wall.a.x, wall.b.x), Math.max(wall.a.x, wall.b.x)]
  : [Math.min(wall.a.y, wall.b.y), Math.max(wall.a.y, wall.b.y)]
const along = (o: Opening) => o.orient === 'h' ? o.at.x : o.at.y
const cross = (o: Opening) => o.orient === 'h' ? o.at.y : o.at.x
const overlap = (a: Interval, b: Interval) => Math.min(a[1], b[1]) - Math.max(a[0], b[0])
const sub = (source: Interval[], cut: Interval): Interval[] => source.flatMap(([a, b]): Interval[] => {
  if (cut[1] <= a || cut[0] >= b) return [[a, b]]
  const out: Interval[] = []
  if (cut[0] > a) out.push([a, cut[0]])
  if (cut[1] < b) out.push([cut[1], b])
  return out
})

/** Exterior wall segments minus actual opening and column keep-out intervals. */
export function availableFacadeRegions(floor: FloorPlan, wall: Wall, clearance = 220): Interval[] {
  if (wall.kind !== 'exterior') return []
  const orient = axis(wall)
  const line = fixed(wall)
  const [lo, hi] = interval(wall)
  let free: Interval[] = [[lo + 100, hi - 100]]
  for (const op of floor.openings) {
    if (op.orient !== orient || Math.abs(cross(op) - line) > 2) continue
    free = sub(free, [along(op) - op.width / 2 - clearance, along(op) + op.width / 2 + clearance])
  }
  for (const col of floor.columns ?? []) {
    if (Math.abs((orient === 'h' ? col.at.y : col.at.x) - line) > 2) continue
    const c = orient === 'h' ? col.at.x : col.at.y
    free = sub(free, [c - col.size / 2 - clearance, c + col.size / 2 + clearance])
  }
  return free.filter(([a, b]) => b - a >= 250)
}

function exteriorWall(floor: FloorPlan, o: Opening): Wall | undefined {
  return floor.walls.find((w) => w.kind === 'exterior' && axis(w) === o.orient &&
    Math.abs(fixed(w) - cross(o)) < 2 &&
    overlap(interval(w), [along(o) - o.width / 2, along(o) + o.width / 2]) >= o.width - 2)
}

function addOnWall(out: FacadeFeature[], floor: FloorPlan, wall: Wall, type: FacadeFeature['type'],
  center: number, width: number, bottom: number, height: number, depth: number,
  anchorType: FacadeFeature['anchorType'], index: number) {
  const orient = axis(wall)
  const line = fixed(wall)
  out.push({
    id: `${floor.prefix}_${type.toUpperCase().replaceAll('-', '_')}_${String(index).padStart(2, '0')}`,
    type, hostFloorId: floor.prefix ?? `L${floor.level}`, hostWallId: wall.id ?? '', anchorType,
    orient, at: orient === 'h' ? { x: center, y: line } : { x: line, y: center },
    width, height, depth, bottom, requiredClearance: 150, priority: type === 'screen-fin' ? 8 : 7,
  })
}

export function planFacade(design: Design): FacadePlan {
  const features: FacadeFeature[] = []
  const errors: string[] = []
  const warnings: string[] = []
  const dna = design.dna
  const height = Math.round(design.model.brief.levels.floorToFloor * 1000)
  const ground = design.floors[0]
  const entry = ground.openings.find((o) => o.kind === 'entry')
  const host = entry && exteriorWall(ground, entry)
  if (!entry || !host) errors.push('Main entrance has no exterior wall anchor.')
  else {
    const middle = along(entry)
    const half = entry.width / 2 + 300
    const thickness = dna.frameThicknessMm
    const [lo, hi] = interval(host)
    const jambClear = [middle - half, middle + half].every((at) =>
      !(ground.columns ?? []).some((c) => Math.abs((entry.orient === 'h' ? c.at.y : c.at.x) - fixed(host)) < 2 &&
        Math.abs((entry.orient === 'h' ? c.at.x : c.at.y) - at) < c.size / 2 + thickness / 2))
    const canopy = ['horizontal-canopy', 'deep-shadow-entry', 'recessed-entry'].includes(dna.entranceDesign)
    if (!canopy && jambClear && middle - half - thickness / 2 >= lo && middle + half + thickness / 2 <= hi) {
      addOnWall(features, ground, host, 'entry-jamb', middle - half, thickness, 0, 2650, 300, 'main-door', 1)
      addOnWall(features, ground, host, 'entry-jamb', middle + half, thickness, 0, 2650, 300, 'main-door', 2)
      addOnWall(features, ground, host, 'entry-lintel', middle, 2 * half + thickness, 2650, 180, 300, 'main-door', 1)
    } else {
      // A light canopy anchors to the same door when the adjacent wall is too
      // narrow or contains structure; it clears the full door head and swing.
      addOnWall(features, ground, host, 'canopy', middle, Math.min(2 * half, hi - lo - 200),
        2700, 140, Math.max(700, dna.overhangMm), 'main-door', 1)
    }
  }

  for (const floor of design.floors) {
    const front = floor.outline.y + floor.outline.h
    const walls = floor.walls.filter((w) => w.kind === 'exterior' && axis(w) === 'h' && Math.abs(fixed(w) - front) < 2)
    const options = walls.flatMap((wall) => availableFacadeRegions(floor, wall, 250)
      .map((range) => ({ wall, range })))
      .filter(({ range }) => range[1] - range[0] >= 950)
      .sort((a, b) => (b.range[1] - b.range[0]) - (a.range[1] - a.range[0]))
    const target = options[0]
    if (target) {
      const { wall, range } = target
      const featureW = Math.min(1700, range[1] - range[0] - 100)
      const mid = (range[0] + range[1]) / 2
      const isScreen = ['timber-fins', 'metal-fins', 'jaali-panel'].includes(dna.featureElement)
      if (isScreen) {
        const count = Math.max(3, Math.floor(featureW / dna.finSpacingMm))
        for (let i = 0; i < count; i++)
          addOnWall(features, floor, wall, 'screen-fin', mid - featureW / 2 + i * featureW / Math.max(1, count - 1),
            60, 350, height - 650, 180, 'wall-segment', i + 1)
      } else if (dna.featureElement === 'planter-band') {
        addOnWall(features, floor, wall, 'planter-band', mid, featureW, height - 300, 260,
          360, 'roof-edge', 1)
      } else if (dna.featureElement === 'floating-slab' || dna.featureElement === 'deep-chajja') {
        addOnWall(features, floor, wall, 'horizontal-band', mid, featureW,
          height - 280, 120, dna.featureElement === 'deep-chajja' ? dna.overhangMm : 550,
          'roof-edge', 1)
      } else if (dna.featureElement === 'stone-tower') {
        addOnWall(features, floor, wall, 'tower', mid, featureW, 200, height - 650,
          Math.min(500, dna.frameThicknessMm), 'wall-segment', 1)
      }
    } else warnings.push(`${floor.name}: no solid front wall region fits an optional feature.`)
    if (dna.featureElement !== 'floating-slab' && dna.featureElement !== 'deep-chajja' &&
      ['horizontal-stack', 'layered-facade', 'stepped-composition', 'floating-box', 'interlocking-volumes'].includes(dna.facadeComposition)) {
      for (const wall of walls) {
        const [a, b] = interval(wall)
        if (b - a < 1200) continue
        addOnWall(features, floor, wall, 'horizontal-band', (a + b) / 2, b - a - 300,
          height - 260, 120, dna.overhangMm, 'roof-edge', features.length + 1)
      }
    }
  }

  // The validator uses the same feature list the Three.js builder consumes.
  for (const feature of features) {
    const floor = design.floors.find((f) => f.prefix === feature.hostFloorId)
    const wall = floor?.walls.find((w) => w.id === feature.hostWallId)
    if (!floor || !wall || wall.kind !== 'exterior') {
      errors.push(`${feature.id} lacks a valid exterior host wall.`)
      continue
    }
    const center = feature.orient === 'h' ? feature.at.x : feature.at.y
    const span: Interval = [center - feature.width / 2, center + feature.width / 2]
    if (overlap(span, interval(wall)) < feature.width - 2) errors.push(`${feature.id} extends outside its host wall.`)
    if (![feature.width, feature.height, feature.depth, feature.bottom].every(Number.isFinite) ||
      feature.width <= 0 || feature.height <= 0 || feature.depth <= 0) errors.push(`${feature.id} has invalid dimensions.`)
    if (feature.type === 'tower' || feature.type === 'screen-fin') {
      if (!availableFacadeRegions(floor, wall, feature.requiredClearance).some(([a, b]) => span[0] >= a - 1 && span[1] <= b + 1))
        errors.push(`${feature.id} blocks an opening or column.`)
    }
    if (feature.type === 'entry-jamb' || feature.type === 'tower' || feature.type === 'screen-fin') {
      for (const col of floor.columns ?? []) {
        if (Math.abs((feature.orient === 'h' ? col.at.y : col.at.x) - fixed(wall)) > 2) continue
        const c = feature.orient === 'h' ? col.at.x : col.at.y
        if (overlap(span, [c - col.size / 2, c + col.size / 2]) > 1)
          errors.push(`${feature.id} crosses ${col.id}.`)
      }
    }
    for (const op of floor.openings) {
      if (op.orient !== feature.orient || Math.abs(cross(op) - fixed(wall)) > 2) continue
      const openingSpan: Interval = [along(op) - op.width / 2, along(op) + op.width / 2]
      const upper = op.kind === 'window' ? 2600 : 2500
      if (overlap(span, openingSpan) > 1 && feature.bottom < upper && feature.bottom + feature.height > (op.kind === 'window' ? op.sill ?? 850 : 0))
        errors.push(`${feature.id} crosses ${op.id ?? 'an opening'}.`)
    }
  }
  return { features, errors, warnings, score: Math.max(0, 100 - errors.length * 40 - warnings.length * 5) }
}

export function validateVillaVariation(design: Design) {
  const { errors, warnings, score } = planFacade(design)
  return { valid: errors.length === 0, errors, warnings, score }
}
