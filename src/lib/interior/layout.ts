import type { RoomBox, Side } from '../three/buildRoom.ts'

/* ------------------------------------------------------------------ *
 *  Interior layout for the 360 preview: what a designer would place in a
 *  living room, bedroom, dining room or study, fitted by rule to the
 *  room's real clear space, doors, windows and columns.
 *
 *  Rules (mm, residential practice):
 *    door swing / threshold kept clear  ........ leaf width + 150 deep
 *    main walkway  900, secondary  750
 *    sofa to TV  2100-3600 (≈ 1.5-2.5 × a 55" screen)
 *    sofa to coffee table  400-450
 *    beside a bed  ≥ 500 (nightstand) ; foot of bed  ≥ 750
 *    wardrobe front  900 ; dining chair pull-out  750
 *    nothing taller than a window's sill stands in front of it
 *  A piece that cannot meet its rule is left out, never forced in.
 *  Coordinates: room-local metres, x east, z south, y up from the floor.
 * ------------------------------------------------------------------ */

export type Facing = Side
export type PieceType =
  | 'sofa' | 'armchair' | 'coffee-table' | 'tv-unit' | 'tv' | 'rug' | 'side-table' | 'floor-lamp' | 'table-lamp' | 'plant'
  | 'bed' | 'nightstand' | 'wardrobe' | 'desk' | 'chair' | 'dining-table' | 'dining-chair' | 'sideboard' | 'bookshelf'
  | 'curtain' | 'art' | 'pendant' | 'console'
export type Piece = {
  id: string; type: PieceType
  /** centre of the footprint */
  x: number; z: number
  /** width across the front, depth front-to-back, height */
  w: number; d: number; h: number
  /** the direction the front of the piece faces */
  face: Facing
  /** height of the underside above the floor (wall-hung pieces, lamps on tables) */
  y?: number
  variant?: string
}
type Rect = { x0: number; x1: number; z0: number; z1: number }
type Opening = { kind: string; side: Side; alongM?: number; widthM: number; sillM: number; headM: number }
export type RoomKind = 'living' | 'bedroom' | 'dining' | 'study'

const OPP: Record<Side, Side> = { N: 'S', S: 'N', E: 'W', W: 'E' }
const along = (s: Side) => s === 'N' || s === 'S'   // wall runs along x

export function roomKindOf(id: string, name: string): RoomKind | null {
  const t = `${id} ${name}`
  if (/kitchen|bath|toilet|wc|powder|utility|store|pooja|puja|stair|corridor|foyer|lobby|wash|laundry/i.test(t)) return null
  if (/living|family|lounge|drawing|media|sitting/i.test(t)) return 'living'
  if (/dining/i.test(t)) return 'dining'
  if (/bed|master|guest/i.test(t)) return 'bedroom'
  if (/study|office|library/i.test(t)) return 'study'
  return null
}

/** the clear inside of the room: each wall's inner face, from the room's own wall boxes */
export function clearRoom(shell: RoomBox[], dims: { w: number; d: number }): Rect {
  const r: Rect = { x0: -dims.w / 2 + 0.06, x1: dims.w / 2 - 0.06, z0: -dims.d / 2 + 0.06, z1: dims.d / 2 - 0.06 }
  for (const b of shell) {
    if (b.mat !== 'wall' || b.id.startsWith('connected') || b.id.startsWith('column')) continue
    const [x, , z] = b.pos, [sx, , sz] = b.size
    if (sz <= sx && Math.abs(Math.abs(z) - dims.d / 2) < 0.2) { if (z < 0) r.z0 = Math.max(r.z0, z + sz / 2); else r.z1 = Math.min(r.z1, z - sz / 2) }
    else if (sx < sz && Math.abs(Math.abs(x) - dims.w / 2) < 0.2) { if (x < 0) r.x0 = Math.max(r.x0, x + sx / 2); else r.x1 = Math.min(r.x1, x - sx / 2) }
  }
  return r
}

class Planner {
  pieces: Piece[] = []
  blocked: { rect: Rect; tag: string }[] = []
  room: Rect
  openings: Opening[]
  kind: RoomKind
  id: string
  constructor(room: Rect, openings: Opening[], columns: RoomBox[], kind: RoomKind, id: string) {
    this.room = room; this.openings = openings; this.kind = kind; this.id = id
    // doors: the leaf's swing and the threshold stay clear
    for (const o of openings.filter((o) => o.kind !== 'window' && o.alongM !== undefined)) {
      const depth = o.widthM > 1.2 ? 0.8 : Math.min(o.widthM, 1.0) + 0.1, half = o.widthM / 2 + 0.1
      this.blocked.push({ rect: this.band(o.side, o.alongM! - half, o.alongM! + half, depth), tag: 'door' })
    }
    for (const c of columns) this.blocked.push({ rect: { x0: c.pos[0] - c.size[0] / 2, x1: c.pos[0] + c.size[0] / 2, z0: c.pos[2] - c.size[2] / 2, z1: c.pos[2] + c.size[2] / 2 }, tag: 'column' })
  }
  get w() { return this.room.x1 - this.room.x0 }
  get d() { return this.room.z1 - this.room.z0 }
  /** wall length and the coordinate range along it */
  span(side: Side): [number, number] { return along(side) ? [this.room.x0, this.room.x1] : [this.room.z0, this.room.z1] }
  /** a strip against a wall: from a to b along it, `depth` into the room */
  band(side: Side, a: number, b: number, depth: number, gap = 0): Rect {
    const r = this.room
    if (side === 'N') return { x0: a, x1: b, z0: r.z0 + gap, z1: r.z0 + gap + depth }
    if (side === 'S') return { x0: a, x1: b, z0: r.z1 - gap - depth, z1: r.z1 - gap }
    if (side === 'W') return { x0: r.x0 + gap, x1: r.x0 + gap + depth, z0: a, z1: b }
    return { x0: r.x1 - gap - depth, x1: r.x1 - gap, z0: a, z1: b }
  }
  footprint(p: Piece): Rect {
    const [fw, fd] = along(p.face) ? [p.w, p.d] : [p.d, p.w]
    return { x0: p.x - fw / 2, x1: p.x + fw / 2, z0: p.z - fd / 2, z1: p.z + fd / 2 }
  }
  inside(r: Rect) { return r.x0 >= this.room.x0 - 1e-6 && r.x1 <= this.room.x1 + 1e-6 && r.z0 >= this.room.z0 - 1e-6 && r.z1 <= this.room.z1 + 1e-6 }
  hits(a: Rect, b: Rect, pad = 0) { return a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.z0 < b.z1 + pad && a.z1 > b.z0 - pad }
  /** a window on this wall whose sill is lower than the piece, over this stretch */
  windowBehind(side: Side, a: number, b: number, height: number) {
    return this.openings.some((o) => o.kind === 'window' && o.side === side && o.alongM !== undefined && o.sillM < height
      && o.alongM - o.widthM / 2 < b && o.alongM + o.widthM / 2 > a)
  }
  free(r: Rect, pad = 0, ignore: string[] = []) {
    return this.inside(r) && !this.blocked.some((b) => this.hits(r, b.rect)) && !this.pieces.some((p) => !ignore.includes(p.type) && p.type !== 'rug' && p.type !== 'curtain' && p.type !== 'art' && p.type !== 'pendant' && this.hits(r, this.footprint(p), pad))
  }
  clearOfFurniture(r: Rect, ignore: string[] = []) {
    return this.inside(r) && !this.pieces.some((p) => !ignore.includes(p.type) && !['rug', 'curtain', 'art', 'pendant'].includes(p.type) && this.hits(r, this.footprint(p)))
  }
  add(p: Piece, pad = 0.05, ignore: string[] = []): boolean {
    if (!this.free(this.footprint(p), pad, ignore)) return false
    this.pieces.push(p)
    return true
  }
  /** a piece standing with its back to a wall, centred at `c` along it */
  against(side: Side, c: number, w: number, d: number, h: number, type: PieceType, id: string, gap = 0.02): Piece {
    const face = OPP[side]
    const r = this.room
    const off = gap + d / 2
    const [x, z] = side === 'N' ? [c, r.z0 + off] : side === 'S' ? [c, r.z1 - off] : side === 'W' ? [r.x0 + off, c] : [r.x1 - off, c]
    return { id: `${this.id}-${id}`, type, x, z, w, d, h, face }
  }
  /** stretches of a wall with no door and (for pieces taller than a sill) no window, at least `min` long */
  solid(side: Side, height: number, min: number): [number, number][] {
    const [lo, hi] = this.span(side)
    const cuts: [number, number][] = []
    for (const o of this.openings) {
      if (o.side !== side || o.alongM === undefined) continue
      if (o.kind === 'window' && o.sillM >= height) continue
      // a tall piece also keeps clear of the curtains hanging beside a window
      const margin = o.kind === 'window' ? (height > 1.5 ? 0.5 : 0.05) : 0.15
      cuts.push([o.alongM - o.widthM / 2 - margin, o.alongM + o.widthM / 2 + margin])
    }
    for (const b of this.blocked) {
      const r = b.rect
      const touches = side === 'N' ? r.z0 <= this.room.z0 + 0.05 : side === 'S' ? r.z1 >= this.room.z1 - 0.05 : side === 'W' ? r.x0 <= this.room.x0 + 0.05 : r.x1 >= this.room.x1 - 0.05
      if (touches) cuts.push(along(side) ? [r.x0, r.x1] : [r.z0, r.z1])
    }
    cuts.sort((a, b) => a[0] - b[0])
    const out: [number, number][] = []
    let at = lo
    for (const [a, b] of cuts) { if (a - at >= min) out.push([at, a]); at = Math.max(at, b) }
    if (hi - at >= min) out.push([at, hi])
    return out
  }
  distance(side: Side) { return along(side) ? this.d : this.w }
}

/** a rectangle pulled in by m on every side */
const shrink = (r: Rect, m: number): Rect => ({ x0: r.x0 + m, x1: r.x1 - m, z0: r.z0 + m, z1: r.z1 - m })
const longest = (segments: [number, number][]) => [...segments].sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0]
const mid = (s: [number, number]) => (s[0] + s[1]) / 2
const len = (s: [number, number]) => s[1] - s[0]

function curtains(p: Planner, height: number) {
  for (const o of p.openings.filter((o) => o.kind === 'window' && o.alongM !== undefined)) {
    const panel = Math.min(0.7, o.widthM * 0.3)
    for (const [k, sign] of [[0, -1], [1, 1]] as const) {
      const [lo, hi] = p.span(o.side)
      const c = Math.max(lo + panel / 2, Math.min(hi - panel / 2, o.alongM! + sign * (o.widthM / 2 + panel / 2 - 0.15)))
      const piece = p.against(o.side, c, panel, 0.12, height - 0.05, 'curtain', `curtain-${o.side}-${k}`, 0.06)
      p.pieces.push(piece)
    }
  }
}

function art(p: Planner, side: Side, c: number, width: number, y: number, id: string) {
  if (p.windowBehind(side, c - width / 2, c + width / 2, y + width * 0.7) || p.openings.some((o) => o.kind !== 'window' && o.side === side && o.alongM !== undefined && Math.abs(o.alongM - c) < (o.widthM + width) / 2)) return
  const piece = p.against(side, c, width, 0.04, width * 0.7, 'art', id, 0.0)
  piece.y = y
  p.pieces.push(piece)
}

function plantInCorner(p: Planner, n = 1) {
  const corners: [number, number][] = [[p.room.x0 + 0.3, p.room.z0 + 0.3], [p.room.x1 - 0.3, p.room.z0 + 0.3], [p.room.x0 + 0.3, p.room.z1 - 0.3], [p.room.x1 - 0.3, p.room.z1 - 0.3]]
  let placed = 0
  for (const [x, z] of corners) {
    if (placed >= n) break
    const piece: Piece = { id: `${p.id}-plant-${placed}`, type: 'plant', x, z, w: 0.42, d: 0.42, h: 1.3, face: 'S' }
    if (p.add(piece, 0.1)) placed++
  }
}

/** an armchair, side table and floor lamp in the emptiest free corner, turned to face into the room */
function readingCorner(p: Planner) {
  const r = p.room
  const corners: [number, number, Side][] = [[r.x0, r.z0, 'S'], [r.x1, r.z0, 'S'], [r.x0, r.z1, 'N'], [r.x1, r.z1, 'N']]
  const scored = corners.map(([x, z, face]) => ({ x, z, face, gap: Math.min(...p.pieces.filter((q) => !['rug', 'curtain', 'art', 'tv'].includes(q.type)).map((q) => Math.hypot(q.x - x, q.z - z)), 99) }))
    .sort((a, b) => b.gap - a.gap)
  for (const c of scored) {
    if (c.gap < 2.0) break
    const sx = c.x === r.x0 ? 1 : -1, sz = c.z === r.z0 ? 1 : -1
    const chair: Piece = { id: `${p.id}-reading-chair`, type: 'armchair', x: c.x + sx * 0.6, z: c.z + sz * 0.6, w: 0.8, d: 0.82, h: 0.8, face: c.face }
    if (!p.add(chair, 0.1)) continue
    p.add({ id: `${p.id}-reading-lamp`, type: 'floor-lamp', x: c.x + sx * 0.25, z: c.z + sz * 0.25, w: 0.38, d: 0.38, h: 1.6, face: c.face }, 0.0)
    p.add({ id: `${p.id}-reading-table`, type: 'side-table', x: c.x + sx * 1.25, z: c.z + sz * 0.45, w: 0.42, d: 0.42, h: 0.52, face: c.face }, 0.05)
    return
  }
}

/* ---------------------------------------------------------------- living */

function living(p: Planner, ceiling: number) {
  // the TV wall: a solid stretch for the unit (the screen is above sill height); the sofa faces it from the opposite side
  const sides: Side[] = ['N', 'S', 'E', 'W']
  type Plan = { tv: Side; seg: [number, number]; score: number }
  const plans: Plan[] = []
  for (const tv of sides) {
    const span = p.distance(tv)
    if (span < 2.6) continue
    for (const seg of p.solid(tv, 1.5, 1.6)) {
      // a comfortable viewing distance across the room scores highest; a longer wall gives more room for the unit
      const view = Math.min(span, 3.6)
      plans.push({ tv, seg, score: -Math.abs(view - 3.0) * 2 + Math.min(len(seg), 3) * 0.6 - (span > 4.8 ? 0.5 : 0) })
    }
  }
  plans.sort((a, b) => b.score - a.score)
  for (const plan of plans) {
    const before = p.pieces.length
    const c = mid(plan.seg)
    const unitW = Math.min(2.2, len(plan.seg) - 0.1)
    const sofaSide = OPP[plan.tv]
    const span = p.distance(plan.tv)
    const unit = p.against(plan.tv, c, unitW, 0.42, 0.48, 'tv-unit', 'tv-unit')
    if (!p.add(unit)) continue
    const tv = p.against(plan.tv, c, Math.min(1.25, unitW - 0.1), 0.05, 0.72, 'tv', 'tv', 0.03)
    tv.y = 0.95
    p.pieces.push(tv)
    // the sofa: against the far wall when the room allows a normal viewing distance, else floating at 3.2 m
    const sofaW = 2.2, sofaD = 0.92
    const windowBehindSofa = p.windowBehind(sofaSide, c - sofaW / 2, c + sofaW / 2, 3)
    const gaps = span <= 4.4 ? [windowBehindSofa ? 0.16 : 0.04] : [3.2, 3.0, 2.8, 2.6, 2.4].map((view) => span - 0.42 - view - sofaD)
    const fixed = p.pieces.length
    let sofa: Piece | null = null, sofaGap = 0, gapSofaTv = 0
    for (const g of gaps) {
      for (const w of [sofaW, 2.0, 1.8]) {
        const cand = p.against(sofaSide, c, w, sofaD, 0.82, 'sofa', 'sofa', g)
        // the sofa back is under a window's sill or against solid wall
        if (g < 0.3 && p.windowBehind(sofaSide, c - w / 2, c + w / 2, 0.82)) continue
        if (p.add(cand, 0.05)) { sofa = cand; break }
      }
      if (!sofa) continue
      sofaGap = g
      gapSofaTv = span - 0.42 - sofaD - sofaGap
      // coffee table 0.42 m in front of the sofa, a 450 passage to the unit
      const tableD = Math.min(0.6, gapSofaTv - 0.42 - 0.45)
      const t = tableD >= 0.4 ? p.against(sofaSide, c, Math.min(1.2, sofa.w * 0.55), tableD, 0.42, 'coffee-table', 'coffee-table', sofaGap + sofaD + 0.42) : null
      if (t && p.add(t, 0.0)) break
      // without its table a floating sofa tries a nearer distance; against a wall it stays as it is
      if (span <= 4.4) break
      p.pieces.splice(fixed); sofa = null
    }
    if (!sofa && gaps.length > 1) {
      // no distance leaves room for a coffee table: the sofa alone at the most comfortable distance that fits
      for (const g of gaps) { const cand = p.against(sofaSide, c, sofaW, sofaD, 0.82, 'sofa', 'sofa', g); if (p.add(cand, 0.05)) { sofa = cand; sofaGap = g; gapSofaTv = span - 0.42 - sofaD - g; break } }
    }
    if (!sofa) { p.pieces.splice(before); continue }
    const rugD = Math.min(gapSofaTv + 0.35 - 0.15, 2.0)
    const rug = p.against(sofaSide, c, Math.min(sofa.w + 0.6, 2.8), rugD, 0.012, 'rug', 'rug', sofaGap + sofaD - 0.35)
    p.pieces.push(rug)
    // side table and floor lamp at the sofa's ends
    for (const [k, sign] of [[0, -1], [1, 1]] as const) {
      const at = c + sign * (sofa.w / 2 + 0.3)
      const st = p.against(sofaSide, at, 0.45, 0.45, 0.55, k === 0 ? 'side-table' : 'floor-lamp', k === 0 ? 'side-table' : 'floor-lamp', sofaGap + 0.2)
      if (k === 1) { st.w = st.d = 0.4; st.h = 1.6 }
      p.add(st, 0.04)
    }
    // an armchair turned towards the coffee table, where the walkway allows
    const tableCentre = sofaGap + sofaD + 0.42 + 0.3
    for (const sign of [1, -1]) {
      const at = c + sign * (sofa.w / 2 + 0.75)
      const face: Facing = along(plan.tv) ? (sign > 0 ? 'W' : 'E') : (sign > 0 ? 'N' : 'S')
      const r = p.room
      const [x, z] = sofaSide === 'N' ? [at, r.z0 + tableCentre] : sofaSide === 'S' ? [at, r.z1 - tableCentre] : sofaSide === 'W' ? [r.x0 + tableCentre, at] : [r.x1 - tableCentre, at]
      if (p.add({ id: `${p.id}-armchair`, type: 'armchair', x, z, w: 0.8, d: 0.82, h: 0.8, face }, 0.25)) break
    }
    // the other half of a long room: a console or bookshelf on a solid wall
    for (const side of sides) {
      const seg = longest(p.solid(side, 2.0, 1.4).filter((s) => !p.pieces.some((q) => q.type === 'sofa' && p.hits(p.band(side, s[0], s[1], 0.5), p.footprint(q)))))
      if (!seg) continue
      const shelf = p.against(side, mid(seg), Math.min(1.6, len(seg) - 0.2), 0.36, 2.0, 'bookshelf', 'bookshelf')
      if (p.add(shelf, 0.5)) break
    }
    readingCorner(p)
    plantInCorner(p, 2)
    // art: over the sofa when it stands against solid wall, else on the longest clear wall
    const sofaWall = p.solid(sofaSide, 2.4, 1.2).find((s) => s[0] <= sofa!.x && s[1] >= sofa!.x || s[0] <= sofa!.z && s[1] >= sofa!.z)
    if (sofaGap < 0.1 && sofaWall) art(p, sofaSide, c, Math.min(1.2, sofa.w * 0.55), 1.35, 'art')
    curtains(p, ceiling)
    return
  }
  plantInCorner(p, 2)
  curtains(p, ceiling)
}

/* ---------------------------------------------------------------- bedroom */

/** a wardrobe on a solid wall other than the headboard's, with 0.75 m clear in front (sliding shutters) */
function placeWardrobe(p: Planner, headWall: Side): boolean {
  for (const side of (['N', 'S', 'E', 'W'] as Side[]).filter((s) => s !== headWall)) {
    for (const seg of p.solid(side, 2.1, 1.0).sort((a, b) => len(b) - len(a))) {
      const w = Math.min(2.4, len(seg) - 0.05)
      for (const c of [seg[0] + w / 2 + 0.02, mid(seg), seg[1] - w / 2 - 0.02]) {
        const cand = p.against(side, c, w, 0.6, 2.1, 'wardrobe', 'wardrobe')
        if (!p.clearOfFurniture(p.band(side, c - w / 2, c + w / 2, 0.6 + 0.75), ['table-lamp'])) continue
        if (p.add(cand, 0.05)) return true
      }
    }
  }
  return false
}

function bedroom(p: Planner, ceiling: number, master: boolean) {
  const minDim = Math.min(p.w, p.d)
  const bedW = minDim < 2.8 ? 1.2 : master && minDim >= 3.4 ? 1.8 : 1.6, bedL = 2.05
  const sides: Side[] = ['N', 'S', 'E', 'W']
  const footWalk = minDim < 3.0 ? 0.6 : 0.75
  // first a solid wall with room for both nightstands, then any solid wall, then under a window with a low headboard
  const tries: { side: Side; seg: [number, number]; low: boolean }[] = []
  for (const [height, low, need] of [[1.1, false, bedW + 1.0], [1.1, false, bedW + 0.1], [0.85, true, bedW + 0.1]] as const)
    for (const side of sides) for (const seg of p.solid(side, height, need)) tries.push({ side, seg, low })
  // every bed position along its wall, centre first, 0.2 m apart
  const spots = (seg: [number, number]) => {
    const lo = seg[0] + bedW / 2 + 0.05, hi = seg[1] - bedW / 2 - 0.05, c = Math.max(lo, Math.min(hi, mid(seg)))
    const out = [c]
    for (let k = 1; k < 12; k++) for (const v of [c - k * 0.2, c + k * 0.2]) if (v >= lo - 1e-6 && v <= hi + 1e-6) out.push(v)
    return out
  }
  const putBed = (side: Side, at: number, low: boolean): Piece | null => {
    if (p.distance(side) < bedL + footWalk) return null
    const cand = p.against(side, at, bedW + 0.1, bedL, low ? 0.85 : 1.05, 'bed', 'bed', low ? 0.08 : 0.0)
    cand.variant = `${bedW >= 1.8 ? 'king' : bedW >= 1.6 ? 'queen' : 'single'}${low ? '-low' : ''}`
    if (!p.clearOfFurniture(p.band(side, at - bedW / 2, at + bedW / 2, bedL + footWalk))) return null
    if (!p.add(cand, 0.0)) return null
    p.blocked.push({ rect: p.band(side, at - bedW / 2, at + bedW / 2, footWalk, bedL), tag: 'walk' })
    return cand
  }
  // the bed and the wardrobe are placed together: the first bed position that still leaves a wardrobe its wall wins
  let bed: Piece | null = null, headWall: Side | null = null, fallback: { side: Side; at: number; low: boolean } | null = null
  search: for (const { side, seg, low } of tries) for (const at of spots(seg)) {
    const pieces = p.pieces.length, blocked = p.blocked.length
    const placed = putBed(side, at, low)
    if (!placed) continue
    if (placeWardrobe(p, side)) { bed = placed; headWall = side; break search }
    fallback ??= { side, at, low }
    p.pieces.splice(pieces); p.blocked.splice(blocked)
  }
  if (!bed && fallback) { bed = putBed(fallback.side, fallback.at, fallback.low); headWall = fallback.side }
  if (bed && headWall) {
    const c = along(headWall) ? bed.x : bed.z
    for (const [k, sign] of [[0, -1], [1, 1]] as const) {
      const at = c + sign * (bed.w / 2 + 0.26)
      const ns = p.against(headWall, at, 0.46, 0.4, 0.5, 'nightstand', `nightstand-${k}`)
      if (p.add(ns, 0.02)) p.pieces.push({ ...ns, id: `${ns.id}-lamp`, type: 'table-lamp', w: 0.3, d: 0.3, h: 0.5, y: 0.5 })
    }
    p.pieces.push(p.against(headWall, c, bed.w + 1.0, 1.7, 0.012, 'rug', 'rug', 0.9))
    if (p.solid(headWall, 2.6, bed.w).length) art(p, headWall, c, Math.min(1.1, bed.w * 0.7), 1.4, 'art')
  }
  // a desk and chair under the window, if the room has the space
  for (const o of p.openings.filter((o) => o.kind === 'window' && o.alongM !== undefined)) {
    const desk = p.against(o.side, o.alongM!, Math.min(1.2, o.widthM), 0.55, 0.75, 'desk', 'desk')
    if (o.sillM >= 0.75 && p.add(desk, 0.1)) {
      const chair = p.against(o.side, o.alongM!, 0.48, 0.5, 0.85, 'chair', 'desk-chair', 0.5)
      chair.face = o.side
      if (!p.add(chair, 0.0, ['desk'])) p.pieces.splice(p.pieces.indexOf(desk), 1)
      else break
    }
  }
  plantInCorner(p, 1)
  curtains(p, ceiling)
}

/* ---------------------------------------------------------------- dining */

function dining(p: Planner, ceiling: number) {
  const longX = p.w >= p.d
  const L = longX ? p.w : p.d, S = longX ? p.d : p.w
  const centre = { x: (p.room.x0 + p.room.x1) / 2, z: (p.room.z0 + p.room.z1) / 2 }
  let table: Piece | null = null, seats = 0, tl = 0, tw = 0
  outer: for (const n of [L >= 3.6 && S >= 2.7 ? 6 : 4, 4, 2]) {
    seats = n; tl = n === 6 ? 1.8 : n === 4 ? 1.3 : 0.8; tw = n === 2 ? 0.75 : 0.9
    for (const s1 of [0, 0.2, -0.2, 0.4, -0.4, 0.6, -0.6]) for (const s2 of [0, 0.2, -0.2, 0.4, -0.4]) {
      const cand: Piece = { id: `${p.id}-table`, type: 'dining-table', x: centre.x + (longX ? s1 : s2), z: centre.z + (longX ? s2 : s1), w: longX ? tl : tw, d: longX ? tw : tl, h: 0.75, face: 'S' }
      // the table with its chairs tucked in, and room to pull one out against the walls
      const withChairs: Rect = { x0: cand.x - cand.w / 2 - 0.5, x1: cand.x + cand.w / 2 + 0.5, z0: cand.z - cand.d / 2 - 0.5, z1: cand.z + cand.d / 2 + 0.5 }
      // chairs may come within the last 0.2 m of a door's clearance (the leaf swings to one side), never into its swing
      const doorHit = p.blocked.some((b) => b.tag === 'door' ? p.hits(withChairs, shrink(b.rect, 0.2)) : p.hits(withChairs, b.rect))
      if (doorHit || !p.inside(withChairs)) continue
      if (p.add(cand, 0.0)) { table = cand; break outer }
    }
  }
  if (table) {
    const perSide = seats / 2 - (seats === 6 ? 1 : 0)
    const lx = longX
    for (let i = 0; i < perSide; i++) {
      const t = (i + 0.5) / perSide - 0.5
      for (const sign of [-1, 1]) {
        const x = lx ? table.x + t * tl : table.x + sign * (tw / 2 + 0.22)
        const z = lx ? table.z + sign * (tw / 2 + 0.22) : table.z + t * tl
        const face: Facing = lx ? (sign < 0 ? 'S' : 'N') : (sign < 0 ? 'E' : 'W')
        p.add({ id: `${p.id}-chair-${i}-${sign}`, type: 'dining-chair', x, z, w: 0.46, d: 0.5, h: 0.9, face }, 0.0, ['dining-table'])
      }
    }
    if (seats === 6) for (const sign of [-1, 1]) {
      const x = lx ? table.x + sign * (tl / 2 + 0.22) : table.x
      const z = lx ? table.z : table.z + sign * (tl / 2 + 0.22)
      const face: Facing = lx ? (sign < 0 ? 'E' : 'W') : (sign < 0 ? 'S' : 'N')
      p.add({ id: `${p.id}-chair-end-${sign}`, type: 'dining-chair', x, z, w: 0.46, d: 0.5, h: 0.9, face }, 0.0, ['dining-table'])
    }
    p.pieces.push({ id: `${p.id}-pendant`, type: 'pendant', x: table.x, z: table.z, w: 0.45, d: 0.45, h: 0.4, face: 'S', y: Math.max(1.55, ceiling - 1.3) })
    // a sideboard on a solid wall with chairs still pulling out
    for (const side of ['N', 'S', 'E', 'W'] as Side[]) {
      const seg = longest(p.solid(side, 0.9, 1.3))
      if (!seg) continue
      const sb = p.against(side, mid(seg), Math.min(1.6, len(seg) - 0.1), 0.45, 0.8, 'sideboard', 'sideboard')
      if (p.add(sb, 0.75)) { art(p, side, mid(seg), 0.9, 1.4, 'art'); break }
    }
  }
  plantInCorner(p, 1)
  curtains(p, ceiling)
}

/* ---------------------------------------------------------------- study */

function study(p: Planner, ceiling: number) {
  const win = p.openings.find((o) => o.kind === 'window' && o.alongM !== undefined && o.sillM >= 0.75)
  const sides: Side[] = ['N', 'S', 'E', 'W']
  let placed = false
  if (win) {
    const desk = p.against(win.side, win.alongM!, Math.min(1.4, win.widthM + 0.2), 0.6, 0.75, 'desk', 'desk')
    if (p.add(desk, 0.1)) {
      const chair = p.against(win.side, win.alongM!, 0.5, 0.5, 0.95, 'chair', 'chair', 0.55)
      chair.face = win.side
      p.add(chair, 0.0, ['desk'])
      placed = true
    }
  }
  if (!placed) for (const side of sides) {
    const seg = longest(p.solid(side, 0.8, 1.3))
    if (!seg) continue
    const desk = p.against(side, mid(seg), 1.3, 0.6, 0.75, 'desk', 'desk')
    if (p.add(desk, 0.1)) { const chair = p.against(side, mid(seg), 0.5, 0.5, 0.95, 'chair', 'chair', 0.55); chair.face = side; p.add(chair, 0, ['desk']); break }
  }
  for (const side of sides) {
    const seg = longest(p.solid(side, 2.0, 1.0))
    if (seg && p.add(p.against(side, mid(seg), Math.min(1.8, len(seg) - 0.1), 0.36, 2.0, 'bookshelf', 'bookshelf'), 0.5)) break
  }
  for (const side of sides) {
    const seg = longest(p.solid(side, 0.9, 1.0))
    if (!seg) continue
    const a = p.against(side, mid(seg), 0.8, 0.82, 0.8, 'armchair', 'armchair', 0.05)
    if (p.add(a, 0.6)) { p.add(p.against(side, mid(seg) + 0.62, 0.4, 0.4, 1.6, 'floor-lamp', 'lamp', 0.1), 0.05); break }
  }
  plantInCorner(p, 1)
  curtains(p, ceiling)
}

export function layoutRoom(kind: RoomKind, id: string, name: string, shell: RoomBox[], openings: Opening[], dims: { w: number; d: number; h: number }): Piece[] {
  const room = clearRoom(shell, dims)
  const columns = shell.filter((b) => b.id.startsWith('column'))
  const p = new Planner(room, openings, columns, kind, id)
  if (kind === 'living') living(p, dims.h)
  else if (kind === 'bedroom') bedroom(p, dims.h, /master/i.test(`${id} ${name}`))
  else if (kind === 'dining') dining(p, dims.h)
  else study(p, dims.h)
  return p.pieces
}
