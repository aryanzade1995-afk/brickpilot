import { rectBottom, rectRight } from '../geometry.ts'
import { planToCompass } from '../model/canonical.ts'
import type { Direction } from '../model/brief.ts'
import type { Design, PlacedRoom } from './types.ts'

/* ------------------------------------------------------------------ *
 *  Real-compass orientation of rooms and windows. The plan is drawn
 *  with the entry at plan-south; planToCompass rotates plan sides to
 *  true bearings. Shared by the Vastu notes and preference scoring.
 * ------------------------------------------------------------------ */

export type Quadrant = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | 'C'

const toCompass = (design: Design, planSide: Direction): Direction =>
  planToCompass[design.model.entrySide]?.[planSide] ?? planSide

/** a compass pair written N/S first, then E/W ('NE', never 'EN') */
function combine(a: Direction | null, b: Direction | null): Quadrant {
  const ns = [a, b].find((d) => d === 'N' || d === 'S') ?? ''
  const ew = [a, b].find((d) => d === 'E' || d === 'W') ?? ''
  return ((ns + ew) || 'C') as Quadrant
}

/** the room with this id on the given floor (ground by default) */
function roomOn(design: Design, roomId: string, level = 0): PlacedRoom | undefined {
  return design.floors.find((f) => f.level === level)?.rooms.find((r) => r.id === roomId)
}

/**
 * Which ninth of the house a room's centre falls in — the Vastu 3×3 grid laid
 * over the ground-floor outline, in true compass terms. null if the room is
 * not on that floor.
 */
export function roomQuadrant(design: Design, roomId: string, level = 0): Quadrant | null {
  const room = roomOn(design, roomId, level)
  const ground = design.floors[0]
  if (!room || !ground) return null
  const o = ground.outline
  const cx = room.rect.x + room.rect.w / 2
  const cy = room.rect.y + room.rect.h / 2
  const third = (v: number, lo: number, len: number, low: Direction, high: Direction): Direction | null =>
    v < lo + len / 3 ? low : v > lo + (2 * len) / 3 ? high : null
  const ew = third(cx, o.x, o.w, 'W', 'E')
  const ns = third(cy, o.y, o.h, 'N', 'S')
  return combine(ns && toCompass(design, ns), ew && toCompass(design, ew))
}

/** true compass sides of the walls carrying this room's windows */
export function windowFacings(design: Design, roomId: string, level = 0): Direction[] {
  const floor = design.floors.find((f) => f.level === level)
  const room = floor?.rooms.find((r) => r.id === roomId)
  if (!floor || !room) return []
  const r = room.rect
  const sides = new Set<Direction>()
  for (const o of floor.openings) {
    if (o.kind !== 'window' || !o.rooms?.includes(roomId)) continue
    const plan: Direction | null = o.orient === 'h'
      ? (Math.abs(o.at.y - r.y) < 2 ? 'N' : Math.abs(o.at.y - rectBottom(r)) < 2 ? 'S' : null)
      : (Math.abs(o.at.x - r.x) < 2 ? 'W' : Math.abs(o.at.x - rectRight(r)) < 2 ? 'E' : null)
    if (plan) sides.add(toCompass(design, plan))
  }
  return [...sides]
}

/** true compass side the main entry door faces, if there is one */
export function entryFacing(design: Design): Direction | null {
  const ground = design.floors[0]
  const entry = ground?.openings.find((o) => o.kind === 'entry')
  const foyer = entry?.rooms?.[0] ? ground.rooms.find((r) => r.id === entry.rooms![0]) : undefined
  if (!entry || !foyer) return null
  const r = foyer.rect
  const plan: Direction = entry.orient === 'h'
    ? (Math.abs(entry.at.y - r.y) < 2 ? 'N' : 'S')
    : (Math.abs(entry.at.x - r.x) < 2 ? 'W' : 'E')
  return toCompass(design, plan)
}
