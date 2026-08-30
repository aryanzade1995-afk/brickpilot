import {
  type Rect,
  type Point,
  snap,
  rectArea,
  rectBottom,
  rectRight,
  rectCenter,
  sharedEdge,
  toSqm,
} from '../geometry.ts'
import type { CanonicalModel, FloorProgram, Relationship, SpaceReq } from '../model/canonical.ts'
import { themeOf } from '../model/themes.ts'
import { squarify } from './treemap.ts'
import type { Design, FloorPlan, Opening, PlacedRoom, StairRun, Wall } from './types.ts'

const EXT_WALL = 230
const INT_WALL = 115
const STAIR_LEN = 4000
const DOOR = 900

const ZONE_ORDER: Record<string, number> = {
  social: 0,
  service: 1,
  sacred: 2,
  work: 3,
  private: 4,
  outdoor: 5,
  circulation: 6,
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export type Strategy = 'orthogonal-core' | 'wing-split'

export const STRATEGIES: { id: Strategy; label: string; blurb: string }[] = [
  {
    id: 'orthogonal-core',
    label: 'Orthogonal core',
    blurb: 'A compact block with the stair and services drawn to one edge — the shortest walls and the simplest structure.',
  },
  {
    id: 'wing-split',
    label: 'Split wings',
    blurb: 'The stair sits centrally and the plan opens into a living wing and a sleeping wing, each with its own aspect.',
  },
]

/** One validated scheme per strategy — the "directions" the user picks between. */
export function generateDirections(
  model: CanonicalModel,
): { strategy: Strategy; label: string; blurb: string; design: Design }[] {
  return STRATEGIES.map((s) => ({
    strategy: s.id,
    label: s.label,
    blurb: s.blurb,
    design: generate(model, s.id),
  }))
}

export function generate(model: CanonicalModel, strategy: Strategy = 'orthogonal-core'): Design {
  const grid = model.grid

  const envelope: Rect = {
    x: model.setbacksMm.W,
    y: model.setbacksMm.N,
    w: model.envelope.width,
    h: model.envelope.depth,
  }
  const plotRect: Rect = { x: 0, y: 0, w: model.plot.width, h: model.plot.depth }

  // --- front strip: covered outdoor sits between the house and the road ---
  const outdoorIds = new Set(model.floors[0].spaces.filter((s) => s.outdoor).map((s) => s.id))
  const twoCar = model.brief.spaces.occupants >= 4
  const parkD = 5200
  const verandahD = 2600
  let frontStrip = 0
  if (outdoorIds.has('parking')) frontStrip = parkD
  else if (outdoorIds.has('verandah') || outdoorIds.has('courtyard')) frontStrip = verandahD
  if (frontStrip > 0) frontStrip += 300

  // --- house footprint: fills the envelope, less the front strip ---
  const houseW = snap(Math.min(envelope.w, 22000), grid)
  const houseH = snap(clamp(envelope.h - frontStrip, 6000, 18000), grid)
  const houseRect: Rect = {
    x: snap(envelope.x + (envelope.w - houseW) / 2, grid),
    y: envelope.y,
    w: houseW,
    h: houseH,
  }

  // --- core strip: west edge for orthogonal-core, centred for wing-split ---
  const coreW = snap(clamp(model.brief.levels.stairWidth * 2 + 600, 2400, 2900), grid)
  const coreX =
    strategy === 'wing-split'
      ? snap(houseRect.x + (houseRect.w - coreW) / 2, grid)
      : houseRect.x
  const coreRect: Rect = { x: coreX, y: houseRect.y, w: coreW, h: houseRect.h }
  const stairRect: Rect = {
    x: coreRect.x + INT_WALL,
    y: coreRect.y + INT_WALL,
    w: coreRect.w - INT_WALL * 2,
    h: STAIR_LEN,
  }

  // --- per-floor footprint schedule: a clean stepped block ---
  // Each storey sits fully within the one below (never oversails it), but is
  // also grown to cover every storey above it, so a sparse middle floor can
  // never be squeezed under a denser floor on top of it.
  const baseArea = houseRect.w * houseRect.h
  const wing = strategy === 'wing-split'
  const minFW = Math.min(coreRect.w + (wing ? 5600 : 4200), houseRect.w)
  const coreCx = coreRect.x + coreRect.w / 2

  const rawScale = model.floors.map((fp) => {
    if (fp.level === 0) return 1
    const interior = fp.spaces.filter((s) => s.zone !== 'circulation' && !s.outdoor)
    const need = (interior.reduce((a, s) => a + s.target, 0) + 14) * 1.16 * 1e6
    return clamp(Math.sqrt(need / baseArea), 0.62, 1)
  })
  for (let i = rawScale.length - 2; i >= 1; i--) {
    rawScale[i] = Math.max(rawScale[i], rawScale[i + 1]) // suffix-max
  }

  const footprints: Rect[] = []
  let prevW = houseRect.w
  let prevH = houseRect.h
  for (const fp of model.floors) {
    if (fp.level === 0) {
      footprints.push(houseRect)
      continue
    }
    const s = rawScale[fp.level]
    const w = Math.min(
      prevW,
      snap(clamp(houseRect.w * clamp(s * 1.08, 0.55, 1), minFW, houseRect.w), grid),
    )
    const h = Math.min(
      prevH,
      snap(clamp(houseRect.h * s, stairRect.h + 2400, houseRect.h), grid),
    )
    prevW = w
    prevH = h
    const x = wing
      ? clamp(snap(coreCx - w / 2, grid), houseRect.x, rectRight(houseRect) - w)
      : houseRect.x
    footprints.push({ x, y: houseRect.y, w, h })
  }

  const ctx: Ctx = { houseRect, coreRect, stairRect, envelope, grid, twoCar, strategy }
  const floors = model.floors.map((fp, i) => buildFloor(fp, model, ctx, footprints[i]))

  const groundMm2 = rectArea(floors[0].outline)
  const builtMm2 = floors.reduce((a, f) => a + rectArea(f.outline), 0)
  const outdoorMm2 = floors[0].rooms
    .filter((r) => r.outdoor)
    .reduce((a, r) => a + rectArea(r.rect), 0)
  const builtAreaSqm = toSqm(builtMm2)
  const coverage = (groundMm2 + outdoorMm2 * 0.5) / rectArea(plotRect)
  const heightM = Math.round((floors.length * model.brief.levels.floorToFloor + 1) * 10) / 10

  const doors = floors.reduce(
    (n, f) => n + f.openings.filter((o) => o.kind === 'door' || o.kind === 'entry').length,
    0,
  )
  const windows = floors.reduce((n, f) => n + f.openings.filter((o) => o.kind === 'window').length, 0)

  return {
    id: `${model.seed}-${strategy}`,
    seed: model.seed,
    algorithm: 'deterministic-plan-v1',
    candidate: strategy,
    model,
    floors,
    builtAreaSqm,
    footprintSqm: toSqm(groundMm2),
    coveredFootprintSqm: toSqm(groundMm2 + outdoorMm2),
    heightM,
    coverage,
    openingCounts: { doors, windows },
  }
}

type Ctx = {
  houseRect: Rect
  coreRect: Rect
  stairRect: Rect
  envelope: Rect
  grid: number
  twoCar: boolean
  strategy: Strategy
}

function buildFloor(
  fp: FloorProgram,
  model: CanonicalModel,
  ctx: Ctx,
  houseRect: Rect,
): FloorPlan {
  const { coreRect, stairRect, envelope, grid, twoCar } = ctx
  const rooms: PlacedRoom[] = []

  const core = fp.spaces.filter((s) => s.zone === 'circulation')
  const outdoor = fp.spaces.filter((s) => s.outdoor)
  const interior = [...fp.spaces.filter((s) => s.zone !== 'circulation' && !s.outdoor)].sort(
    (a, b) => (ZONE_ORDER[a.zone] ?? 9) - (ZONE_ORDER[b.zone] ?? 9),
  )

  // footprint (already clamped to sit within the floor below) → strips & wings
  const wing = ctx.strategy === 'wing-split'
  const coreStrip: Rect = { x: coreRect.x, y: coreRect.y, w: coreRect.w, h: houseRect.h }
  const mainRect: Rect = {
    x: houseRect.x + coreRect.w,
    y: houseRect.y,
    w: houseRect.w - coreRect.w,
    h: houseRect.h,
  }
  const westWing: Rect = { x: houseRect.x, y: houseRect.y, w: coreStrip.x - houseRect.x, h: houseRect.h }
  const eastWing: Rect = {
    x: coreStrip.x + coreStrip.w,
    y: houseRect.y,
    w: rectRight(houseRect) - (coreStrip.x + coreStrip.w),
    h: houseRect.h,
  }

  // ---- core strip, north→south: [stair] [circulation?] [foyer / lobby] ----
  const stairSpace = core.find((s) => s.id === 'stair')
  const frontSpace = core.find((s) => s.id === 'foyer' || s.id.startsWith('lobby'))
  const circSpace = core.find((s) => s.id.startsWith('circ'))

  const southStart = stairSpace ? stairRect.y + stairRect.h : coreStrip.y
  let cursor = southStart
  const southH = rectBottom(coreStrip) - southStart

  if (stairSpace) {
    rooms.push(place(stairSpace, { x: coreStrip.x, y: coreStrip.y, w: coreStrip.w, h: stairRect.h }))
  }
  if (circSpace && southH > 3200) {
    const circH = snap(clamp(southH * 0.42, 1600, 3200), grid)
    rooms.push(place(circSpace, { x: coreStrip.x, y: cursor, w: coreStrip.w, h: circH }))
    cursor += circH
  }
  if (frontSpace) {
    rooms.push(
      place(frontSpace, { x: coreStrip.x, y: cursor, w: coreStrip.w, h: rectBottom(coreStrip) - cursor }),
    )
  }

  // ---- main area: treemap of interior spaces, bedrooms carrying their ensuite ----
  const bathFor = new Map<string, SpaceReq>()
  const consumed = new Set<string>()
  model.relationships
    .filter((rel) => rel.kind === 'adjacent')
    .forEach((rel) => {
      const bed = interior.find((s) => s.id === rel.a && s.zone === 'private')
      const bath = interior.find((s) => s.id === rel.b && s.wet)
      if (bed && bath) {
        bathFor.set(bed.id, bath)
        consumed.add(bath.id)
      }
    })

  const units = interior
    .filter((s) => !consumed.has(s.id))
    .map((s) => {
      const bath = bathFor.get(s.id)
      return { id: s.id, weight: s.target + (bath?.target ?? 0), room: s, bath }
    })

  const snapRect = (r: Rect): Rect => {
    const x = clamp(snap(r.x, grid), houseRect.x, rectRight(houseRect) - grid)
    const y = clamp(snap(r.y, grid), houseRect.y, rectBottom(houseRect) - grid)
    return {
      x,
      y,
      w: Math.min(snap(r.w, grid), rectRight(houseRect) - x),
      h: Math.min(snap(r.h, grid), rectBottom(houseRect) - y),
    }
  }

  const fill = (us: typeof units, region: Rect, tag = '') => {
    if (region.w < 1500 || region.h < 1500) return

    // An empty wing (sparse upper floor) becomes one hall, so the enclosed
    // outline still fills the whole footprint and the storey below never
    // ends up narrower than the one above it.
    if (us.length === 0) {
      if (fp.level > 0) rooms.push(place(hallSpace(fp.level, tag, toSqm(rectArea(region))), snapRect(region)))
      return
    }

    // A sparse upper floor leaves the treemap more area than the programme needs,
    // so every room inflates past its brief maximum. Carve the surplus off as a
    // hall strip against the core (a staple of Indian house planning, and a tidy
    // circulation spine) so the real rooms land near their target sizes.
    let roomRegion = region
    const surplus = toSqm(rectArea(region)) - us.reduce((a, u) => a + u.weight, 0)
    if (fp.level > 0 && surplus >= 8) {
      let hallW = snap((surplus * 1e6) / region.h, grid)
      hallW = Math.min(hallW, snap(region.w * 0.4, grid))
      if (hallW >= 2000 && region.w - hallW >= 3800) {
        rooms.push(
          place(hallSpace(fp.level, tag, surplus), snapRect({ ...region, w: hallW })),
        )
        roomRegion = { x: region.x + hallW, y: region.y, w: region.w - hallW, h: region.h }
      }
    }

    const cells = squarify(us.map((u) => ({ id: u.id, weight: u.weight })), roomRegion)
    for (const u of us) {
      const cell = cells.get(u.id)
      if (!cell) continue
      if (!u.bath) {
        rooms.push(place(u.room, snapRect(cell)))
        continue
      }
      const [bedRect, bathRect] = splitEnsuite(cell, u.bath.target, coreStrip)
      rooms.push(place(u.room, snapRect(bedRect)))
      rooms.push(place(u.bath, snapRect(bathRect)))
    }
  }

  if (wing) {
    // balance the two wings: largest-first, each unit to the lighter wing
    const west: typeof units = []
    const east: typeof units = []
    let wa = 0
    let ea = 0
    for (const u of [...units].sort((a, b) => b.weight - a.weight)) {
      if (wa <= ea) {
        west.push(u)
        wa += u.weight
      } else {
        east.push(u)
        ea += u.weight
      }
    }
    fill(west, westWing, 'w')
    fill(east, eastWing, 'e')
  } else {
    fill(units, mainRect)
  }

  repairWindows(rooms, enclosedOutline(rooms))

  // ---- outdoor ----
  if (fp.level === 0 && outdoor.length > 0) {
    layoutFrontYard(outdoor, rooms, { houseRect, envelope, grid, twoCar })
  } else if (fp.level > 0) {
    for (const s of outdoor) {
      if (!s.id.startsWith('balcony')) continue
      const w = snap(clamp(houseRect.w * 0.4, 2400, 4200), grid)
      const d = 1500
      rooms.push(
        place(s, {
          x: snap(houseRect.x + houseRect.w / 2 - w / 2, grid),
          y: rectBottom(houseRect),
          w,
          h: d,
        }),
      )
    }
  }

  const outline = enclosedOutline(rooms)
  const walls = deriveWalls(rooms, outline)
  const openings: Opening[] = []
  deriveDoors(rooms, model.relationships, openings)
  const entryRoom = rooms.find((r) => r.id === 'foyer' || r.id.startsWith('lobby'))
  if (entryRoom && fp.level === 0) {
    addEntry(entryRoom, outline, model.brief.entry.mainDoorWidth, openings)
  }
  // a full-height door on the facade behind every balcony
  for (const b of rooms) {
    if (!b.outdoor || !b.id.startsWith('balcony')) continue
    const at = { x: Math.round(b.rect.x + b.rect.w / 2), y: rectBottom(outline) }
    openings.push({ kind: 'door', at, orient: 'h', width: clamp(b.rect.w - 700, 900, 1600) })
  }
  // window rhythm on every daylight facade, clear of the doors above — the
  // spacing and proportion are set by the chosen design character
  deriveWindows(rooms, outline, openings, themeOf(model.brief).windows)

  const { reachable, unreachableRooms } = repairReachability(rooms, openings, fp.level)
  const stair = stairSpace ? makeStair(stairRect, model.brief.levels.floorToFloor) : undefined

  return { level: fp.level, name: fp.name, outline, rooms, walls, openings, stair, reachable, unreachableRooms }
}

/* ---------------------------------- layout --------------------------------- */

function layoutFrontYard(
  outdoor: SpaceReq[],
  rooms: PlacedRoom[],
  o: { houseRect: Rect; envelope: Rect; grid: number; twoCar: boolean },
) {
  const { houseRect, envelope, grid, twoCar } = o
  const frontY = rectBottom(houseRect) + 200
  const availH = rectBottom(envelope) - frontY - 100
  let cx = houseRect.x

  const sizeFor = (s: SpaceReq): { w: number; h: number } => {
    if (s.id === 'parking') return { w: twoCar ? 5200 : 3000, h: Math.min(availH, 5000) }
    if (s.id === 'verandah') return { w: 3400, h: Math.min(availH, 2600) }
    return { w: 3200, h: Math.min(availH, 3200) }
  }

  for (const s of outdoor) {
    const { w, h } = sizeFor(s)
    let ww = snap(w, grid)
    if (cx + ww > rectRight(houseRect)) ww = rectRight(houseRect) - cx
    if (ww < 1500) break
    rooms.push(place(s, { x: cx, y: frontY, w: ww, h: snap(h, grid) }))
    cx += ww + 200
  }
}

/** carve an ensuite bath out of a bedroom cell, pushed to the interior (core) side */
function splitEnsuite(cell: Rect, bathTargetSqm: number, coreStrip: Rect): [Rect, Rect] {
  const bathArea = bathTargetSqm * 1e6
  const nearCoreWest = Math.abs(cell.x - rectRight(coreStrip)) < cell.w
  if (cell.w >= cell.h) {
    const bw = clamp(bathArea / cell.h, 1500, cell.w * 0.42)
    return nearCoreWest
      ? [
          { x: cell.x + bw, y: cell.y, w: cell.w - bw, h: cell.h },
          { x: cell.x, y: cell.y, w: bw, h: cell.h },
        ]
      : [
          { x: cell.x, y: cell.y, w: cell.w - bw, h: cell.h },
          { x: cell.x + cell.w - bw, y: cell.y, w: bw, h: cell.h },
        ]
  }
  const bh = clamp(bathArea / cell.w, 1500, cell.h * 0.42)
  return [
    { x: cell.x, y: cell.y + bh, w: cell.w, h: cell.h - bh },
    { x: cell.x, y: cell.y, w: cell.w, h: bh },
  ]
}

/** swap any daylight-hungry room that ended up landlocked with a perimeter service room */
function repairWindows(rooms: PlacedRoom[], outline: Rect) {
  const onPerimeter = (r: PlacedRoom) =>
    Math.abs(r.rect.x - outline.x) < 2 ||
    Math.abs(rectRight(r.rect) - rectRight(outline)) < 2 ||
    Math.abs(r.rect.y - outline.y) < 2 ||
    Math.abs(rectBottom(r.rect) - rectBottom(outline)) < 2

  for (const r of rooms) {
    if (r.outdoor || !r.wantsWindow || onPerimeter(r)) continue
    const swap = rooms.find(
      (o) =>
        !o.outdoor &&
        !o.wantsWindow &&
        o.zone !== 'circulation' &&
        onPerimeter(o) &&
        Math.abs(rectArea(o.rect) - rectArea(r.rect)) < rectArea(r.rect) * 0.6,
    )
    if (!swap) continue
    const tmp = r.rect
    r.rect = swap.rect
    swap.rect = tmp
    r.area = toSqm(rectArea(r.rect))
    swap.area = toSqm(rectArea(swap.rect))
  }
}

/* ---------------------------------- helpers -------------------------------- */

function place(s: SpaceReq, rect: Rect): PlacedRoom {
  return {
    id: s.id,
    name: s.name,
    zone: s.zone,
    rect,
    area: toSqm(rectArea(rect)),
    outdoor: s.outdoor,
    wantsWindow: s.wantsWindow,
  }
}

/** A slack-absorbing hall so treemap rooms don't inflate past the brief. */
function hallSpace(level: number, tag: string, sqm: number): SpaceReq {
  return {
    id: `hall${level}${tag}`,
    name: 'Hall',
    zone: 'circulation',
    target: sqm,
    min: 6,
    max: 999,
    wantsWindow: false,
    wet: false,
    outdoor: false,
  }
}

function enclosedOutline(rooms: PlacedRoom[]): Rect {
  const enc = rooms.filter((r) => !r.outdoor)
  const x0 = Math.min(...enc.map((r) => r.rect.x))
  const y0 = Math.min(...enc.map((r) => r.rect.y))
  const x1 = Math.max(...enc.map((r) => rectRight(r.rect)))
  const y1 = Math.max(...enc.map((r) => rectBottom(r.rect)))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

function deriveWalls(rooms: PlacedRoom[], outline: Rect): Wall[] {
  const walls: Wall[] = [
    { a: { x: outline.x, y: outline.y }, b: { x: rectRight(outline), y: outline.y }, thickness: EXT_WALL, kind: 'exterior' },
    { a: { x: rectRight(outline), y: outline.y }, b: { x: rectRight(outline), y: rectBottom(outline) }, thickness: EXT_WALL, kind: 'exterior' },
    { a: { x: rectRight(outline), y: rectBottom(outline) }, b: { x: outline.x, y: rectBottom(outline) }, thickness: EXT_WALL, kind: 'exterior' },
    { a: { x: outline.x, y: rectBottom(outline) }, b: { x: outline.x, y: outline.y }, thickness: EXT_WALL, kind: 'exterior' },
  ]
  const enc = rooms.filter((r) => !r.outdoor)
  const seen = new Set<string>()
  for (let i = 0; i < enc.length; i++) {
    for (let j = i + 1; j < enc.length; j++) {
      const e = sharedEdge(enc[i].rect, enc[j].rect)
      if (!e || e.length < 400) continue
      const key = `${Math.round(e.seg.a.x)},${Math.round(e.seg.a.y)},${Math.round(e.seg.b.x)},${Math.round(e.seg.b.y)}`
      if (seen.has(key)) continue
      seen.add(key)
      const horizontal = Math.abs(e.seg.a.y - e.seg.b.y) < 2
      const onOutline = horizontal
        ? Math.abs(e.seg.a.y - outline.y) < 2 || Math.abs(e.seg.a.y - rectBottom(outline)) < 2
        : Math.abs(e.seg.a.x - outline.x) < 2 || Math.abs(e.seg.a.x - rectRight(outline)) < 2
      if (onOutline) continue
      walls.push({ a: e.seg.a, b: e.seg.b, thickness: INT_WALL, kind: 'interior' })
    }
  }
  return walls
}

type WindowSpec = { mullionMm: number; widthMm: number; minRoomSqm: number }

/**
 * One window per habitable room, snapped to a shared per-facade mullion grid so
 * windows line up between storeys. Small rooms (baths, utility, pooja) get none —
 * they don't read at massing scale. The rhythm is a design-character choice.
 */
function deriveWindows(rooms: PlacedRoom[], outline: Rect, out: Opening[], spec: WindowSpec) {
  const MULLION = spec.mullionMm // window-column spacing (mm)
  const MIN_ROOM = spec.minRoomSqm // m² — smaller habitable rooms get no massing window
  const WIN_W = spec.widthMm

  const edges = [
    { orient: 'h' as const, fixed: outline.y, lo: outline.x, hi: rectRight(outline) },
    { orient: 'h' as const, fixed: rectBottom(outline), lo: outline.x, hi: rectRight(outline) },
    { orient: 'v' as const, fixed: outline.x, lo: outline.y, hi: rectBottom(outline) },
    { orient: 'v' as const, fixed: rectRight(outline), lo: outline.y, hi: rectBottom(outline) },
  ]

  const touchesEdge = (r: PlacedRoom, orient: 'h' | 'v', fixed: number) =>
    orient === 'h'
      ? Math.abs(r.rect.y - fixed) < 2 || Math.abs(rectBottom(r.rect) - fixed) < 2
      : Math.abs(r.rect.x - fixed) < 2 || Math.abs(rectRight(r.rect) - fixed) < 2

  for (const e of edges) {
    const span = e.hi - e.lo
    if (span < 2400) continue
    const cols = Math.max(1, Math.round((span - 1400) / MULLION))
    const line = (i: number) => Math.round(e.lo + (span * (i + 0.5)) / cols)

    for (const r of rooms) {
      if (r.outdoor || !r.wantsWindow || r.area < MIN_ROOM) continue
      if (!touchesEdge(r, e.orient, e.fixed)) continue
      const rlo = e.orient === 'h' ? r.rect.x : r.rect.y
      const rhi = e.orient === 'h' ? rectRight(r.rect) : rectBottom(r.rect)
      if (rhi - rlo < 1600) continue
      const rc = (rlo + rhi) / 2

      // nearest mullion column landing inside this room, else the room centre
      let along = Math.round(rc)
      let best = Infinity
      for (let i = 0; i < cols; i++) {
        const c = line(i)
        if (c > rlo + 600 && c < rhi - 600 && Math.abs(c - rc) < best) {
          best = Math.abs(c - rc)
          along = c
        }
      }

      const perpOf = (o: Opening) => (e.orient === 'h' ? o.at.y : o.at.x)
      const alongOf = (o: Opening) => (e.orient === 'h' ? o.at.x : o.at.y)
      const clash = out.some(
        (o) => Math.abs(perpOf(o) - e.fixed) < 400 && Math.abs(alongOf(o) - along) < 1300,
      )
      if (clash) continue
      const at: Point = e.orient === 'h' ? { x: along, y: e.fixed } : { x: e.fixed, y: along }
      out.push({ kind: 'window', at, orient: e.orient, width: Math.min(WIN_W, rhi - rlo - 1000) })
    }
  }
}

function deriveDoors(rooms: PlacedRoom[], rels: Relationship[], out: Opening[]) {
  const byId = new Map(rooms.map((r) => [r.id, r]))
  for (const rel of rels) {
    if (rel.kind === 'separated') continue
    const a = byId.get(rel.a)
    const b = byId.get(rel.b)
    if (!a || !b) continue
    const e = sharedEdge(a.rect, b.rect)
    if (!e || e.length < DOOR + 200) continue
    const mid = midOf(e.seg)
    if (out.some((o) => near(o.at, mid, 400))) continue
    out.push({ kind: 'door', at: mid, orient: e.side === 'N' || e.side === 'S' ? 'h' : 'v', width: DOOR, swing: 1 })
  }
}

function addEntry(foyer: PlacedRoom, outline: Rect, width: number, out: Opening[]) {
  const onSouth = Math.abs(rectBottom(foyer.rect) - rectBottom(outline)) < 2
  const onWest = Math.abs(foyer.rect.x - outline.x) < 2
  if (onSouth || !onWest) {
    out.push({ kind: 'entry', at: { x: rectCenter(foyer.rect).x, y: rectBottom(foyer.rect) }, orient: 'h', width, swing: -1 })
  } else {
    out.push({ kind: 'entry', at: { x: foyer.rect.x, y: rectCenter(foyer.rect).y }, orient: 'v', width, swing: 1 })
  }
}

function repairReachability(rooms: PlacedRoom[], openings: Opening[], level: number) {
  const enc = rooms.filter((r) => !r.outdoor)
  const adj = new Map<string, Set<string>>()
  enc.forEach((r) => adj.set(r.id, new Set()))
  const linkPair = (a: string, b: string) => {
    adj.get(a)?.add(b)
    adj.get(b)?.add(a)
  }

  for (let i = 0; i < enc.length; i++) {
    for (let j = i + 1; j < enc.length; j++) {
      const e = sharedEdge(enc[i].rect, enc[j].rect)
      if (!e) continue
      const mid = midOf(e.seg)
      if (openings.some((o) => (o.kind === 'door' || o.kind === 'entry') && near(o.at, mid, Math.max(700, e.length / 2)))) {
        linkPair(enc[i].id, enc[j].id)
      }
    }
  }

  const start =
    enc.find((r) => (level === 0 ? r.id === 'foyer' : r.id.startsWith('lobby'))) ??
    enc.find((r) => r.id === 'stair') ??
    enc[0]
  if (!start) return { reachable: false, unreachableRooms: enc.map((r) => r.id) }

  const seen = bfs(start.id, adj)
  let changed = true
  while (changed) {
    changed = false
    for (const r of enc) {
      if (seen.has(r.id)) continue
      let best: { other: string; len: number; mid: Point; orient: 'h' | 'v' } | null = null
      for (const other of enc) {
        if (!seen.has(other.id)) continue
        const e = sharedEdge(r.rect, other.rect)
        if (!e || e.length < DOOR) continue
        if (!best || e.length > best.len)
          best = { other: other.id, len: e.length, mid: midOf(e.seg), orient: e.side === 'N' || e.side === 'S' ? 'h' : 'v' }
      }
      if (best) {
        openings.push({ kind: 'door', at: best.mid, orient: best.orient, width: DOOR, swing: 1 })
        linkPair(r.id, best.other)
        for (const id of bfs(r.id, adj)) seen.add(id)
        changed = true
      }
    }
  }

  const unreachableRooms = enc.filter((r) => !seen.has(r.id)).map((r) => r.id)
  return { reachable: unreachableRooms.length === 0, unreachableRooms }
}

function bfs(startId: string, adj: Map<string, Set<string>>): Set<string> {
  const seen = new Set<string>([startId])
  const q = [startId]
  while (q.length) {
    const cur = q.shift() as string
    for (const n of adj.get(cur) ?? []) {
      if (!seen.has(n)) {
        seen.add(n)
        q.push(n)
      }
    }
  }
  return seen
}

function makeStair(rect: Rect, floorToFloor: number): StairRun {
  const risers = Math.max(14, Math.round((floorToFloor * 1000) / 175))
  const perFlight = Math.ceil(risers / 2)
  const flightW = rect.w / 2
  const treads: Point[][] = []
  const run = rect.h * 0.86
  const going = run / perFlight
  for (let i = 1; i < perFlight; i++) {
    const y = rect.y + i * going
    treads.push([{ x: rect.x, y }, { x: rect.x + flightW, y }])
  }
  for (let i = 1; i < perFlight; i++) {
    const y = rect.y + run - i * going
    treads.push([{ x: rect.x + flightW, y }, { x: rect.x + rect.w, y }])
  }
  return { rect, treads, direction: 'up' }
}

const midOf = (seg: { a: Point; b: Point }): Point => ({ x: (seg.a.x + seg.b.x) / 2, y: (seg.a.y + seg.b.y) / 2 })
const near = (a: Point, b: Point, tol: number) => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol
