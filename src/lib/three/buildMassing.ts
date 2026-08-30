import type { Design, FloorPlan, Opening } from '../engine/types.ts'
import type { Rect } from '../geometry.ts'

/* ------------------------------------------------------------------ *
 *  buildMassing — an architect's white-card study model of the house.
 *
 *  Each storey's four facades are one continuous solid plane, segmented
 *  into pier / spandrel / header pieces around every opening (all the
 *  same `wall` kind, so they merge and never z-fight), with a single
 *  dark pane recessed behind the void. Floor slabs are inset behind the
 *  wall face and below finished-floor, so they only read when exploded.
 *  Roof = a deck flush with top-of-wall + a low mitred kerb parapet.
 *  Plinth meets FFL with no gap. Carport / porch / balcony are single
 *  coherent structures. Everything is a pure function of the Design.
 * ------------------------------------------------------------------ */

export type MassKind =
  | 'plinth'
  | 'slab'
  | 'wall'
  | 'partition'
  | 'glass'
  | 'stair'
  | 'roof'
  | 'parapet'
  | 'column'
  | 'canopy'
  | 'railing'

export type MassBox = {
  id: string
  kind: MassKind
  /** world-space centre, metres */
  pos: [number, number, number]
  /** full extents, metres */
  size: [number, number, number]
  level: number
}

export type Massing = {
  boxes: MassBox[]
  floors: { level: number; baseY: number }[]
  bounds: { w: number; d: number }
  center: [number, number, number]
  floorHeight: number
  stats: { storeys: number; heightM: number; builtAreaSqm: number; openings: number }
}

/* ---- dimensions, metres --------------------------------------------------- */
const EXT_T = 0.24 // exterior wall thickness
const INT_T = 0.11 // interior partition thickness
const SLAB_T = 0.22 // inset floor plate
const PLINTH_H = 0.4 // base-course height above grade
const PLINTH_PROJ = 0.16 // base-course projection past the wall face
const ROOF_T = 0.22 // roof / terrace deck
const PARAPET_H = 0.5 // low kerb parapet
const PARAPET_T = 0.12
const KERB_H = 0.38 // terrace upstand
const RECESS = 0.1 // pane reveal depth behind the outer facade
const PANE_T = 0.06
const PANE_SHRINK = 0.006 // pane a hair smaller than the void — avoids an exact coincident plane
const CANOPY_TOP = 2.75 // carport canopy top, metres above FFL
const CANOPY_T = 0.26
const COL = 0.3 // square column
const HT_MM = (EXT_T * 1000) / 2 // exterior half-thickness, mm

const BAND: Record<Opening['kind'], { sill: number; head: number }> = {
  window: { sill: 0.9, head: 2.15 },
  door: { sill: 0, head: 2.1 },
  entry: { sill: 0, head: 2.45 },
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

type Vec3 = [number, number, number]
type Push = (id: string, kind: MassKind, level: number, pos: Vec3, size: Vec3) => void
type XF = (mm: number) => number
type Side = 'N' | 'S' | 'E' | 'W'
type FaceOp = { at: number; width: number; sill: number; head: number }

export function buildMassing(design: Design): Massing {
  const { model } = design
  const plotW = model.plot.width
  const plotD = model.plot.depth
  const H = model.brief.levels.floorToFloor
  const y0 = PLINTH_H

  const wx: XF = (mm) => (mm - plotW / 2) / 1000
  const wz: XF = (mm) => (mm - plotD / 2) / 1000
  const m: XF = (mm) => mm / 1000

  const boxes: MassBox[] = []
  const push: Push = (id, kind, level, pos, size) => {
    if (size[0] > 0.02 && size[1] > 0.02 && size[2] > 0.02) boxes.push({ id, kind, pos, size, level })
  }

  const floors = [...design.floors].sort((a, b) => a.level - b.level)
  const topLevel = floors[floors.length - 1].level
  const g = floors[0].outline

  // ---- plinth: top == finished floor, projects as a base course ----
  push(
    'plinth',
    'plinth',
    0,
    [wx(g.x + g.w / 2), PLINTH_H / 2, wz(g.y + g.h / 2)],
    [m(g.w) + EXT_T + 2 * PLINTH_PROJ, PLINTH_H, m(g.h) + EXT_T + 2 * PLINTH_PROJ],
  )

  for (const floor of floors) {
    const L = floor.level
    const baseY = y0 + L * H
    const wallTop = baseY + H
    const o = floor.outline
    const ox0 = o.x
    const ox1 = o.x + o.w
    const oy0 = o.y
    const oy1 = o.y + o.h
    const midX = wx(o.x + o.w / 2)
    const midZ = wz(o.y + o.h / 2)

    // ---- inset floor plate — hidden assembled, reads the storey when exploded ----
    push(
      `slab-${L}`,
      'slab',
      L,
      [midX, baseY - SLAB_T / 2, midZ],
      [Math.max(m(o.w) - 2 * EXT_T, 0.4), SLAB_T, Math.max(m(o.h) - 2 * EXT_T, 0.4)],
    )

    // ---- classify openings onto the four facades; the rest are interior ----
    const face: Record<Side, FaceOp[]> = { N: [], S: [], E: [], W: [] }
    const interiorOps: Opening[] = []
    const TOL = 450
    for (const op of floor.openings) {
      const band = BAND[op.kind]
      const rec = { width: op.width, sill: band.sill, head: band.head }
      let placed = false
      if (op.orient === 'h') {
        if (Math.abs(op.at.y - oy0) < TOL) {
          face.N.push({ at: op.at.x, ...rec })
          placed = true
        } else if (Math.abs(op.at.y - oy1) < TOL) {
          face.S.push({ at: op.at.x, ...rec })
          placed = true
        }
      } else if (Math.abs(op.at.x - ox0) < TOL) {
        face.W.push({ at: op.at.y, ...rec })
        placed = true
      } else if (Math.abs(op.at.x - ox1) < TOL) {
        face.E.push({ at: op.at.y, ...rec })
        placed = true
      }
      if (!placed) interiorOps.push(op)
    }

    // ---- one segmented solid plane per facade; E/W full depth, N/S tucked between ----
    addWall('W', oy0, oy1, ox0, baseY, wallTop, face.W, L, `w${L}W`, push, wx, wz, m)
    addWall('E', oy0, oy1, ox1, baseY, wallTop, face.E, L, `w${L}E`, push, wx, wz, m)
    addWall('N', ox0 + HT_MM, ox1 - HT_MM, oy0, baseY, wallTop, face.N, L, `w${L}N`, push, wx, wz, m)
    addWall('S', ox0 + HT_MM, ox1 - HT_MM, oy1, baseY, wallTop, face.S, L, `w${L}S`, push, wx, wz, m)

    // ---- interior partitions — own group, hidden until exploded ----
    for (let i = 0; i < floor.walls.length; i++) {
      const w = floor.walls[i]
      if (w.kind !== 'interior') continue
      segmentPartition(w, interiorOps, baseY, H, L, `p${L}-${i}`, push, wx, wz, m)
    }

    // ---- roof on top, deliberate terrace where a lower floor steps out ----
    if (L === topLevel) {
      buildRoof(o, wallTop, L, push, wx, wz, m)
    } else {
      const up = floors.find((f) => f.level === L + 1)
      if (up) buildTerrace(o, up.outline, wallTop, L, push, wx, wz, m)
    }

    // ---- outdoor rooms ----
    const covers = floor.rooms.filter((r) => r.outdoor && !r.id.startsWith('balcony'))
    for (const r of floor.rooms) {
      if (r.outdoor && r.id.startsWith('balcony')) buildBalcony(r.rect, baseY, L, push, wx, wz, m)
    }
    // one combined canopy over all covered outdoor bays
    if (covers.length > 0) {
      const cov = covers.reduce(
        (acc, r) => ({
          x: Math.min(acc.x, r.rect.x),
          y: Math.min(acc.y, r.rect.y),
          x1: Math.max(acc.x1, r.rect.x + r.rect.w),
          y1: Math.max(acc.y1, r.rect.y + r.rect.h),
        }),
        { x: Infinity, y: Infinity, x1: -Infinity, y1: -Infinity },
      )
      buildCarport(
        { x: cov.x, y: cov.y, w: cov.x1 - cov.x, h: cov.y1 - cov.y },
        g,
        y0,
        L,
        'cover',
        push,
        wx,
        wz,
        m,
      )
    }

    // ---- entry porch — only if a verandah/carport isn't already sheltering the door ----
    if (L === 0) {
      const entry = floor.openings.find((op) => op.kind === 'entry')
      const sheltered =
        entry &&
        covers.some(
          (c) =>
            entry.at.x > c.rect.x - 600 &&
            entry.at.x < c.rect.x + c.rect.w + 600 &&
            entry.at.y > c.rect.y - 900 &&
            entry.at.y < c.rect.y + c.rect.h + 900,
        )
      if (entry && !sheltered) buildPorch(entry, o, y0, H, push, wx, wz, m)
    }

    // ---- stair ----
    if (floor.stair) {
      for (const s of buildStair(floor.stair.rect, H)) {
        push(`stair-${L}-${s.tag}`, 'stair', L, [wx(s.x), baseY + s.y, wz(s.z)], s.size)
      }
    }
  }

  const storeys = floors.length
  return {
    boxes,
    floors: floors.map((f) => ({ level: f.level, baseY: y0 + f.level * H })),
    bounds: { w: plotW / 1000, d: plotD / 1000 },
    center: [wx(g.x + g.w / 2), y0 + (storeys * H) / 2, wz(g.y + g.h / 2)],
    floorHeight: H,
    stats: {
      storeys,
      heightM: design.heightM,
      builtAreaSqm: design.builtAreaSqm,
      openings: design.openingCounts.doors + design.openingCounts.windows,
    },
  }
}

/* ------------------------------ facade segmentation ------------------------------ */

function addWall(
  side: Side,
  a0: number,
  a1: number,
  fixed: number,
  baseY: number,
  wallTop: number,
  ops: FaceOp[],
  level: number,
  tag: string,
  push: Push,
  wx: XF,
  wz: XF,
  m: XF,
) {
  const horizontal = side === 'N' || side === 'S'
  const outward = side === 'S' || side === 'E' ? 1 : -1
  if (a1 - a0 < 120) return

  const solid = (from: number, to: number, yb: number, yt: number, sub: string) => {
    const len = m(to - from)
    const h = yt - yb
    if (len <= 0.04 || h <= 0.04) return
    const mid = (from + to) / 2
    const px = horizontal ? wx(mid) : wx(fixed)
    const pz = horizontal ? wz(fixed) : wz(mid)
    push(
      `${tag}-${sub}`,
      'wall',
      level,
      [px, (yb + yt) / 2, pz],
      horizontal ? [len, h, EXT_T] : [EXT_T, h, len],
    )
  }

  const clean = ops
    .map((o) => ({ s: o.at - o.width / 2, e: o.at + o.width / 2, sill: o.sill, head: o.head }))
    .filter((o) => o.e > a0 + 150 && o.s < a1 - 150)
    .sort((p, q) => p.s - q.s)

  let cursor = a0
  clean.forEach((o, i) => {
    const s = clamp(o.s, a0 + 120, a1 - 420)
    const e = clamp(o.e, s + 300, a1 - 120)
    if (e - s < 350 || s < cursor + 60) return
    const sillY = baseY + o.sill
    const headY = Math.min(baseY + o.head, wallTop - 0.08)
    solid(cursor, s, baseY, wallTop, `p${i}`) // pier
    if (sillY - baseY > 0.08) solid(s, e, baseY, sillY, `sp${i}`) // spandrel under a window
    if (wallTop - headY > 0.08) solid(s, e, headY, wallTop, `hd${i}`) // header

    // one recessed dark pane, smaller than the void on every edge
    const paneFixed = fixed + outward * (HT_MM - (RECESS + PANE_T / 2) * 1000)
    const pl = m(e - s) - 2 * PANE_SHRINK
    const ph = headY - sillY - 2 * PANE_SHRINK
    if (pl > 0.1 && ph > 0.1) {
      const pmid = (s + e) / 2
      const ppx = horizontal ? wx(pmid) : wx(paneFixed)
      const ppz = horizontal ? wz(paneFixed) : wz(pmid)
      push(
        `${tag}-gl${i}`,
        'glass',
        level,
        [ppx, (sillY + headY) / 2, ppz],
        horizontal ? [pl, ph, PANE_T] : [PANE_T, ph, pl],
      )
    }
    cursor = e
  })
  solid(cursor, a1, baseY, wallTop, 'pE')
}

/** interior wall as a `partition` box, cut around any interior doorway on its line */
function segmentPartition(
  w: FloorPlan['walls'][number],
  doors: Opening[],
  baseY: number,
  H: number,
  level: number,
  tag: string,
  push: Push,
  wx: XF,
  wz: XF,
  m: XF,
) {
  const horizontal = Math.abs(w.b.x - w.a.x) >= Math.abs(w.b.y - w.a.y)
  const p0 = horizontal ? Math.min(w.a.x, w.b.x) : Math.min(w.a.y, w.b.y)
  const p1 = horizontal ? Math.max(w.a.x, w.b.x) : Math.max(w.a.y, w.b.y)
  const fixed = horizontal ? w.a.y : w.a.x
  if (p1 - p0 < 250) return
  const t = w.thickness ? m(w.thickness) : INT_T
  const top = H - SLAB_T - 0.02

  const gaps = doors
    .filter((d) => (d.orient === 'h') === horizontal)
    .filter((d) => Math.abs((horizontal ? d.at.y : d.at.x) - fixed) < 220)
    .map((d) => {
      const c = horizontal ? d.at.x : d.at.y
      return { s: c - d.width / 2, e: c + d.width / 2 }
    })
    .filter((d) => d.e > p0 && d.s < p1)
    .sort((a, b) => a.s - b.s)

  const seg = (from: number, to: number, sub: string) => {
    if (to - from < 120) return
    const mid = (from + to) / 2
    const len = m(to - from)
    push(
      `${tag}-${sub}`,
      'partition',
      level,
      [wx(horizontal ? mid : fixed), baseY + top / 2, wz(horizontal ? fixed : mid)],
      horizontal ? [len, top, t] : [t, top, len],
    )
  }

  let cur = p0
  gaps.forEach((d, i) => {
    seg(cur, Math.max(cur, d.s), `s${i}`)
    cur = Math.max(cur, d.e)
  })
  seg(cur, p1, 'sE')
}

/* --------------------------------- roof / terrace -------------------------------- */

function buildRoof(o: Rect, wallTop: number, L: number, push: Push, wx: XF, wz: XF, m: XF) {
  const cxw = wx(o.x + o.w / 2)
  const czw = wz(o.y + o.h / 2)
  const rw = m(o.w) + EXT_T
  const rd = m(o.h) + EXT_T

  push(`roof-${L}`, 'roof', L, [cxw, wallTop - ROOF_T / 2, czw], [rw, ROOF_T, rd])

  const pcy = wallTop + PARAPET_H / 2
  const nz = wz(o.y) - EXT_T / 2 + PARAPET_T / 2
  const sz = wz(o.y + o.h) + EXT_T / 2 - PARAPET_T / 2
  const wxc = wx(o.x) - EXT_T / 2 + PARAPET_T / 2
  const exc = wx(o.x + o.w) + EXT_T / 2 - PARAPET_T / 2
  const vLen = Math.max(rd - 2 * PARAPET_T, 0.2)
  push(`par-${L}-n`, 'parapet', L, [cxw, pcy, nz], [rw, PARAPET_H, PARAPET_T])
  push(`par-${L}-s`, 'parapet', L, [cxw, pcy, sz], [rw, PARAPET_H, PARAPET_T])
  push(`par-${L}-w`, 'parapet', L, [wxc, pcy, czw], [PARAPET_T, PARAPET_H, vLen])
  push(`par-${L}-e`, 'parapet', L, [exc, pcy, czw], [PARAPET_T, PARAPET_H, vLen])
}

function buildTerrace(
  o: Rect,
  up: Rect,
  wallTop: number,
  L: number,
  push: Push,
  wx: XF,
  wz: XF,
  m: XF,
) {
  const exN = up.y - o.y > 400
  const exS = o.y + o.h - (up.y + up.h) > 400
  const exW = up.x - o.x > 400
  const exE = o.x + o.w - (up.x + up.w) > 400
  if (!exN && !exS && !exW && !exE) return

  const cxw = wx(o.x + o.w / 2)
  const czw = wz(o.y + o.h / 2)
  const rw = m(o.w) + EXT_T
  const rd = m(o.h) + EXT_T
  push(`terr-${L}`, 'roof', L, [cxw, wallTop - ROOF_T / 2, czw], [rw, ROOF_T, rd])

  const kcy = wallTop + KERB_H / 2
  if (exN)
    push(`kerb-${L}-n`, 'parapet', L, [cxw, kcy, wz(o.y) - EXT_T / 2 + PARAPET_T / 2], [rw, KERB_H, PARAPET_T])
  if (exS)
    push(
      `kerb-${L}-s`,
      'parapet',
      L,
      [cxw, kcy, wz(o.y + o.h) + EXT_T / 2 - PARAPET_T / 2],
      [rw, KERB_H, PARAPET_T],
    )
  if (exW)
    push(`kerb-${L}-w`, 'parapet', L, [wx(o.x) - EXT_T / 2 + PARAPET_T / 2, kcy, czw], [PARAPET_T, KERB_H, rd])
  if (exE)
    push(
      `kerb-${L}-e`,
      'parapet',
      L,
      [wx(o.x + o.w) + EXT_T / 2 - PARAPET_T / 2, kcy, czw],
      [PARAPET_T, KERB_H, rd],
    )
}

/* --------------------------------- carport / porch ------------------------------- */

function buildCarport(
  rect: Rect,
  ground: Rect,
  y0: number,
  L: number,
  id: string,
  push: Push,
  wx: XF,
  wz: XF,
  m: XF,
) {
  const houseS = ground.y + ground.h
  const cN = rect.y > houseS - 800 ? houseS + 120 : rect.y
  const cS = rect.y + rect.h
  const cW = rect.x
  const cE = rect.x + rect.w
  if (cS - cN < 1600 || cE - cW < 1600) return

  const cxm = wx((cW + cE) / 2)
  const czm = wz((cN + cS) / 2)
  const wM = m(cE - cW)
  const dM = m(cS - cN)
  const topY = y0 + CANOPY_TOP

  push(`can-${L}-${id}`, 'canopy', L, [cxm, topY - CANOPY_T / 2, czm], [wM + 0.25, CANOPY_T, dM + 0.25])
  push(`cpad-${L}-${id}`, 'slab', L, [cxm, y0 - 0.05, czm], [wM, 0.1, dM])

  const colH = CANOPY_TOP - CANOPY_T
  const ins = COL / 2 + 0.14
  const xL = wx(cW) + ins
  const xR = wx(cE) - ins
  const zS = wz(cS) - ins
  const zN = wz(cN) + ins
  const zMid = (wz(cN) + wz(cS)) / 2
  const houseZ = wz(houseS)
  const col = (x: number, z: number, k: string) => {
    if (Math.abs(z - houseZ) < 0.9) return // the house wall carries this edge
    push(`col-${L}-${id}-${k}`, 'column', L, [x, y0 + colH / 2, z], [COL, colH, COL])
  }
  col(xL, zS, 'sw')
  col(xR, zS, 'se')
  col(xL, zN, 'nw')
  col(xR, zN, 'ne')
  if (dM > 5.2) {
    col(xL, zMid, 'mw')
    col(xR, zMid, 'me')
  }
  if (wM > 6.4) col((xL + xR) / 2, zS, 'sm')
}

function buildBalcony(rect: Rect, baseY: number, L: number, push: Push, wx: XF, wz: XF, m: XF) {
  const depth = Math.max(rect.h, 1300)
  const bN = rect.y - 150 // tuck under the facade so it connects
  const bS = rect.y + depth
  const bW = rect.x
  const bE = rect.x + rect.w
  if (bE - bW < 1200) return
  const cxw = wx((bW + bE) / 2)

  // projecting slab, top a step above the finished floor so it clearly reads
  push(`balc-${L}`, 'slab', L, [cxw, baseY - 0.11, wz((bN + bS) / 2)], [m(bE - bW), 0.26, m(bS - bN)])

  const rh = 0.95
  const ry = baseY + rh / 2
  const midZ = wz((rect.y + bS) / 2)
  push(`balr-${L}-s`, 'railing', L, [cxw, ry, wz(bS)], [m(bE - bW) + 0.14, rh, 0.14])
  push(`balr-${L}-w`, 'railing', L, [wx(bW), ry, midZ], [0.14, rh, m(bS - rect.y)])
  push(`balr-${L}-e`, 'railing', L, [wx(bE), ry, midZ], [0.14, rh, m(bS - rect.y)])
}

function buildPorch(entry: Opening, o: Rect, y0: number, H: number, push: Push, wx: XF, wz: XF, m: XF) {
  const wmv = m(entry.width) + 0.6
  const porchY = y0 + Math.min(BAND.entry.head + 0.3, H - 0.15)
  if (entry.orient === 'h') {
    const onNorth = Math.abs(entry.at.y - o.y) < Math.abs(entry.at.y - (o.y + o.h))
    const sgn = onNorth ? -1 : 1
    push('estep', 'plinth', 0, [wx(entry.at.x), y0 - 0.05, wz(entry.at.y + sgn * 650)], [wmv, 0.16, 1.1])
    push('eporch', 'canopy', 0, [wx(entry.at.x), porchY - 0.09, wz(entry.at.y + sgn * 720)], [wmv + 0.4, 0.18, 1.75])
  } else {
    const onWest = Math.abs(entry.at.x - o.x) < Math.abs(entry.at.x - (o.x + o.w))
    const sgn = onWest ? -1 : 1
    push('estep', 'plinth', 0, [wx(entry.at.x + sgn * 650), y0 - 0.05, wz(entry.at.y)], [1.1, 0.16, wmv])
    push('eporch', 'canopy', 0, [wx(entry.at.x + sgn * 720), porchY - 0.09, wz(entry.at.y)], [1.75, 0.18, wmv + 0.4])
  }
}

/* ----------------------------------- stair ----------------------------------- */

/** dog-leg stair: two flights of tread boxes + a mid landing.
 *  x/z in plan-millimetres; y and size in metres, y relative to the storey base. */
function buildStair(rect: Rect, H: number) {
  const risers = Math.max(14, Math.round((H * 1000) / 172))
  const perFlight = Math.ceil(risers / 2)
  const flightWmm = Math.max((rect.w - 120) / 2, 300)
  const flightW = flightWmm / 1000
  const runMm = rect.h * 0.84
  const goingMm = runMm / perFlight
  const going = goingMm / 1000
  const rise = H / risers
  const out: { tag: string; x: number; y: number; z: number; size: Vec3 }[] = []

  for (let i = 0; i < perFlight; i++) {
    const h = (i + 0.5) * rise
    out.push({
      tag: `a${i}`,
      x: rect.x + 60 + flightWmm / 2,
      y: h,
      z: rect.y + goingMm * (i + 0.5),
      size: [flightW, Math.max(rise, 0.05), Math.max(going * 1.02, 0.05)],
    })
    out.push({
      tag: `b${i}`,
      x: rect.x + 60 + flightWmm + 120 + flightWmm / 2,
      y: H - h,
      z: rect.y + runMm - goingMm * (i + 0.5),
      size: [flightW, Math.max(rise, 0.05), Math.max(going * 1.02, 0.05)],
    })
  }
  out.push({
    tag: 'land',
    x: rect.x + rect.w / 2,
    y: H / 2 - 0.09,
    z: rect.y + runMm + Math.max(rect.h - runMm, 200) / 2,
    size: [Math.max(rect.w / 1000, 0.4), 0.18, Math.max((rect.h - runMm) / 1000, 0.2)],
  })
  return out
}
