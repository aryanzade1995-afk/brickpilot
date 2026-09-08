/* ------------------------------------------------------------------ *
 *  balconyResolver — pick which upper-floor rooms get a balcony, on
 *  which wall, projecting or recessed, per the style's BalconyRule.
 *  A `wrapVerandah` style gets one continuous verandah (emitted by the
 *  facade resolver) plus at most one discrete balcony.
 * ------------------------------------------------------------------ */

import type { Rect } from '../../lib/geometry.ts'
import { rectBottom, rectRight } from '../../lib/geometry.ts'
import type { FloorPlan } from '../../lib/engine/types.ts'
import type { Rng } from '../../lib/engine/shape/rng.ts'
import type { BalconySpec, DesignGenome, Direction4, GenerationConstraints, StyleGrammar } from '../types.ts'
import { BALCONY_LIBRARY } from '../library/balconyLibrary.ts'
import { classifyRoom, roomWalls } from './classify.ts'

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const snap = (v: number) => Math.round(v / 100) * 100

export function resolveBalconies(
  grammar: StyleGrammar,
  constraints: GenerationConstraints,
  floor: FloorPlan,
  level: number,
  buildable: Rect,
  rng: Rng,
  genome: DesignGenome,
): BalconySpec[] {
  // the genome picks ONE balcony type; realise it only where a wall supports it
  const gType = genome.balcony
  if (gType === 'none') return []
  const bEntry = BALCONY_LIBRARY[gType as keyof typeof BALCONY_LIBRARY] ?? null
  if (!bEntry) return []
  const isVerandah = gType === 'wrap_verandah'
  if (level === 0 && !isVerandah && bEntry.upperOnly) return []

  const rule = grammar.balcony
  const out: BalconySpec[] = []
  // count comes from the genome, gated by the library's per-floor max
  const cap = clamp(genome.balconyCount || bEntry.maxPerFloor, 1, bEntry.maxPerFloor)
  const minWidthMm = Math.max(rule.minWidthMm, 1400)
  const rooms = bEntry.rooms.length ? bEntry.rooms : rule.rooms

  const candidates = floor.rooms
    .filter((r) => !r.outdoor && rooms.includes(classifyRoom(r)))
    // master first, then by area
    .sort((a, b) => (a.id === 'bed1' ? -1 : b.id === 'bed1' ? 1 : b.area - a.area))

  for (const room of candidates) {
    if (out.length >= cap) break
    const exWalls = roomWalls(room, floor).filter((w) => w.exterior && w.lengthMm >= minWidthMm + 400)
    if (exWalls.length === 0) continue
    // prefer a street or a view (court) wall, longest
    exWalls.sort((a, b) => balconyScore(b) - balconyScore(a))
    const wall = exWalls[0]
    const depthMm = snap(
      clamp(
        lerp(bEntry.depthMm[0], bEntry.depthMm[1], rng.next()),
        constraints.balcony.minDepthMm,
        constraints.balcony.maxDepthMm,
      ),
    )
    // the library type decides projecting vs. carved; corner types need a real corner
    const corner = exWalls.length >= 2 && exWalls[1].lengthMm >= minWidthMm
    const recessed = bEntry.recessed || (gType === 'corner' && !corner)
    const rect = balconyRect(room.rect, wall.side, depthMm, recessed, buildable)
    if (!rect) continue
    const type: BalconySpec['type'] = mapBalconyType(gType, { corner, recessed, level, wrap: isVerandah })
    out.push({
      id: `bal${level}-${out.length}`,
      roomId: room.id,
      level,
      side: wall.side,
      rect,
      depthMm,
      recessed,
      type,
      railStyle: bEntry.rail,
    })
  }
  return out
}

/** collapse the vocabulary's 12 balcony terms onto the DesignSpec's 5 render types */
function mapBalconyType(
  g: string,
  ctx: { corner: boolean; recessed: boolean; level: number; wrap: boolean },
): BalconySpec['type'] {
  if (ctx.wrap) return ctx.level <= 1 ? 'verandah' : 'continuous'
  if (g === 'continuous' || g === 'full_width') return 'continuous'
  if (g === 'recessed' || ctx.recessed) return 'recessed'
  if (g === 'corner' || g === 'corner_cantilever') return ctx.corner ? 'corner' : 'cantilever'
  if (g === 'terrace_balcony' || g === 'planted_balcony') return 'continuous'
  return 'cantilever'
}

function balconyScore(w: { side: Direction4; lengthMm: number; facesStreet: boolean; facesCourt: boolean }): number {
  return (w.facesStreet ? 1.2 : 0) + (w.facesCourt ? 1.0 : 0) + Math.min(w.lengthMm / 6000, 1) + (w.side === 'S' ? 0.3 : 0)
}

/** the balcony slab footprint — projecting outside the room, or carved from it if recessed */
function balconyRect(room: Rect, side: Direction4, depth: number, recessed: boolean, b: Rect): Rect | null {
  const width = Math.min(room.w, room.h) > 0 ? (side === 'N' || side === 'S' ? room.w : room.h) : 0
  const inset = 300
  if (recessed) {
    // sits inside the room outline against that wall
    if (side === 'N') return { x: room.x + inset, y: room.y, w: room.w - 2 * inset, h: depth }
    if (side === 'S') return { x: room.x + inset, y: rectBottom(room) - depth, w: room.w - 2 * inset, h: depth }
    if (side === 'W') return { x: room.x, y: room.y + inset, w: depth, h: room.h - 2 * inset }
    return { x: rectRight(room) - depth, y: room.y + inset, w: depth, h: room.h - 2 * inset }
  }
  // projecting — must not leave the plot
  let r: Rect
  if (side === 'N') r = { x: room.x + inset, y: room.y - depth, w: room.w - 2 * inset, h: depth }
  else if (side === 'S') r = { x: room.x + inset, y: rectBottom(room), w: room.w - 2 * inset, h: depth }
  else if (side === 'W') r = { x: room.x - depth, y: room.y + inset, w: depth, h: room.h - 2 * inset }
  else r = { x: rectRight(room), y: room.y + inset, w: depth, h: room.h - 2 * inset }
  if (r.w < 1200 || r.h < 800) return null
  if (r.x < b.x - 50 || r.y < b.y - 50 || rectRight(r) > rectRight(b) + 50 || rectBottom(r) > rectBottom(b) + 50) {
    // fall back to a shallow recessed balcony
    return balconyRect(room, side, Math.max(1000, depth - 600), true, b)
  }
  void width
  return r
}
