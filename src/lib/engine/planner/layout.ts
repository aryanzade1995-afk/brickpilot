import { roofServiceLayout, terraceFreeRatio, TERRACE_LIMITS } from '../terrace.ts'
import { rectUnionBBox } from '../../geometry.ts'
import type { FloorPlan } from '../types.ts'
import type { Band, FloorPlate, FloorRequirements, LocalRoom, Orientation, PlateFamily, RoomReq, SiteModel, Unit } from './types.ts'
import { MAX_SPAN, MIN_BAND, MIN_SPAN, clamp, roomWidths, snap, snapUp, unitLength } from './program.ts'

/* ------------------------------------------------------------------ *
 *  FloorPlatePlan + RoomPlacement + StructuralGrid (cross axes).
 *
 *  Every floor is three parallel bands along u: A (back), S (spine),
 *  B (front). Rooms span the full depth of their band, so each room
 *  touches an exterior face and every band line is a continuous wall.
 *  Upper floors are clipped to cross axes of the ground floor, so an
 *  upper plate is always a subset of the plate below it.
 * ------------------------------------------------------------------ */

export type PlateCandidate = {
  orientation: Orientation
  depthA: number
  depthB: number
  spine: number
  length: number
  /** true when every room can reach its target width */
  atTarget: boolean
  /** true when every room can at least reach its minimum */
  atMin: boolean
  /** only found by relaxing the zone limits — drawn, but it will be rejected */
  relaxed: boolean
  score: number
}

export type LayoutInput = {
  /** Existing Structure Mode: cross axes (local u) already built; walls slide onto them and they stay the grid */
  lockedAxes?: number[]
  floors: FloorRequirements[]
  site: SiteModel
  family: PlateFamily
  large: boolean
  stairDepth: number
  hasStair: boolean
  /** one band of rooms along an entrance hall (narrow / shallow plots) */
  singleLoaded?: boolean
  /** hall width for a single-loaded plan (fits the main door) */
  hallMm?: number
  courtSqm: number
}

/** a room narrower than this cannot share its one outside wall with a column
 *  and still fit a 900 mm window beside it (2 × (900 + 300 end + 210 column)) */
const NARROW = 3000

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

type Split = { A: Unit[]; B: Unit[] }

/** RoomGraph → band assignment: movable units hop bands until the two band
 *  lengths are as even as their capacities allow. Deterministic greedy. */
export function balance(units: Unit[], dA: number, dB: number, capA: number, capB: number, which: 'min' | 'target' = 'target'): Split {
  const band = new Map(units.map((u) => [u.key, u.band]))
  const len = (b: 'A' | 'B') => sum(units.filter((u) => band.get(u.key) === b).map((u) => unitLength(u, b === 'A' ? dA : dB, which)))
  const cost = () => {
    const oa = len('A') - capA
    const ob = len('B') - capB
    return [Math.max(oa, ob), Math.abs(oa - ob)]
  }
  for (let guard = 0; guard < 40; guard++) {
    const [c0, d0] = cost()
    let best: { key: string; c: number; d: number } | null = null
    for (const u of units) {
      if (!u.movable) continue
      const from = band.get(u.key)!
      band.set(u.key, from === 'A' ? 'B' : 'A')
      const [c, d] = cost()
      band.set(u.key, from)
      if (c < c0 - 1 || (Math.abs(c - c0) <= 1 && d < d0 - 1)) {
        if (!best || c < best.c - 1 || (Math.abs(c - best.c) <= 1 && d < best.d)) best = { key: u.key, c, d }
      }
    }
    if (!best) break
    band.set(best.key, band.get(best.key) === 'A' ? 'B' : 'A')
  }
  const pick = (b: 'A' | 'B') => units.filter((u) => band.get(u.key) === b).sort((p, q) => Number(q.anchor) - Number(p.anchor))
  return { A: pick('A'), B: pick('B') }
}

/** notch length at the far end of band B for an L-shaped plate */
const notchFor = (bNeed: number) => clamp(snap(bNeed * 0.3), 3000, 6000)
const courtFor = (sqm: number, dA: number) => Math.max(3000, snapUp((sqm * 1e6) / dA))

/** Search band depths / orientation for plates that hold the programme. */
export function plateCandidates(input: LayoutInput): PlateCandidate[] {
  const fit = search(input, false)
  // nothing fits the zone: still return the least-bad plates, so the plan is
  // drawn and the validators say exactly why it is rejected
  return fit.length ? fit : search(input, true)
}

function search(input: LayoutInput, relaxed: boolean): PlateCandidate[] {
  const { site, large, family } = input
  const single = !!input.singleLoaded
  // an L-notch cuts the front band — a single-loaded plan has none
  if (single && family === 'l-shape') return []
  const spine = single ? input.hallMm ?? 1800 : large ? 1500 : 1200
  const dMax = site.fillPlot ? 5400 : large ? 5400 : 4800
  const bDepths = single ? [0] : Array.from({ length: Math.floor((dMax - MIN_BAND) / 300) + 1 }, (_, i) => MIN_BAND + i * 300)
  const out: PlateCandidate[] = []
  for (const orientation of ['x', 'y'] as Orientation[]) {
    const lMax = Math.min(orientation === 'x' ? site.houseZone.w : site.houseZone.h, large ? 32000 : 24000)
    const vMax = orientation === 'x' ? site.houseZone.h : site.houseZone.w
    const aLo = Math.max(MIN_BAND, input.hasStair ? input.stairDepth : 0)
    for (let dA = aLo; dA <= Math.max(aLo, dMax); dA += 300) {
      for (const dB of bDepths) {
        const v = dA + spine + dB
        if (v > vMax && !(relaxed && dA === aLo && dB === bDepths[0])) continue
        const gapA = family === 'courtyard' ? courtFor(input.courtSqm, dA) : 0
        const need = (which: 'min' | 'target') => Math.max(...input.floors.map((f) => {
          const s = balance(f.units, dA, dB, -gapA, 0, which)
          const a = sum(s.A.map((u) => unitLength(u, dA, which))) + gapA
          const b = sum(s.B.map((u) => unitLength(u, dB, which)))
          return Math.max(a, family === 'l-shape' ? b + notchFor(b) : b)
        }))
        const lt = snapUp(need('target'))
        const lm = snapUp(need('min'))
        if (lm > lMax * 1.25 && !relaxed) continue
        const coverageLength = site.maxEnclosedMm2 ? Math.floor(site.maxEnclosedMm2 / v / 100) * 100 : lMax
        const fill = site.fillPlot || site.growPlate
        const normal = clamp(lt, Math.min(lm, lMax), lMax)
        // a large villa grows from its normal length up to the coverage limit
        const length = site.fillPlot ? Math.min(lMax, coverageLength)
          : site.growPlate ? Math.max(normal, Math.min(lMax, coverageLength)) : normal
        if (length < lm && !relaxed) continue
        const aspect = Math.max(length, v) / Math.min(length, v)
        // compact plates first; strongly elongated ones and squeezed rooms pay
        const score = (fill ? -(length * v) / 1e6 : (length * v) / 1e6) * (1 + 0.12 * Math.max(0, aspect - 2)) +
          (lt <= lMax ? 0 : 400) + (lm <= lMax ? 0 : 4000)
        out.push({ orientation, depthA: dA, depthB: dB, spine, length, atTarget: lt <= lMax, atMin: lm <= lMax, relaxed: relaxed || v > vMax, score })
      }
    }
  }
  return out.sort((p, q) => p.score - q.score || p.depthA - q.depthA || p.depthB - q.depthB)
}

/* ------------------------------ RoomPlacement ------------------------------- */

/** widths (multiples of 100 mm) that exactly fill `len` */
export function distribute(rooms: RoomReq[], len: number, d: number): number[] {
  const w = rooms.map((r) => roomWidths(r, d))
  const sMin = sum(w.map((x) => x.min))
  const sT = sum(w.map((x) => x.target))
  let xs: number[]
  if (len <= sT) {
    if (len >= sMin) {
      const k = sT - sMin > 0 ? (len - sMin) / (sT - sMin) : 0
      xs = w.map((x) => x.min + k * (x.target - x.min))
    } else xs = w.map((x) => (x.min * len) / Math.max(1, sMin))
  } else {
    xs = w.map((x) => x.target)
    let extra = len - sT
    const flexible = rooms.map((r) => !r.fixedWidthMm && !r.wet && r.kind !== 'foyer' && r.kind !== 'pooja')
    // grow flexible rooms toward their maxima first, then past them evenly
    for (let pass = 0; pass < 2 && extra > 1; pass++) {
      const idx = rooms.map((_, i) => i).filter((i) => flexible[i] && (pass === 1 || xs[i] < w[i].max - 1))
      const pool = idx.length ? idx : rooms.map((_, i) => i).filter((i) => !rooms[i].fixedWidthMm)
      if (!pool.length) break
      const wt = sum(pool.map((i) => w[i].target))
      let used = 0
      for (const i of pool) {
        const add = (extra * w[i].target) / wt
        const room = pass === 0 ? Math.min(add, w[i].max - xs[i]) : add
        xs[i] += room
        used += room
      }
      extra -= used
    }
  }
  const rounded = xs.map((x, i) => (rooms[i].fixedWidthMm && len >= sMin ? rooms[i].fixedWidthMm! : Math.max(100, snap(x))))
  const residual = len - sum(rounded)
  if (residual !== 0) {
    let host = -1
    rounded.forEach((x, i) => {
      if (!rooms[i].fixedWidthMm && (host < 0 || x > rounded[host])) host = i
    })
    if (host < 0) host = rounded.length - 1
    rounded[host] += residual
  }
  return rounded
}

export function placeUnits(units: Unit[], segs: [number, number][], d: number, band: Band, axes: number[] = [], maximumGrowth?: number): { rooms: LocalRoom[]; used: [number, number][] } {
  const rooms: LocalRoom[] = []
  const used: [number, number][] = []
  if (!units.length || !segs.length) return { rooms, used }
  const place = (us: Unit[], seg: [number, number]) => {
    if (!us.length) return
    const list = us.flatMap((u) => u.rooms)
    // a band of fixed slots only (a top-floor stair core) stops at the slot:
    // the rest of that band is roof / terrace, never an inflated stair
    const fixed = list.every((r) => r.fixedWidthMm)
    const fixedLen = sum(list.map((r) => r.fixedWidthMm ?? 0))
    if (fixed && fixedLen < seg[1] - seg[0]) seg = [seg[0], seg[0] + fixedLen]
    const ws = distribute(list, seg[1] - seg[0], d)
    if (maximumGrowth) {
      const caps = list.map(r => r.fixedWidthMm ?? Math.max(roomWidths(r,d).min, Math.floor(r.maxSqm*maximumGrowth*1e6/d/100)*100))
      ws.forEach((width,i) => { ws[i] = Math.min(width,caps[i]) })
      let spare = seg[1]-seg[0]-sum(ws)
      for (let i=0;i<ws.length && spare>0;i++) {
        const add=Math.min(spare,caps[i]-ws[i]);ws[i]+=add;spare-=add
      }
      if (spare>0) return
    }
    const cuts = [seg[0]]
    ws.forEach((w) => cuts.push(cuts[cuts.length - 1] + w))
    if (axes.length) alignToAxes(list, cuts, d, axes, maximumGrowth)
    list.forEach((r, i) => rooms.push({ req: r, band, u0: cuts[i], u1: cuts[i + 1] }))
    used.push(seg)
  }
  if (segs.length === 1) {
    place(units, segs[0])
    return { rooms, used }
  }
  // two segments (a court splits the band): choose the split that distorts least
  const distortion = (us: Unit[], seg: [number, number]) => {
    if (!us.length) return 0
    const len = seg[1] - seg[0]
    const mn = sum(us.map((u) => unitLength(u, d, 'min')))
    const t = sum(us.map((u) => unitLength(u, d, 'target')))
    return mn > len ? 1000 + (mn - len) / 100 : Math.abs(len - t) / len
  }
  let bestK = units.length
  let best = Infinity
  const k0 = units[0]?.anchor ? 1 : 0
  for (let k = k0; k <= units.length; k++) {
    const left = units.slice(0, k)
    const right = units.slice(k)
    // an empty second segment simply drops out of the plate; an empty first
    // segment would strand the stair end, so it is never left empty
    if (!left.length) continue
    const c = Math.max(distortion(left, segs[0]), distortion(right, segs[1])) + (right.length ? 0 : 0.35)
    if (c < best - 1e-9) {
      best = c
      bestK = k
    }
  }
  place(units.slice(0, bestK), segs[0])
  place(units.slice(bestK), segs[1])
  return { rooms, used }
}

/**
 * Slide partitions onto the structural cross axes: a partition within 900 mm
 * of an axis moves onto it, and an axis running through a narrow room (bath,
 * pooja, utility) pulls that room's nearer wall onto itself — so columns
 * land in wall junctions, not in the middle of a 1.5 m bathroom wall.
 * Every room keeps at least its minimum width; fixed slots never move.
 */
function alignToAxes(rooms: RoomReq[], cuts: number[], d: number, axes: number[], maximumGrowth?: number) {
  const mins = rooms.map((r) => roomWidths(r, d).min)
  const maxs = rooms.map(r => maximumGrowth && r.zone!=='circulation' ? r.maxSqm*maximumGrowth*1e6/d : Infinity)
  const movable = (i: number) => !rooms[i - 1]?.fixedWidthMm && !rooms[i]?.fixedWidthMm
  const ok = (i: number, at: number) =>
    at - cuts[i - 1] >= mins[i - 1] - 1 && cuts[i + 1] - at >= mins[i] - 1 &&
    at-cuts[i-1]<=maxs[i-1]+1 && cuts[i+1]-at<=maxs[i]+1
  for (let i = 1; i < cuts.length - 1; i++) {
    if (!movable(i)) continue
    const near = axes.filter((a) => Math.abs(a - cuts[i]) <= 900 && a > cuts[i - 1] && a < cuts[i + 1])
      .sort((a, b) => Math.abs(a - cuts[i]) - Math.abs(b - cuts[i]))
    const at = near.find((a) => ok(i, a))
    if (at !== undefined) cuts[i] = at
  }
  for (let k = 0; k < rooms.length; k++) {
    if (cuts[k + 1] - cuts[k] >= NARROW) continue
    const inside = axes.filter((a) => a > cuts[k] + 1 && a < cuts[k + 1] - 1)
    for (const a of inside) {
      const w = cuts[k + 1] - cuts[k]
      const inner = (i: number) => i > 0 && i < cuts.length - 1 && movable(i)
      const tryMoves: [number, number][][] = [
        [[k, a]], [[k + 1, a]],
        // translate the whole room so one of its walls sits on the axis
        [[k, a], [k + 1, a + w]], [[k + 1, a], [k, a - w]],
      ]
      for (const moves of tryMoves.sort((p, q) => Math.abs(p[0][1] - cuts[p[0][0]]) - Math.abs(q[0][1] - cuts[q[0][0]]))) {
        if (!moves.every(([i]) => inner(i))) continue
        const next = [...cuts]
        for (const [i, v] of moves) next[i] = v
        // cascade: push the walls beyond the moved room along until every
        // neighbour is back at its minimum (the segment ends never move)
        const hi = Math.max(...moves.map(([i]) => i))
        const lo = Math.min(...moves.map(([i]) => i))
        for (let i = hi + 1; i < next.length - 1; i++)
          if (next[i] - next[i - 1] < mins[i - 1]) next[i] = next[i - 1] + mins[i - 1]
        for (let i = lo - 1; i > 0; i--)
          if (next[i + 1] - next[i] < mins[i]) next[i] = next[i + 1] - mins[i]
        const valid = next.every((c, i) => i === 0 || (c - next[i - 1] >= mins[i - 1] - 1 && c-next[i-1]<=maxs[i-1]+1)) &&
          rooms.every((r, i) => !r.fixedWidthMm || next[i + 1] - next[i] === cuts[i + 1] - cuts[i]) &&
          next.every((c, i) => c === cuts[i] || (i > 0 && i < cuts.length - 1))
        if (!valid) continue
        next.forEach((v, i) => { cuts[i] = v })
        break
      }
    }
  }
}

const clip = (ivs: [number, number][], lo: number, hi: number): [number, number][] =>
  ivs.map(([a, b]) => [Math.max(a, lo), Math.min(b, hi)] as [number, number]).filter(([a, b]) => b - a >= 1200)

const minus = (lo: number, hi: number, gap: [number, number] | null): [number, number][] =>
  !gap ? [[lo, hi]] : clip([[lo, gap[0]], [gap[1], hi]], lo, hi)

export type LayoutResult = {
  plates: FloorPlate[]
  rooms: LocalRoom[][]
  court: [number, number] | null
  notch: [number, number] | null
  uLines: number[]
  roofFreeRatio: number
}

/**
 * Place every floor on a chosen plate. Ground first (it fixes the court /
 * notch and the cross axes), then each upper floor on a u-extent that is a
 * ground cross axis — so every upper edge sits over a beam line below.
 */
export function placeFloors(input: LayoutInput, cand: PlateCandidate): LayoutResult {
  const { depthA: dA, depthB: dB, length: L } = cand
  const { family } = input
  const ground = input.floors[0]

  // ---- ground: bands, then court / notch placement ----
  const gapA0 = family === 'courtyard' ? courtFor(input.courtSqm, dA) : 0
  const split0 = balance(ground.units, dA, dB, L - gapA0, L)
  const bNeed = sum(split0.B.map((u) => unitLength(u, dB, 'target')))
  let notch: [number, number] | null = null
  if (family === 'l-shape' || (family === 'stepped' && !input.singleLoaded)) {
    const n = family === 'stepped' ? Math.min(1800, snap(L * 0.2)) : Math.min(notchFor(bNeed), snap(L * 0.4))
    notch = [L - n, L]
  }
  let court: [number, number] | null = null
  let aSegs: [number, number][] = [[0, L]]
  if (family === 'courtyard' && gapA0 > 0) {
    // lay band A out as one run, then open the court at the unit boundary
    // nearest the middle (never before the stair core)
    const trial = placeUnits(split0.A, [[0, L - gapA0]], dA, 'A').rooms
    const cuts: number[] = []
    let k = 0
    for (const u of split0.A) {
      k += u.rooms.length
      if (k < trial.length) cuts.push(trial[k].u0)
    }
    const minCut = split0.A[0]?.anchor ? trial[split0.A[0].rooms.length - 1].u1 : 0
    const mid = (L - gapA0) / 2
    const c0 = cuts.filter((c) => c >= minCut).sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid))[0]
    if (c0 !== undefined) {
      court = [c0, c0 + gapA0]
      aSegs = [[0, c0], [c0 + gapA0, L]]
    }
  }
  const bSegs = minus(0, L, notch)

  const floorRooms = (f: FloorRequirements, len: number, aS: [number, number][], bS: [number, number][], axes: number[] = []) => {
    const capA = sum(aS.map(([a, b]) => b - a))
    const capB = sum(bS.map(([a, b]) => b - a))
    const s = balance(f.units, dA, dB, capA, capB)
    const pa = placeUnits(s.A, aS, dA, 'A', axes)
    const pb = placeUnits(s.B, bS, dB, 'B', axes)
    // the spine runs only as far as the rooms it serves (every used segment
    // ends on a cross axis, so the spine end does too)
    const reach = Math.max(0, ...[...pa.used, ...pb.used].map(([, b]) => b))
    const spineLen = reach > 0 ? reach : len
    const spine: LocalRoom = { req: f.spine, band: 'S', u0: 0, u1: spineLen }
    return {
      rooms: [...pa.rooms, spine, ...pb.rooms],
      plate: { level: f.level, length: spineLen, segments: { A: pa.used, S: [[0, spineLen]], B: pb.used } } as FloorPlate,
      fitsTarget: s.A.length + s.B.length === f.units.length &&
        sum(s.A.map((u) => unitLength(u, dA, 'target'))) <= capA + 1 &&
        sum(s.B.map((u) => unitLength(u, dB, 'target'))) <= capB + 1,
      fitsMin: sum(s.A.map((u) => unitLength(u, dA, 'min'))) <= capA + 1 &&
        sum(s.B.map((u) => unitLength(u, dB, 'min'))) <= capB + 1,
    }
  }

  // axes fixed before any room is placed: the core end and the court / notch
  // edges — ground rooms slide their walls onto them just as upper rooms do
  const core = ground.units.find((u) => u.anchor && u.band === 'A')
  const coreLen = core && core.rooms.every((r) => r.fixedWidthMm) ? sum(core.rooms.map((r) => r.fixedWidthMm!)) : 0
  const g = floorRooms(ground, L, aSegs, bSegs, [...(input.lockedAxes ?? []), ...(court ?? []), ...(notch ? [notch[0]] : []), ...(coreLen ? [coreLen] : [])])
  const coreEnd = g.rooms.find((r) => r.req.kind === 'stair' || r.req.kind === 'lift')
  const uLines = input.lockedAxes?.length ? [...new Set([0, ...input.lockedAxes, L])].filter(u => u >= 0 && u <= L).sort((a, b) => a - b) : crossAxes(g.rooms, L, [
    0, L,
    ...Object.values(g.plate.segments).flat(2),
    ...(court ?? []), ...(notch ? [notch[0]] : []),
    ...(coreEnd ? [g.rooms.filter((r) => r.band === 'A' && (r.req.kind === 'stair' || r.req.kind === 'lift'))
      .reduce((a, r) => Math.max(a, r.u1), 0)] : []),
  ])

  const roofRatio = (r: ReturnType<typeof floorRooms>) => {
    const vs = { A: [0,dA], S: [dA,dA+cand.spine], B: [dA+cand.spine,dA+cand.spine+dB] }
    const slab = (['A','S','B'] as Band[]).flatMap(b => r.plate.segments[b].map(([a,c]) => ({ x:a,y:vs[b][0],w:c-a,h:vs[b][1]-vs[b][0] }))).filter(p=>p.w>0&&p.h>0)
    const st = r.rooms.find(x=>x.req.kind==='stair')
    const stair = st ? {rect:{x:st.u0,y:vs[st.band][0],w:st.u1-st.u0,h:vs[st.band][1]-vs[st.band][0]}} : undefined
    const outline = rectUnionBBox(slab)
    const service = roofServiceLayout({outline,footprint:slab,stair} as FloorPlan)
    return terraceFreeRatio({level:r.plate.level,slab,outline,...service,pergola:null})
  }

  const plates: FloorPlate[] = [g.plate]
  const rooms: LocalRoom[][] = [g.rooms]
  let prev = L
  for (const f of input.floors.slice(1)) {
    const at = (len: number) => floorRooms(f, len, clip(aSegs, 0, len), clip(bSegs, 0, len), uLines)
    let len = prev
    // upper floors step back to the shortest cross axis that holds their
    // programme; only the 'rectangular' family keeps a full-height stack
    if (family !== 'rectangular') {
      const lines = uLines.filter((u) => u >= 4800 && u <= prev)
      const fit = lines.find((u) => at(u).fitsTarget && roofRatio(at(u)) >= TERRACE_LIMITS.minFreeRatio + TERRACE_LIMITS.planningClearanceMargin) ?? lines.find((u) => at(u).fitsMin && roofRatio(at(u)) >= TERRACE_LIMITS.minFreeRatio + TERRACE_LIMITS.planningClearanceMargin)
      if (fit !== undefined) len = fit
    }
    const r = at(len)
    plates.push(r.plate)
    rooms.push(r.rooms)
    prev = r.plate.length
  }
  return { plates, rooms, court, notch, uLines, roofFreeRatio: roofRatio({plate:plates.at(-1)!,rooms:rooms.at(-1)!,fitsTarget:true,fitsMin:true}) }
}

const clearOfNarrow = (u: number, rooms: LocalRoom[]) =>
  !rooms.some((r) => r.band !== 'S' && r.u1 - r.u0 < NARROW && u > r.u0 + 1 && u < r.u1 - 1)

/** an intermediate axis between `cur` and `b` that does not run through a
 *  narrow room (bath / pooja / utility wall too short to share with a column) */
function freeAxis(cur: number, b: number, rooms: LocalRoom[]): number {
  const ideal = snap(cur + (b - cur) / Math.ceil((b - cur) / MAX_SPAN))
  const lo = cur + MIN_SPAN
  const hi = Math.min(cur + MAX_SPAN, b - MIN_SPAN)
  const clear = (u: number) => clearOfNarrow(u, rooms)
  for (let d = 0; d <= 2000; d += 100) {
    for (const u of [ideal - d, ideal + d]) if (u >= lo && u <= hi && clear(u)) return u
  }
  return ideal
}

/** StructuralGrid cross axes: every plate edge / court edge / core edge is an
 *  axis; long runs are subdivided, preferring existing partition walls, so no
 *  span exceeds MAX_SPAN. */
export function crossAxes(groundRooms: LocalRoom[], L: number, required: number[]): number[] {
  const req = [...new Set(required.map(snap))].filter((u) => u >= 0 && u <= L).sort((a, b) => a - b)
  // a partition in one band is only a good axis if it does not split a
  // narrow room in the other band
  const cand = [...new Set(groundRooms.filter((r) => r.band !== 'S').flatMap((r) => [r.u0, r.u1]))]
    .filter((c) => c > 0 && c < L && clearOfNarrow(c, groundRooms)).sort((a, b) => a - b)
  const lines = [req[0]]
  for (let i = 0; i < req.length - 1; i++) {
    const b = req[i + 1]
    let cur = req[i]
    while (b - cur > MAX_SPAN) {
      const opts = cand.filter((c) => c >= cur + MIN_SPAN && c <= cur + MAX_SPAN && b - c >= MIN_SPAN)
      const c = opts.length ? opts[opts.length - 1] : freeAxis(cur, b, groundRooms)
      lines.push(c)
      cur = c
    }
    lines.push(b)
  }
  return [...new Set(lines)].sort((a, b) => a - b)
}
