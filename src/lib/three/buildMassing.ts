import { rectBottom, rectRight, type Rect } from '../geometry.ts'
import type { Opening, Wall } from '../engine/types.ts'
import type { Design } from '../engine/types.ts'

export type MassKind =
  | 'plinth'
  | 'slab'
  | 'wall'
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

const SLAB = 0.2
const ROOF = 0.24
const PARAPET = 0.95
const PLINTH_DROP = 0.45
const EXT_T = 0.25
const INT_T = 0.11
const COL = 0.24

// opening bands, millimetres above finished floor
const BAND: Record<Opening['kind'], { sill: number; head: number }> = {
  window: { sill: 900, head: 2150 },
  door: { sill: 0, head: 2100 },
  entry: { sill: 0, head: 2300 },
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

export function buildMassing(design: Design): Massing {
  const { model } = design
  const cx = model.plot.width / 2
  const cy = model.plot.depth / 2
  const H = model.brief.levels.floorToFloor
  const wallHmm = H * 1000 - SLAB * 1000

  const wx = (mm: number) => (mm - cx) / 1000
  const wz = (mm: number) => (mm - cy) / 1000
  const m = (mm: number) => mm / 1000

  const boxes: MassBox[] = []
  const push = (
    id: string,
    kind: MassKind,
    level: number,
    pos: [number, number, number],
    size: [number, number, number],
  ) => {
    if (size[0] > 0.02 && size[1] > 0.02 && size[2] > 0.02) boxes.push({ id, kind, pos, size, level })
  }

  const topLevel = design.floors.length - 1
  const groundOutline = design.floors[0].outline

  // ---- plinth under the ground floor ----
  push(
    'plinth',
    'plinth',
    0,
    [wx(groundOutline.x + groundOutline.w / 2), -PLINTH_DROP / 2, wz(groundOutline.y + groundOutline.h / 2)],
    [m(groundOutline.w) + 0.7, PLINTH_DROP, m(groundOutline.h) + 0.7],
  )

  for (const floor of design.floors) {
    const baseY = floor.level * H
    const o = floor.outline

    // ---- floor plate ----
    push(
      `slab-${floor.level}`,
      'slab',
      floor.level,
      [wx(o.x + o.w / 2), baseY - SLAB / 2, wz(o.y + o.h / 2)],
      [m(o.w) + EXT_T, SLAB, m(o.h) + EXT_T],
    )

    // ---- walls, segmented around openings ----
    floor.walls.forEach((w, i) => {
      for (const b of segmentWall(w, floor.openings, baseY, wallHmm, wx, wz, m)) {
        push(`w${floor.level}-${i}-${b.tag}`, b.kind, floor.level, b.pos, b.size)
      }
    })

    // ---- carport / verandah: slab, corner columns, flat canopy ----
    for (const r of floor.rooms) {
      if (!r.outdoor) continue
      const cxm = wx(r.rect.x + r.rect.w / 2)
      const czm = wz(r.rect.y + r.rect.h / 2)
      push(`oslab-${floor.level}-${r.id}`, 'slab', floor.level, [cxm, baseY - SLAB / 2, czm], [m(r.rect.w), SLAB, m(r.rect.h)])
      if (r.id.startsWith('balcony')) {
        // balcony: projecting slab + solid railing on the outer edges
        railing(r.rect).forEach((seg, k) =>
          push(`bal-${floor.level}-${r.id}-${k}`, 'railing', floor.level, [wx(seg.x), baseY + 0.5, wz(seg.y)], seg.size),
        )
        continue
      }
      const canH = wallHmm / 1000
      for (const [dx, dz] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]) {
        push(
          `col-${floor.level}-${r.id}-${dx}${dz}`,
          'column',
          floor.level,
          [cxm + (dx * (m(r.rect.w) - COL)) / 2, baseY + canH / 2, czm + (dz * (m(r.rect.h) - COL)) / 2],
          [COL, canH, COL],
        )
      }
      push(`canopy-${floor.level}-${r.id}`, 'canopy', floor.level, [cxm, baseY + canH + 0.09, czm], [m(r.rect.w) + 0.3, 0.18, m(r.rect.h) + 0.3])
    }

    // ---- stair: real treads + mid landing ----
    if (floor.stair) {
      buildStair(floor.stair.rect, H).forEach((s, k) =>
        push(`stair-${floor.level}-${k}`, 'stair', floor.level, [wx(s.x), baseY + s.y, wz(s.z)], s.size),
      )
    }

    // ---- roof + parapet on the top floor ----
    if (floor.level === topLevel) {
      const roofY = baseY + wallHmm / 1000
      push(
        `roof-${floor.level}`,
        'roof',
        floor.level,
        [wx(o.x + o.w / 2), roofY + ROOF / 2, wz(o.y + o.h / 2)],
        [m(o.w) + EXT_T + 0.2, ROOF, m(o.h) + EXT_T + 0.2],
      )
      const py = roofY + ROOF + PARAPET / 2
      const ext = m(EXT_T)
      const rim: { mx: number; my: number; size: [number, number, number] }[] = [
        { mx: o.x + o.w / 2, my: o.y, size: [m(o.w) + ext, PARAPET, 0.14] },
        { mx: o.x + o.w / 2, my: rectBottom(o), size: [m(o.w) + ext, PARAPET, 0.14] },
        { mx: o.x, my: o.y + o.h / 2, size: [0.14, PARAPET, m(o.h) + ext] },
        { mx: rectRight(o), my: o.y + o.h / 2, size: [0.14, PARAPET, m(o.h) + ext] },
      ]
      rim.forEach((seg, k) =>
        push(`parapet-${floor.level}-${k}`, 'parapet', floor.level, [wx(seg.mx), py, wz(seg.my)], seg.size),
      )
    }
  }

  const structural = boxes.filter((b) => b.kind === 'wall' || b.kind === 'roof')
  return {
    boxes,
    floors: design.floors.map((f) => ({ level: f.level, baseY: f.level * H })),
    bounds: { w: model.plot.width / 1000, d: model.plot.depth / 1000 },
    center: [avg(structural.map((b) => b.pos[0])), (design.floors.length * (wallHmm / 1000)) / 2, avg(structural.map((b) => b.pos[2]))],
    floorHeight: H,
    stats: {
      storeys: design.floors.length,
      heightM: design.heightM,
      builtAreaSqm: design.builtAreaSqm,
      openings: design.openingCounts.doors + design.openingCounts.windows,
    },
  }
}

/* ---------------------------------------------------------------- */

type SubBox = { tag: string; kind: MassKind; pos: [number, number, number]; size: [number, number, number] }

/** Split one wall into solid piers + sill/lintel bands, leaving voids for openings. */
function segmentWall(
  wall: Wall,
  openings: Opening[],
  baseY: number,
  wallHmm: number,
  wx: (n: number) => number,
  wz: (n: number) => number,
  m: (n: number) => number,
): SubBox[] {
  const horizontal = Math.abs(wall.a.y - wall.b.y) < Math.abs(wall.a.x - wall.b.x)
  const t = wall.kind === 'exterior' ? EXT_T : INT_T
  const kind: MassKind = 'wall'
  const wallH = wallHmm / 1000

  // axis = along the wall, fixed = perpendicular position
  const [p0, p1] = horizontal
    ? [Math.min(wall.a.x, wall.b.x), Math.max(wall.a.x, wall.b.x)]
    : [Math.min(wall.a.y, wall.b.y), Math.max(wall.a.y, wall.b.y)]
  const fixed = horizontal ? wall.a.y : wall.a.x

  const on = openings
    .filter((o) => {
      const perp = horizontal ? o.at.y : o.at.x
      const along = horizontal ? o.at.x : o.at.y
      const wantH = horizontal
      return (
        (o.orient === 'h') === wantH &&
        Math.abs(perp - fixed) < t * 500 + 140 &&
        along > p0 + 150 &&
        along < p1 - 150
      )
    })
    .map((o) => ({ q: horizontal ? o.at.x : o.at.y, w: o.width, band: BAND[o.kind] }))
    .sort((a, b) => a.q - b.q)

  const out: SubBox[] = []
  const solid = (from: number, to: number, tag: string) => {
    if (to - from < 40) return
    const midAlong = (from + to) / 2
    const px = horizontal ? wx(midAlong) : wx(fixed)
    const pz = horizontal ? wz(fixed) : wz(midAlong)
    const len = m(to - from)
    out.push({
      tag,
      kind,
      pos: [px, baseY + wallH / 2, pz],
      size: horizontal ? [len, wallH, t] : [t, wallH, len],
    })
  }
  const band = (from: number, to: number, y0: number, y1: number, k: MassKind, tag: string) => {
    if (to - from < 40 || y1 - y0 < 0.04) return
    const midAlong = (from + to) / 2
    const px = horizontal ? wx(midAlong) : wx(fixed)
    const pz = horizontal ? wz(fixed) : wz(midAlong)
    const len = m(to - from)
    const th = k === 'glass' ? 0.06 : t
    out.push({
      tag,
      kind: k,
      pos: [px, baseY + (y0 + y1) / 2, pz],
      size: horizontal ? [len, y1 - y0, th] : [th, y1 - y0, len],
    })
  }

  let cursor = p0
  on.forEach((o, i) => {
    const a = o.q - o.w / 2
    const b = o.q + o.w / 2
    solid(cursor, a, `s${i}`)
    const sill = o.band.sill / 1000
    const head = Math.min(o.band.head / 1000, wallH)
    if (sill > 0.05) band(a, b, 0, sill, kind, `sill${i}`)
    if (wallH - head > 0.05) band(a, b, head, wallH, kind, `head${i}`)
    band(a, b, sill, head, 'glass', `glz${i}`)
    cursor = b
  })
  solid(cursor, p1, 'sE')
  return out
}

/** dog-leg stair: two flights of tread boxes with a mid-landing.
 *  x/z returned in plan-millimetres; y and size in metres. */
function buildStair(rect: Rect, floorToFloor: number) {
  const risers = Math.max(15, Math.round((floorToFloor * 1000) / 172))
  const perFlight = Math.ceil(risers / 2)
  const flightWmm = (rect.w - 100) / 2
  const flightW = flightWmm / 1000
  const runMm = rect.h * 0.86
  const goingMm = runMm / perFlight
  const going = goingMm / 1000
  const rise = floorToFloor / risers
  const out: { x: number; y: number; z: number; size: [number, number, number] }[] = []

  for (let i = 0; i < perFlight; i++) {
    const h = (i + 0.5) * rise
    out.push({
      x: rect.x + 50 + flightWmm / 2,
      y: h,
      z: rect.y + i * goingMm + goingMm / 2,
      size: [flightW, rise, going * 1.02],
    })
    out.push({
      x: rect.x + 50 + flightWmm + 100 + flightWmm / 2,
      y: floorToFloor - h,
      z: rect.y + runMm - i * goingMm - goingMm / 2,
      size: [flightW, rise, going * 1.02],
    })
  }
  // mid landing at the north end
  out.push({
    x: rect.x + rect.w / 2,
    y: floorToFloor / 2 - 0.09,
    z: rect.y + runMm + (rect.h - runMm) / 2,
    size: [rect.w / 1000, 0.18, (rect.h - runMm) / 1000],
  })
  return out
}

/** solid balcony railing on the three outward edges (plan-mm x/y, metre size) */
function railing(rect: Rect): { x: number; y: number; size: [number, number, number] }[] {
  const t = 0.1
  const w = rect.w / 1000
  const d = rect.h / 1000
  return [
    { x: rect.x + rect.w / 2, y: rectBottom(rect), size: [w, 1.0, t] },
    { x: rect.x, y: rect.y + rect.h / 2, size: [t, 1.0, d] },
    { x: rectRight(rect), y: rect.y + rect.h / 2, size: [t, 1.0, d] },
  ]
}
