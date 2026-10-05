import { type Point, type Rect, rectBottom, rectRight, rectUnionBBox } from '../../geometry.ts'
import type { CanonicalModel } from '../../model/canonical.ts'
import { columnPosition, columnSizeMm } from '../structuralSizing.ts'
import type { FloorPlan, PlacedRoom } from '../types.ts'
import type { Beam, Column, ExistingStructure, FloorRequirements, LocalRoom, Orientation, RoomReq, SiteModel } from './types.ts'
import { COLUMN, GOING, MAX_BEAM_SPAN, MIN_BAND, normalizeBrief, programRequirements, roomWidths, siteModel, snapUp, stairGeometry } from './program.ts'
import { placeFloors, type LayoutInput, type PlateCandidate } from './layout.ts'
import {
  type Frame, type Occupancy, beamsFor, onPlate, placeDoors, placeWindows, planShafts, plateRects,
  stairRun, supportZonesFor, toPlanPoint, toPlanRect, wallGraph,
} from './elements.ts'
import { frontYard, placeBalcony, reachability, reorder, type PlanRequest, type PlanResult } from './index.ts'
import { toSqm, rectArea } from '../../geometry.ts'

/* ------------------------------------------------------------------ *
 *  Existing Structure Mode planner.
 *
 *  The columns / footings already on site are LOCKED: they define the
 *  structural grid and are never moved or resized. Rooms, walls, doors,
 *  windows and the stair adapt to that grid, reusing the production room
 *  placer (bands A | spine | B), door and window placers. Missing
 *  columns and beams on the grid are PROPOSED; extra columns that keep a
 *  span under the beam limit are OPTIONAL (drawn dashed).
 * ------------------------------------------------------------------ */

export const EXISTING_LIMITS = { clusterMm: 200, matchMm: 250, spineMm: 1200, minBandMm: 2400, maxBeamSpanMm: MAX_BEAM_SPAN } as const

const cluster = (values: number[], tol = EXISTING_LIMITS.clusterMm): number[] => {
  const sorted = [...values].sort((a, b) => a - b)
  const groups: number[][] = []
  for (const v of sorted) {
    const last = groups[groups.length - 1]
    if (last && v - last[last.length - 1] <= tol) last.push(v)
    else groups.push([v])
  }
  return groups.map((g) => Math.round(g.reduce((a, b) => a + b, 0) / g.length))
}

/** the grid of an existing structure: unique x / y lines and the bounding box they span */
export function structureGrid(structure: ExistingStructure) {
  const anchors: Point[] = [...structure.columns.map((c) => c.at), ...structure.footings.map((f) => f.at)]
  if (anchors.length < 2) return null
  const xs = cluster(anchors.map((p) => p.x)), ys = cluster(anchors.map((p) => p.y))
  if (xs.length < 2 || ys.length < 2) return null
  return { xs, ys, x0: xs[0], x1: xs[xs.length - 1], y0: ys[0], y1: ys[ys.length - 1], anchors }
}

/** extra grid lines where a bay is longer than the beam limit (optional columns) */
function withOptionalLines(lines: number[]): { all: number[]; optional: Set<number> } {
  const all = [lines[0]], optional = new Set<number>()
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i] - lines[i - 1], parts = Math.ceil(gap / EXISTING_LIMITS.maxBeamSpanMm)
    for (let k = 1; k < parts; k++) {
      const at = Math.round(lines[i - 1] + (gap * k) / parts)
      all.push(at); optional.add(at)
    }
    all.push(lines[i])
  }
  return { all, optional }
}

const placed = (r: RoomReq, rect: Rect): PlacedRoom => ({ id: r.id, semanticId: r.semanticId, name: r.name, zone: r.zone, rect,
  area: toSqm(rectArea(rect)), outdoor: r.outdoor, wantsWindow: r.space.wantsWindow })

const near = (a: Point, b: Point, tol: number) => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol
const sameBeam = (b: Beam, s: ExistingStructure['beams'][number], dx: number, dy: number) => {
  const t = EXISTING_LIMITS.matchMm
  const sa = { x: s.a.x + dx, y: s.a.y + dy }, sb = { x: s.b.x + dx, y: s.b.y + dy }
  return (near(b.a, sa, t) && near(b.b, sb, t)) || (near(b.a, sb, t) && near(b.b, sa, t))
}

export type ExistingPlacement = { dx: number; dy: number; frame: Frame }

/** Plan an existing structure into a Design-ready PlanResult, or null when no layout holds the programme. */
export function planExisting(model: CanonicalModel, request: PlanRequest): PlanResult | null {
  const structure = request.existing
  if (!structure) return null
  const grid = structureGrid(structure)
  if (!grid) return null
  const nb = normalizeBrief(model), stair = stairGeometry(nb)
  const W = grid.x1 - grid.x0, D = grid.y1 - grid.y0
  if (W < 2400 || D < 2400) return null

  // ---- where the structure stands on the plot: a pure translation, the structure itself is untouched ----
  let site: SiteModel = siteModel(model, 'front')
  const fits = (z: Rect) => W <= z.w && D <= z.h
  if (!fits(site.houseZone) && fits(site.envelope)) site = { ...site, frontStripMm: 0, houseZone: { ...site.envelope } }
  const zone = site.houseZone
  const px = Math.round(zone.x + Math.max(0, (zone.w - W) / 2)), py = Math.round(zone.y + Math.max(0, zone.h - D))
  const dx = px - grid.x0, dy = py - grid.y0

  const hallMm = snapUp(Math.max(1800, nb.mainDoorMm + 600))
  const candidates: { orientation: Orientation; mirror: boolean; cand: PlateCandidate; single: boolean; score: number; axes: number[]; vLines: number[] }[] = []
  const lineSet = (vals: number[], optional: Set<number>) => ({ vals, optional })
  void lineSet

  for (const orientation of ['x', 'y'] as Orientation[]) for (const mirror of [false, true]) {
    const L = orientation === 'x' ? W : D, V = orientation === 'x' ? D : W
    const toLocal = (p: Point) => {
      const x = p.x - grid.x0, y = p.y - grid.y0
      return orientation === 'x' ? { u: mirror ? W - x : x, v: y } : { u: D - y, v: mirror ? W - x : x }
    }
    const uRaw = [...new Set((orientation === 'x' ? grid.xs : grid.ys).map((c) => toLocal(orientation === 'x' ? { x: c, y: grid.y0 } : { x: grid.x0, y: c }).u))].sort((a, b) => a - b)
    const vRaw = [...new Set((orientation === 'x' ? grid.ys : grid.xs).map((c) => toLocal(orientation === 'x' ? { x: grid.x0, y: c } : { x: c, y: grid.y0 }).v))].sort((a, b) => a - b)
    const uLines = withOptionalLines(uRaw).all, vLines = withOptionalLines(vRaw).all
    const aLo = Math.max(MIN_BAND, nb.storeys >= 0 && stair.depth ? stair.depth : MIN_BAND)
    for (const single of [false, true]) {
      const spine = single ? hallMm : EXISTING_LIMITS.spineMm
      const depthsA = single ? [V - spine] : [...new Set([...vLines.filter((v) => v > 0 && v < V), ...Array.from({ length: Math.max(0, Math.floor((V - spine - EXISTING_LIMITS.minBandMm - aLo) / 300) + 1) }, (_, i) => aLo + i * 300)])].sort((a, b) => a - b)
      for (const dA of depthsA) {
        const dB = single ? 0 : V - dA - spine
        if (dA < aLo || (!single && dB < EXISTING_LIMITS.minBandMm)) continue
        const onGrid = vLines.includes(dA) ? 0 : 1
        const cand: PlateCandidate = { orientation, depthA: dA, depthB: dB, spine, length: L, atTarget: true, atMin: true, relaxed: false, score: onGrid }
        candidates.push({ orientation, mirror, cand, single, score: onGrid, axes: uLines, vLines })
      }
    }
  }
  if (!candidates.length) return null

  // ---- rank candidates by how well the programme fits (rooms at target > minimum > squeezed) ----
  type Scored = (typeof candidates)[number] & { layout: ReturnType<typeof placeFloors>; floorsReq: FloorRequirements[]; quality: number; input: LayoutInput }
  const scored: Scored[] = []
  const frameOf = (c: (typeof candidates)[number]): Frame => ({ orientation: c.orientation, mirror: c.mirror, px, py, L: c.cand.length, V: c.cand.depthA + c.cand.spine + c.cand.depthB })
  for (const c of candidates) {
    const floorsReq = programRequirements(nb, stair.slotWidth, c.single)
    reorder(floorsReq, request.order)
    const input: LayoutInput = {
      lockedAxes: c.axes.filter((u) => u > 0 && u < c.cand.length),
      floors: floorsReq, site, family: 'rectangular', large: nb.large, stairDepth: stair.depth,
      hasStair: floorsReq[0].rooms.some((r) => r.kind === 'stair'), courtSqm: 12, singleLoaded: c.single, hallMm,
    }
    let layout: ReturnType<typeof placeFloors>
    try { layout = placeFloors(input, c.cand) } catch { continue }
    // every ground room must be placed and no room may fall below its minimum size
    const ground = layout.rooms[0].filter((r) => r.band !== 'S')
    if (ground.length !== floorsReq[0].rooms.length) continue
    // grid rows that end up inside a band are columns standing free in a room: avoid them where possible
    const vInterior = c.vLines.filter((v) => v > 0 && v < c.cand.depthA + c.cand.spine + c.cand.depthB)
    const freeRows = vInterior.filter((v) => Math.abs(v - c.cand.depthA) > 5 && Math.abs(v - (c.cand.depthA + c.cand.spine)) > 5).length
    let quality = c.score * 0.5 + freeRows * 4, bad = 0
    for (const [fi, rooms] of layout.rooms.entries()) for (const lr of rooms) {
      if (lr.band === 'S') continue
      const depth = lr.band === 'A' ? c.cand.depthA : c.cand.depthB
      const area = ((lr.u1 - lr.u0) * depth) / 1e6, req = lr.req
      if (area < req.minSqm - 0.05 || (lr.u1 - lr.u0) < roomWidths(req, depth).min - 1) bad += 1
      quality += Math.abs(area - req.targetSqm) / Math.max(1, req.targetSqm)
      void fi
    }
    if (bad) quality += 100 * bad
    scored.push({ ...c, layout, floorsReq, quality, input })
  }
  if (!scored.length) return null
  scored.sort((a, b) => a.quality - b.quality)
  const pool = scored.filter((c) => c.quality <= scored[0].quality + 1.5 + Math.abs(scored[0].quality) * 0.2).slice(0, 6)
  const chosen = pool[request.pick % pool.length]
  const { cand, layout, floorsReq, input } = chosen
  const frame = frameOf(chosen)
  const V = frame.V
  const vLinesLocal = [0, cand.depthA, cand.depthA + cand.spine, V]
  const bandV = { A: [vLinesLocal[0], vLinesLocal[1]], S: [vLinesLocal[1], vLinesLocal[2]], B: [vLinesLocal[2], vLinesLocal[3]] } as const

  // ---- the structural grid in plan coordinates (translated, never altered) ----
  const gridX = withOptionalLines(grid.xs), gridY = withOptionalLines(grid.ys)
  const lockedAt = (c: Point) => [...structure.columns.map((x) => ({ at: x.at, size: x.size, id: x.id })), ...structure.footings.map((f) => ({ at: f.at, size: 0, id: f.id }))]
    .map((x) => ({ ...x, at: { x: x.at.x + dx, y: x.at.y + dy } })).find((x) => near(x.at, c, EXISTING_LIMITS.clusterMm))
  const lockedColumns = structure.columns.map((c) => ({ ...c, at: { x: c.at.x + dx, y: c.at.y + dy } }))
  const gx = gridX.all.map((x) => x + dx), gy = gridY.all.map((y) => y + dy)
  const optionalX = new Set([...gridX.optional].map((x) => x + dx)), optionalY = new Set([...gridY.optional].map((y) => y + dy))

  const kinds = new Map<string, string>(), parents = new Map<string, string>()
  for (const f of floorsReq) for (const r of [...f.rooms, ...f.outdoor, f.spine]) { kinds.set(r.id, r.kind); if (r.parent) parents.set(r.id, r.parent) }
  const kindOf = (id: string) => kinds.get(id) ?? ''
  const parentOf = (id: string) => parents.get(id)
  const toRoom = (lr: LocalRoom): PlacedRoom => placed(lr.req, toPlanRect(frame, lr.u0, lr.u1, bandV[lr.band][0], bandV[lr.band][1]))
  const outdoorRoom = (r: RoomReq, rect: Rect): PlacedRoom => placed(r, rect)
  const axisLines = [
    ...gx.map((x) => ({ orient: 'v' as const, fixed: x, lo: -Infinity, hi: Infinity })),
    ...gy.map((y) => ({ orient: 'h' as const, fixed: y, lo: -Infinity, hi: Infinity })),
  ]
  void input

  const floors: FloorPlan[] = []
  let lowerRooms: PlacedRoom[] = [], lowerOpenings: FloorPlan['openings'] = [], lowerPlate: Rect[] = []
  let maxSpan = 0
  for (const [fi, plate] of layout.plates.entries()) {
    const req = floorsReq[fi], prefix = req.prefix, level = req.level
    const footprint = plateRects(frame, plate, vLinesLocal)
    const rooms = layout.rooms[fi].map(toRoom)
    const bbox = rectUnionBBox(footprint)
    if (level === 0) frontYard(rooms, req.outdoor.filter((r) => r.kind !== 'courtyard'), bbox, site, nb.twoCar, nb.large, outdoorRoom)
    else for (const r of req.outdoor.filter((x) => x.kind === 'balcony')) {
      const b = placeBalcony(rooms, bbox, site, kindOf, lowerPlate)
      if (b) rooms.push(outdoorRoom(r, b))
    }

    // ---- walls first: a new column is only proposed where a wall already runs ----
    const walls = wallGraph(rooms, prefix, axisLines)
    const onWall = (p: Point) => walls.some((w) => {
      const h = Math.abs(w.a.y - w.b.y) < 2
      return h ? Math.abs(p.y - w.a.y) < 2 && p.x >= Math.min(w.a.x, w.b.x) - 2 && p.x <= Math.max(w.a.x, w.b.x) + 2
        : Math.abs(p.x - w.a.x) < 2 && p.y >= Math.min(w.a.y, w.b.y) - 2 && p.y <= Math.max(w.a.y, w.b.y) + 2
    })
    // ---- columns: LOCKED where built (kept even if they stand in a room), PROPOSED on the grid where a wall runs ----
    const inPlate = (p: Point) => footprint.some((r) => p.x >= r.x - 1 && p.x <= rectRight(r) + 1 && p.y >= r.y - 1 && p.y <= rectBottom(r) + 1)
    const columns: Column[] = []
    for (const y of gy) for (const x of gx) {
      const at = { x, y }
      if (!inPlate(at)) continue
      const locked = level < structure.storeysBuilt ? lockedAt(at) : undefined
      const builtColumn = locked && lockedColumns.find((c) => near(c.at, at, EXISTING_LIMITS.clusterMm))
      if (!builtColumn && !onWall(at)) continue
      const optional = optionalX.has(x) || optionalY.has(y)
      columns.push(builtColumn
        ? { id: '', at: { ...builtColumn.at }, size: builtColumn.size, grid: '', state: 'LOCKED' }
        : { id: '', at, size: columnSizeMm(model.brief.levels.storeys, columnPosition(at, footprint)), grid: '', state: 'PROPOSED', ...(optional ? { optional: true } : {}) })
    }
    columns.sort((a, b) => a.at.y - b.at.y || a.at.x - b.at.x).forEach((c, i) => { c.id = `${prefix}_COLUMN_C${String(i + 1).padStart(2, '0')}`; c.grid = `GRID_${i + 1}` })
    const beams = beamsFor(columns, inPlate, prefix).map((b) => {
      const builtBeam = level < structure.storeysBuilt && structure.beams.some((s) => sameBeam(b, s, dx, dy))
      const optional = columns.some((c) => c.optional && (near(c.at, b.a, 1) || near(c.at, b.b, 1)))
      return { ...b, state: builtBeam ? ('LOCKED' as const) : ('PROPOSED' as const), ...(optional && !builtBeam ? { optional: true } : {}) }
    })
    maxSpan = Math.max(maxSpan, ...beams.map((b) => b.span))
    const cells: Rect[] = []
    for (let i = 0; i < gx.length - 1; i++) for (let j = 0; j < gy.length - 1; j++) {
      const cell = { x: gx[i], y: gy[j], w: gx[i + 1] - gx[i], h: gy[j + 1] - gy[j] }
      if (inPlate({ x: cell.x + cell.w / 2, y: cell.y + cell.h / 2 })) cells.push(cell)
    }
    const cantilevers = rooms.filter((r) => r.outdoor && r.id.startsWith('balcony') && !lowerPlate.some((p) => r.rect.x >= p.x - 1 && r.rect.y >= p.y - 1 && rectRight(r.rect) <= rectRight(p) + 1 && rectBottom(r.rect) <= rectBottom(p) + 1)).map((r) => r.rect)
    const supportZones = supportZonesFor(cells, prefix, cantilevers)

    // ---- walls, doors, windows, shafts: the production placers, keeping clear of every column ----
    const occ: Occupancy = new Map()
    const stairRoom = rooms.find((r) => r.id === 'stair')
    const spineRoom = rooms.find((r) => r.id === req.spine.id)!
    const coreTarget = stairRoom ? { x: stairRoom.rect.x + stairRoom.rect.w / 2, y: stairRoom.rect.y + stairRoom.rect.h / 2 } : { x: spineRoom.rect.x, y: spineRoom.rect.y }
    const { openings: doors, failed } = placeDoors(rooms, req.spine.id, prefix, columns, occ, kindOf, parentOf,
      level === 0 ? { width: nb.mainDoorMm } : null, coreTarget, model.brief.lifestyle.kitchen)
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
      level, name: model.floors[fi].name, prefix, outline: bbox, footprint,
      roof: request.roofFor(level, fi === layout.plates.length - 1),
      courtyard: null, rooms, walls, openings, stair: stairRunOut,
      reachable: reach.length === 0 && failed.length === 0,
      unreachableRooms: [...new Set([...reach, ...failed.filter((id) => !rooms.find((r) => r.id === id)?.outdoor)])],
      columns, beams, shafts, supportZones,
    })
    lowerRooms = rooms; lowerOpenings = openings; lowerPlate = footprint
  }
  void onPlate; void toPlanPoint; void COLUMN
  return {
    existingOffset: { dx, dy },
    floors,
    structure: { orientation: cand.orientation, mirror: chosen.mirror, family: 'rectangular', axes: [
      ...gx.map((x, i) => ({ id: `GRID_${i + 1}`, orient: 'v' as const, at: x })),
      ...gy.map((y, i) => ({ id: `GRID_${String.fromCharCode(65 + i)}`, orient: 'h' as const, at: y })),
    ], maxBeamSpanMm: maxSpan },
    site,
    candidates: pool.length,
  }
}
