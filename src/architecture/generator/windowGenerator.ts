/* ------------------------------------------------------------------ *
 *  windowGenerator — the room-driven opening system.
 *
 *      ROOM → EXTERIOR WALLS → ORIENTATION → ROOM TYPE → STYLE RULE
 *           → OPENING COUNT / SIZE / KIND → placement
 *
 *  Rules enforced (per the grammar + GenerationConstraints):
 *   - every window belongs to a real room and a real exterior wall
 *   - bedroom 1–2, bathroom privacy-only, kitchen 1, living/dining larger
 *   - respect wall length, keep MIN_WALL_BETWEEN between openings
 *   - keep MIN_CORNER_OFFSET from each end, MIN_DOOR_WINDOW from any door
 *   - window-to-wall ratio capped (maxWindowRatio)
 *   - each floor is generated independently — the upper floors are NOT
 *     a copy of the ground floor, and street-facing upper rooms shrink
 *     / raise for privacy
 *   - never emit windows just to make a facade look busy
 * ------------------------------------------------------------------ */

import type { Point } from '../../lib/geometry.ts'
import type { FloorPlan } from '../../lib/engine/types.ts'
import type { Rng } from '../../lib/engine/shape/rng.ts'
import type { DesignGenome, Direction4, GenerationConstraints, RoomClass, RoomWindowRule, StyleGrammar, WindowSpec } from '../types.ts'
import { GLAZING_LIBRARY, WINDOW_STRATEGY_LIBRARY } from '../library/windowLibrary.ts'
import { classifyRoom, doorOnEdge, roomWalls, type WallEdge } from './classify.ts'

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** room classes that never get an exterior window from this pass */
const NO_WINDOW: RoomClass = 'foyer'
const SKIP: Set<RoomClass> = new Set<RoomClass>([NO_WINDOW, 'lobby', 'parking', 'balcony', 'courtyard', 'verandah', 'other'])

/** rough daylight desirability of an orientation (plan frame; S = street/entry) */
const ORIENT_SCORE: Record<Direction4, number> = { N: 1.0, S: 0.75, E: 0.7, W: 0.55 }

export type WindowGenInput = {
  grammar: StyleGrammar
  constraints: GenerationConstraints
  floor: FloorPlan
  level: number
  floorHeightMm: number
  entrySide: Direction4
  rng: Rng
  genome: DesignGenome
  /** resolved doors (entry / internal / balcony) the windows must stay clear of */
  extraDoors?: { at: Point; width: number }[]
}

export function generateWindows(input: WindowGenInput): WindowSpec[] {
  const { grammar, constraints, floor, level, floorHeightMm, rng, genome } = input
  const wr = grammar.window
  const cw = constraints.window
  // the genome's glazing strategy sets a hard window-to-wall ceiling + a count bias
  const glz = GLAZING_LIBRARY[genome.glazing as keyof typeof GLAZING_LIBRARY] ?? GLAZING_LIBRARY.controlled_large
  const wStrat = WINDOW_STRATEGY_LIBRARY[genome.windowStrategy as keyof typeof WINDOW_STRATEGY_LIBRARY]
  const glazingCeiling = glz.wallRatioCeiling
  const countBias = glz.countBias
  const sillBiasMm = wStrat?.sillBiasMm ?? 0
  const out: WindowSpec[] = []
  let uid = 0

  for (const room of floor.rooms) {
    if (room.outdoor) continue
    const cls = classifyRoom(room)
    if (SKIP.has(cls)) continue
    const rule: RoomWindowRule = wr.byRoom[cls] ?? wr.fallback

    // ---- candidate walls: exterior, long enough, not the entry, not doored-out
    const doors = [
      ...floor.openings.filter((o) => o.kind === 'door' || o.kind === 'entry').map((o) => ({ at: o.at, width: o.width })),
      ...(input.extraDoors ?? []),
    ]
    const allExterior = roomWalls(room, floor).filter((w) => w.exterior)
    const walls = allExterior.filter((w) => {
      if (w.lengthMm < rule.widthMm[0] + 2 * wr.minCornerOffsetMm) return false
      // a wall almost entirely taken by a door is not a window wall
      const doorSpan = doors.reduce((s, d) => s + (doorOnEdge(w, d.at) != null ? d.width : 0), 0)
      return doorSpan < w.lengthMm * 0.7
    })
    const habitable = cls === 'living' || cls === 'dining' || cls === 'bedroom' || cls === 'master' || cls === 'study' || cls === 'kitchen'
    if (walls.length === 0) {
      // §12 — a habitable room MUST get light + ventilation: force one window on
      // its longest exterior wall (a small ventilator if the wall is short)
      if (habitable && allExterior.length) {
        const w = allExterior.sort((a, b) => b.lengthMm - a.lengthMm)[0]
        const corner = Math.min(wr.minCornerOffsetMm, w.lengthMm * 0.15)
        const usable = w.lengthMm - 2 * corner
        if (usable >= 500) {
          const width = Math.round(Math.min(usable, cls === 'living' || cls === 'dining' ? 2000 : 1400))
          out.push({
            id: `w${level}-${uid++}`,
            roomId: room.id,
            roomClass: cls,
            level,
            wall: { a: w.a, b: w.b },
            side: w.side,
            centerMm: w.lengthMm / 2,
            widthMm: width,
            heightMm: width < 900 ? 900 : 1350,
            sillMm: rule.sillMm,
            kind: width < 900 ? 'ventilator' : 'standard',
            mullions: 0,
            facesCourt: w.facesCourt,
            facesStreet: w.facesStreet,
          })
        }
      }
      continue
    }
    const doorsOn = (w: WallEdge) => doors.filter((d) => doorOnEdge(w, d.at) != null)

    // ---- rank walls
    const ranked = [...walls].sort((a, b) => wallScore(b, cls, level, wr.upperPrivacyBias) - wallScore(a, cls, level, wr.upperPrivacyBias))

    // ---- how many windows this room wants
    let want = rule.preferred
    // the genome's glazing strategy scales social-room counts (never bath / stair / utility)
    if (!rule.privacy && cls !== 'stair') want = Math.round(want * countBias)
    const primary = ranked[0]
    const streetPrivate = primary.facesStreet && level > 0 && (cls === 'bedroom' || cls === 'master' || cls === 'study')
    if (streetPrivate) want = Math.max(1, want - Math.round(wr.upperPrivacyBias))
    want = clamp(want, cls === 'stair' ? 0 : rule.preferred > 0 ? 1 : 0, Math.min(rule.max, cw.maxWindowsPerRoom))
    if (cls === 'stair') want = rng.chance(0.45) ? 1 : 0
    if (want === 0) continue

    // ---- decide the opening kind
    const privacy = rule.privacy || (streetPrivate && rng.chance(0.6))
    // the genome's window strategy biases which social rooms ribbon vs. picture vs. punch
    const socialKind = !rule.privacy ? (wStrat?.socialKind ?? 'standard') : 'privacy'
    const stripChance = grammar.window.stripGlazingChance * (socialKind === 'strip' ? 1.8 : socialKind === 'picture' ? 0.4 : 1)
    const pictureChance = grammar.window.pictureWindowChance * (socialKind === 'picture' ? 1.9 : socialKind === 'strip' ? 0.4 : 1)
    // a ribbon window needs a door-free wall — else pick a standard set instead
    const stripWall = ranked.find((w) => doorsOn(w).length === 0) ?? null
    const strip =
      !privacy &&
      rule.allowStrip &&
      !!stripWall &&
      (stripWall.facesCourt || !stripWall.facesStreet || cls === 'living' || cls === 'dining') &&
      rng.chance(clamp(stripChance, 0, 0.95))
    const picture = !privacy && !strip && rule.allowPicture && rng.chance(clamp(pictureChance, 0, 0.95))

    if (strip && stripWall) {
      const w = placeStrip(stripWall, room.id, cls, level, rule, wr, floorHeightMm, sillBiasMm, rng, uid++)
      if (w) out.push(w)
      continue
    }

    // ---- distribute `want` standard/privacy/picture windows across the top wall(s)
    const placed = placeWindows({
      walls: ranked,
      want,
      roomId: room.id,
      cls,
      level,
      rule,
      wr,
      cw,
      floorHeightMm,
      doors,
      privacy,
      picture,
      glazingCeiling,
      sillBiasMm,
      rng,
      startUid: uid,
    })
    uid += placed.length
    out.push(...placed)
  }

  return out
}

/* ------------------------------------------------------------------ */

function wallScore(w: WallEdge, cls: RoomClass, level: number, privacyBias: number): number {
  let s = ORIENT_SCORE[w.side]
  s += Math.min(w.lengthMm / 6000, 1) * 0.6 // longer wall preferred
  if (w.facesCourt) s += cls === 'living' || cls === 'dining' || cls === 'master' ? 1.4 : 0.9
  if (w.facesStreet && level > 0 && (cls === 'bedroom' || cls === 'master' || cls === 'bathroom')) s -= privacyBias * 1.2
  if (w.facesStreet && (cls === 'living' || cls === 'dining')) s += 0.25 // a street presence for social rooms
  return s
}

function windowHeight(rule: RoomWindowRule, floorHeightMm: number, sill: number, rng: Rng): number {
  const head = 300
  const cap = Math.max(rule.heightMm[0], floorHeightMm - sill - head)
  return Math.round(clamp(lerp(rule.heightMm[0], rule.heightMm[1], rng.next()), rule.heightMm[0], cap))
}

function mullionsFor(widthMm: number): number {
  return widthMm > 1650 ? Math.max(1, Math.floor((widthMm - 250) / 1450)) : 0
}

function placeStrip(
  wall: WallEdge,
  roomId: string,
  cls: RoomClass,
  level: number,
  rule: RoomWindowRule,
  wr: StyleGrammar['window'],
  floorHeightMm: number,
  sillBiasMm: number,
  rng: Rng,
  id: number,
): WindowSpec | null {
  const usable = wall.lengthMm - 2 * wr.minCornerOffsetMm
  if (usable < 1600) return null
  const sill = Math.round(clamp(rule.sillMm + sillBiasMm * 0.5 + rng.range(-40, 60), 0, 1200))
  const widthMm = Math.round(usable)
  const centerMm = wr.minCornerOffsetMm + usable / 2
  return {
    id: `w${level}-${id}`,
    roomId,
    roomClass: cls,
    level,
    wall: { a: wall.a, b: wall.b },
    side: wall.side,
    centerMm,
    widthMm,
    heightMm: windowHeight(rule, floorHeightMm, sill, rng),
    sillMm: sill,
    kind: 'strip',
    mullions: Math.max(2, Math.floor(widthMm / 1500)),
    facesCourt: wall.facesCourt,
    facesStreet: wall.facesStreet,
  }
}

type PlaceInput = {
  walls: WallEdge[]
  want: number
  roomId: string
  cls: RoomClass
  level: number
  rule: RoomWindowRule
  wr: StyleGrammar['window']
  cw: GenerationConstraints['window']
  floorHeightMm: number
  doors: { at: Point; width: number }[]
  privacy: boolean
  picture: boolean
  /** window-to-wall ratio ceiling from the genome's glazing strategy */
  glazingCeiling: number
  /** sill adjustment from the genome's window strategy, mm */
  sillBiasMm: number
  rng: Rng
  startUid: number
}

function placeWindows(p: PlaceInput): WindowSpec[] {
  const { walls, roomId, cls, level, rule, wr, cw, floorHeightMm, doors, privacy, picture, glazingCeiling, sillBiasMm, rng } = p
  const res: WindowSpec[] = []
  let remaining = p.want
  let id = p.startUid

  for (const wall of walls) {
    if (remaining <= 0) break

    // free intervals on this wall = [cornerOffset, len-cornerOffset] minus door clearances
    const lo = wr.minCornerOffsetMm
    const hi = wall.lengthMm - wr.minCornerOffsetMm
    if (hi - lo < rule.widthMm[0]) continue
    const blocked: [number, number][] = []
    for (const d of doors) {
      const off = doorOnEdge(wall, d.at)
      if (off == null) continue
      const clr = d.width / 2 + wr.minDoorWindowDistanceMm + 150
      blocked.push([off - clr, off + clr])
    }
    const intervals = subtract([lo, hi], blocked).filter(([a, b]) => b - a >= rule.widthMm[0])
    if (intervals.length === 0) continue

    // window-to-wall ratio budget for this wall — the genome's glazing ceiling
    // is a further cap on top of the style + global limits
    const wallArea = wall.lengthMm * floorHeightMm
    let areaBudget = Math.min(wr.maxWindowRatio, cw.maxWindowRatio, glazingCeiling) * wallArea
    let usedArea = 0

    for (const [ia, ib] of intervals) {
      if (remaining <= 0) break
      const span = ib - ia
      // how many of this room's windows fit in this interval
      const wBase = privacy
        ? rule.widthMm[0]
        : picture && res.length === 0
          ? Math.min(rule.widthMm[1] * 1.4, span - 100)
          : lerp(rule.widthMm[0], rule.widthMm[1], 0.35 + rng.next() * 0.4)
      const fitCount = Math.max(1, Math.floor((span + wr.minWallBetweenWindowsMm) / (wBase + wr.minWallBetweenWindowsMm)))
      const n = Math.min(remaining, fitCount, picture ? 1 : rule.max)

      const gap = wr.minWallBetweenWindowsMm
      const wWidth = Math.min(wBase, (span - (n - 1) * gap) / n)
      if (wWidth < rule.widthMm[0] * 0.75) continue
      const total = n * wWidth + (n - 1) * gap
      let cursor = ia + (span - total) / 2

      for (let k = 0; k < n; k++) {
        const sill = privacy
          ? Math.max(rule.sillMm, 1400)
          : Math.round(clamp(rule.sillMm + sillBiasMm + rng.range(-50, 80), 0, 1300))
        const heightMm = privacy
          ? Math.round(clamp(rule.heightMm[1], 500, 900))
          : windowHeight(rule, floorHeightMm, sill, rng)
        const widthMm = Math.round(wWidth)
        if (usedArea + widthMm * heightMm > areaBudget && res.length > 0) {
          remaining = 0
          break
        }
        usedArea += widthMm * heightMm
        res.push({
          id: `w${level}-${id++}`,
          roomId,
          roomClass: cls,
          level,
          wall: { a: wall.a, b: wall.b },
          side: wall.side,
          centerMm: Math.round(cursor + widthMm / 2),
          widthMm,
          heightMm,
          sillMm: sill,
          kind: privacy ? 'privacy' : picture && res.length === 0 ? 'picture' : 'standard',
          mullions: privacy ? 0 : mullionsFor(widthMm),
          facesCourt: wall.facesCourt,
          facesStreet: wall.facesStreet,
        })
        cursor += widthMm + gap
        remaining--
      }
      // once a wall carries the room's picture window, cap its remaining budget
      if (picture) areaBudget = usedArea
    }
  }
  return res
}

/** [lo,hi] minus a set of blocked intervals → the free intervals */
function subtract(range: [number, number], blocked: [number, number][]): [number, number][] {
  let free: [number, number][] = [range]
  for (const [ba, bb] of blocked) {
    const next: [number, number][] = []
    for (const [fa, fb] of free) {
      if (bb <= fa || ba >= fb) {
        next.push([fa, fb])
        continue
      }
      if (ba > fa) next.push([fa, Math.min(ba, fb)])
      if (bb < fb) next.push([Math.max(bb, fa), fb])
    }
    free = next
  }
  return free
}
