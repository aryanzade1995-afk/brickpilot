import type { Design, FloorPlan, PlacedRoom } from '../engine/types.ts'
import { rectBottom, rectRight } from '../geometry.ts'

/* ------------------------------------------------------------------ *
 *  buildDollhouse — a warm, furnished cut-away model of the whole
 *  house: floor slabs, walls trimmed to ~1.15 m, a stepped stair and
 *  parametric furniture in every room, keyed to room type / size and
 *  the real door & window positions. Pure function of the Design,
 *  deterministic, no textures — reads by form + a warm accent palette.
 * ------------------------------------------------------------------ */

export type DollMat =
  | 'wall'
  | 'floor'
  | 'rug'
  | 'sage' // upholstery accents — one per room by hash
  | 'blush'
  | 'clay'
  | 'cream' // bedding, cushions — a soft neutral, never an accent
  | 'wood' // walnut / teak frames, legs, headboards
  | 'panel' // pale cabinetry, wardrobe, shelving
  | 'stone' // counters, vanity tops, hearth
  | 'metal' // legs, rails, taps, appliances
  | 'ceramic' // sanitaryware, basins, planters
  | 'plant'
  | 'art' // framed panels on walls
  | 'lamp' // shade — emits a warm tint
  | 'glass'
  | 'stair'

/** the three saturated accents rooms rotate through — green / rose / terracotta */
const ACCENTS: DollMat[] = ['sage', 'blush', 'clay']

export type DollBox = {
  id: string
  mat: DollMat
  /** world-space centre, metres */
  pos: [number, number, number]
  /** full extents, metres */
  size: [number, number, number]
}

export type Dollhouse = {
  boxes: DollBox[]
  floors: { level: number; baseY: number }[]
  bounds: { w: number; d: number }
  footprint: { w: number; d: number }
  center: [number, number, number]
  floorHeight: number
  stats: { storeys: number; rooms: number; pieces: number }
}

type Side = 'N' | 'S' | 'E' | 'W'
const SIDES: Side[] = ['N', 'S', 'E', 'W']
const CUT = 1.16 // wall trim height, m
const SLAB = 0.12
const EXT_T = 0.22
const INT_T = 0.1
const PLINTH = 0.35
/** in the stacked "all floors" view, storeys float apart as trays — the cut
 *  wall plus a wide open band so a steep camera sees into every level */
const TRAY = CUT + 2.15

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const rand = (seed: number) => {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 1 | s) + 0x9e3779b9) >>> 0
    return ((s ^ (s >>> 16)) >>> 0) / 4294967296
  }
}

/**
 * @param only  when set, isolate that storey and drop it to the plinth —
 *              a clean single-floor cut-away; otherwise every storey is
 *              stacked as trays with an open band between.
 */
export function buildDollhouse(design: Design, only?: number): Dollhouse {
  const { model } = design
  const isolate = only !== undefined
  const plotW = model.plot.width
  const plotD = model.plot.depth
  const H = model.brief.levels.floorToFloor
  const wx = (mm: number) => (mm - plotW / 2) / 1000
  const wz = (mm: number) => (mm - plotD / 2) / 1000
  const m = (mm: number) => mm / 1000

  const boxes: DollBox[] = []
  const push = (id: string, mat: DollMat, pos: [number, number, number], size: [number, number, number]) => {
    if (size[0] > 0.015 && size[1] > 0.015 && size[2] > 0.015) boxes.push({ id, mat, pos, size })
  }

  const allFloors = [...design.floors].sort((a, b) => a.level - b.level)
  const floors = isolate ? allFloors.filter((f) => f.level === only) : allFloors
  const g = (floors[0] ?? allFloors[0]).outline
  const tierOf = (L: number) => (isolate ? 0 : L)
  const topLevel = allFloors[allFloors.length - 1]?.level ?? 0
  let pieces = 0
  let roomCount = 0

  // ---- plinth ----
  push('plinth', 'floor', [wx(g.x + g.w / 2), PLINTH / 2, wz(g.y + g.h / 2)], [m(g.w) + 0.5, PLINTH, m(g.h) + 0.5])

  for (const floor of floors) {
    const L = floor.level
    const baseY = PLINTH + tierOf(L) * TRAY
    const blocks = floor.footprint?.length ? floor.footprint : [floor.outline]

    // ---- floor slab per block (pale oak) ----
    blocks.forEach((b, bi) => {
      push(
        `slab-${L}-${bi}`,
        'floor',
        [wx(b.x + b.w / 2), baseY - SLAB / 2, wz(b.y + b.h / 2)],
        [m(b.w), SLAB, m(b.h)],
      )
    })

    // ---- doors on this storey, so walls can leave a gap ----
    const doors = floor.openings.filter((o) => o.kind === 'door' || o.kind === 'entry')

    // ---- walls trimmed to CUT, split around door gaps ----
    floor.walls.forEach((w, i) => {
      if (w.kind === 'parapet') return
      const horiz = Math.abs(w.a.y - w.b.y) < 2
      const t = (w.kind === 'exterior' ? EXT_T : INT_T)
      const a0 = horiz ? Math.min(w.a.x, w.b.x) : Math.min(w.a.y, w.b.y)
      const a1 = horiz ? Math.max(w.a.x, w.b.x) : Math.max(w.a.y, w.b.y)
      const fixed = horiz ? w.a.y : w.a.x
      // gaps from doors that sit on this line
      const gaps: [number, number][] = []
      for (const d of doors) {
        const dPerp = horiz ? d.at.y : d.at.x
        const dAlong = horiz ? d.at.x : d.at.y
        if (Math.abs(dPerp - fixed) > 220) continue
        if (dAlong < a0 || dAlong > a1) continue
        gaps.push([dAlong - d.width / 2 - 40, dAlong + d.width / 2 + 40])
      }
      gaps.sort((p, q) => p[0] - q[0])
      let cursor = a0
      const segs: [number, number][] = []
      for (const [gs, ge] of gaps) {
        if (gs - cursor > 120) segs.push([cursor, gs])
        cursor = Math.max(cursor, ge)
      }
      if (a1 - cursor > 120) segs.push([cursor, a1])
      segs.forEach(([s0, s1], si) => {
        const len = m(s1 - s0)
        const mid = (s0 + s1) / 2
        push(
          `w${L}-${i}-${si}`,
          'wall',
          horiz ? [wx(mid), baseY + CUT / 2, wz(fixed)] : [wx(fixed), baseY + CUT / 2, wz(mid)],
          horiz ? [len, CUT, t] : [t, CUT, len],
        )
      })
    })

    // ---- a slim timber flight so the stair hall never reads as an empty room:
    //      climbs to the cut line then a landing; only where the design has storeys ----
    if (floor.stair && topLevel > 0) {
      const r = floor.stair.rect
      const o = floor.outline
      const up = L < topLevel
      const rise = CUT + 0.2
      const steps = 6
      const tw = Math.min(1.15, m(r.w) * 0.52) // tread width — against one side, not filling the room
      // hug the exterior wall of the core so the flight never sits across the
      // door to a neighbouring bath / study
      const hugRight = Math.abs(rectRight(r) - rectRight(o)) < Math.abs(r.x - o.x)
      const tx = wx(r.x + r.w / 2) + (hugRight ? 1 : -1) * (m(r.w) / 2 - tw / 2 - 0.12)
      const from = up ? 0.16 : 0.58
      const to = up ? 0.58 : 0.16
      for (let k = 0; k < steps; k++) {
        const f = k / (steps - 1)
        push(
          `stair-${L}-${k}`,
          'stair',
          [tx, baseY + rise * ((up ? k + 0.5 : steps - k - 0.5) / steps), wz(r.y + r.h * (from + (to - from) * f))],
          [tw, rise / steps + 0.02, m(r.h) * 0.11],
        )
      }
      push(
        `stair-${L}-land`,
        'stair',
        [tx, baseY + rise, wz(r.y + r.h * (up ? 0.66 : 0.1))],
        [tw, 0.08, m(r.h) * 0.16],
      )
    }

    // ---- furniture ----
    for (const room of floor.rooms) {
      if (room.outdoor) continue
      roomCount++
      pieces += furnishRoom(room, floor, baseY, wx, wz, m, push)
    }
  }

  const storeys = floors.length
  const tiers = isolate ? 1 : storeys
  return {
    boxes,
    floors: floors.map((f) => ({ level: f.level, baseY: PLINTH + tierOf(f.level) * TRAY })),
    bounds: { w: plotW / 1000, d: plotD / 1000 },
    footprint: { w: g.w / 1000, d: g.h / 1000 },
    center: [wx(g.x + g.w / 2), PLINTH + Math.max(tiers * TRAY - 0.6, CUT) / 2, wz(g.y + g.h / 2)],
    floorHeight: H,
    stats: { storeys, rooms: roomCount, pieces },
  }
}

/* ------------------------------ furniture --------------------------- */

type XF = (mm: number) => number
type Push = (id: string, mat: DollMat, pos: [number, number, number], size: [number, number, number]) => void

/** which sides of a room carry a door / a window */
function edgesOf(room: PlacedRoom, floor: FloorPlan) {
  const r = room.rect
  const line: Record<Side, number> = { N: r.y, S: rectBottom(r), W: r.x, E: rectRight(r) }
  const door: Record<Side, boolean> = { N: false, S: false, E: false, W: false }
  const win: Record<Side, boolean> = { N: false, S: false, E: false, W: false }
  for (const op of floor.openings) {
    const horiz = op.orient === 'h'
    for (const s of SIDES) {
      if ((s === 'N' || s === 'S') !== horiz) continue
      const perp = horiz ? op.at.y : op.at.x
      const along = horiz ? op.at.x : op.at.y
      if (Math.abs(perp - line[s]) > 240) continue
      if (along < (horiz ? r.x : r.y) - 100 || along > (horiz ? rectRight(r) : rectBottom(r)) + 100) continue
      if (op.kind === 'window') win[s] = true
      else door[s] = true
    }
  }
  return { door, win }
}

/**
 * Place furniture for one room. Works in world metres via the `wx/wz/m`
 * transforms; a room is a rect in plot-mm. Returns the piece count.
 */
function furnishRoom(
  room: PlacedRoom,
  floor: FloorPlan,
  baseY: number,
  wx: XF,
  wz: XF,
  m: XF,
  push: Push,
): number {
  const r = room.rect
  const W = m(r.w)
  const D = m(r.h)
  const cx = wx(r.x + r.w / 2)
  const cz = wz(r.y + r.h / 2)
  const y0 = baseY // slab top
  const { door, win } = edgesOf(room, floor)
  const rng = rand(Math.round(r.x * 7 + r.y * 13 + r.w))

  // ---- keep-clear zones in front of every door: no furniture may block a
  //      doorway or its swing (local metres, room-centre origin) ----
  const CLEAR = 0.92
  const doorZones: { x0: number; z0: number; x1: number; z1: number }[] = []
  for (const op of floor.openings) {
    if (op.kind === 'window') continue
    const horiz = op.orient === 'h'
    const perp = horiz ? op.at.y : op.at.x
    const along = horiz ? op.at.x : op.at.y
    const hw = op.width / 2000 + 0.16
    if (horiz) {
      if (along < r.x - 100 || along > rectRight(r) + 100) continue
      const lx = wx(op.at.x) - cx
      if (Math.abs(perp - r.y) < 260) doorZones.push({ x0: lx - hw, z0: -D / 2, x1: lx + hw, z1: -D / 2 + CLEAR })
      else if (Math.abs(perp - rectBottom(r)) < 260) doorZones.push({ x0: lx - hw, z0: D / 2 - CLEAR, x1: lx + hw, z1: D / 2 })
    } else {
      if (along < r.y - 100 || along > rectBottom(r) + 100) continue
      const lz = wz(op.at.y) - cz
      if (Math.abs(perp - r.x) < 260) doorZones.push({ x0: -W / 2, z0: lz - hw, x1: -W / 2 + CLEAR, z1: lz + hw })
      else if (Math.abs(perp - rectRight(r)) < 260) doorZones.push({ x0: W / 2 - CLEAR, z0: lz - hw, x1: W / 2, z1: lz + hw })
    }
  }
  /** a floor-standing piece at (lx,lz) of footprint (sw,sd) that intrudes into a doorway */
  const blocksDoor = (lx: number, lz: number, sw: number, sd: number) =>
    doorZones.some(
      (z) =>
        lx - sw / 2 < z.x1 - 0.06 &&
        lx + sw / 2 > z.x0 + 0.06 &&
        lz - sd / 2 < z.z1 - 0.06 &&
        lz + sd / 2 > z.z0 + 0.06,
    )
  // pieces that anchor a room are never dropped (an empty room reads worse than a
  // tight one); everything else yields to a doorway
  const ANCHOR = /^(bed-|sofa-|table$|tleg|kb-|kc-|ku-|island|desk$|dleg|vanity|basin|wc|altar|washer|counter$|media$)/

  let n = 0
  const P = (id: string, mat: DollMat, lx: number, ly: number, lz: number, sw: number, sh: number, sd: number) => {
    const flat = sh <= 0.06 // rugs, mats, cloths
    const mounted = ly - sh / 2 >= 1.24 // wall art, mirrors, upper cabinets, hoods, pendants
    if (!flat && !mounted && !ANCHOR.test(id) && blocksDoor(lx, lz, sw, sd)) return
    push(`${room.id}-${id}`, mat, [cx + lx, y0 + ly, cz + lz], [sw, sh, sd])
    n++
  }

  // one saturated accent per room, plus a paired second — deterministic by position
  const hash = Math.abs(Math.round(r.x * 0.13 + r.y * 0.29 + r.w * 0.07 + r.h * 0.05))
  const acc: DollMat = ACCENTS[hash % ACCENTS.length]
  const acc2: DollMat = ACCENTS[(hash + 1) % ACCENTS.length]

  // a wall with no door, preferring one facing the room's long axis
  const clearWall = (): Side => {
    const cands = SIDES.filter((s) => !door[s])
    const order: Side[] = W >= D ? ['N', 'S', 'W', 'E'] : ['W', 'E', 'N', 'S']
    return (cands.sort((a, b) => order.indexOf(a) - order.indexOf(b))[0] ?? 'N') as Side
  }
  /** local offset + facing for a piece pushed against `side`, `depth` deep */
  const atWall = (side: Side, depth: number) => {
    const inset = 0.06 + depth / 2
    if (side === 'N') return { x: 0, z: -D / 2 + inset, horiz: true }
    if (side === 'S') return { x: 0, z: D / 2 - inset, horiz: true }
    if (side === 'W') return { x: -W / 2 + inset, z: 0, horiz: false }
    return { x: W / 2 - inset, z: 0, horiz: false }
  }

  // a big, floor-anchoring rug — sits well inside the walls, distinct from the oak slab
  const rug = (w: number, d: number) =>
    P('rug', 'rug', 0, 0.016, 0, clamp(w, 0.6, W - 0.24), 0.032, clamp(d, 0.6, D - 0.24))
  const pendant = (lz = 0, lx = 0) => {
    P('pend-rod', 'metal', lx, CUT + 0.14, lz, 0.04, 0.28, 0.04)
    P('pend', 'lamp', lx, CUT - 0.06, lz, 0.5, 0.28, 0.5)
  }
  const floorLamp = (sx: number, sz: number) => {
    P('fl-pole', 'metal', sx * (W / 2 - 0.26), 0.68, sz * (D / 2 - 0.26), 0.05, 1.36, 0.05)
    P('fl-shade', 'lamp', sx * (W / 2 - 0.26), 1.46, sz * (D / 2 - 0.26), 0.36, 0.32, 0.36)
  }
  const plant = () => {
    // in the corner nearest a window
    const sx = win.E ? 1 : win.W ? -1 : 1
    const sz = win.S ? 1 : win.N ? -1 : 1
    P('plant-pot', 'ceramic', sx * (W / 2 - 0.3), 0.17, sz * (D / 2 - 0.3), 0.32, 0.34, 0.32)
    P('plant-fol', 'plant', sx * (W / 2 - 0.3), 0.74, sz * (D / 2 - 0.3), 0.64, 0.84, 0.64)
  }
  /** framed panels on a clear wall, centred, `count` across */
  const wallArt = (avoid: Side[], count = rng() < 0.38 ? 3 : 2) => {
    const side = SIDES.find((s) => !door[s] && !avoid.includes(s))
    if (!side) return
    const p = atWall(side, 0.03)
    for (let k = 0; k < count; k++) {
      const off = (k - (count - 1) / 2) * 0.7
      P(
        `art${k}`,
        'art',
        p.horiz ? off : p.x + (side === 'W' ? 0.03 : -0.03),
        CUT * 0.6,
        p.horiz ? p.z + (side === 'N' ? 0.03 : -0.03) : off,
        p.horiz ? 0.52 : 0.03,
        0.64,
        p.horiz ? 0.03 : 0.52,
      )
    }
  }

  const id = room.id
  const zone = room.zone

  /* ---- bedrooms ---- */
  if (id.startsWith('bed')) {
    const dbl = W * D >= 9.5 // m²
    const bw = clamp(dbl ? 1.6 : 1.05, 0.9, W - 0.85)
    const bl = clamp(2.04, 1.8, D - 0.7)
    const head = clearWall()
    const hb = atWall(head, 0.14)
    const along = head === 'N' || head === 'S' ? 'x' : 'z'
    const bedX = hb.horiz ? 0 : hb.x + (head === 'W' ? bl / 2 : -bl / 2)
    const bedZ = hb.horiz ? hb.z + (head === 'N' ? bl / 2 : -bl / 2) : 0
    const bedW = hb.horiz ? bw : bl
    const bedD = hb.horiz ? bl : bw
    const footX = head === 'W' ? 1 : head === 'E' ? -1 : 0
    const footZ = head === 'N' ? 1 : head === 'S' ? -1 : 0
    P('bed-base', 'wood', bedX, 0.17, bedZ, bedW + 0.12, 0.34, bedD + 0.12)
    P('bed-mat', 'cream', bedX, 0.46, bedZ, bedW, 0.26, bedD)
    // a folded throw across the foot third, in the room accent
    P(
      'throw',
      acc,
      bedX + footX * bl * 0.26,
      0.6,
      bedZ + footZ * bl * 0.26,
      hb.horiz ? bw : bl * 0.36,
      0.06,
      hb.horiz ? bl * 0.36 : bw,
    )
    P(
      'bed-pil',
      'cream',
      hb.horiz ? bedX : bedX + (head === 'W' ? -bl / 2 + 0.2 : bl / 2 - 0.2),
      0.62,
      hb.horiz ? bedZ + (head === 'N' ? -bl / 2 + 0.22 : bl / 2 - 0.22) : bedZ,
      hb.horiz ? bw * 0.86 : 0.44,
      0.16,
      hb.horiz ? 0.44 : bw * 0.86,
    )
    P(
      'bed-hb',
      acc2,
      hb.horiz ? bedX : hb.x,
      0.72,
      hb.horiz ? hb.z : bedZ,
      hb.horiz ? bw + 0.18 : 0.12,
      1.04,
      hb.horiz ? 0.12 : bw + 0.18,
    )
    // nightstands + a little lamp on each
    if (dbl && (along === 'x' ? W - bw > 1.2 : D - bw > 1.2)) {
      for (const s of [-1, 1] as const) {
        const nx = hb.horiz ? bedX + s * (bw / 2 + 0.3) : hb.x + (head === 'W' ? 0.26 : -0.26)
        const nz = hb.horiz ? hb.z + (head === 'N' ? 0.26 : -0.26) : bedZ + s * (bw / 2 + 0.3)
        P(`ns${s}`, 'panel', nx, 0.25, nz, 0.44, 0.48, 0.44)
        P(`nl${s}`, 'lamp', nx, 0.62, nz, 0.2, 0.28, 0.2)
      }
    }
    // a bench at the foot, if there's room to walk past it
    if (hb.horiz ? D - bl > 1.5 : W - bl > 1.5) {
      P(
        'foot-bench',
        acc,
        bedX + footX * (bl / 2 + 0.32),
        0.24,
        bedZ + footZ * (bl / 2 + 0.32),
        hb.horiz ? bw * 0.9 : 0.42,
        0.44,
        hb.horiz ? 0.42 : bw * 0.9,
      )
    }
    // wardrobe on a clear side wall
    const wr = SIDES.find((s) => s !== head && !door[s] && (s === 'W' || s === 'E' ? D : W) > 1.6)
    if (wr) {
      const p = atWall(wr, 0.6)
      P('wardrobe', 'panel', p.x, CUT / 2, p.z, p.horiz ? clamp(W - 0.5, 1, 2.6) : 0.6, CUT, p.horiz ? 0.6 : clamp(D - 0.5, 1, 2.6))
    }
    rug(bedW + 1.2, bedD + 1.0)
    pendant(bedZ * 0.25)
    wallArt([head, wr ?? head], 2)
    if (Object.values(win).some(Boolean)) plant()
    return n
  }

  /* ---- living / family lounge ---- */
  if (id === 'living' || id.startsWith('familyLounge') || id.startsWith('hall')) {
    if (id.startsWith('hall')) {
      // a spine hall: a runner + a slim console + a couple of frames
      rug(Math.min(W - 0.4, 1.1), Math.min(D - 0.4, 3.4))
      const cw = clearWall()
      const p = atWall(cw, 0.34)
      P('console', 'wood', p.x, 0.42, p.z, p.horiz ? 1.2 : 0.34, 0.82, p.horiz ? 0.34 : 1.2)
      wallArt([cw], 3)
      return n
    }
    const back = clearWall()
    const p = atWall(back, 1.0)
    const sofaLen = clamp(p.horiz ? W - 0.9 : D - 0.9, 1.7, 3.2)
    P('sofa-base', acc, p.x, 0.26, p.z, p.horiz ? sofaLen : 1.0, 0.36, p.horiz ? 1.0 : sofaLen)
    P(
      'sofa-back',
      acc,
      p.horiz ? p.x : p.x + (back === 'W' ? -0.36 : 0.36),
      0.62,
      p.horiz ? p.z + (back === 'N' ? -0.36 : 0.36) : p.z,
      p.horiz ? sofaLen : 0.26,
      0.56,
      p.horiz ? 0.26 : sofaLen,
    )
    P('sofa-seat', 'cream', p.x, 0.47, p.z, p.horiz ? sofaLen - 0.12 : 0.76, 0.18, p.horiz ? 0.76 : sofaLen - 0.12)
    for (const s of [-1, 1] as const)
      P(
        `sofa-arm${s}`,
        acc,
        p.horiz ? p.x + s * (sofaLen / 2 - 0.12) : p.x,
        0.46,
        p.horiz ? p.z : p.z + s * (sofaLen / 2 - 0.12),
        p.horiz ? 0.24 : 1.0,
        0.46,
        p.horiz ? 1.0 : 0.24,
      )
    // toss cushions in the second accent
    for (const s of [-1, 1] as const)
      P(
        `cush${s}`,
        acc2,
        p.horiz ? p.x + s * sofaLen * 0.24 : p.x + (back === 'W' ? 0.12 : -0.12),
        0.62,
        p.horiz ? p.z + (back === 'N' ? 0.12 : -0.12) : p.z + s * sofaLen * 0.24,
        0.34,
        0.3,
        0.34,
      )
    // coffee table in front
    const fwd = back === 'N' ? 1 : back === 'S' ? -1 : 0
    const fwdX = back === 'W' ? 1 : back === 'E' ? -1 : 0
    P(
      'coffee',
      'wood',
      p.x + fwdX * 1.05,
      0.22,
      p.z + fwd * 1.05,
      p.horiz ? sofaLen * 0.58 : 0.7,
      0.4,
      p.horiz ? 0.7 : sofaLen * 0.58,
    )
    // an ottoman off to one side
    P(
      'ottoman',
      acc2,
      p.x + fwdX * 1.05 + (p.horiz ? sofaLen * 0.42 : 0),
      0.21,
      p.z + fwd * 1.05 + (p.horiz ? 0 : sofaLen * 0.42),
      0.56,
      0.4,
      0.56,
    )
    // media console on the opposite wall
    const opp: Side = back === 'N' ? 'S' : back === 'S' ? 'N' : back === 'W' ? 'E' : 'W'
    const op = atWall(opp, 0.42)
    P('media', 'panel', op.x, 0.3, op.z, op.horiz ? clamp(W - 0.7, 1.2, 2.6) : 0.42, 0.52, op.horiz ? 0.42 : clamp(D - 0.7, 1.2, 2.6))
    P(
      'tv',
      'metal',
      op.horiz ? op.x : op.x + (opp === 'W' ? 0.06 : -0.06),
      1.04,
      op.horiz ? op.z + (opp === 'N' ? 0.04 : -0.04) : op.z,
      op.horiz ? 1.5 : 0.06,
      0.84,
      op.horiz ? 0.06 : 1.5,
    )
    rug(sofaLen + 1.0, 2.8)
    pendant(fwd * 0.5, fwdX * 0.5)
    floorLamp(fwdX >= 0 ? 1 : -1, fwd >= 0 ? 1 : -1)
    plant()
    return n
  }

  /* ---- dining ---- */
  if (id === 'dining') {
    const tw = clamp(W - 1.1, 1.0, 2.4)
    const td = clamp(D - 1.1, 0.9, 1.2)
    P('table', 'wood', 0, 0.38, 0, tw, 0.07, td)
    for (const s of [-1, 1] as const) {
      P(`tleg${s}`, 'wood', s * (tw / 2 - 0.1), 0.19, 0, 0.09, 0.38, td - 0.2)
    }
    const perLong = Math.max(2, Math.round(tw / 0.6))
    for (let i = 0; i < perLong; i++) {
      const lx = -tw / 2 + tw * ((i + 0.5) / perLong)
      for (const s of [-1, 1] as const) {
        P(`chair-${s > 0 ? 's' : 'n'}${i}`, acc, lx, 0.25, s * (td / 2 + 0.28), 0.46, 0.48, 0.46)
        P(`chairbk-${s > 0 ? 's' : 'n'}${i}`, 'wood', lx, 0.66, s * (td / 2 + 0.28 + (s > 0 ? 0.19 : -0.19)), 0.46, 0.56, 0.06)
      }
    }
    // a sideboard against a clear wall
    const cw = clearWall()
    const sp = atWall(cw, 0.4)
    P('sideboard', 'wood', sp.x, 0.4, sp.z, sp.horiz ? clamp(W - 0.8, 1.0, 2.2) : 0.4, 0.8, sp.horiz ? 0.4 : clamp(D - 0.8, 1.0, 2.2))
    rug(tw + 1.4, td + 1.4)
    pendant()
    wallArt([cw], 2)
    plant()
    return n
  }

  /* ---- kitchen ---- */
  if (id === 'kitchen') {
    // an L of base + upper cabinets along the two most-clear walls
    const walls = SIDES.filter((s) => !door[s]).slice(0, 2)
    if (walls.length === 0) walls.push('N')
    walls.forEach((s, wi) => {
      const p = atWall(s, 0.62)
      const run = p.horiz ? W - 0.15 : D - 0.15
      P(`kb-${s}`, 'panel', p.x, 0.46, p.z, p.horiz ? run : 0.62, 0.92, p.horiz ? 0.62 : run)
      P(`kc-${s}`, 'stone', p.x, 0.94, p.z, p.horiz ? run : 0.68, 0.06, p.horiz ? 0.68 : run)
      P(
        `ku-${s}`,
        'panel',
        p.horiz ? p.x : p.x + (s === 'W' ? 0.14 : -0.14),
        1.78,
        p.horiz ? p.z + (s === 'N' ? 0.14 : -0.14) : p.z,
        p.horiz ? run * 0.82 : 0.38,
        0.68,
        p.horiz ? 0.38 : run * 0.82,
      )
      // a tall fridge caps the first run; an extractor hood the second
      if (wi === 0) {
        P(
          `fridge-${s}`,
          'metal',
          p.horiz ? p.x - run / 2 + 0.36 : p.x,
          CUT / 2,
          p.horiz ? p.z : p.z - run / 2 + 0.36,
          p.horiz ? 0.72 : 0.66,
          CUT,
          p.horiz ? 0.66 : 0.72,
        )
      } else {
        P(
          `hood-${s}`,
          'metal',
          p.horiz ? p.x : p.x + (s === 'W' ? 0.16 : -0.16),
          1.5,
          p.horiz ? p.z + (s === 'N' ? 0.16 : -0.16) : p.z,
          p.horiz ? 0.8 : 0.5,
          0.32,
          p.horiz ? 0.5 : 0.8,
        )
      }
    })
    // island for a roomy kitchen
    if (W * (r.h / 1000) >= 8.5 && Math.min(W, D) > 2.6) {
      const iw = clamp(W * 0.44, 0.95, 2.0)
      const idp = clamp(D * 0.36, 0.75, 1.2)
      P('island', 'panel', 0, 0.46, 0, iw, 0.92, idp)
      P('island-top', 'stone', 0, 0.95, 0, iw + 0.12, 0.06, idp + 0.12)
      // a couple of stools tucked under one long side
      for (const s of [-1, 1] as const) P(`stool${s}`, 'wood', s * iw * 0.28, 0.3, idp / 2 + 0.24, 0.32, 0.6, 0.32)
      pendant(0, -iw * 0.26)
      pendant(0, iw * 0.26)
    }
    return n
  }

  /* ---- bathrooms ---- */
  if (zone === 'service' && /bath|toilet|wc/i.test(id + room.name)) {
    const cw = clearWall()
    const vp = atWall(cw, 0.52)
    P('vanity', 'panel', vp.x, 0.42, vp.z, vp.horiz ? clamp(W - 0.5, 0.7, 1.5) : 0.52, 0.84, vp.horiz ? 0.52 : clamp(D - 0.5, 0.7, 1.5))
    P('basin', 'ceramic', vp.x, 0.9, vp.z, 0.46, 0.16, 0.36)
    P(
      'mirror',
      'glass',
      vp.horiz ? vp.x : vp.x + (cw === 'W' ? 0.03 : -0.03),
      1.3,
      vp.horiz ? vp.z + (cw === 'N' ? 0.03 : -0.03) : vp.z,
      vp.horiz ? 0.6 : 0.03,
      0.7,
      vp.horiz ? 0.03 : 0.6,
    )
    // WC in a corner away from the vanity
    P('wc', 'ceramic', W / 2 - 0.34, 0.21, -D / 2 + 0.36, 0.4, 0.42, 0.58)
    P('wc-tank', 'ceramic', W / 2 - 0.34, 0.56, -D / 2 + 0.19, 0.44, 0.34, 0.17)
    // shower tray + glass in the far corner (kept under the wall line)
    if (W > 1.5 && D > 1.5) {
      P('shower-tray', 'stone', -W / 2 + 0.55, 0.04, D / 2 - 0.55, 1.0, 0.08, 1.0)
      P('shower-g1', 'glass', -W / 2 + 1.05, CUT / 2, D / 2 - 0.55, 0.04, CUT, 1.0)
      P('shower-g2', 'glass', -W / 2 + 0.55, CUT / 2, D / 2 - 1.05, 1.0, CUT, 0.04)
    }
    P('bath-mat', 'rug', vp.horiz ? vp.x : vp.x + (cw === 'W' ? 0.5 : -0.5), 0.03, vp.horiz ? vp.z + (cw === 'N' ? 0.5 : -0.5) : vp.z, 0.7, 0.03, 0.5)
    return n
  }

  /* ---- study / office ---- */
  if (id === 'study') {
    const dw = win.N ? 'N' : win.S ? 'S' : win.W ? 'W' : win.E ? 'E' : clearWall()
    const p = atWall(dw, 0.68)
    P('desk', 'wood', p.x, 0.38, p.z, p.horiz ? clamp(W - 0.7, 1.2, 2.0) : 0.68, 0.06, p.horiz ? 0.68 : clamp(D - 0.7, 1.2, 2.0))
    for (const s of [-1, 1] as const)
      P(`dleg${s}`, 'metal', p.horiz ? p.x + s * 0.62 : p.x, 0.19, p.horiz ? p.z : p.z + s * 0.62, 0.05, 0.38, 0.05)
    P('chair', acc, p.horiz ? p.x : p.x + (dw === 'W' ? 0.52 : -0.52), 0.25, p.horiz ? p.z + (dw === 'N' ? 0.52 : -0.52) : p.z, 0.48, 0.48, 0.48)
    P('chair-bk', 'metal', p.horiz ? p.x : p.x + (dw === 'W' ? 0.52 : -0.52), 0.64, p.horiz ? p.z + (dw === 'N' ? 0.68 : -0.68) : p.z, p.horiz ? 0.48 : 0.06, 0.52, p.horiz ? 0.06 : 0.48)
    const sw = SIDES.find((s) => s !== dw && !door[s])
    if (sw) {
      const sp = atWall(sw, 0.32)
      P('shelf', 'panel', sp.x, CUT / 2, sp.z, sp.horiz ? clamp(W - 0.7, 0.9, 2.2) : 0.32, CUT, sp.horiz ? 0.32 : clamp(D - 0.7, 0.9, 2.2))
    }
    rug(W - 0.6, D - 0.6)
    wallArt([dw, sw ?? dw], 2)
    return n
  }

  /* ---- pooja ---- */
  if (id === 'pooja' || /pooja|prayer|mandir/i.test(room.name)) {
    const bw = clearWall()
    const p = atWall(bw, 0.42)
    P('altar', 'wood', p.x, 0.37, p.z, p.horiz ? clamp(W - 0.3, 0.6, 1.5) : 0.42, 0.74, p.horiz ? 0.42 : clamp(D - 0.3, 0.6, 1.5))
    P('altar-cloth', acc, p.x, 0.76, p.z, p.horiz ? clamp(W - 0.3, 0.6, 1.5) : 0.44, 0.05, p.horiz ? 0.44 : clamp(D - 0.3, 0.6, 1.5))
    P(
      'altar-canopy',
      'wood',
      p.horiz ? p.x : p.x + (bw === 'W' ? 0.2 : -0.2),
      CUT - 0.05,
      p.horiz ? p.z + (bw === 'N' ? 0.2 : -0.2) : p.z,
      p.horiz ? clamp(W - 0.3, 0.6, 1.5) : 0.46,
      0.09,
      p.horiz ? 0.46 : clamp(D - 0.3, 0.6, 1.5),
    )
    rug(1.2, 1.2)
    P('lamp-diya', 'lamp', 0, 0.42, 0, 0.16, 0.12, 0.16)
    return n
  }

  /* ---- utility ---- */
  if (id === 'utility') {
    const cw = clearWall()
    const p = atWall(cw, 0.62)
    P('washer', 'panel', p.horiz ? p.x - (W - 0.8) / 4 : p.x, 0.43, p.horiz ? p.z : p.z - (D - 0.8) / 4, 0.64, 0.86, 0.62)
    P('counter', 'stone', p.x, 0.92, p.z, p.horiz ? clamp(W - 0.4, 0.8, 2.2) : 0.62, 0.06, p.horiz ? 0.62 : clamp(D - 0.4, 0.8, 2.2))
    return n
  }

  /* ---- foyer / entry ---- */
  if (id === 'foyer' || id.startsWith('lobby')) {
    const cw = clearWall()
    const p = atWall(cw, 0.34)
    P('console', 'wood', p.x, 0.42, p.z, p.horiz ? clamp(W - 0.5, 0.8, 1.5) : 0.34, 0.82, p.horiz ? 0.34 : clamp(D - 0.5, 0.8, 1.5))
    P(
      'mirror',
      'glass',
      p.horiz ? p.x : p.x + (cw === 'W' ? 0.02 : -0.02),
      1.36,
      p.horiz ? p.z + (cw === 'N' ? 0.02 : -0.02) : p.z,
      p.horiz ? 0.52 : 0.03,
      0.94,
      p.horiz ? 0.03 : 0.52,
    )
    // a small bench opposite
    const opp: Side = cw === 'N' ? 'S' : cw === 'S' ? 'N' : cw === 'W' ? 'E' : 'W'
    if (!door[opp]) {
      const bp = atWall(opp, 0.34)
      P('bench', acc, bp.x, 0.22, bp.z, bp.horiz ? clamp(W - 0.7, 0.8, 1.4) : 0.34, 0.4, bp.horiz ? 0.34 : clamp(D - 0.7, 0.8, 1.4))
    }
    rug(1.1, 1.7)
    return n
  }

  // circulation / stair / anything else — leave clear
  return n
}
