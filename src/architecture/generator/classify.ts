/* ------------------------------------------------------------------ *
 *  Room classification + wall analysis — shared helpers used by the
 *  window / balcony / facade resolvers. All coordinates are the
 *  engine's plot-origin millimetre frame (y+ = plan-south = entry).
 * ------------------------------------------------------------------ */

import type { Point, Rect } from '../../lib/geometry.ts'
import { rectBottom, rectRight } from '../../lib/geometry.ts'
import type { FloorPlan, PlacedRoom } from '../../lib/engine/types.ts'
import type { Direction4, PlanShape, RoomClass } from '../types.ts'

/** engine room id → grammar RoomClass */
export function classifyRoom(room: PlacedRoom): RoomClass {
  const id = room.id
  const name = `${id} ${room.name}`.toLowerCase()
  if (id === 'bed1') return 'master'
  if (/^bed\d+$/.test(id)) return 'bedroom'
  if (/bath|toilet|\bwc\b/.test(name)) return 'bathroom'
  if (id === 'kitchen') return 'kitchen'
  if (id === 'utility') return 'utility'
  if (id === 'pooja' || room.zone === 'sacred') return 'pooja'
  if (id === 'stair') return 'stair'
  if (id === 'foyer') return 'foyer'
  if (/^lobby/.test(id)) return 'lobby'
  if (id === 'study') return 'study'
  if (id === 'living' || id === 'livingDining' || id === 'familyLounge') return 'living'
  if (id === 'dining') return 'dining'
  if (/^balcony/.test(id)) return 'balcony'
  if (id === 'parking') return 'parking'
  if (id === 'verandah') return 'verandah'
  if (id === 'courtyard') return 'courtyard'
  return 'other'
}

export type WallEdge = {
  side: Direction4
  a: Point
  b: Point
  lengthMm: number
  /** faces open air (the footprint ends here) */
  exterior: boolean
  /** faces the internal courtyard void */
  facesCourt: boolean
  /** faces the plan-south (entry / street) side */
  facesStreet: boolean
}

const SIDES: Direction4[] = ['N', 'S', 'E', 'W']

function edgeOf(r: Rect, side: Direction4): { a: Point; b: Point } {
  switch (side) {
    case 'N':
      return { a: { x: r.x, y: r.y }, b: { x: rectRight(r), y: r.y } }
    case 'S':
      return { a: { x: r.x, y: rectBottom(r) }, b: { x: rectRight(r), y: rectBottom(r) } }
    case 'W':
      return { a: { x: r.x, y: r.y }, b: { x: r.x, y: rectBottom(r) } }
    default:
      return { a: { x: rectRight(r), y: r.y }, b: { x: rectRight(r), y: rectBottom(r) } }
  }
}

/** midpoint of an edge, nudged `d` mm outward (perpendicular, away from the room) */
function outwardProbe(r: Rect, side: Direction4, d: number): Point {
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  if (side === 'N') return { x: cx, y: r.y - d }
  if (side === 'S') return { x: cx, y: rectBottom(r) + d }
  if (side === 'W') return { x: r.x - d, y: cy }
  return { x: rectRight(r) + d, y: cy }
}

const inRect = (p: Point, rect: Rect, tol = 1) =>
  p.x >= rect.x - tol && p.x <= rectRight(rect) + tol && p.y >= rect.y - tol && p.y <= rectBottom(rect) + tol

/** analyse the four walls of a room against the footprint + courtyard */
export function roomWalls(room: PlacedRoom, floor: FloorPlan): WallEdge[] {
  const r = room.rect
  const blocks = floor.footprint?.length ? floor.footprint : [floor.outline]
  const court = floor.courtyard ?? null
  const others = floor.rooms.filter((o) => o.id !== room.id && !o.outdoor)

  return SIDES.map((side): WallEdge => {
    const { a, b } = edgeOf(r, side)
    const lengthMm = Math.hypot(b.x - a.x, b.y - a.y)
    const probe = outwardProbe(r, side, 120)
    const insideFootprint = blocks.some((blk) => inRect(probe, blk))
    // shared with a neighbouring room if that probe point sits inside one
    const sharedRoom = others.some((o) => inRect(probe, o.rect, 2))
    const facesCourt = court ? inRect(probe, court, 2) : false
    const exterior = (!insideFootprint || facesCourt) && !sharedRoom
    const facesStreet = side === 'S'
    return { side, a, b, lengthMm, exterior, facesCourt, facesStreet }
  })
}

/** which engine shape produced this design → the grammar PlanShape */
export function planShapeOf(shape: string): PlanShape {
  if (shape === 'square') return 'square'
  if (shape === 'rectangle') return 'rectangular'
  if (shape === 'l-shape') return 'l_shape'
  if (shape === 't-shape') return 't_shape'
  if (shape === 'u-shape') return 'u_shape'
  if (shape === 'courtyard') return 'courtyard'
  return 'rectangular'
}

/** does an opening (door) sit on this wall edge? returns its centre offset a→b, else null */
export function doorOnEdge(edge: WallEdge, at: Point, tol = 160): number | null {
  const horiz = Math.abs(edge.a.y - edge.b.y) < 1
  const fixed = horiz ? edge.a.y : edge.a.x
  const perp = horiz ? at.y : at.x
  if (Math.abs(perp - fixed) > tol) return null
  const lo = horiz ? Math.min(edge.a.x, edge.b.x) : Math.min(edge.a.y, edge.b.y)
  const along = horiz ? at.x : at.y
  const hi = horiz ? Math.max(edge.a.x, edge.b.x) : Math.max(edge.a.y, edge.b.y)
  if (along < lo - tol || along > hi + tol) return null
  return along - lo
}
