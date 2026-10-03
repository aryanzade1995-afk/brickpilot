import type { Design, Opening, Wall } from '../engine/types.ts'
import { rectUnionArea, segLength, type Rect } from '../geometry.ts'
import { fnv } from '../engine/massing/rng.ts'
import { validatedPunePolicy as policy } from './data/validated.ts'

export type RoomQuantity = { id: string; floor: string; name: string; area: number }
export type Quantities = {
  geometryKey: string; floorArea: number; groundArea: number; wallArea: number; paintArea: number
  doorArea: number; windowArea: number; roofArea: number; pavingArea: number; lawnArea: number; poolArea: number
  doorCount: number; windowCount: number; rooms: RoomQuantity[]; assumptions: string[]
}
function intersection(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y)
  const w = Math.min(a.x + a.w, b.x + b.w) - x, h = Math.min(a.y + a.h, b.y + b.h) - y
  return w > 0 && h > 0 ? { x, y, w, h } : null
}
/** Exact union minus the intersecting hole union: holes outside plates never reduce area. */
export function measuredArea(rects: Rect[], holes: Rect[] = []): number {
  const cuts = rects.flatMap(a => holes.flatMap(b => { const r = intersection(a, b); return r ? [r] : [] }))
  return (rectUnionArea(rects) - rectUnionArea(cuts)) / 1e6
}
export function geometryCostKey(design: Design): string {
  const geometry = JSON.stringify({ floors: design.floors.map(f => ({ level: f.level, footprint: f.footprint,
    courtyard: f.courtyard, voids: f.doubleHeightVoids, walls: f.walls, openings: f.openings,
    rooms: f.rooms.map(r => ({ id: r.semanticId || r.id, rect: r.rect, outdoor: r.outdoor })) })),
    site: design.siteFeatures ?? [], height: design.model.brief.levels.floorToFloor })
  return `cost-${fnv(geometry).toString(16)}-${fnv(`quantities|${geometry}`).toString(16)}`
}
function openingHeight(o: Opening): number {
  const m = policy.measurement
  return Math.max(0, (o.head ?? (o.kind === 'window' ? m.windowHeadMm : o.kind === 'entry' ? m.entryHeightMm : m.doorHeightMm)) -
    (o.kind === 'window' ? o.sill ?? m.windowSillMm : 0))
}
function hosts(w: Wall, o: Opening): boolean {
  const t = policy.measurement.hostToleranceMm
  if (o.orient === 'h') return Math.abs(w.a.y - w.b.y) <= t && Math.abs(w.a.y - o.at.y) <= t &&
    o.at.x - o.width / 2 >= Math.min(w.a.x, w.b.x) - t && o.at.x + o.width / 2 <= Math.max(w.a.x, w.b.x) + t
  return Math.abs(w.a.x - w.b.x) <= t && Math.abs(w.a.x - o.at.x) <= t &&
    o.at.y - o.width / 2 >= Math.min(w.a.y, w.b.y) - t && o.at.y + o.width / 2 <= Math.max(w.a.y, w.b.y) + t
}
/** Read-only geometry take-off. Never trusts cached areas/counts or a bounding box. */
export function measureDesign(design: Design): Quantities {
  const rooms: RoomQuantity[] = []
  let floorArea = 0, wallArea = 0, paintArea = 0, doorArea = 0, windowArea = 0, doorCount = 0, windowCount = 0
  const holes = (f: Design['floors'][number]) => [...(f.courtyard ? [f.courtyard] : []), ...(f.doubleHeightVoids ?? []).map(v => v.rect)]
  for (const f of design.floors) {
    const cuts = holes(f)
    floorArea += measuredArea(f.footprint, cuts)
    const wallHeight = design.model.brief.levels.floorToFloor * 1000 - policy.measurement.slabThicknessMm
    const assigned = new Set<Opening>()
    for (const w of f.walls.filter(w => w.kind !== 'parapet')) {
      const h = w.heightMm ?? wallHeight
      const area = Math.max(0, segLength(w) * h / 1e6 - f.openings.reduce((sum, o) => {
        if (assigned.has(o) || !hosts(w, o)) return sum
        assigned.add(o)
        return sum + o.width * Math.min(h, openingHeight(o)) / 1e6
      }, 0))
      wallArea += area
      paintArea += area * 2
    }
    for (const o of f.openings) {
      const area = o.width * openingHeight(o) / 1e6
      if (o.kind === 'window' || o.leaf === false && o.treatment === 'glazed-slide') { windowArea += area; windowCount++ }
      else if (o.leaf !== false) { doorArea += area; doorCount++ }
    }
    for (const r of f.rooms.filter(r => !r.outdoor)) rooms.push({ id: `${f.level}:${r.semanticId || r.id}`,
      floor: f.name, name: r.name, area: measuredArea([r.rect], cuts) })
  }
  const ordered = [...design.floors].sort((a, b) => a.level - b.level)
  const ground = ordered[0]
  const roofs = (f: Design['floors'][number]) => [...f.footprint, ...(f.doubleHeightVoids ?? []).map(v => v.rect)]
  const roofArea = ordered.reduce((sum, f, i) => sum + measuredArea(roofs(f),
    [...(f.courtyard ? [f.courtyard] : []), ...(ordered[i + 1] ? roofs(ordered[i + 1]) : [])]), 0)
  const siteArea = (kinds: string[]) => measuredArea((design.siteFeatures ?? []).filter(f => kinds.includes(f.kind)).map(f => f.rect))
  return { geometryKey: geometryCostKey(design), floorArea, groundArea: ground ? measuredArea(ground.footprint, holes(ground)) : 0,
    wallArea, paintArea, doorArea, windowArea, doorCount, windowCount, roofArea,
    pavingArea: siteArea(['parking', 'driveway', 'path', 'sitOut', 'utilityYard']), lawnArea: siteArea(['lawn']), poolArea: siteArea(['pool']), rooms,
    assumptions: ['Floor areas use source footprint unions minus courtyard and double-height voids. Roofs include exposed lower roofs and ceilings over double-height space.',
      'Paint covers both wall faces after opening deductions; wall-height and missing opening heights use documented concept defaults.',
      'Floor finishes use indoor room rectangles; structure, MEP and pool use area allowances, not engineered quantities.',
      'Blender-only facade additions, furniture and landscape objects are excluded.'] }
}
