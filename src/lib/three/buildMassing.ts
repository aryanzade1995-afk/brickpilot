import type { Design, FloorPlan, Opening } from '../engine/types.ts'
import type { Rect } from '../geometry.ts'
import type { CanonicalModel } from '../model/canonical.ts'
import { themeOf, type ThemeDef } from '../model/themes.ts'

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
  | 'clad'
  | 'feature'
  | 'lawn'
  | 'paving'
  | 'planter'
  | 'hedge'
  | 'fence'

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
  footprint: { w: number; d: number }
  center: [number, number, number]
  floorHeight: number
  stats: { storeys: number; heightM: number; builtAreaSqm: number; openings: number }
}

/* ---- dimensions, metres --------------------------------------------------- */
const EXT_T = 0.24 // exterior wall thickness
const INT_T = 0.11 // interior partition thickness
const SLAB_T = 0.22 // inset floor plate
const PLINTH_H = 0.4 // base-course height above grade
const ROOF_T = 0.22 // terrace deck
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
  window: { sill: 0.85, head: 2.2 },
  door: { sill: 0, head: 2.3 },
  entry: { sill: 0, head: 2.5 },
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** deterministic PRNG seeded from the design seed string */
function seededRng(seed: string): () => number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return () => {
    h = (h + 0x6d2b79f5) | 0
    let t = Math.imul(h ^ (h >>> 15), 1 | h)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Vec3 = [number, number, number]
type Push = (id: string, kind: MassKind, level: number, pos: Vec3, size: Vec3) => void
type XF = (mm: number) => number
type Side = 'N' | 'S' | 'E' | 'W'
type FaceOp = { at: number; width: number; sill: number; head: number }

export function buildMassing(design: Design): Massing {
  const { model } = design
  const T = themeOf(model.brief)
  const plotW = model.plot.width
  const plotD = model.plot.depth
  const H = model.brief.levels.floorToFloor
  const y0 = PLINTH_H
  const plinthProj = T.massing.plinthProjMm / 1000
  const winBand = { sill: T.windows.sillMm / 1000, head: T.windows.headMm / 1000 }

  const wx: XF = (mm) => (mm - plotW / 2) / 1000
  const wz: XF = (mm) => (mm - plotD / 2) / 1000
  const m: XF = (mm) => mm / 1000

  const boxes: MassBox[] = []
  const push: Push = (id, kind, level, pos, size) => {
    if (size[0] > 0.02 && size[1] > 0.02 && size[2] > 0.02)
      boxes.push({ id, kind, pos, size, level })
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
    [m(g.w) + EXT_T + 2 * plinthProj, PLINTH_H, m(g.h) + EXT_T + 2 * plinthProj],
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
      const band = op.kind === 'window' ? winBand : BAND[op.kind]
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
    const gm = T.windows.groupMm
    addWall('W', oy0, oy1, ox0, baseY, wallTop, face.W, L, gm, `w${L}W`, push, wx, wz, m)
    addWall('E', oy0, oy1, ox1, baseY, wallTop, face.E, L, gm, `w${L}E`, push, wx, wz, m)
    addWall('N', ox0 + HT_MM, ox1 - HT_MM, oy0, baseY, wallTop, face.N, L, gm, `w${L}N`, push, wx, wz, m)
    addWall('S', ox0 + HT_MM, ox1 - HT_MM, oy1, baseY, wallTop, face.S, L, gm, `w${L}S`, push, wx, wz, m)

    // ---- interior partitions — own group, hidden until exploded ----
    for (let i = 0; i < floor.walls.length; i++) {
      const w = floor.walls[i]
      if (w.kind !== 'interior') continue
      segmentPartition(w, interiorOps, baseY, H, L, `p${L}-${i}`, push, wx, wz, m)
    }

    // ---- timber cladding strip on the entry (plan-south) facade ----
    if (T.accents.cladFacade) {
      buildCladding(o, face.S, baseY, wallTop, L, T.accents.cladWidthMm, push, wx, wz, m)
    }

    // ---- roof on top, deliberate terrace where a lower floor steps out ----
    if (L === topLevel) {
      buildRoof(o, wallTop, L, T, push, wx, wz, m)
    } else {
      const up = floors.find((f) => f.level === L + 1)
      if (up) buildTerrace(o, up.outline, wallTop, L, push, wx, wz, m)
    }

    // ---- outdoor rooms ----
    const covers = floor.rooms.filter((r) => r.outdoor && !r.id.startsWith('balcony'))
    for (const r of floor.rooms) {
      if (r.outdoor && r.id.startsWith('balcony'))
        buildBalcony(
          r.rect,
          baseY,
          L,
          T.massing.balconyDepthMm / 1000,
          T.accents.railStyle,
          push,
          wx,
          wz,
          m,
        )
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

    // ---- flat-roof entry porch over the door ----
    if (L === 0) {
      const entry = floor.openings.find((op) => op.kind === 'entry')
      if (entry) buildPorch(entry, o, y0, H, push, wx, wz, m)
    }

    // ---- stair — only the flights that actually go up to a floor above ----
    if (floor.stair && L < topLevel) {
      for (const s of buildStair(floor.stair.rect, H)) {
        push(`stair-${L}-${s.tag}`, 'stair', L, [wx(s.x), baseY + s.y, wz(s.z)], s.size)
      }
    }

    // ---- terrace garden on the flat roof where a lower floor steps out ----
    if (T.landscape.terraceGarden && L < topLevel) {
      const up = floors.find((f) => f.level === L + 1)
      if (up) buildTerraceGarden(o, up.outline, wallTop, L, push, wx, wz, m)
    }
  }

  // ---- dark riven-stone feature pier running the full height of the front ----
  if (T.accents.featureColumn) {
    const entry = floors[0].openings.find((op) => op.kind === 'entry')
    if (entry) {
      const total = floors.length * H + 0.25
      const w = 620
      // toward the near end of the entry facade, clear of the door
      const toLeft = entry.at.x > g.x + g.w / 2
      const x = toLeft ? g.x + 700 : g.x + g.w - 700
      push(
        'feat-pier',
        'feature',
        0,
        [wx(x), y0 + total / 2 - 0.1, wz(g.y + g.h) + EXT_T / 2 + 0.09],
        [m(w), total, 0.22],
      )
    }
  }

  buildLandscape(model, floors[0], T, push, wx, wz, m)

  const storeys = floors.length
  return {
    boxes,
    floors: floors.map((f) => ({ level: f.level, baseY: y0 + f.level * H })),
    bounds: { w: plotW / 1000, d: plotD / 1000 },
    /** ground-storey building extent (metres) — for framing the camera */
    footprint: { w: g.w / 1000, d: g.h / 1000 },
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
  groupMm: number,
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

      // teak frame at the wall face + vertical mullions on wide (grouped) panes
      const isWindow = o.head - o.sill < 2.0 // doors/entry keep an open reveal
      if (isWindow) {
        const fr = 0.08 // frame member size
        const ff = fixed + outward * (HT_MM - fr * 500) // sits in the reveal, flush-ish
        const along = (from: number, to: number, yb: number, yt: number, thin: boolean, sub: string) => {
          const len = m(to - from)
          const hh = yt - yb
          if (len < 0.03 || hh < 0.03) return
          const mid = (from + to) / 2
          const px = horizontal ? wx(mid) : wx(ff)
          const pz = horizontal ? wz(ff) : wz(mid)
          push(
            `${tag}-fr${i}${sub}`,
            'clad',
            level,
            [px, (yb + yt) / 2, pz],
            horizontal ? [len, hh, thin ? fr : fr] : [thin ? fr : fr, hh, len],
          )
        }
        along(s, e, sillY, sillY + fr, false, 'b')
        along(s, e, headY - fr, headY, false, 't')
        along(s, s + Math.round(fr * 1000), sillY, headY, true, 'l')
        along(e - Math.round(fr * 1000), e, sillY, headY, true, 'r')
        const bays = Math.max(1, Math.round((e - s) / groupMm))
        for (let k = 1; k < bays; k++) {
          const c = s + ((e - s) * k) / bays
          along(c - Math.round(fr * 500), c + Math.round(fr * 500), sillY, headY, true, `m${k}`)
        }
      }
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

function buildRoof(o: Rect, wallTop: number, L: number, T: ThemeDef, push: Push, wx: XF, wz: XF, m: XF) {
  const cxw = wx(o.x + o.w / 2)
  const czw = wz(o.y + o.h / 2)
  const roofT = T.roof.thickMm / 1000
  const eave = T.roof.eaveMm / 1000
  const wallW = m(o.w) + EXT_T
  const wallD = m(o.h) + EXT_T
  const rw = wallW + 2 * eave
  const rd = wallD + 2 * eave

  // thin roof deck flush with top-of-wall (+ any eave oversail)
  push(`roof-${L}`, 'roof', L, [cxw, wallTop - roofT / 2, czw], [rw, roofT, rd])

  // ---- flat-band: the signature bold white fascia beam wrapping the slab ----
  if (T.roof.style === 'flat-band') {
    const band = T.roof.bandMm / 1000
    const t = 0.14 // fascia beam thickness (how proud it sits)
    // the band centres on the slab edge, projecting past the wall face
    const by = wallTop - roofT / 2 // vertical centre — straddles the deck
    const nz = wz(o.y) - EXT_T / 2 - eave + t / 2
    const sz = wz(o.y + o.h) + EXT_T / 2 + eave - t / 2
    const wxc = wx(o.x) - EXT_T / 2 - eave + t / 2
    const exc = wx(o.x + o.w) + EXT_T / 2 + eave - t / 2
    push(`band-${L}-n`, 'roof', L, [cxw, by, nz], [rw, band, t])
    push(`band-${L}-s`, 'roof', L, [cxw, by, sz], [rw, band, t])
    push(`band-${L}-w`, 'roof', L, [wxc, by, czw], [t, band, rd])
    push(`band-${L}-e`, 'roof', L, [exc, by, czw], [t, band, rd])
    // a slim upstand lip on the outer top edge
    const ly = by + band / 2 + 0.05
    push(`lip-${L}-n`, 'roof', L, [cxw, ly, nz], [rw + 0.04, 0.1, t + 0.04])
    push(`lip-${L}-s`, 'roof', L, [cxw, ly, sz], [rw + 0.04, 0.1, t + 0.04])
    push(`lip-${L}-w`, 'roof', L, [wxc, ly, czw], [t + 0.04, 0.1, rd + 0.04])
    push(`lip-${L}-e`, 'roof', L, [exc, ly, czw], [t + 0.04, 0.1, rd + 0.04])
    return
  }

  if (T.roof.style === 'flat-eave') {
    const fh = 0.16
    const fy = wallTop - roofT - fh / 2
    push(`fas-${L}-n`, 'roof', L, [cxw, fy, wz(o.y) - EXT_T / 2 - eave + PARAPET_T / 2], [rw, fh, PARAPET_T])
    push(`fas-${L}-s`, 'roof', L, [cxw, fy, wz(o.y + o.h) + EXT_T / 2 + eave - PARAPET_T / 2], [rw, fh, PARAPET_T])
    push(`fas-${L}-w`, 'roof', L, [wx(o.x) - EXT_T / 2 - eave + PARAPET_T / 2, fy, czw], [PARAPET_T, fh, rd])
    push(`fas-${L}-e`, 'roof', L, [wx(o.x + o.w) + EXT_T / 2 + eave - PARAPET_T / 2, fy, czw], [PARAPET_T, fh, rd])
  }

  const parH = T.roof.parapetMm / 1000
  if (parH < 0.05) return
  const pcy = wallTop + parH / 2
  const vLen = Math.max(wallD - 2 * PARAPET_T, 0.2)
  push(`par-${L}-n`, 'parapet', L, [cxw, pcy, wz(o.y) - EXT_T / 2 + PARAPET_T / 2], [wallW, parH, PARAPET_T])
  push(`par-${L}-s`, 'parapet', L, [cxw, pcy, wz(o.y + o.h) + EXT_T / 2 - PARAPET_T / 2], [wallW, parH, PARAPET_T])
  push(`par-${L}-w`, 'parapet', L, [wx(o.x) - EXT_T / 2 + PARAPET_T / 2, pcy, czw], [PARAPET_T, parH, vLen])
  push(`par-${L}-e`, 'parapet', L, [wx(o.x + o.w) + EXT_T / 2 - PARAPET_T / 2, pcy, czw], [PARAPET_T, parH, vLen])
}

/** a vertical timber-batten cladding panel on the entry (plan-south) facade,
 *  framed in a slim white L, positioned clear of the door and windows */
function buildCladding(
  o: Rect,
  southOps: FaceOp[],
  baseY: number,
  wallTop: number,
  L: number,
  widthMm: number,
  push: Push,
  wx: XF,
  wz: XF,
  m: XF,
) {
  const a0 = o.x + HT_MM
  const a1 = o.x + o.w - HT_MM
  if (a1 - a0 < widthMm + 800) return
  // widest clear stretch on the south face, away from any opening
  const blocked = southOps
    .map((op) => ({ s: op.at - op.width / 2 - 400, e: op.at + op.width / 2 + 400 }))
    .sort((p, q) => p.s - q.s)
  let best = { s: a0, e: a0, len: 0 }
  let cur = a0
  for (const b of [...blocked, { s: a1, e: a1 }]) {
    if (b.s - cur > best.len) best = { s: cur, e: b.s, len: b.s - cur }
    cur = Math.max(cur, b.e)
  }
  if (best.len < widthMm) return
  const cw = Math.min(widthMm, best.len - 200)
  const cx = best.s + (best.len - cw) / 2 + cw / 2
  const z = wz(o.y + o.h) + EXT_T / 2 + 0.02
  const h = wallTop - baseY - 0.12
  push(`clad-${L}`, 'clad', L, [wx(cx), baseY + 0.06 + h / 2, z], [m(cw), h, 0.05])
  // slim white frame: top rail + two jambs
  const ft = 0.12
  push(`cladf-${L}-t`, 'roof', L, [wx(cx), baseY + 0.06 + h + ft / 2, z + 0.01], [m(cw) + 2 * ft, ft, 0.09])
  push(`cladf-${L}-l`, 'roof', L, [wx(cx - cw / 2) - ft / 2, baseY + 0.06 + h / 2, z + 0.01], [ft, h, 0.09])
  push(`cladf-${L}-r`, 'roof', L, [wx(cx + cw / 2) + ft / 2, baseY + 0.06 + h / 2, z + 0.01], [ft, h, 0.09])
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

  const cxw = wx(o.x + o.w / 2)
  const czw = wz(o.y + o.h / 2)
  const rw = m(o.w) + EXT_T
  const rd = m(o.h) + EXT_T
  // always cap the storey — a hair below the storey-above soffit so it never
  // z-fights the inset slab, and so equal-footprint floors still get a ceiling
  push(`terr-${L}`, 'roof', L, [cxw, wallTop - SLAB_T - ROOF_T / 2 - 0.01, czw], [rw, ROOF_T, rd])

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

  // a paved parking pad, a touch proud of the lawn, with a low kerb and
  // painted bay lines so it reads as a real parking space
  push(`cpad-${L}-${id}`, 'paving', L, [cxm, 0.05, czm], [wM + 0.3, 0.1, dM + 0.3])
  const bays = wM > 5 ? 2 : 1
  for (let i = 1; i < bays; i++) {
    const bx = wx(cW) + (wM / bays) * i
    push(`bay-${L}-${id}-${i}`, 'slab', L, [bx, 0.11, czm], [0.08, 0.02, dM * 0.9])
  }

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

function buildBalcony(
  rect: Rect,
  baseY: number,
  L: number,
  depthM: number,
  rail: 'bar' | 'baluster',
  push: Push,
  wx: XF,
  wz: XF,
  m: XF,
) {
  const depth = Math.max(rect.h, depthM * 1000)
  const bN = rect.y - 150 // tuck under the facade so it connects
  const bS = rect.y + depth
  const bW = rect.x
  const bE = rect.x + rect.w
  if (bE - bW < 1200) return
  const cxw = wx((bW + bE) / 2)

  // projecting slab, top a step above the finished floor so it clearly reads
  push(`balc-${L}`, 'slab', L, [cxw, baseY - 0.11, wz((bN + bS) / 2)], [m(bE - bW), 0.26, m(bS - bN)])

  const rh = 0.98 // handrail height above the balcony floor
  const y = baseY
  const edges: { from: Vec3; to: Vec3 }[] = [
    { from: [wx(bW), y, wz(bS)], to: [wx(bE), y, wz(bS)] }, // south
    { from: [wx(bW), y, wz(rect.y - 100)], to: [wx(bW), y, wz(bS)] }, // west return
    { from: [wx(bE), y, wz(rect.y - 100)], to: [wx(bE), y, wz(bS)] }, // east return
  ]
  edges.forEach((e, ei) => {
    const horiz = Math.abs(e.to[0] - e.from[0]) >= Math.abs(e.to[2] - e.from[2])
    const len = horiz ? Math.abs(e.to[0] - e.from[0]) : Math.abs(e.to[2] - e.from[2])
    if (len < 0.4) return
    const mx = (e.from[0] + e.to[0]) / 2
    const mz = (e.from[2] + e.to[2]) / 2
    const post = 0.05
    const railT = rail === 'bar' ? 0.035 : 0.06
    const railSize: Vec3 = horiz ? [len + post, railT, railT] : [railT, railT, len + post]

    if (rail === 'bar') {
      // slim black steel: a top handrail + three thin horizontals, end posts only
      for (const f of [1, 0.7, 0.42, 0.14]) {
        push(`balr-${L}-${ei}-${f}`, 'railing', L, [mx, y + rh * f, mz], railSize)
      }
      for (const t of [0, 1]) {
        const px = e.from[0] + (e.to[0] - e.from[0]) * t
        const pz = e.from[2] + (e.to[2] - e.from[2]) * t
        push(`balp-${L}-${ei}-${t}`, 'railing', L, [px, y + rh / 2, pz], [post, rh, post])
      }
    } else {
      push(`balr-${L}-${ei}-top`, 'railing', L, [mx, y + rh, mz], railSize)
      push(`balr-${L}-${ei}-bot`, 'railing', L, [mx, y + 0.12, mz], railSize)
      const n = Math.max(2, Math.round(len / 0.28))
      for (let i = 0; i <= n; i++) {
        const t = i / n
        const px = e.from[0] + (e.to[0] - e.from[0]) * t
        const pz = e.from[2] + (e.to[2] - e.from[2]) * t
        push(`balp-${L}-${ei}-${i}`, 'railing', L, [px, y + rh / 2, pz], [post, rh, post])
      }
    }
  })
}

/** slim flat-roof entry porch on one column — the reference car-porch look */
function buildPorch(entry: Opening, o: Rect, y0: number, H: number, push: Push, wx: XF, wz: XF, m: XF) {
  if (entry.orient !== 'h') return // only the plan-south entry gets the porch
  const w = m(entry.width) + 1.3
  const proj = 1.9 // how far the porch reaches out from the facade
  const topY = y0 + Math.min(BAND.entry.head + 0.45, H - 0.15)
  const zFace = entry.at.y
  const zMid = zFace + proj * 0.55

  push('estep', 'plinth', 0, [wx(entry.at.x), y0 - 0.04, wz(zFace + 650)], [w * 0.75, 0.13, 1.3])
  // a thin flat slab + a crisp white lip on the outer edge
  push('eporch', 'canopy', 0, [wx(entry.at.x), topY - 0.09, wz(zMid)], [w, 0.16, proj])
  push('eporch-lip', 'roof', 0, [wx(entry.at.x), topY, wz(zFace + proj)], [w + 0.08, 0.13, 0.1])
  // one slim column at the outer front corner
  const px = entry.at.x + (entry.width / 2 + 300) * (entry.at.x < o.x + o.w / 2 ? 1 : -1)
  const colH = topY - 0.16 - y0
  push('eporch-col', 'column', 0, [wx(px), y0 + colH / 2, wz(zFace + proj - 0.2)], [0.22, colH, 0.22])
}

/* --------------------------------- site / garden -------------------------------- */

function buildLandscape(
  model: CanonicalModel,
  ground: FloorPlan,
  T: ThemeDef,
  push: Push,
  wx: XF,
  wz: XF,
  m: XF,
) {
  const P = model.brief.rooms.priorities
  if (!P.garden && !P.compoundWall) return

  const rnd = seededRng(model.seed)
  const plotW = model.plot.width
  const plotD = model.plot.depth
  const sb = model.setbacksMm
  const g = ground.outline
  const gx0 = g.x
  const gy0 = g.y
  const gy1 = g.y + g.h
  const carport = ground.rooms.find((r) => r.id === 'parking')
  const entry = ground.openings.find((o) => o.kind === 'entry')
  const driveX = carport ? carport.rect.x + carport.rect.w / 2 : entry ? entry.at.x : plotW / 2

  // ---- lawn covering the plot, just above grade (hard surfaces sit on top) ----
  if (P.garden) {
    push('lawn', 'lawn', 0, [wx(plotW / 2), 0.02, wz(plotD / 2)], [m(plotW - 400), 0.04, m(plotD - 400)])

    // driveway from the approach (plan-south) to the carport / house front
    const driveW = carport ? Math.min(carport.rect.w, 3400) : 3000
    const driveN = carport ? carport.rect.y + carport.rect.h : gy1
    push(
      'drive',
      'paving',
      0,
      [wx(driveX), 0.03, wz((driveN + plotD) / 2)],
      [m(driveW), 0.06, m(plotD - driveN + 200)],
    )
    if (entry) {
      const walkFromY = carport ? carport.rect.y : gy1
      push(
        'walk',
        'paving',
        0,
        [wx(entry.at.x), 0.035, wz((entry.at.y + walkFromY) / 2)],
        [1.4, 0.06, m(Math.abs(walkFromY - entry.at.y) + 400)],
      )
    }
  }

  // ---- compound wall with a gate opening on the approach side ----
  if (P.compoundWall) {
    const wallH = T.landscape.boundaryMm / 1000
    const t = 0.16
    const inset = 150
    const x0 = inset
    const x1 = plotW - inset
    const z0 = inset
    const z1 = plotD - inset
    const cy = wallH / 2
    push('cw-n', 'fence', 0, [wx(plotW / 2), cy, wz(z0)], [m(x1 - x0 + t), wallH, t])
    push('cw-e', 'fence', 0, [wx(x1), cy, wz(plotD / 2)], [t, wallH, m(z1 - z0)])
    push('cw-w', 'fence', 0, [wx(x0), cy, wz(plotD / 2)], [t, wallH, m(z1 - z0)])
    const gateHalf = 1900
    const gL1 = driveX - gateHalf
    const gR0 = driveX + gateHalf
    if (gL1 - x0 > 300) push('cw-sl', 'fence', 0, [wx((x0 + gL1) / 2), cy, wz(z1)], [m(gL1 - x0), wallH, t])
    if (x1 - gR0 > 300) push('cw-sr', 'fence', 0, [wx((gR0 + x1) / 2), cy, wz(z1)], [m(x1 - gR0), wallH, t])
    const gpH = wallH + 0.35
    push('gp-l', 'fence', 0, [wx(gL1), gpH / 2, wz(z1)], [0.28, gpH, 0.28])
    push('gp-r', 'fence', 0, [wx(gR0), gpH / 2, wz(z1)], [0.28, gpH, 0.28])
  }

  if (!P.garden) return

  // ---- front hedge along the approach setback, split around the drive ----
  if (T.landscape.hedgeMm > 0) {
    const hH = T.landscape.hedgeMm / 1000
    const hz = plotD - Math.max(sb.S * 0.45, 500)
    const gap = 2300
    for (const [a, b] of [
      [400, driveX - gap],
      [driveX + gap, plotW - 400],
    ]) {
      if (b - a < 700) continue
      push(`hedge-${Math.round(a)}`, 'hedge', 0, [wx((a + b) / 2), hH / 2, wz(hz)], [m(b - a), hH, 0.55])
    }
  }

  // ---- a few low shrub clumps near the entry walk and front corners ----
  const walkX = entry ? entry.at.x : driveX
  const shrubZ = clamp(gy1 + 900, gy1 + 600, plotD - 500)
  const spots = [
    { x: walkX - 1400, z: shrubZ },
    { x: walkX + 1400, z: shrubZ },
    { x: 700, z: plotD - 700 },
    { x: plotW - 700, z: plotD - 700 },
    { x: gx0 - 500, z: (gy0 + gy1) / 2 },
  ]
  for (let i = 0; i < Math.min(T.landscape.shrubs, spots.length); i++) {
    const s = spots[i]
    const r = m(550 + rnd() * 350)
    const h = m(450 + rnd() * 350)
    push(`shrub-${i}`, 'hedge', 0, [wx(s.x), h / 2, wz(s.z)], [r, h, r])
  }
}

/** planter boxes along the exposed edge of a stepped-back flat roof terrace */
function buildTerraceGarden(
  o: Rect,
  up: Rect,
  wallTop: number,
  L: number,
  push: Push,
  wx: XF,
  wz: XF,
  m: XF,
) {
  const deckTop = wallTop - SLAB_T - 0.01
  const plH = 0.42
  const put = (x: number, z: number, w: number, d: number, tag: string) => {
    if (w < 600 || d < 400) return
    push(`plnt-${L}-${tag}`, 'planter', L, [wx(x + w / 2), deckTop + plH / 2, wz(z + d / 2)], [m(w), plH, m(d)])
  }
  if (o.y + o.h - (up.y + up.h) > 900) put(o.x + 400, o.y + o.h - 750, o.w - 800, 700, 's')
  if (o.x + o.w - (up.x + up.w) > 900) put(o.x + o.w - 750, up.y + 300, 700, up.h - 600, 'e')
  if (up.x - o.x > 900) put(o.x + 300, up.y + 300, 700, up.h - 600, 'w')
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
