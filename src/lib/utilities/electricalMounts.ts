import type { FloorPlan, PlacedRoom } from '../engine/types.ts'
import type { Point } from '../geometry.ts'
import type { ElectricalMount, ElectricalSymbolType } from './plan.ts'

/** Concept visual heights, explicitly not verified installation requirements.
 * Floor-plan millimetres (x,y) become Three.js metres (x,height,z). */
export function electricalHeight(type: ElectricalSymbolType, label: string, roomHeightMm: number) {
  const service = Math.max(400, roomHeightMm - 250)
  const desired = type === 'db_panel' ? 1500 : type === 'switch' ? 1200 : type === 'socket' ? /geyser|chimney/i.test(label) ? 1800 : 450 : type === 'exhaust_fan' ? 2200 : service
  return { elevationMm: Math.min(desired, service - (type === 'light' ? 0 : 150)), serviceElevationMm: service }
}

/** Find a real solid wall face inside this room. Opening ranges are tested
 * at the board's actual height; a window/door never becomes a mounting face.
 * Missing source walls stay explicitly unmounted instead of floating boards. */
export function wallMount(floor: FloorPlan, room: PlacedRoom, desired: Point, elevationMm: number, clearance = 150) {
  const r = room.rect, candidates: { position: Point; normal: Point; wallIndex: number; distance: number }[] = []
  floor.walls.forEach((w, wallIndex) => {
    const horizontal = Math.abs(w.a.y - w.b.y) < .01, vertical = Math.abs(w.a.x - w.b.x) < .01
    if (!horizontal && !vertical || (w.heightMm ?? Infinity) < elevationMm + 100) return
    const axis = horizontal ? w.a.y : w.a.x
    const boundary = horizontal ? [r.y, r.y + r.h] : [r.x, r.x + r.w]
    if (!boundary.some(v => Math.abs(v - axis) < 25)) return
    let spans = [[Math.max(Math.min(horizontal ? w.a.x : w.a.y, horizontal ? w.b.x : w.b.y), horizontal ? r.x : r.y), Math.min(Math.max(horizontal ? w.a.x : w.a.y, horizontal ? w.b.x : w.b.y), horizontal ? r.x + r.w : r.y + r.h)]]
    for (const o of floor.openings) {
      if ((o.orient === 'h') !== horizontal || Math.abs((horizontal ? o.at.y : o.at.x) - axis) > 25) continue
      if (o.kind === 'window' && (elevationMm + 120 < (o.sill ?? 900) || elevationMm - 120 > (o.head ?? 2100))) continue
      if (o.kind !== 'window' && elevationMm - 120 > (o.head ?? 2100)) continue
      const mid = horizontal ? o.at.x : o.at.y, lo = mid - o.width / 2, hi = mid + o.width / 2
      spans = spans.flatMap(([a, b]) => hi <= a || lo >= b ? [[a, b]] : [[a, Math.min(b, lo)], [Math.max(a, hi), b]].filter(([x, y]) => y > x))
    }
    for (const [lo, hi] of spans) {
      if (hi - lo < clearance * 2) continue
      const v = Math.max(lo + clearance, Math.min(hi - clearance, horizontal ? desired.x : desired.y))
      const normal = horizontal ? { x: 0, y: r.y + r.h / 2 > axis ? 1 : -1 } : { x: r.x + r.w / 2 > axis ? 1 : -1, y: 0 }
      const offset = w.thickness / 2 + 35
      const position = horizontal ? { x: v, y: axis + normal.y * offset } : { x: axis + normal.x * offset, y: v }
      if (position.x < r.x || position.x > r.x + r.w || position.y < r.y || position.y > r.y + r.h) continue
      candidates.push({ position, normal, wallIndex, distance: Math.hypot(position.x - desired.x, position.y - desired.y) })
    }
  })
  return candidates.sort((a, b) => a.distance - b.distance || a.wallIndex - b.wallIndex)[0] ?? null
}

export function mountSymbol(floor: FloorPlan, room: PlacedRoom, type: ElectricalSymbolType, label: string, position: Point, heightMm: number): { position: Point; mount?: ElectricalMount } {
  const heights = electricalHeight(type, label, heightMm)
  if (type === 'light') return { position, mount: { ...heights, kind: 'ceiling', normal: { x: 0, y: 0 }, wallIndex: null } }
  const wall = wallMount(floor, room, position, heights.elevationMm, type === 'db_panel' ? 250 : 150)
  return wall ? { position: wall.position, mount: { ...heights, kind: 'wall', normal: wall.normal, wallIndex: wall.wallIndex } } : { position }
}
