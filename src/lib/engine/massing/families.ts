import { rectUnionArea, rectUnionBBox, rectUnionEdges, type Rect } from '../../geometry.ts'
import type { BuildingModel } from '../buildingModel.ts'
import { MASSING_FAMILIES, type FamilyAssessment, type MassingFamily } from './model.ts'

export function intersectRects(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y)
  const w = Math.min(a.x + a.w, b.x + b.w) - x
  const h = Math.min(a.y + a.h, b.y + b.h) - y
  return w > 0 && h > 0 ? { x, y, w, h } : null
}
export const intersectionArea = (a: Rect[], b: Rect[]) => rectUnionArea(
  a.flatMap((r) => b.flatMap((s) => { const hit = intersectRects(r, s); return hit ? [hit] : [] })),
)
export const uncoveredArea = (a: Rect[], b: Rect[]) => Math.max(0, rectUnionArea(a) - intersectionArea(a, b))

/** Topology is measured from occupied cells of the exact plan union. */
export function footprintTopology(rects: Rect[]) {
  if (!rects.length) throw new Error('A massing footprint cannot be empty')
  const box = rectUnionBBox(rects)
  const xs = [...new Set(rects.flatMap((r) => [r.x, r.x + r.w]))].sort((a, b) => a - b)
  const ys = [...new Set(rects.flatMap((r) => [r.y, r.y + r.h]))].sort((a, b) => a - b)
  const nx = xs.length - 1, ny = ys.length - 1
  const cells = Array.from({ length: nx * ny }, (_, i) => {
    const x = i % nx, y = Math.floor(i / nx)
    const cx = (xs[x] + xs[x + 1]) / 2, cy = (ys[y] + ys[y + 1]) / 2
    return rects.some((r) => cx > r.x && cx < r.x + r.w && cy > r.y && cy < r.y + r.h)
  })
  const seen = new Set<number>()
  let components = 0, holes = 0
  for (let i = 0; i < cells.length; i++) {
    if (seen.has(i)) continue
    const occupied = cells[i], queue = [i]
    let boundary = false
    seen.add(i)
    for (let q = 0; q < queue.length; q++) {
      const cell = queue[q], x = cell % nx, y = Math.floor(cell / nx)
      if (x === 0 || y === 0 || x === nx - 1 || y === ny - 1) boundary = true
      for (const [xx, yy] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        const next = yy * nx + xx
        if (xx < 0 || yy < 0 || xx >= nx || yy >= ny || seen.has(next) || cells[next] !== occupied) continue
        seen.add(next); queue.push(next)
      }
    }
    if (occupied) components++
    else if (!boundary) holes++
  }
  const corners = [cells[0], cells[nx - 1], cells[(ny - 1) * nx], cells[nx * ny - 1]].filter(Boolean).length
  const reflectX = rects.map((r) => ({ ...r, x: 2 * box.x + box.w - r.x - r.w }))
  const reflectY = rects.map((r) => ({ ...r, y: 2 * box.y + box.h - r.y - r.h }))
  return { box, components, holes, corners, edges: rectUnionEdges(rects).length,
    asymmetric: uncoveredArea(rects, reflectX) > 1000 || uncoveredArea(rects, reflectY) > 1000,
    aspect: Math.max(box.w, box.h) / Math.min(box.w, box.h) }
}

/** Every family is conditional on the existing occupied floor plates. No fallback relabelling. */
export function assessMassingFamilies(building: BuildingModel): FamilyAssessment[] {
  if (!building.floors.length) return MASSING_FAMILIES.map((family) => ({
    family, compatible: false, reason: 'Requires an existing occupied floor plan.',
  }))
  const floors = [...building.floors].sort((a, b) => a.level - b.level)
  const topologies = floors.map((f) => footprintTopology(f.footprint))
  const ground = topologies[0]
  const lShape = topologies.some((t) => t.components === 1 && !t.holes && t.edges === 6)
  const uShape = topologies.some((t) => t.components === 1 && !t.holes && t.edges === 8 && t.corners === 4)
  const court = topologies.some((t) => t.holes > 0) || floors.some((f) => f.courtyard &&
    uncoveredArea([f.courtyard], f.footprint) >= f.courtyard.w * f.courtyard.h * 0.99)
  let offset = false, stepped = false, terraced = false, overhang = false
  for (let i = 1; i < floors.length; i++) {
    const low = floors[i - 1], high = floors[i], a = topologies[i - 1].box, b = topologies[i].box
    offset ||= Math.hypot(b.x + b.w / 2 - a.x - a.w / 2, b.y + b.h / 2 - a.y - a.h / 2) >= 300
    const uncovered = uncoveredArea(high.footprint, low.footprint)
    const exposed = uncoveredArea(low.footprint, high.footprint)
    stepped ||= uncovered < 1 && exposed >= 1e6
    terraced ||= uncovered < 1 && exposed >= Math.max(6e6, rectUnionArea(low.footprint) * 0.15)
    const supports = building.supportZones.filter((z) => z.floorId === high.id && z.support === 'cantilever').map((z) => z.rect)
    overhang ||= uncovered >= 1e6 && uncoveredArea(high.footprint, [...low.footprint, ...supports]) < 1
  }
  const matches: Record<MassingFamily, [boolean, string]> = {
    L_SHAPED: [lShape, 'Requires a connected L-shaped floor perimeter.'],
    U_SHAPED: [uShape, 'Requires two side wings joined around an open recess.'],
    COURTYARD: [court, 'Requires an existing open courtyard in the plan.'],
    OFFSET_BLOCKS: [offset, 'Requires at least 300 mm of existing offset between floor plates.'],
    INTERLOCKING_BLOCKS: [topologies.some((t) => t.components === 1 && !t.holes && t.edges >= 8 && t.corners < 4),
      'Requires intersecting orthogonal wings in the existing footprint.'],
    STACKED_VOLUMES: [floors.length > 1, 'Requires multiple occupied floors.'],
    STEPPED: [stepped, 'Requires an existing upper-floor setback.'],
    TWIN_WING: [uShape || court || topologies.some((t) => t.components === 1 && t.edges >= 12 && t.corners === 4),
      'Requires two existing wings with a connecting volume.'],
    CANTILEVERED: [overhang, 'Requires an existing upper-floor overhang covered by a declared cantilever support zone.'],
    TERRACED: [terraced, 'Requires a substantial exposed lower-floor roof created by an existing setback.'],
    LINEAR: [ground.aspect >= 2.4, 'Requires a ground footprint at least 2.4 times longer than it is wide.'],
    CLUSTERED: [topologies.some((t) => t.components >= 3), 'Requires at least three separate plan volumes.'],
    SPLIT_VOLUME: [topologies.some((t) => t.components === 2), 'Requires two separate plan volumes.'],
    PAVILION: [floors.length === 1 && ground.components === 1, 'Requires a connected single-storey plan.'],
    ASYMMETRIC: [offset || topologies.some((t) => t.asymmetric), 'Requires an asymmetric footprint or existing floor offset.'],
  }
  return MASSING_FAMILIES.map((family) => ({ family, compatible: matches[family][0],
    reason: matches[family][0] ? 'Compatible with the existing plan.' : matches[family][1] }))
}
