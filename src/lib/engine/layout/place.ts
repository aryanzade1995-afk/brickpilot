import { type Rect, rectRight, rectArea, rectUnionBBox, toSqm } from '../../geometry.ts'
import type { CanonicalModel, FloorProgram, SpaceReq } from '../../model/canonical.ts'
import type { PlacedRoom } from '../types.ts'
import type { Footprint } from '../shape/types.ts'
import type { Rng } from '../shape/rng.ts'
import { GRAMMAR } from './grammar.ts'
import { sliceRegion } from './slots.ts'

/* ------------------------------------------------------------------ *
 *  layoutFloor — rooms wrapped around the circulation hub, per the
 *  ResPlan grammar: the living room (ground) / family lounge (upper)
 *  is the hub, there is no corridor, and every room opens onto it.
 *
 *  Skeleton (rectangle / square footprints):
 *
 *      north / back
 *   +-------+--------------------------+---------+
 *   | stair |      NORTH ROW           |  SIDE   |
 *   +-------+   kitchen / dining /     |  COLUMN |
 *   | core  |   back-of-house beds     |  (beds) |
 *   | tail  +--------------------------+         |
 *   | foyer |                          |         |
 *   | study |          HUB             |         |
 *   |       |   (living / lounge)      |         |
 *   +-------+--------------------------+---------+
 *          south / front (entry on the foyer's front edge)
 *
 *  Every region is sized to the *target area of its own rooms*, and the
 *  hub is the residual centre rectangle — it soaks up whatever slack is
 *  left, clamped, so a small room never balloons to fill a whole column.
 *  The stair sits at a fixed core corner so it lands at the same x on
 *  every storey; the foyer / study fill the core column below it. Every
 *  north-row cell and the side column border the hub, so linkToHub can
 *  guarantee each a door.
 * ------------------------------------------------------------------ */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const G = 100
const snap = (v: number) => Math.round(v / G) * G

export type FloorLayout = {
  rooms: PlacedRoom[]
  hubId: string | null
  stairRect: Rect | null
}

const place = (s: SpaceReq, rect: Rect): PlacedRoom => ({
  id: s.id,
  name: s.name,
  zone: s.zone,
  rect,
  area: toSqm(rectArea(rect)),
  outdoor: s.outdoor,
  wantsWindow: s.wantsWindow,
})

/**
 * Split a cell into [main, sub] along `axis`. The two parts sit side by side
 * (axis 'x') or stacked (axis 'y'), so BOTH still border whatever the cell
 * bordered on the perpendicular edges — the main room keeps its door onto the
 * hub. `subStart` puts the sub room at the low (x: west / y: north) end.
 */
function splitCell(cell: Rect, subSqm: number, axis: 'x' | 'y', subStart: boolean): [Rect, Rect] {
  const MIN_SUB = GRAMMAR.min.bath
  const len = axis === 'x' ? cell.w : cell.h
  const cross = axis === 'x' ? cell.h : cell.w
  const subLen = snap(clamp((subSqm * 1e6) / Math.max(cross, 1), MIN_SUB, Math.max(MIN_SUB, len * 0.45)))
  const mainLen = Math.max(len - subLen, 900)
  if (axis === 'x') {
    const sx = subStart ? cell.x : cell.x + mainLen
    const mx = subStart ? cell.x + subLen : cell.x
    return [
      { x: mx, y: cell.y, w: mainLen, h: cell.h },
      { x: sx, y: cell.y, w: subLen, h: cell.h },
    ]
  }
  const sy = subStart ? cell.y : cell.y + mainLen
  const my = subStart ? cell.y + subLen : cell.y
  return [
    { x: cell.x, y: my, w: cell.w, h: mainLen },
    { x: cell.x, y: sy, w: cell.w, h: subLen },
  ]
}

export function layoutFloor(
  fp: FloorProgram,
  footprint: Footprint,
  model: CanonicalModel,
  _ctx: { grid: number; large: boolean },
  _rng: Rng,
): FloorLayout {
  const house = rectUnionBBox(footprint.blocks)
  const W = house.w
  const H = house.h
  const spaces = fp.spaces
  const S = (id: string) => spaces.find((s) => s.id === id)
  const rooms: PlacedRoom[] = []
  const isGround = fp.level === 0

  // ---- ensuite pairing ----
  const bathFor = new Map<string, SpaceReq>()
  for (const rel of model.relationships) {
    if (rel.kind !== 'adjacent') continue
    const bed = spaces.find((s) => s.id === rel.a && s.zone === 'private')
    const bath = spaces.find((s) => s.id === rel.b && s.wet)
    if (bed && bath) bathFor.set(bed.id, bath)
  }
  const areaOf = (s: SpaceReq) => (s.target + (bathFor.get(s.id)?.target ?? 0)) * 1e6

  const hub = isGround
    ? S('livingDining') ?? S('living')
    : S('familyLounge') ?? S(`lobby${fp.level}`) ?? S('stair')
  const hubId = hub?.id ?? null
  const stair = S('stair')
  const foyer = isGround ? S('foyer') ?? null : null
  const shared = S('sharedBath1') ?? null
  const study = S('study') ?? null
  const beds = spaces.filter((s) => /^bed\d+$/.test(s.id))

  const coreLeft = footprint.core.x < house.x + W / 2

  // ---- assign rooms to regions ----
  //  coreTail : cell(s) below the stair (narrow, core-width)
  //  north    : the back-of-house row, sliced along x, borders the hub
  //  side     : a full-height column on the far side — bedrooms
  //  split    : a small room that shares a host room's cell (host id -> sub)
  let coreTail: SpaceReq[] = []
  const north: SpaceReq[] = []
  const side: SpaceReq[] = []
  const split = new Map<string, SpaceReq>()

  if (isGround) {
    const dining = S('dining') ?? S('livingDining')
    const kitchen = S('kitchen')
    const utility = S('utility')
    const pooja = S('pooja')
    if (dining && dining.id !== hubId) north.push(dining)
    if (kitchen) north.push(kitchen)
    if (utility && kitchen) split.set(kitchen.id, utility)
    else if (utility) north.push(utility)
    if (foyer) coreTail.push(foyer)
    if (pooja && foyer) split.set(foyer.id, pooja)
    else if (pooja) north.push(pooja)
    // ground bedroom(s): the first to the side column, extras onto the back row
    beds.forEach((b, i) => (i === 0 ? side.push(b) : north.push(b)))
  } else {
    // upper floor: the stair tail carries the study / a shared bath, never a bed.
    // Bedrooms wrap the back and one side — up to two across the back, the rest
    // down the far column (ResPlan: beds on the back + side perimeter).
    if (study) coreTail.push(study)
    else if (shared) coreTail.push(shared)
    const loose = shared && !coreTail.includes(shared) ? shared : null
    // up to three bedrooms across the back (a lone side bedroom comes out
    // narrow-and-tall and unbalances the floor); a 4th+ goes down the far column
    const nNorth = Math.min(beds.length, 3)
    north.push(...beds.slice(0, nNorth))
    side.push(...beds.slice(nNorth))
    if (loose) {
      const host = side[side.length - 1] ?? north[north.length - 1]
      if (host) split.set(host.id, loose)
      else coreTail.push(loose)
    }
  }

  const extraArea = (s: SpaceReq) => (split.has(s.id) ? split.get(s.id)!.target * 1e6 : 0)
  const cellArea = (s: SpaceReq) => areaOf(s) + extraArea(s)

  // ---- region thicknesses, each sized to its own contents ----
  const wA = stair
    ? snap(clamp(model.brief.levels.stairWidth * 2 + 300, 2200, 2700))
    : coreTail.length
      ? snap(clamp(Math.sqrt(coreTail.reduce((a, s) => a + cellArea(s), 0) * 1.6), 2200, 3000))
      : 0

  // a stair with no core column below it (single-storey) hands the foyer to the
  // front of the side column instead
  if (!stair && coreTail.length) {
    side.push(...coreTail)
    coreTail = []
  }

  const sideArea = side.reduce((a, s) => a + cellArea(s), 0)
  let wS = side.length ? snap(clamp(sideArea / (H * 0.9), 2700, W * 0.34)) : 0

  let northW = W - wA - wS
  const northArea = north.reduce((a, s) => a + cellArea(s), 0)
  const northNeed = north.length ? northArea / Math.max(northW, 1) : 0
  // a bedroom row can run deeper than a kitchen row before it looks wrong
  const hNCap = H * (isGround ? 0.43 : 0.48)
  let hN = north.length ? snap(clamp(northNeed * 1.05, 2900, hNCap)) : 0

  // ---- the hub: the residual centre rectangle. A wide plot hands the slack to
  // the bedroom column (roomier beds, not a vast living); a deep plot hands it to
  // the back-of-house row, up to ~1.8x its need, then the hub just runs deep. ----
  const hubT = (hub?.target ?? 22) * 1e6
  const isLobbyHub = !!hubId && /^lobby\d+$/.test(hubId)
  const hubMaxW = clamp(Math.sqrt(hubT * 3.6), 4400, Math.max(4400, northW))
  if (northW > hubMaxW && side.length) {
    wS += snap(northW - hubMaxW)
    northW = W - wA - wS
  }
  const hubMaxH = isLobbyHub ? 3600 : Math.max(3800, Math.min(Math.sqrt(hubT * 2.1), 4900))
  if (north.length && H - hN - hubMaxH > 200) {
    // deepen the back-of-house row to shrink an over-tall hub — but never below
    // the row's own minimum (a shallow bedroom fails MIN_ROOM_DIMENSION)
    const grown = Math.min(hN + (H - hN - hubMaxH), Math.max(hN, northNeed * 1.7), hNCap)
    hN = snap(Math.max(hN, grown))
  }

  // ---- geometry ----
  const coreX = coreLeft ? house.x : rectRight(house) - wA
  const innerX = coreLeft ? house.x + wA : house.x + wS
  const sideX = coreLeft ? rectRight(house) - wS : house.x
  // the stair drops ~1.3 m past the back-of-house row so its inner edge borders
  // the hub over a full opening — you step off the flight straight into the
  // living room / lounge on every storey (never a foyer, bath or bedroom).
  const stairH = stair ? snap(clamp(hN + 1300, 3800, H - 2600)) : 0

  // ---- placement helpers ----
  // an ensuite bath / utility / pooja shares its host's cell. It sits beside the
  // host along the row axis so the host keeps its hub-facing edge; if that would
  // leave the host below ~2.5 m it flips to a shallow strip on the far side
  // instead (still off the hub edge).
  const HOST_MIN = 2500
  // `hubAtHiX` — for a column (axis 'y') region, is the hub on its high-x side?
  // The core tail and the side column sit on opposite edges of the plan, so the
  // hub is inboard of each on a different side; the ensuite / niche must land on
  // the far side so the host keeps the wall it doors onto the hub through.
  // `canFlip` — a too-tall split may turn on its side (a shallow ensuite strip)
  // in the side column, but NOT in the core tail: flipping there wedges a 0.9 m
  // foyer between the pooja and the hub. A short foyer is fine, unreachable isn't.
  const emit = (s: SpaceReq, r: Rect, axis: 'x' | 'y', hubAtHiX: boolean, canFlip: boolean) => {
    const sub = split.get(s.id) ?? (bathFor.has(s.id) ? bathFor.get(s.id)! : null)
    if (!sub) {
      rooms.push(place(s, r))
      return
    }
    const along = axis === 'x' ? r.w : r.h
    const subLen = Math.max(GRAMMAR.min.bath, (sub.target * 1e6) / Math.max(axis === 'x' ? r.h : r.w, 1))
    let splitAxis = axis
    let subStart = axis === 'x' ? coreLeft : true
    if (canFlip && along - subLen < HOST_MIN) {
      splitAxis = axis === 'x' ? 'y' : 'x'
      // keep the sub off the hub edge: hub is south of a row, or on the hi/lo-x
      // side of a column depending which side of the plan the column is on
      subStart = axis === 'x' ? true : hubAtHiX
    }
    const [main, subR] = splitCell(r, sub.target, splitAxis, subStart)
    rooms.push(place(s, main), place(sub, subR))
  }
  const fillRegion = (region: Rect, list: SpaceReq[], axis: 'x' | 'y', hubAtHiX = false, canFlip = true) => {
    if (region.w < 1100 || region.h < 1100 || !list.length) return
    const cross = axis === 'x' ? region.h : region.w
    const cells = sliceRegion(
      region,
      list.map((s) => ({
        id: s.id,
        weight: Math.max(cellArea(s), 1) / Math.max(cross, 1),
        minMain: /^bed\d+$/.test(s.id) ? 2500 : 1500,
      })),
      { axis, from: 'lo' },
    )
    for (const s of list) {
      const r = cells.get(s.id)
      if (r) emit(s, r, axis, hubAtHiX, canFlip)
    }
  }

  // ---- stair ----
  let stairRect: Rect | null = null
  if (stair) {
    stairRect = { x: coreX, y: house.y, w: wA, h: stairH }
    rooms.push(place(stair, stairRect))
  }

  // ---- core tail: foyer / study, stacked below the stair, front-anchored ----
  // the hub sits inboard of the core — to its right when the core is on the left;
  // never flip a split here (keeps the foyer full-width and hub-reachable)
  if (coreTail.length) {
    fillRegion({ x: coreX, y: house.y + stairH, w: wA, h: H - stairH }, coreTail, 'y', coreLeft, false)
  }

  // ---- north back-of-house row ----
  if (north.length) {
    fillRegion({ x: innerX, y: house.y, w: northW, h: hN }, north, 'x')
  }

  // ---- side column: bedrooms, full height ----
  // the hub sits inboard of the side column — opposite hand to the core
  if (side.length) {
    fillRegion({ x: sideX, y: house.y, w: wS, h: H }, side, 'y', !coreLeft)
  }

  // ---- hub ----
  if (hub && hub.id !== stair?.id) {
    rooms.push(place(hub, { x: innerX, y: house.y + hN, w: northW, h: H - hN }))
  }

  return { rooms, hubId, stairRect }
}
