import { type Point, type Rect, rectBottom, rectRight, sharedEdge } from '../../geometry.ts'
import type { Opening, PlacedRoom, StairRun, Wall } from '../types.ts'
import type { DesignDNA } from '../designDna.ts'
import type { Beam, Column, FloorPlate, Orientation, Shaft, SupportZone } from './types.ts'
import { BAND_WALL, COLUMN, EXT_WALL, INT_WALL, snap } from './program.ts'
import { quantityRules } from '../../cost/data/quantityRules.ts'

/* ------------------------------ local → plan ------------------------------- */

export type Frame = {
  orientation: Orientation
  mirror: boolean
  /** plan origin of the ground plate's bounding box */
  px: number
  py: number
  /** ground plate extents: length along u, depth across v */
  L: number
  V: number
}

export const planW = (f: Frame) => (f.orientation === 'x' ? f.L : f.V)
export const planH = (f: Frame) => (f.orientation === 'x' ? f.V : f.L)

/** local u-interval × v-interval → plan rect. In 'y' the u = 0 end (stair,
 *  foyer) maps to plan-south so the entry always faces the road. */
export function toPlanRect(f: Frame, u0: number, u1: number, v0: number, v1: number): Rect {
  let r: Rect = f.orientation === 'x'
    ? { x: f.px + u0, y: f.py + v0, w: u1 - u0, h: v1 - v0 }
    : { x: f.px + v0, y: f.py + (f.L - u1), w: v1 - v0, h: u1 - u0 }
  if (f.mirror) r = { ...r, x: 2 * f.px + planW(f) - r.x - r.w }
  return r
}

export function toPlanPoint(f: Frame, u: number, v: number): Point {
  let p: Point = f.orientation === 'x' ? { x: f.px + u, y: f.py + v } : { x: f.px + v, y: f.py + (f.L - u) }
  if (f.mirror) p = { x: 2 * f.px + planW(f) - p.x, y: p.y }
  return p
}

/** the floor plate as the fewest disjoint rectangles (column strips merged) */
export function plateRects(f: Frame, plate: FloorPlate, vLines: number[]): Rect[] {
  const bands = ['A', 'S', 'B'] as const
  const cuts = [...new Set(bands.flatMap((b) => plate.segments[b].flat()))].sort((a, b) => a - b)
  const strips: { u0: number; u1: number; v0: number; v1: number }[] = []
  for (let i = 0; i < cuts.length - 1; i++) {
    const mid = (cuts[i] + cuts[i + 1]) / 2
    const on = bands.map((b) => plate.segments[b].some(([a, c]) => mid > a && mid < c))
    const idx = on.map((x, k) => (x ? k : -1)).filter((k) => k >= 0)
    if (!idx.length) continue
    const v0 = vLines[idx[0]]
    const v1 = vLines[idx[idx.length - 1] + 1]
    const last = strips[strips.length - 1]
    if (last && last.u1 === cuts[i] && last.v0 === v0 && last.v1 === v1) last.u1 = cuts[i + 1]
    else strips.push({ u0: cuts[i], u1: cuts[i + 1], v0, v1 })
  }
  return strips.map((s) => toPlanRect(f, s.u0, s.u1, s.v0, s.v1))
}

/** is local point (u, v) on the (closed) plate? */
export function onPlate(plate: FloorPlate, vLines: number[], u: number, v: number): boolean {
  const bands = ['A', 'S', 'B'] as const
  return bands.some((b, k) => v >= vLines[k] - 1 && v <= vLines[k + 1] + 1 &&
    plate.segments[b].some(([a, c]) => u >= a - 1 && u <= c + 1))
}

/* ------------------------------- WallGraph -------------------------------- */

const horizontalSide = (s: 'N' | 'S' | 'E' | 'W') => s === 'N' || s === 'S'

type Line = { orient: 'h' | 'v'; fixed: number; lo: number; hi: number }

function roomEdges(r: Rect): (Line & { side: 'N' | 'S' | 'E' | 'W' })[] {
  return [
    { side: 'N', orient: 'h', fixed: r.y, lo: r.x, hi: rectRight(r) },
    { side: 'S', orient: 'h', fixed: rectBottom(r), lo: r.x, hi: rectRight(r) },
    { side: 'W', orient: 'v', fixed: r.x, lo: r.y, hi: rectBottom(r) },
    { side: 'E', orient: 'v', fixed: rectRight(r), lo: r.y, hi: rectBottom(r) },
  ]
}

const subtract = (lo: number, hi: number, cuts: [number, number][]): [number, number][] => {
  let parts: [number, number][] = [[lo, hi]]
  for (const [a, b] of cuts) {
    parts = parts.flatMap(([p, q]): [number, number][] => {
      if (b <= p || a >= q) return [[p, q]]
      const out: [number, number][] = []
      if (a > p) out.push([p, a])
      if (b < q) out.push([b, q])
      return out
    })
  }
  return parts.filter(([p, q]) => q - p > 2)
}

const tail = (id: string, prefix: string) => id.startsWith(`${prefix}_`) ? id.slice(prefix.length + 1) : id

/** interior walls = shared room edges; exterior walls = the rest of each room edge */
export function wallGraph(rooms: PlacedRoom[], prefix: string, structuralLines: Line[]): Wall[] {
  const enc = rooms.filter((r) => !r.outdoor)
  const walls: Wall[] = []
  const ids = new Map<string, number>()
  const uid = (base: string) => {
    const n = (ids.get(base) ?? 0) + 1
    ids.set(base, n)
    return n === 1 ? base : `${base}_${String(n).padStart(2, '0')}`
  }
  const onStructural = (l: Line) => structuralLines.some((s) => s.orient === l.orient && Math.abs(s.fixed - l.fixed) < 2)
  const shared = new Map<PlacedRoom, [number, number, 'N' | 'S' | 'E' | 'W'][]>()
  enc.forEach((r) => shared.set(r, []))
  for (let i = 0; i < enc.length; i++) {
    for (let j = i + 1; j < enc.length; j++) {
      const e = sharedEdge(enc[i].rect, enc[j].rect)
      if (!e || e.length < 2) continue
      const h = horizontalSide(e.side)
      const lo = h ? e.seg.a.x : e.seg.a.y
      const hi = h ? e.seg.b.x : e.seg.b.y
      shared.get(enc[i])!.push([lo, hi, e.side])
      const opp = { N: 'S', S: 'N', E: 'W', W: 'E' } as const
      shared.get(enc[j])!.push([lo, hi, opp[e.side]])
      const line: Line = { orient: h ? 'h' : 'v', fixed: h ? e.seg.a.y : e.seg.a.x, lo, hi }
      const structural = onStructural(line)
      walls.push({
        id: uid(`${prefix}_WALL_${tail(enc[i].semanticId, prefix)}_${tail(enc[j].semanticId, prefix)}`),
        a: e.seg.a, b: e.seg.b,
        thickness: structural ? BAND_WALL : INT_WALL,
        kind: 'interior',
        rooms: [enc[i].id, enc[j].id],
        structural,
      })
    }
  }
  for (const r of enc) {
    for (const edge of roomEdges(r.rect)) {
      const cuts = shared.get(r)!.filter((s) => s[2] === edge.side).map(([a, b]) => [a, b] as [number, number])
      for (const [lo, hi] of subtract(edge.lo, edge.hi, cuts)) {
        const a = edge.orient === 'h' ? { x: lo, y: edge.fixed } : { x: edge.fixed, y: lo }
        const b = edge.orient === 'h' ? { x: hi, y: edge.fixed } : { x: edge.fixed, y: hi }
        walls.push({
          id: uid(`${prefix}_WALL_${tail(r.semanticId, prefix)}_EXT_${edge.side}`),
          a, b, thickness: EXT_WALL, kind: 'exterior', rooms: [r.id, null], structural: true,
        })
      }
    }
  }
  return walls
}

/* -------------------------------- StairCore -------------------------------- */

export function stairRun(rect: Rect, startSide: 'N' | 'S' | 'E' | 'W', perFlight: number, going: number): StairRun {
  const alongY = startSide === 'N' || startSide === 'S'
  const across = alongY ? rect.w : rect.h
  const map = (a: number, b: number): Point => {
    if (startSide === 'S') return { x: rect.x + a, y: rectBottom(rect) - b }
    if (startSide === 'N') return { x: rect.x + a, y: rect.y + b }
    if (startSide === 'E') return { x: rectRight(rect) - b, y: rect.y + a }
    return { x: rect.x + b, y: rect.y + a }
  }
  const treads: Point[][] = []
  for (let i = 1; i < perFlight; i++) {
    const b = i * going
    treads.push([map(0, b), map(across / 2 - 50, b)])
    treads.push([map(across / 2 + 50, b), map(across, b)])
  }
  return { rect, treads, direction: 'up', startSide }
}

/* ----------------------------- opening placement ---------------------------- */

export type Occupancy = Map<string, [number, number][]>
const lineKey = (orient: 'h' | 'v', fixed: number) => `${orient}:${Math.round(fixed)}`

export const COLUMN_CLEAR = COLUMN / 2 + 60

/** column positions along a wall line */
function columnsOn(columns: Column[], orient: 'h' | 'v', fixed: number): {at:number;clear:number}[] {
  return columns
    .filter((c) => Math.abs((orient === 'h' ? c.at.y : c.at.x) - fixed) < 2)
    .map((c) => ({at:orient === 'h' ? c.at.x : c.at.y,clear:c.size/2+quantityRules.openingColumnClearanceMm}))
}

/**
 * Centre of an opening of `width` on [lo, hi] of a wall line, clear of the
 * wall ends, every column and every opening already on that line; nearest to
 * `target`. null when nothing fits.
 */
export function fitOnLine(
  line: Line, width: number, target: number, endClear: number,
  columns: Column[], occ: Occupancy,
): number | null {
  const half = width / 2
  let free: [number, number][] = [[line.lo + endClear + half, line.hi - endClear - half]]
  const blocks: [number, number][] = [
    ...columnsOn(columns, line.orient, line.fixed).map((c) => [c.at - c.clear, c.at + c.clear] as [number, number]),
    ...(occ.get(lineKey(line.orient, line.fixed)) ?? []).map(([a, b]) => [a - 150, b + 150] as [number, number]),
  ]
  for (const [a, b] of blocks) {
    free = free.flatMap(([p, q]): [number, number][] => {
      const x0 = a - half
      const x1 = b + half
      if (x1 <= p || x0 >= q) return [[p, q]]
      const out: [number, number][] = []
      if (x0 > p) out.push([p, x0])
      if (x1 < q) out.push([x1, q])
      return out
    })
  }
  free = free.filter(([p, q]) => q >= p)
  if (!free.length) return null
  let best: number | null = null
  for (const [p, q] of free) {
    const c = Math.round(Math.min(q, Math.max(p, target)))
    if (best === null || Math.abs(c - target) < Math.abs(best - target)) best = c
  }
  return best
}

export function occupy(occ: Occupancy, orient: 'h' | 'v', fixed: number, at: number, width: number) {
  const k = lineKey(orient, fixed)
  const list = occ.get(k) ?? []
  list.push([at - width / 2, at + width / 2])
  occ.set(k, list)
}

/* ------------------------------ DoorPlacement ------------------------------ */

type DoorSpec = { to: string; width: number; leaf: boolean; label: 'DOOR' | 'OPENING' }

/** who each room opens to — the access rules of the RoomGraph */
function doorSpecs(r: PlacedRoom, rooms: PlacedRoom[], spineId: string, kindOf: (id: string) => string, parentOf: (id: string) => string | undefined): DoorSpec[] {
  // the spine is where everything opens to; it opens to nothing itself
  if (r.id === spineId) return []
  const spine = rooms.find((x) => x.id === spineId)
  const s = spine?.id ?? ''
  switch (kindOf(r.id)) {
    case 'foyer': {
      return [{ to: s, width: 1000, leaf: false, label: 'OPENING' }]
    }
    case 'living': case 'livingDining': case 'lounge':
      return [{ to: s, width: 1000, leaf: false, label: 'OPENING' }]
    case 'dining':
      return [{ to: s, width: 1000, leaf: false, label: 'OPENING' }]
    case 'kitchen':
      return [{ to: s, width: 800, leaf: true, label: 'DOOR' }]
    case 'utility':
      return [{ to: s, width: 750, leaf: true, label: 'DOOR' }]
    case 'stair':
      return [{ to: s, width: 1000, leaf: false, label: 'OPENING' }]
    case 'lift':
      return [{ to: s, width: 900, leaf: false, label: 'DOOR' }]
    case 'ensuite':
      return [{ to: parentOf(r.id) ?? s, width: 750, leaf: true, label: 'DOOR' }]
    case 'bath':
      return [{ to: s, width: r.id === 'accessibleBath' ? 900 : 750, leaf: true, label: 'DOOR' }]
    case 'bed': case 'study': case 'pooja':
      return [{ to: s, width: kindOf(r.id) === 'pooja' ? 700 : 800, leaf: true, label: 'DOOR' }]
    default:
      return []
  }
}

export function placeDoors(
  rooms: PlacedRoom[], spineId: string, prefix: string, columns: Column[], occ: Occupancy,
  kindOf: (id: string) => string, parentOf: (id: string) => string | undefined,
  entry: { width: number } | null, coreTarget: Point,
  kitchenType: 'open' | 'semi' | 'closed' = 'semi',
): { openings: Opening[]; failed: string[] } {
  const openings: Opening[] = []
  const failed: string[] = []
  const byId = new Map(rooms.map((r) => [r.id, r]))
  const counts = new Map<string, number>()
  const nextId = (base: string) => {
    const n = (counts.get(base) ?? 0) + 1
    counts.set(base, n)
    return `${base}_${String(n).padStart(2, '0')}`
  }

  const put = (served: PlacedRoom, other: PlacedRoom | null, line: Line, width: number, leaf: boolean,
    kind: Opening['kind'], id: string, target: number, treatment?: Opening['treatment']): boolean => {
    const at = fitOnLine(line, width, target, 250, columns, occ)
    if (at === null) return false
    const c = line.orient === 'h' ? served.rect.y + served.rect.h / 2 : served.rect.x + served.rect.w / 2
    const swing: 1 | -1 = c > line.fixed ? 1 : -1
    occupy(occ, line.orient, line.fixed, at, width)
    openings.push({
      id, kind, width, leaf, swing, hinge: 'a',
      orient: line.orient,
      at: line.orient === 'h' ? { x: at, y: line.fixed } : { x: line.fixed, y: at },
      rooms: [served.id, other?.id ?? null],
      ...(treatment ? { treatment } : {}),
    })
    return true
  }
  const lineOf = (e: NonNullable<ReturnType<typeof sharedEdge>>): Line => {
    const h = horizontalSide(e.side)
    return { orient: h ? 'h' : 'v', fixed: h ? e.seg.a.y : e.seg.a.x, lo: h ? e.seg.a.x : e.seg.a.y, hi: h ? e.seg.b.x : e.seg.b.y }
  }

  // ---- the kitchen's connection to dining, set by the brief's kitchen type.
  //      Placed before any other door so it has first claim on the shared
  //      wall; if the chosen type cannot fit it falls back to the next
  //      narrower one (open → glazed slide → door). ----
  const kitchen = rooms.find((x) => !x.outdoor && kindOf(x.id) === 'kitchen')
  let kitchenSpineDoor: 'keep' | 'replaced' | 'viaDining' = 'keep'
  let kitchenDining: PlacedRoom | undefined
  if (kitchen) {
    kitchenDining = ['dining', 'livingDining'].map((id) => byId.get(id))
      .find((o): o is PlacedRoom => !!o && (sharedEdge(kitchen.rect, o.rect)?.length ?? 0) >= 1200)
    const target = kitchenDining ?? byId.get(spineId)
    const e = target && sharedEdge(kitchen.rect, target.rect)
    if (target && e) {
      const line = lineOf(e)
      const mid = (line.lo + line.hi) / 2
      const base = `${kitchen.semanticId}_${kitchenDining ? 'DINING' : 'HALL'}`
      const open = () => {
        for (let w = Math.floor((line.hi - line.lo - 600) / 100) * 100; w >= 1500; w -= 300)
          if (put(kitchen, target, line, w, false, 'door', `${base}_OPENING`, mid, 'open')) return true
        return false
      }
      const semi = () => [1800, 1500, 1200].some((w) =>
        put(kitchen, target, line, w, false, 'door', `${base}_OPENING`, mid, 'glazed-slide'))
      const closed = () => put(kitchen, target, line, 800, true, 'door', `${base}_DOOR`, mid)
      const ladder = kitchenType === 'open' ? [open, semi, closed] : kitchenType === 'semi' ? [semi, closed] : [closed]
      const placed = ladder.findIndex((f) => f())
      const opened = placed >= 0 && kitchenType === 'open' && placed === 0
      // on the hall itself the connection IS the kitchen's door; through an
      // open dining area the kitchen needs no second door
      if (placed >= 0 && !kitchenDining) kitchenSpineDoor = 'replaced'
      else if (opened) kitchenSpineDoor = 'viaDining'
    }
  }

  // the main door first: it is the one opening that must not move
  const foyer = byId.get('foyer')
  if (entry && foyer) {
    const line: Line = { orient: 'h', fixed: rectBottom(foyer.rect), lo: foyer.rect.x, hi: rectRight(foyer.rect) }
    if (!put(foyer, null, line, entry.width, true, 'entry', `${prefix}_MAIN_DOOR`, foyer.rect.x + foyer.rect.w / 2))
      failed.push('foyer')
  }

  for (const r of rooms) {
    if (r.outdoor) continue
    for (const spec of doorSpecs(r, rooms, spineId, kindOf, parentOf)) {
      if (r === kitchen && spec.to === spineId && kitchenSpineDoor !== 'keep') continue
      const to = byId.get(spec.to)
      const e = to && sharedEdge(r.rect, to.rect)
      if (!to || !e) {
        failed.push(r.id)
        continue
      }
      const h = horizontalSide(e.side)
      const line: Line = { orient: h ? 'h' : 'v', fixed: h ? e.seg.a.y : e.seg.a.x, lo: h ? e.seg.a.x : e.seg.a.y, hi: h ? e.seg.b.x : e.seg.b.y }
      // leaves swing into the private / smaller room; cased openings sit central;
      // a door into a bedroom or bath hugs the end nearest the stair core
      const mid = (line.lo + line.hi) / 2
      const toward = h ? coreTarget.x : coreTarget.y
      const target = spec.leaf ? (toward < mid ? line.lo : line.hi) : mid
      const base = `${r.semanticId}_${spec.label}`
      const id = spec.label === 'DOOR' && !openings.some((o) => o.id === base) ? base : nextId(base)
      if (!put(r, to, line, spec.width, spec.leaf, 'door', id, target) &&
        !put(r, to, line, Math.max(700, spec.width - 200), spec.leaf, 'door', id, target))
        failed.push(r.id)
    }
  }
  // an open kitchen dropped its hall door on the strength of the dining room;
  // if dining itself never got an opening, give the kitchen its door back
  if (kitchen && kitchenDining && kitchenSpineDoor === 'viaDining') {
    const diningReached = openings.some((o) => o.rooms?.includes(kitchenDining.id) && !o.rooms.includes(kitchen.id))
    const hall = byId.get(spineId)
    const e = hall && sharedEdge(kitchen.rect, hall.rect)
    if (!diningReached && hall && e) {
      const line = lineOf(e)
      if (!put(kitchen, hall, line, 800, true, 'door', `${kitchen.semanticId}_DOOR`, (line.lo + line.hi) / 2)) failed.push(kitchen.id)
    }
  }
  // balconies open off their host room; a court opens off the spine
  for (const o of rooms.filter((x) => x.outdoor && (x.id.startsWith('balcony') || x.id === 'courtyard'))) {
    const host = o.id === 'courtyard'
      ? rooms.find((x) => x.id === spineId && sharedEdge(x.rect, o.rect))
      : rooms.find((x) => !x.outdoor && sharedEdge(x.rect, o.rect) && (sharedEdge(x.rect, o.rect)?.length ?? 0) > 1500)
    const e = host && sharedEdge(host.rect, o.rect)
    if (!host || !e) {
      failed.push(o.id)
      continue
    }
    const h = horizontalSide(e.side)
    const line: Line = { orient: h ? 'h' : 'v', fixed: h ? e.seg.a.y : e.seg.a.x, lo: h ? e.seg.a.x : e.seg.a.y, hi: h ? e.seg.b.x : e.seg.b.y }
    if (!put(host, o, line, 900, true, 'door', `${o.semanticId}_DOOR`, (line.lo + line.hi) / 2)) failed.push(o.id)
  }
  return { openings, failed }
}

/* ----------------------------- WindowPlacement ----------------------------- */

type WinSpec = { width: number; min: number; sill: number; max: number }

function windowSpec(kind: string, area: number, themeW: number): WinSpec | null {
  if (kind === 'ensuite' || kind === 'bath') return { width: 750, min: 600, sill: 1800, max: 1 }
  if (kind === 'utility') return { width: 900, min: 600, sill: 1200, max: 1 }
  if (kind === 'kitchen') return { width: 1200, min: 900, sill: 1050, max: 1 }
  if (kind === 'stair') return { width: 1200, min: 900, sill: 1500, max: 1 }
  if (kind === 'corridor' || kind === 'lobby') return { width: 900, min: 600, sill: 900, max: 1 }
  if (['living', 'livingDining', 'dining', 'lounge', 'bed', 'study'].includes(kind)) {
    // NBC: glazing ≥ 1/10 of the floor area, at a 1.35 m glazed height
    const need = Math.ceil((area * 0.1 / 1.35) * 10) * 100
    return { width: Math.min(2400, Math.max(themeW, need, 1200)), min: 900, sill: 900, max: 2 }
  }
  return null
}

export const GLAZED_HEIGHT = 1350

export function placeWindows(
  rooms: PlacedRoom[], walls: Wall[], columns: Column[], occ: Occupancy,
  kindOf: (id: string) => string, themeW: number, dna: DesignDNA, below: Opening[],
): Opening[] {
  const out: Opening[] = []
  let parity = 0
  for (const r of rooms) {
    if (r.outdoor) continue
    const spec = windowSpec(kindOf(r.id), r.area, themeW)
    if (!spec) continue
    const ext = walls
      .filter((w) => w.kind === 'exterior' && w.rooms?.[0] === r.id)
      .map((w): Line => {
        const h = Math.abs(w.a.y - w.b.y) < 2
        return { orient: h ? 'h' : 'v', fixed: h ? w.a.y : w.a.x, lo: h ? Math.min(w.a.x, w.b.x) : Math.min(w.a.y, w.b.y), hi: h ? Math.max(w.a.x, w.b.x) : Math.max(w.a.y, w.b.y) }
      })
      .sort((a, b) => b.hi - b.lo - (a.hi - a.lo))
    let glazed = 0
    let n = 0
    for (const line of ext) {
      if (n >= spec.max) break
      if (n > 0 && glazed * GLAZED_HEIGHT >= r.area * 1e6 * 0.1) break
      const frac = dna.rhythm === 'regular' ? 0.5 : dna.rhythm === 'paired' ? (parity++ % 2 ? 0.62 : 0.38)
        : dna.accentSide === 'left' ? 0.36 : 0.64
      let target = line.lo + (line.hi - line.lo) * frac
      // stack over the window below when that position still works here
      const stack = below.find((o) => o.kind === 'window' && o.orient === line.orient &&
        Math.abs((line.orient === 'h' ? o.at.y : o.at.x) - line.fixed) < 2 &&
        (line.orient === 'h' ? o.at.x : o.at.y) > line.lo && (line.orient === 'h' ? o.at.x : o.at.y) < line.hi)
      if (stack) target = line.orient === 'h' ? stack.at.x : stack.at.y
      for (let w = Math.min(spec.width, snap(line.hi - line.lo - 600)); w >= spec.min; w -= 100) {
        const at = fitOnLine(line, w, target, 300, columns, occ)
        if (at === null) continue
        occupy(occ, line.orient, line.fixed, at, w)
        n += 1
        glazed += w
        out.push({
          id: `${r.semanticId}_WINDOW_${String(n).padStart(2, '0')}`,
          kind: 'window', orient: line.orient, width: w, sill: spec.sill,
          at: line.orient === 'h' ? { x: at, y: line.fixed } : { x: line.fixed, y: at },
          rooms: [r.id, null],
        })
        break
      }
    }
  }
  return out
}

/* ----------------------------- WetAreaPlanning ----------------------------- */

const WET = new Set(['ensuite', 'bath', 'kitchen', 'utility'])

export function planShafts(rooms: PlacedRoom[], walls: Wall[], openings: Opening[], kindOf: (id: string) => string, lower: PlacedRoom[]): Shaft[] {
  const S = 450
  const out: Shaft[] = []
  for (const r of rooms) {
    if (r.outdoor || !WET.has(kindOf(r.id))) continue
    const ext = walls.filter((w) => w.kind === 'exterior' && w.rooms?.[0] === r.id)
      .sort((a, b) => Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y) - Math.hypot(a.b.x - a.a.x, a.b.y - a.a.y))[0]
    if (!ext) continue
    const door = openings.find((o) => o.kind !== 'window' && o.rooms?.includes(r.id))
    const h = Math.abs(ext.a.y - ext.b.y) < 2
    const ends = h ? [Math.min(ext.a.x, ext.b.x), Math.max(ext.a.x, ext.b.x)] : [Math.min(ext.a.y, ext.b.y), Math.max(ext.a.y, ext.b.y)]
    const dAt = door ? (h ? door.at.x : door.at.y) : ends[0]
    const atHi = Math.abs(dAt - ends[1]) > Math.abs(dAt - ends[0])
    const along = atHi ? ends[1] - S : ends[0]
    const inward = h ? (r.rect.y + r.rect.h / 2 > ext.a.y ? 1 : -1) : (r.rect.x + r.rect.w / 2 > ext.a.x ? 1 : -1)
    const rect: Rect = h
      ? { x: along, y: inward > 0 ? ext.a.y : ext.a.y - S, w: S, h: S }
      : { x: inward > 0 ? ext.a.x : ext.a.x - S, y: along, w: S, h: S }
    const under = lower.find((o) => !o.outdoor && WET.has(kindOf(o.id)) &&
      rect.x < rectRight(o.rect) && rectRight(rect) > o.rect.x && rect.y < rectBottom(o.rect) && rectBottom(rect) > o.rect.y)
    out.push({ id: `${r.semanticId}_SHAFT`, roomId: r.id, rect, stackedOver: under?.semanticId ?? null })
  }
  return out
}

/* ---------------------------- StructuralConcept ---------------------------- */

export function beamsFor(columns: Column[], plate: (p: Point) => boolean, prefix: string): Beam[] {
  const beams: Beam[] = []
  const link = (list: Column[], key: 'x' | 'y') => {
    const sorted = [...list].sort((a, b) => a.at[key] - b.at[key])
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i].at
      const b = sorted[i + 1].at
      if (!plate({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })) continue
      beams.push({ id: '', a: { ...a }, b: { ...b }, span: Math.round(Math.hypot(b.x - a.x, b.y - a.y)) })
    }
  }
  const byY = new Map<number, Column[]>()
  const byX = new Map<number, Column[]>()
  for (const c of columns) {
    byY.set(c.at.y, [...(byY.get(c.at.y) ?? []), c])
    byX.set(c.at.x, [...(byX.get(c.at.x) ?? []), c])
  }
  for (const [, list] of [...byY].sort((a, b) => a[0] - b[0])) link(list, 'x')
  for (const [, list] of [...byX].sort((a, b) => a[0] - b[0])) link(list, 'y')
  return beams.map((b, i) => ({ ...b, id: `${prefix}_BEAM_B${String(i + 1).padStart(2, '0')}` }))
}

export function supportZonesFor(cells: Rect[], prefix: string, cantilevers: Rect[]): SupportZone[] {
  return [
    ...cells.map((rect, i) => ({ id: `${prefix}_SLAB_P${String(i + 1).padStart(2, '0')}`, rect, support: 'columns' as const })),
    ...cantilevers.map((rect, i) => ({ id: `${prefix}_CANTILEVER_${String(i + 1).padStart(2, '0')}`, rect, support: 'cantilever' as const })),
  ]
}
