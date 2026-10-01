import { sharedEdge } from '../geometry.ts'
import type { Design, PlacedRoom } from './types.ts'
import { costPerSqmAllIn } from '../cost/index.ts'
import { entryFacing, roomQuadrant, windowFacings, type Quadrant } from './orientation.ts'

/* ------------------------------------------------------------------ *
 *  preferenceScore — how well a VALID plan suits the client. It never
 *  decides validity (the validators do); it only ranks plans that
 *  already pass. Every term is small, named and returned, so the UI
 *  can say why a plan was chosen.
 * ------------------------------------------------------------------ */

export type ScoreTerm = { name: string; value: number; group: 'vastu' | 'sun' | 'lifestyle' | 'budget' }
export type PreferenceScore = { total: number; terms: ScoreTerm[] }

/** how much Vastu counts, from the brief's answer */
export const VASTU_WEIGHT = { ignore: 0, prefer: 1, strict: 3 } as const

const COMPASS: Record<Quadrant, string> = {
  N: 'north', NE: 'north-east', E: 'east', SE: 'south-east', S: 'south',
  SW: 'south-west', W: 'west', NW: 'north-west', C: 'centre',
}

const isToilet = (r: PlacedRoom) => !r.outdoor && r.zone === 'service' && /bath|toilet|wc/i.test(r.id + r.name)
const isBedroom = (r: PlacedRoom) => !r.outdoor && r.zone === 'private' && r.id.startsWith('bed')

/** every toilet / bath in the north-east, on any floor */
function northEastToilets(design: Design): PlacedRoom[] {
  return design.floors.flatMap((f) => f.rooms.filter((r) => isToilet(r) && roomQuadrant(design, r.id, f.level) === 'NE'))
}

/** the master bedroom (by role, never by id) and the floor it is on */
function master(design: Design): { id: string; level: number } | null {
  for (const f of design.model.floors) {
    const s = f.spaces.find((x) => x.role === 'master')
    if (s) return { id: s.id, level: f.level }
  }

  return null
}

export function preferenceScore(design: Design): PreferenceScore {
  const terms: ScoreTerm[] = []
  const w = VASTU_WEIGHT[design.model.brief.lifestyle.vastu]

  // ---- Vastu: ideal corner +1, one of its edges +0.5; weighted by preference ----
  if (w > 0) {
    const place = (label: string, id: string, level: number, ideal: Quadrant, edges: Quadrant[]) => {
      const q = roomQuadrant(design, id, level)
      if (!q) return
      if (q === ideal) terms.push({ name: `${label} in the ${COMPASS[q]}`, value: 1 * w, group: 'vastu' })
      else if (edges.includes(q)) terms.push({ name: `${label} on the ${COMPASS[q]} side`, value: 0.5 * w, group: 'vastu' })
    }
    place('Kitchen', 'kitchen', 0, 'SE', ['S', 'E'])
    place('Pooja room', 'pooja', 0, 'NE', ['N', 'E'])
    const m = master(design)
    if (m) place('Master bedroom', m.id, m.level, 'SW', ['S', 'W'])
    for (const t of northEastToilets(design))
      terms.push({ name: `${t.name} in the north-east`, value: -2 * w, group: 'vastu' })
    const entry = entryFacing(design)
    if (entry === 'N' || entry === 'E')
      terms.push({ name: `Main entry faces ${entry === 'N' ? 'north' : 'east'}`, value: 0.5 * w, group: 'vastu' })
  } else {
    terms.push({ name: 'Vastu not requested', value: 0, group: 'vastu' })
  }

  // ---- Sun: always on. Morning light for bedrooms; no west-only glare ----
  for (const f of design.floors) {
    for (const r of f.rooms.filter(isBedroom)) {
      const sides = windowFacings(design, r.id, f.level)
      if (sides.length && sides.every((s) => s === 'W'))
        terms.push({ name: `${r.name}: west-facing windows only (afternoon heat)`, value: -0.5, group: 'sun' })
      if (sides.includes('E') || sides.includes('N'))
        terms.push({ name: `${r.name}: ${sides.includes('E') ? 'east' : 'north'} light`, value: 0.3, group: 'sun' })
    }
  }

  // ---- Lifestyle: a working study should not share a wall with the living
  //      room (noise on calls) — only when someone actually works from home ----
  if (design.model.brief.lifestyle.wfhCount > 0) {
    for (const f of design.floors) {
      const living = f.rooms.filter((r) => r.id === 'living' || r.id === 'livingDining')
      for (const s of f.rooms.filter((r) => r.id.startsWith('study'))) {
        if (living.some((l) => sharedEdge(s.rect, l.rect)))
          terms.push({ name: `${s.name} shares a wall with the living room (noise on calls)`, value: -0.5, group: 'lifestyle' })
      }
    }
  }

  // Evaluate the realized relationships, including cross-floor separation.
  for (const relation of design.model.relationships) {
    const locate = (id: string) => design.floors.flatMap((f) => f.rooms.filter((r) => r.id === id).map((room) => ({ room, level: f.level })))[0]
    const a = locate(relation.a), b = locate(relation.b)
    if (!a || !b) continue
    const gap = Math.hypot((a.room.rect.x + a.room.rect.w / 2) - (b.room.rect.x + b.room.rect.w / 2),
      (a.room.rect.y + a.room.rect.h / 2) - (b.room.rect.y + b.room.rect.h / 2)) / 1000
    if (relation.kind === 'near') terms.push({ name: `${a.room.name} near ${b.room.name}`, group: 'lifestyle',
      value: a.level === b.level ? Math.max(-1, 1 - gap / 10) : -1 })
    if (relation.kind === 'separated') terms.push({ name: `${a.room.name} separated from ${b.room.name}`, group: 'lifestyle',
      value: a.level !== b.level || !sharedEdge(a.room.rect, b.room.rect) ? .4 : -.8 })
  }
  const poojaSide = design.model.brief.rooms.poojaSide
  if (poojaSide !== 'auto' && design.floors[0].rooms.some((r) => r.id === 'pooja')) {
    const quadrant = roomQuadrant(design, 'pooja', 0)
    terms.push({ name: `Pooja on requested ${poojaSide} side`, group: 'lifestyle', value: quadrant?.includes(poojaSide) ? 2 : -1 })
  }
  const estimated = design.builtAreaSqm * costPerSqmAllIn(design.model.brief)
  const amount = design.model.brief.budget.amountLakh * 1e5
  terms.push({ name: 'Requested budget and finish scope', group: 'budget', value: estimated <= amount ? .5 : -Math.min(8, (estimated / amount - 1) * 4) })

  const total = Math.round(terms.reduce((a, t) => a + t.value, 0) * 100) / 100
  return { total, terms }
}

/**
 * Strict Vastu hard rules: no toilet in the north-east, and the kitchen in the
 * south, south-east or east. Returns what failed (empty = satisfied).
 */
export function strictVastuFailures(design: Design): string[] {
  const failed = northEastToilets(design).map((t) => `${t.name} is in the north-east`)
  const k = roomQuadrant(design, 'kitchen', 0)
  if (k && !['S', 'SE', 'E'].includes(k)) failed.push(`the kitchen is in the ${COMPASS[k]}`)
  return failed
}
