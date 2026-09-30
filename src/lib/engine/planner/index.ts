import { type Point, type Rect, rectArea, rectBottom, rectRight, rectUnionBBox, sharedEdge, toSqm } from '../../geometry.ts'
import type { CanonicalModel } from '../../model/canonical.ts'
import type { DesignDNA } from '../designDna.ts'
import type { FloorPlan, Opening, PlacedRoom } from '../types.ts'
import type { RoofSpec } from '../massing/types.ts'
import type { Column, FloorRequirements, LocalRoom, PlanStructure, PlateFamily, RoomReq, SiteModel } from './types.ts'
import { makeRng } from '../massing/rng.ts'
import {
  BALCONY_DEPTH, COLUMN, VERANDAH_DEPTH, PARKING_DEPTH,
  normalizeBrief, programRequirements, siteModel, stairGeometry, snap, snapUp, GOING,
} from './program.ts'
import { placeFloors, plateCandidates, type LayoutInput, type PlateCandidate } from './layout.ts'
import {
  type Frame, type Occupancy, beamsFor, onPlate, placeDoors, placeWindows, planShafts, plateRects,
  stairRun, supportZonesFor, toPlanPoint, toPlanRect, wallGraph,
} from './elements.ts'

export type { PlateFamily } from './types.ts'

export type PlanRequest = {
  family: PlateFamily
  /** which of the ranked plate candidates to take (seed-driven variety) */
  pick: number
  mirror: boolean
  /** seed for the order of rooms along each band (equally valid variants) */
  order: number
  dna: DesignDNA
  themeWindowMm: number
  roofFor: (level: number, top: boolean) => RoofSpec
}

export type PlanResult = {
  floors: FloorPlan[]
  structure: PlanStructure
  site: SiteModel
  candidates: number
}

const alpha = (i: number) => String.fromCharCode(65 + i)
const n2 = (i: number) => String(i).padStart(2, '0')

/** Every stage, in order. Deterministic: the same brief + request ⇒ the same plan. */
export function planVilla(model: CanonicalModel, request: PlanRequest): PlanResult | null {
  // ---- NormalizedBrief → StairCore sizing → SiteModel × ProgramRequirements ----
  const nb = normalizeBrief(model)
  const stair = stairGeometry(nb)
  // a courtyard plan without a court in the brief gets an open light court:
  // extra outdoor space, never a change to the requested programme
  const courtOf = (f: FloorRequirements[]): RoomReq | undefined => f[0].outdoor.find((r) => r.kind === 'courtyard') ??
    (request.family === 'courtyard' ? lightCourt(nb.large) : undefined)

  // ---- FloorPlatePlan: site strategy × plan type, first that truly fits ----
  //  1. front yard, back band | corridor | front band  (the default villa)
  //  2. front yard, one band along an entrance hall    (narrow plots)
  //  3. side yard  (car porch beside the house), three bands  (shallow plots)
  //  4. side yard, one band
  const hallMm = snapUp(Math.max(1800, nb.mainDoorMm + 600))
  const strategies = ([['front', false], ['front', true], ['side', false], ['side', true]] as const).map(([yard, single]) => {
    const site = siteModel(model, yard)
    const floors = programRequirements(nb, stair.slotWidth, single)
    reorder(floors, request.order)
    const courtReq = courtOf(floors)
    const input: LayoutInput = {
      floors, site, family: request.family, large: nb.large, stairDepth: stair.depth,
      hasStair: floors[0].rooms.some((r) => r.kind === 'stair'), courtSqm: courtReq?.targetSqm ?? 12,
      singleLoaded: single, hallMm,
    }
    return { site, floors, courtReq, input, all: plateCandidates(input) }
  })
  const real = (x: (typeof strategies)[number]) => x.all.filter((c) => !c.relaxed)
  const chosen = strategies.find((x) => real(x).some((c) => c.atMin)) ??
    strategies.find((x) => real(x).length) ?? strategies.find((x) => x.all.length)
  if (!chosen) return null
  const { site, courtReq, input } = chosen
  const floorsReq = chosen.floors
  const all = chosen.all
  // rooms at target size beat rooms at minimum size beat squeezed rooms; the
  // seed only varies between near-equivalent plates of the best tier
  const tier = all.filter((c) => c.atTarget).length ? all.filter((c) => c.atTarget)
    : all.filter((c) => c.atMin).length ? all.filter((c) => c.atMin) : all
  const pool = tier.filter((c) => c.score <= tier[0].score * 1.18).slice(0, 4)
  const cand: PlateCandidate = pool[request.pick % pool.length]

  // ---- RoomPlacement (local u/v) + StructuralGrid cross axes ----
  const layout = placeFloors(input, cand)
  const V = cand.depthA + cand.spine + cand.depthB
  const vLines = [0, cand.depthA, cand.depthA + cand.spine, V]
  // a single-loaded plan has no front band: its last two band lines coincide
  const colLines = [...new Set(vLines)]
  const L = cand.length
  const zone = site.houseZone
  const pw = cand.orientation === 'x' ? L : V
  const ph = cand.orientation === 'x' ? V : L
  const frame: Frame = {
    orientation: cand.orientation,
    mirror: request.mirror,
    px: snap(zone.x + Math.max(0, zone.w - pw) / 2),
    py: zone.y + Math.max(0, zone.h - ph),
    L, V,
  }
  const bandV = { A: [vLines[0], vLines[1]], S: [vLines[1], vLines[2]], B: [vLines[2], vLines[3]] } as const
  const toRoom = (lr: LocalRoom): PlacedRoom => {
    const rect = toPlanRect(frame, lr.u0, lr.u1, bandV[lr.band][0], bandV[lr.band][1])
    return {
      id: lr.req.id, semanticId: lr.req.semanticId, name: lr.req.name, zone: lr.req.zone, rect,
      area: toSqm(rectArea(rect)), outdoor: false, wantsWindow: lr.req.space.wantsWindow,
    }
  }
  const outdoorRoom = (r: RoomReq, rect: Rect): PlacedRoom => ({
    id: r.id, semanticId: r.semanticId, name: r.name, zone: r.zone, rect,
    area: toSqm(rectArea(rect)), outdoor: true, wantsWindow: false,
  })
  const kinds = new Map<string, string>()
  const parents = new Map<string, string>()
  for (const f of floorsReq) {
    kinds.set(f.spine.id, f.spine.kind)
    for (const r of [...f.rooms, ...f.outdoor]) {
      kinds.set(r.id, r.kind)
      if (r.parent) parents.set(r.id, r.parent)
    }
  }
  const kindOf = (id: string) => kinds.get(id) ?? ''
  const parentOf = (id: string) => parents.get(id)

  // ---- StructuralGrid in plan: columns at every cross axis × band line on the plate ----
  const uLines = layout.uLines
  const colName = new Map<string, number>()
  const groundCols: { key: string; at: Point; u: number; v: number; ui: number; vi: number }[] = []
  uLines.forEach((u, ui) => colLines.forEach((v, vi) => {
    if (!onPlate(layout.plates[0], vLines, u, v)) return
    const at = toPlanPoint(frame, u, v)
    groundCols.push({ key: `${at.x},${at.y}`, at, u, v, ui, vi })
  }))
  groundCols.sort((a, b) => a.at.y - b.at.y || a.at.x - b.at.x).forEach((c, i) => colName.set(c.key, i + 1))
  // plan-named axes: cross axes 1..n, band lines A..D
  const axisOrient = (cross: boolean): 'h' | 'v' => (cand.orientation === 'x') === cross ? 'v' : 'h'
  const axes = [
    ...uLines.map((u, i) => {
      const p = toPlanPoint(frame, u, 0)
      const o = axisOrient(true)
      return { id: `GRID_${i + 1}`, orient: o, at: o === 'v' ? p.x : p.y }
    }),
    ...colLines.map((v, i) => {
      const p = toPlanPoint(frame, 0, v)
      const o = axisOrient(false)
      return { id: `GRID_${alpha(i)}`, orient: o, at: o === 'v' ? p.x : p.y }
    }),
  ]
  const structuralLines = axes.map((a) => ({ orient: a.orient, fixed: a.at, lo: -Infinity, hi: Infinity }))

  const floors: FloorPlan[] = []
  let lowerRooms: PlacedRoom[] = []
  let lowerOpenings: Opening[] = []
  let lowerPlate: Rect[] = []
  let maxSpan = 0

  for (const [fi, plate] of layout.plates.entries()) {
    const req = floorsReq[fi]
    const prefix = req.prefix
    const level = req.level
    const footprint = plateRects(frame, plate, vLines)
    const rooms = layout.rooms[fi].map(toRoom)
    const bbox = rectUnionBBox(footprint)

    // ---- outdoor programme ----
    if (level === 0) {
      if (layout.court && courtReq && request.family === 'courtyard') {
        rooms.push(outdoorRoom(courtReq, toPlanRect(frame, layout.court[0], layout.court[1], vLines[0], vLines[1])))
      }
      frontYard(rooms, req.outdoor.filter((r) => r.kind !== 'courtyard' || request.family !== 'courtyard'),
        bbox, site, nb.twoCar, nb.large, outdoorRoom)
    } else {
      for (const r of req.outdoor.filter((x) => x.kind === 'balcony')) {
        const b = placeBalcony(rooms, bbox, site, kindOf, lowerPlate)
        if (b) rooms.push(outdoorRoom(r, b))
      }
    }

    // ---- structural concept for this floor ----
    const columns: Column[] = groundCols
      .filter((c) => onPlate(plate, vLines, c.u, c.v))
      .map((c) => ({
        id: `${prefix}_COLUMN_C${n2(colName.get(c.key)!)}`, at: { ...c.at }, size: COLUMN,
        grid: `GRID_${c.ui + 1}${alpha(c.vi)}`,
      }))
    const inPlate = (p: Point) => footprint.some((r) => p.x >= r.x - 1 && p.x <= rectRight(r) + 1 && p.y >= r.y - 1 && p.y <= rectBottom(r) + 1)
    const beams = beamsFor(columns, inPlate, prefix)
    maxSpan = Math.max(maxSpan, ...beams.map((b) => b.span))
    const cells: Rect[] = []
    for (let i = 0; i < uLines.length - 1; i++) {
      for (let j = 0; j < 3; j++) {
        const mu = (uLines[i] + uLines[i + 1]) / 2
        const mv = (vLines[j] + vLines[j + 1]) / 2
        if (onPlate(plate, vLines, mu, mv)) cells.push(toPlanRect(frame, uLines[i], uLines[i + 1], vLines[j], vLines[j + 1]))
      }
    }
    const cantilevers = rooms.filter((r) => r.outdoor && r.id.startsWith('balcony') &&
      !covered(r.rect, lowerPlate)).map((r) => r.rect)
    const supportZones = supportZonesFor(cells, prefix, cantilevers)

    // ---- WallGraph → StairCore → DoorPlacement → WindowPlacement → WetAreaPlanning ----
    const walls = wallGraph(rooms, prefix, structuralLines)
    const occ: Occupancy = new Map()
    const stairRoom = rooms.find((r) => r.id === 'stair')
    const spineRoom = rooms.find((r) => r.id === req.spine.id)!
    const coreTarget = stairRoom
      ? { x: stairRoom.rect.x + stairRoom.rect.w / 2, y: stairRoom.rect.y + stairRoom.rect.h / 2 }
      : { x: spineRoom.rect.x, y: spineRoom.rect.y }
    const { openings: doors, failed } = placeDoors(rooms, req.spine.id, prefix, columns, occ, kindOf, parentOf,
      level === 0 ? { width: nb.mainDoorMm } : null, coreTarget)
    const windows = placeWindows(rooms, walls, columns, occ, kindOf, request.themeWindowMm, request.dna, lowerOpenings)
    const openings = [...doors, ...windows]
    const shafts = planShafts(rooms, walls, openings, kindOf, lowerRooms)

    let stairRunOut
    if (stairRoom) {
      const e = [
        { side: 'N' as const, hit: Math.abs(stairRoom.rect.y - rectBottom(spineRoom.rect)) < 2 },
        { side: 'S' as const, hit: Math.abs(rectBottom(stairRoom.rect) - spineRoom.rect.y) < 2 },
        { side: 'W' as const, hit: Math.abs(stairRoom.rect.x - rectRight(spineRoom.rect)) < 2 },
        { side: 'E' as const, hit: Math.abs(rectRight(stairRoom.rect) - spineRoom.rect.x) < 2 },
      ].find((x) => x.hit)
      stairRunOut = stairRun(stairRoom.rect, e?.side ?? 'S', stair.perFlight, GOING)
    }

    const reach = reachability(rooms, openings, level)
    floors.push({
      level, name: model.floors[fi].name, prefix,
      outline: bbox, footprint,
      roof: request.roofFor(level, fi === layout.plates.length - 1),
      courtyard: level === 0 ? rooms.find((r) => r.id === 'courtyard' && request.family === 'courtyard')?.rect ?? null : null,
      rooms, walls, openings,
      stair: stairRunOut,
      reachable: reach.length === 0 && failed.length === 0,
      unreachableRooms: [...new Set([...reach, ...failed.filter((id) => !rooms.find((r) => r.id === id)?.outdoor)])],
      columns, beams, shafts, supportZones,
    })
    lowerRooms = rooms
    lowerOpenings = openings
    lowerPlate = footprint
  }

  const family: PlateFamily = layout.court && request.family === 'courtyard' ? 'courtyard'
    : layout.notch ? 'l-shape'
    : layout.plates.some((p) => p.length < L) ? 'stepped' : 'rectangular'
  return {
    floors,
    structure: { orientation: cand.orientation, mirror: request.mirror, family, axes, maxBeamSpanMm: maxSpan },
    site,
    candidates: pool.length,
  }
}

function lightCourt(large: boolean): RoomReq {
  const target = large ? 15.6 : 12
  return {
    id: 'courtyard', semanticId: 'GF_COURTYARD', name: 'Courtyard', zone: 'outdoor', kind: 'courtyard',
    minSqm: 8, targetSqm: target, maxSqm: 30, minWidthMm: 0, wet: false, habitable: false, outdoor: true,
    space: { id: 'courtyard', name: 'Courtyard', zone: 'outdoor', target, min: 8, max: 30, wantsWindow: false, wet: false, outdoor: true },
  }
}

/**
 * Seeded, deterministic variety: shuffle the order of the free units along
 * each band and flip which side of its bedroom each ensuite sits on. The
 * stair core and foyer stay anchored and the living room stays beside the
 * foyer; the kitchen suite keeps its internal dining → kitchen → utility
 * order. Every variant still has to pass the same validators.
 */
function reorder(floors: FloorRequirements[], seed: number) {
  if (!seed) return
  const rng = makeRng(seed, 'order')
  for (const f of floors) {
    const fixed = f.units.filter((u) => u.anchor || u.key === 'living')
    const free = f.units.filter((u) => !fixed.includes(u))
    for (let i = free.length - 1; i > 0; i--) {
      const j = rng.int(0, i)
      ;[free[i], free[j]] = [free[j], free[i]]
    }
    for (const u of free) if (u.rooms.length === 2 && u.rooms[1].kind === 'ensuite' && rng.chance(0.5)) u.rooms.reverse()
    f.units = [...fixed, ...free]
  }
}

/** fraction-free test: is `r` inside the union of `plate` (to within 1 mm)? */
function covered(r: Rect, plate: Rect[]): boolean {
  if (!plate.length) return false
  let area = 0
  for (const p of plate) {
    const ox = Math.max(0, Math.min(rectRight(r), rectRight(p)) - Math.max(r.x, p.x))
    const oy = Math.max(0, Math.min(rectBottom(r), rectBottom(p)) - Math.max(r.y, p.y))
    area += ox * oy
  }
  return area >= rectArea(r) - 1000
}

/** parking / verandah / forecourt in the front strip; a spare court goes to the rear garden */
function frontYard(
  rooms: PlacedRoom[], outdoor: RoomReq[], house: Rect, site: SiteModel, twoCar: boolean, large: boolean,
  make: (r: RoomReq, rect: Rect) => PlacedRoom,
) {
  const env = site.envelope
  const y0 = rectBottom(house)
  const foyer = rooms.find((r) => r.id === 'foyer')
  const cx = foyer ? foyer.rect.x + foyer.rect.w / 2 : house.x + house.w / 2
  // the house itself is taken ground; outdoor spaces go around it
  const taken: Rect[] = rooms.filter((r) => !r.outdoor).map((r) => r.rect)
  const free = (r: Rect) => r.x >= env.x && rectRight(r) <= rectRight(env) && r.y >= env.y && rectBottom(r) <= rectBottom(env) &&
    !taken.some((t) => r.x < rectRight(t) && rectRight(r) > t.x && r.y < rectBottom(t) && rectBottom(r) > t.y)
  /** the front strip first (tight against the house), then rows flush with
   *  the front setback line working back — beside the house on a shallow plot */
  const tryAt = (w: number, h: number, prefer: number): Rect | null => {
    const rows = [y0]
    for (let y = rectBottom(env) - h; y >= env.y; y -= 300) rows.push(y)
    for (const [i, y] of rows.entries()) {
      const step = i === 0 ? 100 : 300
      const xs: number[] = [snap(prefer - w / 2)]
      for (let dx = step; dx <= env.w; dx += step) xs.push(snap(prefer - w / 2 - dx), snap(prefer - w / 2 + dx))
      for (const x of xs) {
        const r = { x, y, w, h }
        if (free(r)) return r
      }
    }
    return null
  }
  // the car needs the road frontage most; the verandah takes what is left
  // (on a narrow plot it becomes a rear sit-out rather than blocking the gate)
  const order = ['parking', 'verandah', 'courtyard']
  const verandahW = large ? 4200 : 3400
  const parkingW = twoCar ? 5200 : 3000
  // on a narrow frontage the verandah gives way to the car, down to the foyer width
  const hasParking = outdoor.some((s) => s.kind === 'parking')
  const room = env.w - (hasParking ? parkingW : 0)
  const vW = Math.max(2400, Math.min(verandahW, snap(room - 200)))
  for (const s of [...outdoor].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))) {
    if (!order.includes(s.kind)) continue
    const widths = s.kind === 'parking' ? [...new Set([parkingW, 3000])] : s.kind === 'verandah' ? [vW] : [large ? 4600 : 3200]
    const h = s.kind === 'parking' ? PARKING_DEPTH : s.kind === 'verandah' ? (large ? 3200 : VERANDAH_DEPTH) : 3200
    let rect: Rect | null = null
    for (const w of widths) {
      // the car hugs the envelope edge away from the entrance, leaving the
      // frontage in front of the foyer for the verandah
      const carAt = cx < env.x + env.w / 2 ? rectRight(env) - w / 2 : env.x + w / 2
      rect = rect ?? tryAt(w, h, s.kind === 'parking' ? carAt : cx)
    }
    const w = widths[0]
    if (!rect && s.kind === 'courtyard') {
      // rear garden court behind the house
      const rh = snap(house.y - env.y - 300)
      if (rh >= 2400) rect = { x: snap(house.x + house.w / 2 - w / 2), y: env.y, w, h: Math.min(rh, 4400) }
    }
    if (!rect) continue
    taken.push(rect)
    rooms.push(make(s, rect))
  }
}

/**
 * A balcony off an outside wall: the road facade first, then a face over the
 * roof of the floor below (fully supported), then any other face (a declared
 * cantilever). Habitable rooms host first; a lobby only when nothing else can.
 */
function placeBalcony(rooms: PlacedRoom[], house: Rect, site: SiteModel, kindOf: (id: string) => string, lowerPlate: Rect[]): Rect | null {
  const enclosed = rooms.filter((r) => !r.outdoor)
  const clear = (b: Rect) => rooms.every((o) => {
    const ox = Math.min(rectRight(b), rectRight(o.rect)) - Math.max(b.x, o.rect.x)
    const oy = Math.min(rectBottom(b), rectBottom(o.rect)) - Math.max(b.y, o.rect.y)
    return ox <= 0 || oy <= 0
  })
  const inEnv = (b: Rect) => b.x >= site.envelope.x && b.y >= site.envelope.y &&
    rectRight(b) <= rectRight(site.envelope) && rectBottom(b) <= rectBottom(site.envelope)
  const options: { rect: Rect; rank: number }[] = []
  for (const h of enclosed) {
    const kind = kindOf(h.id)
    const hostRank = ['lounge', 'bed', 'study'].includes(kind) ? 0 : kind === 'lobby' ? 1 : -1
    if (hostRank < 0) continue
    const r = h.rect
    for (const side of ['S', 'N', 'E', 'W'] as const) {
      const len = side === 'N' || side === 'S' ? r.w : r.h
      const w = snap(Math.min(4200, len - (len >= 2600 ? 600 : 400)))
      if (w < 1800) continue
      const c = side === 'N' || side === 'S' ? snap(r.x + (r.w - w) / 2) : snap(r.y + (r.h - w) / 2)
      const rect: Rect = side === 'S' ? { x: c, y: rectBottom(r), w, h: BALCONY_DEPTH }
        : side === 'N' ? { x: c, y: r.y - BALCONY_DEPTH, w, h: BALCONY_DEPTH }
        : side === 'E' ? { x: rectRight(r), y: c, w: BALCONY_DEPTH, h: w }
        : { x: r.x - BALCONY_DEPTH, y: c, w: BALCONY_DEPTH, h: w }
      if (!clear(rect) || !inEnv(rect)) continue
      const supported = covered(rect, lowerPlate)
      const road = side === 'S' && Math.abs(rectBottom(r) - rectBottom(house)) < 2
      options.push({ rect, rank: hostRank * 10 + (road ? 0 : supported ? 1 : 2) - Math.min(0.9, h.area / 100) })
    }
  }
  options.sort((a, b) => a.rank - b.rank || a.rect.x - b.rect.x || a.rect.y - b.rect.y)
  return options[0]?.rect ?? null
}

/** BFS over the door graph: ground from the main door, upper floors from the stair */
export function reachability(rooms: PlacedRoom[], openings: Opening[], level: number): string[] {
  const adj = new Map<string, Set<string>>()
  const byId = new Map(rooms.map((r) => [r.id, r]))
  for (const o of openings) {
    if (o.kind === 'window' || !o.rooms) continue
    const [a, b] = o.rooms
    if (!a || !byId.has(a)) continue
    if (!adj.has(a)) adj.set(a, new Set())
    if (b) {
      const left = byId.get(a)
      const right = byId.get(b)
      const edge = left && right && sharedEdge(left.rect, right.rect)
      if (!edge) continue
      const horizontal = edge.side === 'N' || edge.side === 'S'
      const lo = horizontal ? edge.seg.a.x : edge.seg.a.y
      const hi = horizontal ? edge.seg.b.x : edge.seg.b.y
      const at = horizontal ? o.at.x : o.at.y
      const fixed = horizontal ? edge.seg.a.y : edge.seg.a.x
      if (o.orient !== (horizontal ? 'h' : 'v') ||
        Math.abs((horizontal ? o.at.y : o.at.x) - fixed) > 2 ||
        at - o.width / 2 < lo - 1 || at + o.width / 2 > hi + 1) continue
      if (!adj.has(b)) adj.set(b, new Set())
      adj.get(a)!.add(b)
      adj.get(b)!.add(a)
    }
  }
  const start = level === 0
    ? openings.find((o) => o.kind === 'entry')?.rooms?.[0]
    : rooms.find((r) => r.id === 'stair')?.id ?? rooms.find((r) => r.id.startsWith('lobby'))?.id
  const seen = new Set<string>()
  if (start) {
    const q = [start]
    seen.add(start)
    while (q.length) {
      const cur = q.shift()!
      for (const n of adj.get(cur) ?? []) if (!seen.has(n)) {
        seen.add(n)
        q.push(n)
      }
    }
  }
  return rooms.filter((r) => !r.outdoor && !seen.has(r.id)).map((r) => r.id)
}
