import type { Design, FloorPlan, PlacedRoom } from '../engine/types.ts'
import type { DressedRoom, Look, houseLooks } from './dressRoom.ts'

/* ------------------------------------------------------------------ *
 *  buildDollhouse — a warm, furnished cut-away model of the whole
 *  house: floor slabs, walls trimmed to ~1.15 m, a stepped stair and
 *  parametric furniture in every room, keyed to room type / size and
 *  the real door & window positions. Pure function of the Design,
 *  deterministic, no textures — reads by form + a warm accent palette.
 * ------------------------------------------------------------------ */

export type DollMat =
  | 'wall'
  | 'door' // door leaf + frame — teak, reads as a real opening
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
  /** a chosen finish or the interior style's colour: when set it replaces the material's palette colour */
  look?: Look
  shape?: 'box' | 'cyl' | 'ball'
  /** turn about the vertical, radians */
  rot?: number
  /** rounded edges, metres */
  bevel?: number
}

/** dresses each room as the 360 preview does (src/lib/three/dressRoom.ts): same furniture, style and finishes */
export type Dresser = {
  room: (level: number, roomId: string) => DressedRoom | null
  house: ReturnType<typeof houseLooks>
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
export function buildDollhouse(design: Design, only?: number, dresser?: Dresser): Dollhouse {
  const { model } = design
  const isolate = only !== undefined
  const plotW = model.plot.width
  const plotD = model.plot.depth
  const H = model.brief.levels.floorToFloor
  const wx = (mm: number) => (mm - plotW / 2) / 1000
  const wz = (mm: number) => (mm - plotD / 2) / 1000
  const m = (mm: number) => mm / 1000

  const boxes: DollBox[] = []
  const push = (id: string, mat: DollMat, pos: [number, number, number], size: [number, number, number], extra?: Pick<DollBox, 'look' | 'shape' | 'rot'>) => {
    if (size[0] > 0.015 && size[1] > 0.015 && size[2] > 0.015) boxes.push({ id, mat, pos, size, ...extra })
  }
  const house = dresser?.house ?? null
  // what each room IS, straight from the building model — a recipe is chosen
  // by room type, never guessed from a label
  const roomTypes = new Map<string, string>()
  const cbm = (design as { cbm?: { floors: { rooms: { id: string; type: string }[] }[] } }).cbm
  for (const f of cbm?.floors ?? []) for (const rm of f.rooms) roomTypes.set(rm.id, rm.type)
  const typeOf = (id: string) => roomTypes.get(id)

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
    // every room of the storey dressed up front, so the walls can take each room's paint and tiles
    const dressed = new Map<string, DressedRoom>()
    if (dresser) for (const room of floor.rooms) {
      if (room.outdoor) continue
      try {
        const d = dresser.room(L, room.id)
        if (d) dressed.set(room.id, d)
      } catch {
        // a room the 360 cannot isolate (a double-height gallery) keeps the rule-placed furniture below
      }
    }
    /** a wall piece, and on each face the paint or tiles of the room it faces */
    const wallPiece = (id: string, horiz: boolean, fixed: number, s0: number, s1: number, y0: number, y1: number, t: number) => {
      const mid = (s0 + s1) / 2
      push(id, 'wall', horiz ? [wx(mid), baseY + (y0 + y1) / 2, wz(fixed)] : [wx(fixed), baseY + (y0 + y1) / 2, wz(mid)],
        horiz ? [m(s1 - s0), y1 - y0, t] : [t, y1 - y0, m(s1 - s0)])
      if (!dressed.size) return
      for (const room of floor.rooms) {
        const d = dressed.get(room.id)
        if (!d) continue
        const r = room.rect
        // which of the room's walls this is, and so which way its face looks
        const side = horiz ? (Math.abs(r.y - fixed) < 150 ? 'N' : Math.abs(r.y + r.h - fixed) < 150 ? 'S' : null)
          : (Math.abs(r.x - fixed) < 150 ? 'W' : Math.abs(r.x + r.w - fixed) < 150 ? 'E' : null)
        if (!side) continue
        const lo = Math.max(s0, horiz ? r.x : r.y), hi = Math.min(s1, horiz ? r.x + r.w : r.y + r.h)
        if (hi - lo < 40) continue
        const inward = side === 'N' || side === 'W' ? 1 : -1
        const face = (horiz ? wz(fixed) : wx(fixed)) + inward * (t / 2 + 0.008)
        const c = (lo + hi) / 2
        const skin = (k: string, a: number, b: number, lk: Look) => {
          if (b - a < 0.02) return
          push(`${id}-${room.id}-${k}`, 'wall', horiz ? [wx(c), baseY + (a + b) / 2, face] : [face, baseY + (a + b) / 2, wz(c)],
            horiz ? [m(hi - lo), b - a, 0.016] : [0.016, b - a, m(hi - lo)], { look: lk })
        }
        const tiles = d.tiles
        if (tiles?.zone === 'full') skin('tile', y0, y1, tiles.look)
        else if (tiles?.zone === 'backsplash' && tiles.sides.includes(side)) {
          skin('paint', y0, Math.min(y1, 0.9), d.wall)
          skin('tile', Math.max(y0, 0.9), y1, tiles.look)
        } else skin('paint', y0, y1, d.wall)
      }
    }

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

    // ---- walls trimmed to CUT, split around door gaps + a real frame in each gap ----
    const JAMB = 0.05 // frame reveal, m
    const framedDoors = new Set<string>()
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
        if (Math.abs(dPerp - fixed) > 240) continue
        if (dAlong < a0 - 200 || dAlong > a1 + 200) continue
        gaps.push([dAlong - d.width / 2 - 40, dAlong + d.width / 2 + 40])
        // a slim teak frame + a leaf standing open — draw once per physical door
        const key = `${Math.round(d.at.x)},${Math.round(d.at.y)}`
        const dl = house ? { look: d.kind === 'entry' ? house.mainDoor : house.door } : undefined
        // an open kitchen is just a gap in the wall — no frame, no leaf
        if (d.treatment === 'open') framedDoors.add(key)
        if (!framedDoors.has(key)) {
          framedDoors.add(key)
          const dw = m(d.width)
          const isEntry = d.kind === 'entry'
          const hgt = Math.min(CUT, isEntry ? 2.1 : 2.02)
          const leafT = 0.045
          const jz = baseY + hgt / 2
          if (horiz) {
            const fx = wx(d.at.x)
            const fy = wz(fixed)
            push(`door-j0-${key}`, 'door', [fx - dw / 2, jz, fy], [JAMB, hgt, t + 0.03], dl)
            push(`door-j1-${key}`, 'door', [fx + dw / 2, jz, fy], [JAMB, hgt, t + 0.03], dl)
            push(`door-sill-${key}`, 'door', [fx, baseY + 0.01, fy], [dw, 0.03, t + 0.12], dl)
            // the leaf, hinged at one jamb and swung fully open into the room
            const hingeX = fx + (d.hinge === 'b' ? dw / 2 : -dw / 2)
            if (d.leaf !== false) push(`door-leaf-${key}`, 'door', [hingeX, jz, fy + (d.swing ?? 1) * (dw / 2 + leafT)], [leafT, hgt - 0.06, dw], dl)
            if (d.treatment === 'glazed-slide') push(`door-glass-${key}`, 'glass', [fx, jz, fy], [dw, hgt - 0.06, 0.03])
          } else {
            const fx = wx(fixed)
            const fy = wz(d.at.y)
            push(`door-j0-${key}`, 'door', [fx, jz, fy - dw / 2], [t + 0.03, hgt, JAMB], dl)
            push(`door-j1-${key}`, 'door', [fx, jz, fy + dw / 2], [t + 0.03, hgt, JAMB], dl)
            push(`door-sill-${key}`, 'door', [fx, baseY + 0.01, fy], [t + 0.12, 0.03, dw], dl)
            const hingeZ = fy + (d.hinge === 'b' ? dw / 2 : -dw / 2)
            if (d.leaf !== false) push(`door-leaf-${key}`, 'door', [fx + (d.swing ?? 1) * (dw / 2 + leafT), jz, hingeZ], [dw, hgt - 0.06, leafT], dl)
            if (d.treatment === 'glazed-slide') push(`door-glass-${key}`, 'glass', [fx, jz, fy], [0.03, hgt - 0.06, dw])
          }
        }
      }
      // windows: the wall steps down to the sill, with glass and the chosen frame above it up to the cut
      const windows: { s: number; e: number; sill: number }[] = []
      for (const o of floor.openings) {
        if (o.kind !== 'window') continue
        const perp = horiz ? o.at.y : o.at.x, along = horiz ? o.at.x : o.at.y
        if ((o.orient === 'h') !== horiz || Math.abs(perp - fixed) > 240 || along < a0 - 200 || along > a1 + 200) continue
        const sill = (o.sill ?? 900) / 1000
        if (sill > CUT - 0.08) continue
        const s = Math.max(a0, along - o.width / 2), e = Math.min(a1, along + o.width / 2)
        if (e - s < 200 || gaps.some(([gs, ge]) => gs < e && ge > s)) continue
        windows.push({ s, e, sill })
      }
      for (const w2 of windows) gaps.push([w2.s, w2.e])
      gaps.sort((p, q) => p[0] - q[0])
      let cursor = a0
      const segs: [number, number][] = []
      for (const [gs, ge] of gaps) {
        if (gs - cursor > 120) segs.push([cursor, gs])
        cursor = Math.max(cursor, ge)
      }
      if (a1 - cursor > 120) segs.push([cursor, a1])
      segs.forEach(([s0, s1], si) => wallPiece(`w${L}-${i}-${si}`, horiz, fixed, s0, s1, 0, CUT, t))
      windows.forEach(({ s, e, sill }, wi) => {
        wallPiece(`w${L}-${i}-sill${wi}`, horiz, fixed, s, e, 0, sill, t)
        const mid = (s + e) / 2, len = m(e - s), h = CUT - sill, cy = baseY + sill + h / 2
        const at = (along: number, y: number): [number, number, number] => (horiz ? [wx(along), y, wz(fixed)] : [wx(fixed), y, wz(along)])
        const sz = (along: number, hh: number, deep: number): [number, number, number] => (horiz ? [along, hh, deep] : [deep, hh, along])
        push(`win-glass-${L}-${i}-${wi}`, 'glass', at(mid, cy), sz(len, h, 0.02), house ? { look: house.glass } : undefined)
        const frame = house ? { look: house.frame } : undefined, thin = house?.slim ? 0.025 : 0.06
        push(`win-f-b-${L}-${i}-${wi}`, 'metal', at(mid, baseY + sill + thin / 2), sz(len, thin, 0.07), frame)
        push(`win-f-l-${L}-${i}-${wi}`, 'metal', at(s + thin * 500, cy), sz(thin, h, 0.07), frame)
        push(`win-f-r-${L}-${i}-${wi}`, 'metal', at(e - thin * 500, cy), sz(thin, h, 0.07), frame)
        if (house?.style !== 'fixed') push(`win-f-m-${L}-${i}-${wi}`, 'metal', at(mid, cy), sz(0.035, h, 0.07), frame)
        // the chosen grill on the room side of the glass: bars, a decorative grid, or a fine mosquito mesh
        const grill = house?.grills
        if (grill) {
          if (grill.mesh) push(`win-mesh-${L}-${i}-${wi}`, 'glass', at(mid, cy), sz(len - 0.04, h - 0.03, 0.016), { look: { ...grill.look, opacity: 0.35, metal: 0.3 } })
          else {
            const n = Math.max(2, Math.floor(len / grill.spacing))
            for (let k = 1; k < n; k++) push(`win-bar-${L}-${i}-${wi}-${k}`, 'metal', at(s + ((e - s) * k) / n, cy), sz(0.016, h - 0.04, 0.016), { look: grill.look })
            if (grill.decorative) for (let k = 1; k < Math.max(2, Math.floor(h / grill.spacing)); k++)
              push(`win-rail-${L}-${i}-${wi}-${k}`, 'metal', at(mid, baseY + sill + (h * k) / Math.max(2, Math.floor(h / grill.spacing))), sz(len - 0.08, 0.016, 0.016), { look: grill.look })
          }
        }
      })
    })

    // ---- a slim timber flight so the stair hall never reads as an empty room:
    //      climbs to the cut line then a landing; only where the design has storeys ----
    if (floor.stair && topLevel > 0) {
      const r = floor.stair.rect
      const up = L < topLevel
      const rise = CUT - 0.1
      const steps = 6
      // runs away from the spine edge like the plan's flights: the climbing
      // flight on one side of the well, the arriving flight on the other
      const side = floor.stair.startSide ?? 'N'
      const alongY = side === 'N' || side === 'S'
      const across = m(alongY ? r.w : r.h)
      const run = alongY ? r.h : r.w
      const tw = Math.min(1.15, across * 0.48)
      const off = (up ? -1 : 1) * (across / 2 - tw / 2 - 0.06)
      const place = (f: number): [number, number] => {
        const b = run * f
        const c = alongY ? wx(r.x + r.w / 2) + off : wz(r.y + r.h / 2) + off
        if (side === 'N') return [c, wz(r.y + b)]
        if (side === 'S') return [c, wz(r.y + r.h - b)]
        if (side === 'W') return [wx(r.x + b), c]
        return [wx(r.x + r.w - b), c]
      }
      const from = up ? 0.08 : 0.58
      const to = up ? 0.58 : 0.08
      const dims = (d: number): [number, number, number] => (alongY ? [tw, 0, m(run) * d] : [m(run) * d, 0, tw])
      for (let k = 0; k < steps; k++) {
        const f = k / (steps - 1)
        const [px, pz] = place(from + (to - from) * f)
        const [sx, , sz] = dims(0.11)
        push(`stair-${L}-${k}`, 'stair', [px, baseY + rise * ((up ? k + 0.5 : steps - k - 0.5) / steps), pz], [sx, rise / steps + 0.02, sz])
      }
      const [lx, lz] = place(up ? 0.68 : 0.02)
      const [sx, , sz] = dims(0.16)
      push(`stair-${L}-land`, 'stair', [lx, baseY + rise, lz], [sx, 0.08, sz])
    }

    // ---- furniture ----
    for (const room of floor.rooms) {
      if (room.outdoor) continue
      roomCount++
      const d = dressed.get(room.id)
      if (!d) {
        pieces += furnishRoom(room, floor, typeOf(room.id), baseY, wx, wz, m, push)
        continue
      }
      const r = room.rect, cxw = wx(r.x + r.w / 2), czw = wz(r.y + r.h / 2)
      // the chosen flooring laid over the slab, at its real tile size
      push(`finish-floor-${L}-${room.id}`, 'floor', [cxw, baseY - 0.002, czw], [m(r.w), 0.02, m(r.h)], { look: d.floor })
      for (const b of d.boxes) {
        // the cut-away stops at the cut line: a tall piece is trimmed there, anything wholly above it is left out
        const y0 = b.pos[1] - b.size[1] / 2, y1 = Math.min(b.pos[1] + b.size[1] / 2, CUT)
        if (y0 > CUT - 0.02 || y1 - y0 < 0.001) continue
        boxes.push({ id: `${room.id}-${b.id}`, mat: 'panel', pos: [cxw + b.pos[0], baseY + 0.009 + (y0 + y1) / 2, czw + b.pos[2]],
          size: [b.size[0], y1 - y0, b.size[2]], look: b.look, shape: b.shape, rot: b.rot, bevel: b.bevel })
        pieces++
      }
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

/* ------------------------------------------------------------------ *
 *  furniture — placed by RULE, never by eye.
 *
 *  Every piece goes against a real stretch of wall, clear of every door
 *  swing and threshold, clear of the glass, with the working clearance its
 *  use actually needs. A piece that cannot meet those rules is NOT placed:
 *  an empty corner is honest, a wardrobe through a wall is not.
 *
 *  The clearances are the ones residential practice uses (mm):
 *     walkway            900 main / 750 secondary   (36" / 30")
 *     beside a bed       600, 750 on the main side  (24" / 30")
 *     foot of the bed    900                        (36")
 *     wardrobe / chest   900 in front               (36", to open doors)
 *     dining             900 table-to-wall, 750 to pull a chair out
 *     sofa               400 to the coffee table    (14–18")
 *     kitchen            1050 work aisle            (NKBA, one cook)
 *     WC 600 in front, basin 700
 *  A piece taller than a window's sill never stands in front of that glass.
 * ------------------------------------------------------------------ */

type XF = (mm: number) => number
type Push = (id: string, mat: DollMat, pos: [number, number, number], size: [number, number, number]) => void

const CLEAR = {
  walkway: 0.9,
  walkwayTight: 0.75,
  bedSide: 0.6,
  bedFoot: 0.9,
  storageFront: 0.9,
  diningWall: 0.9,
  chairPull: 0.75,
  sofaCoffee: 0.4,
  seatingWalk: 0.6,
  kitchenAisle: 1.05,
  wcFront: 0.6,
  basinFront: 0.7,
  /** a leaf sweeps its own width — keep that quarter of floor clear */
  doorSwing: 1.0,
  doorThreshold: 0.35,
}

/** a rect in ROOM-LOCAL metres: origin at the room centre, +x right, +z toward the road */
type Rect2 = { x0: number; z0: number; x1: number; z1: number }

const overlaps = (a: Rect2, b: Rect2, eps = 0.02) =>
  a.x0 < b.x1 - eps && a.x1 > b.x0 + eps && a.z0 < b.z1 - eps && a.z1 > b.z0 + eps

type RoomOpening = { side: Side; centre: number; half: number; kind: 'door' | 'window'; sill: number }

type Placement = { cx: number; cz: number; w: number; d: number; side: Side }

type Spec = {
  /** along the wall */
  w: number
  /** away from the wall */
  d: number
  /** working clearance in front */
  front: number
  /** sides to try, best first; default: doorless walls first */
  sides?: Side[]
  /** taller than a window sill — may not stand in front of glass */
  tall?: boolean
  /** elbow room either side (a bed's walking sides) */
  flank?: number
  gap?: number
}

/**
 * One room's usable floor and what has been put on it. Everything is in
 * room-local metres, so a recipe never has to think about the plot frame.
 */
class RoomPlan {
  readonly W: number
  readonly D: number
  private readonly keepOut: Rect2[] = []
  private readonly tallKeepOut: Rect2[] = []
  private readonly taken: Rect2[] = []
  readonly openings: RoomOpening[]
  readonly doorSides: Set<Side>
  readonly windowSides: Set<Side>

  constructor(W: number, D: number, openings: RoomOpening[]) {
    this.W = W
    this.D = D
    this.openings = openings
    this.doorSides = new Set(openings.filter((o) => o.kind === 'door').map((o) => o.side))
    this.windowSides = new Set(openings.filter((o) => o.kind === 'window').map((o) => o.side))
    for (const o of openings) {
      if (o.kind === 'door') {
        const swing = Math.max(CLEAR.doorThreshold, Math.min(CLEAR.doorSwing, o.half * 2))
        this.keepOut.push(this.band(o.side, o.centre - o.half - 0.1, o.centre + o.half + 0.1, swing))
      } else {
        this.tallKeepOut.push(this.band(o.side, o.centre - o.half, o.centre + o.half, 0.35))
      }
    }
  }

  /** a strip along `side`, from `a` to `b` along the wall, `depth` into the room */
  private band(side: Side, a: number, b: number, depth: number): Rect2 {
    const { W, D } = this
    if (side === 'N') return { x0: a, x1: b, z0: -D / 2, z1: -D / 2 + depth }
    if (side === 'S') return { x0: a, x1: b, z0: D / 2 - depth, z1: D / 2 }
    if (side === 'W') return { z0: a, z1: b, x0: -W / 2, x1: -W / 2 + depth }
    return { z0: a, z1: b, x0: W / 2 - depth, x1: W / 2 }
  }

  /** free stretches of one wall — what is left between the openings on it */
  wallRuns(side: Side, tall: boolean): [number, number][] {
    const len = side === 'N' || side === 'S' ? this.W : this.D
    let runs: [number, number][] = [[-len / 2, len / 2]]
    for (const o of this.openings) {
      if (o.side !== side) continue
      if (o.kind === 'window' && !tall) continue
      const pad = o.kind === 'door' ? 0.12 : 0.05
      const s = o.centre - o.half - pad
      const e = o.centre + o.half + pad
      runs = runs
        .flatMap(([a, b]) => [[a, Math.min(b, s)], [Math.max(a, e), b]] as [number, number][])
        .filter(([a, b]) => b - a > 0.2)
    }
    return runs
  }

  longestRun(side: Side, tall = false): number {
    return this.wallRuns(side, tall).reduce((m2, [a, b]) => Math.max(m2, b - a), 0)
  }

  private rectFor(side: Side, along: number, w: number, d: number, gap: number): Rect2 {
    const { W, D } = this
    if (side === 'N') return { x0: along - w / 2, x1: along + w / 2, z0: -D / 2 + gap, z1: -D / 2 + gap + d }
    if (side === 'S') return { x0: along - w / 2, x1: along + w / 2, z0: D / 2 - gap - d, z1: D / 2 - gap }
    if (side === 'W') return { z0: along - w / 2, z1: along + w / 2, x0: -W / 2 + gap, x1: -W / 2 + gap + d }
    return { z0: along - w / 2, z1: along + w / 2, x0: W / 2 - gap - d, x1: W / 2 - gap }
  }

  private frontFor(side: Side, r: Rect2, front: number): Rect2 {
    if (front <= 0) return r
    if (side === 'N') return { ...r, z1: r.z1 + front }
    if (side === 'S') return { ...r, z0: r.z0 - front }
    if (side === 'W') return { ...r, x1: r.x1 + front }
    return { ...r, x0: r.x0 - front }
  }

  private inside(r: Rect2) {
    const e = 0.015
    return r.x0 >= -this.W / 2 - e && r.x1 <= this.W / 2 + e && r.z0 >= -this.D / 2 - e && r.z1 <= this.D / 2 + e
  }

  /** free of doors, of glass (for a tall piece), and of everything already placed */
  free(r: Rect2, tall = false): boolean {
    if (!this.inside(r)) return false
    if (this.keepOut.some((k) => overlaps(r, k))) return false
    if (tall && this.tallKeepOut.some((k) => overlaps(r, k))) return false
    return !this.taken.some((t) => overlaps(r, t))
  }

  reserve(r: Rect2) {
    this.taken.push(r)
  }

  /** put a piece against a wall with its working clearance; null if it will not fit */
  place(spec: Spec): Placement | null {
    const gap = spec.gap ?? 0.03
    const order =
      spec.sides ??
      ([...SIDES].sort((a, b) => Number(this.doorSides.has(a)) - Number(this.doorSides.has(b))) as Side[])
    let best: { p: Placement; score: number; work: Rect2 } | null = null

    order.forEach((side, i) => {
      const sidePenalty = i * 0.5
      for (const [a, b] of this.wallRuns(side, !!spec.tall)) {
        if (b - a < spec.w) continue
        const mid = (a + b) / 2
        const tries: number[] = [mid]
        for (let t = a + spec.w / 2; t <= b - spec.w / 2 + 0.001; t += 0.15) tries.push(t)
        for (const along of tries) {
          if (along - spec.w / 2 < a - 0.001 || along + spec.w / 2 > b + 0.001) continue
          const foot = this.rectFor(side, along, spec.w, spec.d, gap)
          const work = this.frontFor(side, foot, spec.front)
          if (!this.free(work, spec.tall)) continue
          if (spec.flank) {
            const horiz = side === 'N' || side === 'S'
            const wide = horiz
              ? { ...work, x0: work.x0 - spec.flank, x1: work.x1 + spec.flank }
              : { ...work, z0: work.z0 - spec.flank, z1: work.z1 + spec.flank }
            if (!this.free(wide, spec.tall)) continue
          }
          const score = sidePenalty + Math.abs(along - mid) * 0.5 - (b - a) * 0.05
          if (!best || score < best.score) {
            const horiz = side === 'N' || side === 'S'
            best = {
              p: {
                cx: horiz ? along : (foot.x0 + foot.x1) / 2,
                cz: horiz ? (foot.z0 + foot.z1) / 2 : along,
                w: spec.w,
                d: spec.d,
                side,
              },
              score,
              work,
            }
          }
        }
      }
    })
    if (!best) return null
    const picked = best as { p: Placement; score: number; work: Rect2 }
    this.reserve(picked.work)
    return picked.p
  }

  /** put a piece in open floor (a dining table), keeping `margin` all round */
  placeFree(w: number, d: number, margin: number): Placement | null {
    const nx = 14
    const nz = 14
    let best: { p: Placement; score: number; r: Rect2 } | null = null
    const x0 = -this.W / 2 + w / 2 + margin
    const x1 = this.W / 2 - w / 2 - margin
    const z0 = -this.D / 2 + d / 2 + margin
    const z1 = this.D / 2 - d / 2 - margin
    if (x1 < x0 || z1 < z0) return null
    for (let i = 0; i <= nx; i++) {
      for (let j = 0; j <= nz; j++) {
        const cx = x0 + ((x1 - x0) * i) / nx
        const cz = z0 + ((z1 - z0) * j) / nz
        const r = { x0: cx - w / 2 - margin, x1: cx + w / 2 + margin, z0: cz - d / 2 - margin, z1: cz + d / 2 + margin }
        if (!this.free(r)) continue
        const score = Math.abs(cx) + Math.abs(cz)
        if (!best || score < best.score) best = { p: { cx, cz, w, d, side: 'N' }, score, r }
      }
    }
    if (!best) return null
    const picked = best as { p: Placement; score: number; r: Rect2 }
    this.reserve(picked.r)
    return picked.p
  }
}

const isHoriz = (side: Side) => side === 'N' || side === 'S'
/** unit vector pointing into the room from `side` */
const into = (side: Side): [number, number] => (side === 'N' ? [0, 1] : side === 'S' ? [0, -1] : side === 'W' ? [1, 0] : [-1, 0])

/** which recipe a room gets, from the model's room type (or its id) */
/** is a point on (within a wall of) this rect's boundary? */
function onBoundary(r: { x: number; y: number; w: number; h: number }, p: { x: number; y: number }): boolean {
  const t = 200
  const inX = p.x > r.x - t && p.x < r.x + r.w + t
  const inY = p.y > r.y - t && p.y < r.y + r.h + t
  return (inX && (Math.abs(p.y - r.y) < t || Math.abs(p.y - r.y - r.h) < t)) || (inY && (Math.abs(p.x - r.x) < t || Math.abs(p.x - r.x - r.w) < t))
}

function recipeOf(id: string, type: string | undefined): string {
  const t = type ?? ''
  if (t) return t
  // room ids of the classic plan engine: bed1 is the master, the rest are bedrooms
  if (id === 'bed1') return 'master'
  if (/^bed\d/.test(id)) return 'bedroom'
  if (id.startsWith('sharedBath')) return 'bath'
  if (id === 'familyLounge') return 'family'
  if (id === 'livingDining') return 'living'
  if (id.startsWith('bedroom')) return 'bedroom'
  if (id.startsWith('bath') || id.startsWith('toilet')) return 'bath'
  if (id.startsWith('stair')) return 'stair'
  if (id.startsWith('study')) return 'study'
  if (id.startsWith('hub') || id.startsWith('lobby')) return 'lobby'
  if (id.startsWith('wash') || id.startsWith('passage')) return 'passage'
  if (id.startsWith('dress') || id.startsWith('store')) return 'store'
  return id
}

/**
 * Furnish one room. `openings` are this room's own doors and windows, from
 * the model — not guessed from geometry — so the keep-clear zones are exact.
 */
function furnishRoom(
  room: PlacedRoom,
  floor: FloorPlan,
  type: string | undefined,
  baseY: number,
  wx: XF,
  wz: XF,
  m: XF,
  push: Push,
): number {
  const r = room.rect
  const cxw = wx(r.x + r.w / 2)
  const czw = wz(r.y + r.h / 2)
  // clear floor: the room rect less half the thickest wall (+ a finish
  // allowance) on each side — an outside wall is 220 mm, centred on the edge
  const W = m(r.w) - (EXT_T + 0.04)
  const D = m(r.h) - (EXT_T + 0.04)
  if (W < 0.8 || D < 0.8) return 0

  // ---- this room's own openings, in room-local metres
  const openings: RoomOpening[] = []
  for (const op of floor.openings) {
    // a plan that names the rooms an opening joins is trusted; otherwise the
    // opening belongs to every room whose wall line it sits on
    const mine = op.rooms ? op.rooms.includes(room.id) : onBoundary(r, op.at)
    if (!mine) continue
    const lx = wx(op.at.x) - cxw
    const lz = wz(op.at.y) - czw
    const kind = op.kind === 'window' ? ('window' as const) : ('door' as const)
    const half = m(op.width) / 2
    let side: Side | null = null
    if (op.orient === 'h') side = lz < 0 ? 'N' : 'S'
    else side = lx < 0 ? 'W' : 'E'
    // only if it really sits on this room's wall line
    const off = isHoriz(side) ? Math.abs(Math.abs(lz) - D / 2) : Math.abs(Math.abs(lx) - W / 2)
    if (off > 0.3) continue
    openings.push({ side, centre: isHoriz(side) ? lx : lz, half, kind, sill: (op.sill ?? 900) / 1000 })
  }

  const plan = new RoomPlan(W, D, openings)
  // a plan whose rooms overlap leaves floor that belongs to two rooms at once:
  // neither furnishes it. A door standing inside this room (not on its wall)
  // keeps a square of its own width clear on every side.
  const toLocal = (x0: number, y0: number, x1: number, y1: number): Rect2 => {
    const lx0 = Math.max(-W / 2, wx(x0) - cxw)
    const lx1 = Math.min(W / 2, wx(x1) - cxw)
    const lz0 = Math.max(-D / 2, wz(y0) - czw)
    const lz1 = Math.min(D / 2, wz(y1) - czw)
    return { x0: lx0, z0: lz0, x1: Math.max(lx0, lx1), z1: Math.max(lz0, lz1) }
  }
  for (const o of floor.rooms) {
    if (o.id === room.id || o.outdoor) continue
    const q = o.rect
    const x0 = Math.max(r.x, q.x)
    const x1 = Math.min(r.x + r.w, q.x + q.w)
    const y0 = Math.max(r.y, q.y)
    const y1 = Math.min(r.y + r.h, q.y + q.h)
    if (x1 - x0 > 150 && y1 - y0 > 150) plan.reserve(toLocal(x0 - 150, y0 - 150, x1 + 150, y1 + 150))
  }
  for (const op of floor.openings) {
    if (op.kind === 'window') continue
    const inside = op.at.x > r.x + 200 && op.at.x < r.x + r.w - 200 && op.at.y > r.y + 200 && op.at.y < r.y + r.h - 200
    if (inside) plan.reserve(toLocal(op.at.x - op.width - 100, op.at.y - op.width - 100, op.at.x + op.width + 100, op.at.y + op.width + 100))
  }
  const rng = rand(Math.round(r.x * 7 + r.y * 13 + r.w))
  const acc = ACCENTS[Math.floor(rng() * ACCENTS.length)]
  let n = 0

  /**
   * Push a box at a ROOM-LOCAL centre. This is a CUT-AWAY model: the walls
   * stop at `CUT`, so a wardrobe or a fridge is trimmed at the same line
   * rather than standing proud of the house like a chimney.
   */
  const P = (id: string, mat: DollMat, lx: number, y: number, lz: number, w: number, h: number, d: number) => {
    const top = Math.min(y + h, CUT)
    const hh = top - y
    if (hh < 0.02) return
    push(`${room.id}-${id}`, mat, [cxw + lx, baseY + y + hh / 2, czw + lz], [w, hh, d])
    n++
  }
  /** a rug, centred under a piece — never reserved, it is flat */
  const rug = (lx: number, lz: number, w: number, d: number) =>
    P('rug', 'rug', lx, 0.004, lz, Math.min(w, W - 0.3), 0.012, Math.min(d, D - 0.3))

  /**
   * A piece sitting against a wall is described in WALL coordinates: `along`
   * runs along the wall, `deep` goes into the room. These two turn that into
   * world sizes and offsets, so a recipe never has to know which wall it got.
   */
  const sz = (pl: Placement, along: number, h: number, deep: number): [number, number, number] =>
    isHoriz(pl.side) ? [along, h, deep] : [deep, h, along]
  /** local centre `a` along the wall and `t` toward the room, from the piece's own centre */
  const at = (pl: Placement, a: number, t: number): [number, number] => {
    const [ix, iz] = into(pl.side)
    return isHoriz(pl.side) ? [pl.cx + a, pl.cz + t * iz] : [pl.cx + t * ix, pl.cz + a]
  }

  /** try each option in turn — the ideal layout first, the minimum last */
  const tryPlace = (...opts: Spec[]): Placement | null => {
    for (const o of opts) {
      const got = plan.place(o)
      if (got) return got
    }
    return null
  }

  const recipe = recipeOf(room.id, type)

  /* ---------------- bedroom ---------------- */
  if (recipe === 'bedroom' || recipe === 'master') {
    const big = W * D >= 12
    const bedW = big ? 1.8 : W * D >= 9 ? 1.5 : 1.0
    const bedL = bedW > 1.2 ? 2.0 : 1.9
    // headboard against a wall: no door on it, ideally no window either
    const quiet = SIDES.filter((s) => !plan.doorSides.has(s) && !plan.windowSides.has(s))
    const order = [...quiet, ...SIDES.filter((s) => !plan.doorSides.has(s) && plan.windowSides.has(s)), ...SIDES]
    let bed =
      plan.place({ w: bedW, d: bedL, front: CLEAR.bedFoot, sides: order, flank: CLEAR.bedSide, gap: 0.04 }) ??
      plan.place({ w: bedW, d: bedL, front: CLEAR.walkwayTight, sides: order, flank: 0.35, gap: 0.04 })
    if (!bed) bed = plan.place({ w: 1.0, d: 1.9, front: 0.6, sides: order, gap: 0.04 })
    if (bed) {
      const bw = bed.w // along the wall: the bed's width
      const bd = bed.d // into the room: its length
      const put = (id: string, mat: DollMat, a: number, y: number, t: number, along: number, h: number, deep: number) => {
        const [x, z] = at(bed!, a, t)
        const [sx, sy, szz] = sz(bed!, along, h, deep)
        P(id, mat, x, y, z, sx, sy, szz)
      }
      put('bed-base', 'wood', 0, 0.08, 0, bw, 0.24, bd)
      put('bed-mat', 'cream', 0, 0.32, 0, bw - 0.08, 0.22, bd - 0.1)
      put('bed-hb', 'wood', 0, 0.3, -(bd / 2 - 0.04), bw + 0.1, 0.7, 0.08)
      put('bed-pil', 'cream', 0, 0.54, -(bd / 2 - 0.38), bw - 0.3, 0.12, 0.42)
      put('throw', acc, 0, 0.44, bd * 0.2, bw - 0.04, 0.05, 0.5)
      const [rx, rz] = at(bed, 0, 0.4)
      rug(rx, rz, isHoriz(bed.side) ? bw + 1.0 : bd + 0.6, isHoriz(bed.side) ? bd + 0.6 : bw + 1.0)
      // nightstands flank the headboard, within the bed's own elbow room
      for (const s of [-1, 1]) {
        const [nx, nz] = at(bed, s * (bw / 2 + 0.26), -(bd / 2 - 0.2))
        const cell: Rect2 = { x0: nx - 0.22, x1: nx + 0.22, z0: nz - 0.22, z1: nz + 0.22 }
        if (!plan.free(cell)) continue
        plan.reserve(cell)
        P(`night${s > 0 ? 1 : 0}`, 'wood', nx, 0.2, nz, 0.44, 0.4, 0.4)
        P(`lamp${s > 0 ? 1 : 0}`, 'lamp', nx, 0.45, nz, 0.22, 0.26, 0.22)
      }
    }
    // wardrobe: tall, wants 900 to open its doors, never across the glass
    const wardW = clamp(Math.min(W, D) * 0.75, 0.9, 2.4)
    const ward = tryPlace(
      { w: wardW, d: 0.6, front: CLEAR.storageFront, tall: true, gap: 0.02 },
      { w: Math.max(1.2, wardW * 0.7), d: 0.6, front: CLEAR.storageFront, tall: true, gap: 0.02 },
      { w: 1.2, d: 0.6, front: CLEAR.walkwayTight, tall: true, gap: 0.02 },
      { w: 0.9, d: 0.55, front: 0.55, tall: true, gap: 0.02 },
    )
    if (ward) {
      const [sx, sy, szz] = sz(ward, ward.w, 2.05, ward.d)
      P('wardrobe', 'panel', ward.cx, 0.0, ward.cz, sx, sy, szz)
      const [hx, hz] = at(ward, 0, ward.d / 2 + 0.01)
      const [hsx, hsy, hsz] = sz(ward, 0.04, 0.3, 0.02)
      P('ward-handle', 'metal', hx, 1.0, hz, hsx, hsy, hsz)
    }
    if (big) {
      const chest = plan.place({ w: 1.0, d: 0.45, front: CLEAR.storageFront, tall: false })
      if (chest) {
        const [sx, sy, szz] = sz(chest, chest.w, 0.8, chest.d)
        P('chest', 'wood', chest.cx, 0.0, chest.cz, sx, sy, szz)
        P('chest-plant', 'plant', chest.cx, 0.8, chest.cz, 0.22, 0.3, 0.22)
      }
    }
    return n
  }

  /* ---------------- living ---------------- */
  if (recipe === 'living' || recipe === 'family') {
    const sofaW = clamp(Math.min(W, D) > 3.4 ? 2.4 : 1.8, 1.5, 2.6)
    const sofa = tryPlace(
      { w: sofaW, d: 0.9, front: CLEAR.sofaCoffee + 0.6 + CLEAR.seatingWalk, gap: 0.05 },
      { w: sofaW, d: 0.9, front: CLEAR.sofaCoffee + 0.6, gap: 0.05 },
      { w: 1.8, d: 0.85, front: CLEAR.sofaCoffee + 0.5, gap: 0.05 },
      { w: 1.5, d: 0.8, front: CLEAR.sofaCoffee, gap: 0.05 },
    )
    if (sofa) {
      const sw = sofa.w // along the wall
      const sd = sofa.d // into the room
      const put = (id: string, mat: DollMat, a: number, y: number, t: number, along: number, h: number, deep: number) => {
        const [x, z] = at(sofa!, a, t)
        const [sx, sy, szz] = sz(sofa!, along, h, deep)
        P(id, mat, x, y, z, sx, sy, szz)
      }
      put('sofa-base', acc, 0, 0.1, 0, sw, 0.32, sd)
      put('sofa-seat', 'cream', 0, 0.42, 0.02, sw - 0.24, 0.16, sd - 0.2)
      put('sofa-back', acc, 0, 0.42, -(sd / 2 - 0.1), sw, 0.44, 0.2)
      for (const s of [-1, 1]) put(`sofa-arm${s > 0 ? 1 : 0}`, acc, s * (sw / 2 - 0.1), 0.32, 0, 0.2, 0.22, sd)
      // the coffee table sits a hand's reach in front — 400 mm
      const ctW = Math.min(1.1, sw - 0.4)
      const [cx2, cz2] = at(sofa, 0, sd / 2 + CLEAR.sofaCoffee + 0.3)
      // the coffee table stands in the clearance the sofa already reserved for
      // it, so it needs no test of its own — only the room's own edges
      const ctSize = sz(sofa, ctW, 0.06, 0.6)
      if (Math.abs(cx2) + ctSize[0] / 2 < W / 2 && Math.abs(cz2) + ctSize[2] / 2 < D / 2) {
        P('coffee', 'wood', cx2, 0.34, cz2, ctSize[0], ctSize[1], ctSize[2])
        P('coffee-book', 'clay', cx2, 0.4, cz2, 0.3, 0.05, 0.22)
      }
      const [rx, rz] = at(sofa, 0, sd / 2 + 0.7)
      const rugSize = sz(sofa, sw + 0.8, 0, 2.0)
      rug(rx, rz, rugSize[0], rugSize[2])
      // the television faces the sofa, on the wall opposite — never over glass
      const opp: Side = sofa.side === 'N' ? 'S' : sofa.side === 'S' ? 'N' : sofa.side === 'W' ? 'E' : 'W'
      const media = tryPlace(
        { w: Math.min(1.8, sofaW), d: 0.4, front: CLEAR.seatingWalk, sides: [opp], tall: true },
        { w: 1.2, d: 0.4, front: 0.45, sides: [opp], tall: true },
        { w: 1.2, d: 0.4, front: 0.45, tall: true },
      )
      if (media) {
        const ms = sz(media, media.w, 0.42, media.d)
        P('media', 'panel', media.cx, 0.0, media.cz, ms[0], ms[1], ms[2])
        const tv = sz(media, media.w * 0.8, 0.62, 0.06)
        const [tx, tz] = at(media, 0, -0.02)
        P('tv', 'metal', tx, 0.5, tz, tv[0], tv[1], tv[2])
      }
      const chair = plan.place({ w: 0.8, d: 0.8, front: CLEAR.seatingWalk })
      if (chair) {
        P('armchair', 'cream', chair.cx, 0.1, chair.cz, 0.8, 0.3, 0.8)
        const [bx, bz] = at(chair, 0, -0.33)
        const bs = sz(chair, 0.8, 0.42, 0.14)
        P('armchair-back', acc, bx, 0.4, bz, bs[0], bs[1], bs[2])
      }
    }
    return n
  }

  /* ---------------- dining ---------------- */
  if (recipe === 'dining') {
    const seats = W * D >= 16 ? 8 : W * D >= 11 ? 6 : 4
    const tw = seats >= 8 ? 2.0 : seats >= 6 ? 1.6 : 1.2
    const td = seats >= 6 ? 0.9 : 0.8
    // the table wants a chair-pull ring all round; failing that a smaller
    // table, and failing that one pushed against a wall (a compact-home dining)
    let t =
      plan.placeFree(tw, td, CLEAR.chairPull) ??
      plan.placeFree(Math.min(tw, 1.6), 0.9, CLEAR.chairPull) ??
      plan.placeFree(1.2, 0.8, 0.65) ??
      plan.placeFree(1.1, 0.75, 0.5)
    if (!t) {
      // a dining that doubles as the way through: a small table against the
      // wall, chairs on the free sides — what a compact Indian home does
      const against = tryPlace(
        { w: 1.4, d: 0.8, front: CLEAR.chairPull },
        { w: 1.1, d: 0.75, front: 0.6 },
        { w: 0.9, d: 0.7, front: 0.45 },
      )
      if (against) t = { ...against, w: isHoriz(against.side) ? against.w : against.d, d: isHoriz(against.side) ? against.d : against.w }
    }
    if (t) {
      P('table', 'wood', t.cx, 0.72, t.cz, t.w, 0.06, t.d)
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) P(`tleg${sx}${sz}`, 'wood', t.cx + sx * (t.w / 2 - 0.1), 0.0, t.cz + sz * (t.d / 2 - 0.1), 0.07, 0.72, 0.07)
      const perSide = Math.max(1, Math.floor(seats / 2))
      for (let i = 0; i < perSide; i++) {
        const f = (i + 0.5) / perSide - 0.5
        for (const s of [-1, 1]) {
          // a chair only goes where it can actually be pulled out
          const back = t.cz + s * (t.d / 2 + 0.44)
          if (Math.abs(back) + 0.03 > D / 2 || Math.abs(t.cx + f * t.w) + 0.22 > W / 2) continue
          P(`chair-${s > 0 ? 's' : 'n'}${i}`, 'cream', t.cx + f * t.w, 0.42, t.cz + s * (t.d / 2 + 0.24), 0.44, 0.06, 0.44)
          P(`chair-b-${s > 0 ? 's' : 'n'}${i}`, 'wood', t.cx + f * t.w, 0.48, back, 0.44, 0.5, 0.06)
        }
      }
      rug(t.cx, t.cz, t.w + 1.2, t.d + 1.2)
    }
    const side = tryPlace(
      { w: Math.min(1.5, W - 0.6), d: 0.42, front: CLEAR.walkwayTight, tall: false },
      { w: Math.min(1.2, W - 0.4), d: 0.4, front: 0.5 },
      { w: 0.9, d: 0.35, front: 0.35 },
    )
    if (side) {
      const ss = sz(side, side.w, 0.8, side.d)
      P('sideboard', 'panel', side.cx, 0.0, side.cz, ss[0], ss[1], ss[2])
      P('side-vase', 'ceramic', side.cx, 0.8, side.cz, 0.18, 0.3, 0.18)
    }
    return n
  }

  /* ---------------- kitchen ---------------- */
  if (recipe === 'kitchen') {
    // the main run goes on the longest clear wall; a second run only if the
    // aisle between them stays at 1050 (NKBA, one cook)
    const runs = SIDES.map((s) => ({ s, len: plan.longestRun(s, false) })).sort((a, b) => b.len - a.len)
    const placed: Placement[] = []
    for (const { s, len } of runs) {
      if (placed.length >= 2 || len < 1.2) continue
      const across = isHoriz(s) ? D : W
      if (placed.length === 1 && across - 0.6 - 0.6 < CLEAR.kitchenAisle) continue
      const p = plan.place({ w: Math.min(len - 0.05, isHoriz(s) ? W : D), d: 0.6, front: CLEAR.kitchenAisle, sides: [s], gap: 0.01 })
      if (p) placed.push(p)
    }
    placed.forEach((p, i) => {
      const body = sz(p, p.w, 0.86, p.d)
      P(`counter${i}`, 'panel', p.cx, 0.0, p.cz, body[0], body[1], body[2])
      P(`top${i}`, 'stone', p.cx, 0.86, p.cz, body[0] + 0.03, 0.04, body[2] + 0.03)
      // upper cabinets only where no glass sits above the counter
      const along = isHoriz(p.side) ? p.cx : p.cz
      const clearAbove = plan.wallRuns(p.side, true).some(([a, b]) => along - p.w / 2 > a - 0.05 && along + p.w / 2 < b + 0.05)
      if (clearAbove) {
        const [ux, uz] = at(p, 0, -0.14)
        const us = sz(p, p.w, 0.7, 0.32)
        P(`upper${i}`, 'panel', ux, 1.45, uz, us[0], us[1], us[2])
      }
      // the sink goes under the window when the run has one, the hob elsewhere
      const winHere = plan.openings.find((o) => o.kind === 'window' && o.side === p.side && Math.abs(o.centre - along) < p.w / 2)
      const fixtureAt = winHere ? winHere.centre - along : 0
      if (i === 0) {
        const [fx, fz] = at(p, fixtureAt, 0.02)
        const ss = sz(p, 0.5, 0.06, 0.4)
        P('sink', 'metal', fx, 0.84, fz, ss[0], ss[1], ss[2])
        const [tx, tz] = at(p, fixtureAt, -0.16)
        P('tap', 'metal', tx, 0.9, tz, 0.04, 0.28, 0.04)
      } else {
        const hs = sz(p, 0.58, 0.04, 0.48)
        P('hob', 'metal', p.cx, 0.87, p.cz, hs[0], hs[1], hs[2])
      }
    })
    const fridge = plan.place({ w: 0.7, d: 0.7, front: CLEAR.walkwayTight, tall: true })
    if (fridge) P('fridge', 'metal', fridge.cx, 0.0, fridge.cz, 0.7, 1.75, 0.7)
    return n
  }

  /* ---------------- bath / WC ---------------- */
  if (recipe === 'bath' || recipe === 'toilet') {
    // away from the door: the WC is the piece you least want to see from it
    const away = SIDES.filter((s) => !plan.doorSides.has(s))
    const wc = tryPlace(
      { w: 0.42, d: 0.7, front: CLEAR.wcFront, sides: away.length ? away : SIDES, gap: 0.02 },
      { w: 0.42, d: 0.7, front: 0.5, gap: 0.02 },
    )
    if (wc) {
      const ws = sz(wc, wc.w, 0.42, wc.d)
      P('wc', 'ceramic', wc.cx, 0.0, wc.cz, ws[0], ws[1], ws[2])
      const [cx2, cz2] = at(wc, 0, -(wc.d / 2 - 0.08))
      const cs = sz(wc, wc.w, 0.42, 0.16)
      P('cistern', 'ceramic', cx2, 0.42, cz2, cs[0], cs[1], cs[2])
    }
    const basin = tryPlace(
      { w: 0.6, d: 0.45, front: CLEAR.basinFront, gap: 0.02 },
      { w: 0.55, d: 0.42, front: 0.55, gap: 0.02 },
      { w: 0.5, d: 0.4, front: 0.45, gap: 0.02 },
    )
    if (basin) {
      const vs = sz(basin, basin.w, 0.78, basin.d)
      P('vanity', 'panel', basin.cx, 0.0, basin.cz, vs[0], vs[1], vs[2])
      P('basin', 'ceramic', basin.cx, 0.78, basin.cz, vs[0] - 0.08, 0.14, vs[2] - 0.06)
      const [mx, mz] = at(basin, 0, -(basin.d / 2))
      const ms = sz(basin, basin.w - 0.1, 0.7, 0.03)
      P('mirror', 'glass', mx, 1.1, mz, ms[0], ms[1], ms[2])
    }
    if (W * D >= 3.6) {
      const sh = tryPlace({ w: 0.9, d: 0.9, front: 0.3, gap: 0.01 }, { w: 0.8, d: 0.8, front: 0.25, gap: 0.01 })
      if (sh) {
        P('shower-tray', 'stone', sh.cx, 0.0, sh.cz, 0.9, 0.08, 0.9)
        const [gx, gz] = at(sh, 0, 0.45)
        const gs = sz(sh, 0.9, 1.9, 0.02)
        P('shower-glass', 'glass', gx, 0.08, gz, gs[0], gs[1], gs[2])
      }
    }
    return n
  }

  /* ---------------- study / home office ---------------- */
  if (recipe === 'study') {
    // a desk likes daylight: try the window walls first
    const lit = SIDES.filter((s) => plan.windowSides.has(s))
    const desk = tryPlace(
      { w: 1.4, d: 0.7, front: CLEAR.walkway, sides: [...lit, ...SIDES] },
      { w: 1.2, d: 0.65, front: CLEAR.walkwayTight, sides: [...lit, ...SIDES] },
      { w: 1.1, d: 0.6, front: 0.7 },
    )
    if (desk) {
      const ds = sz(desk, desk.w, 0.05, desk.d)
      P('desk', 'wood', desk.cx, 0.72, desk.cz, ds[0], ds[1], ds[2])
      for (const s of [-1, 1]) {
        const [lx, lz] = at(desk, s * (desk.w / 2 - 0.08), 0)
        P(`desk-leg${s > 0 ? 1 : 0}`, 'metal', lx, 0.0, lz, 0.06, 0.72, 0.06)
      }
      const [chx, chz] = at(desk, 0, desk.d / 2 + 0.28)
      P('desk-chair', 'cream', chx, 0.42, chz, 0.46, 0.06, 0.46)
      const [bx, bz] = at(desk, 0, desk.d / 2 + 0.48)
      const bs = sz(desk, 0.46, 0.5, 0.06)
      P('desk-chair-b', acc, bx, 0.48, bz, bs[0], bs[1], bs[2])
    }
    const shelf = plan.place({ w: Math.min(1.4, W - 0.5), d: 0.32, front: CLEAR.walkwayTight, tall: true })
    if (shelf) {
      const ss = sz(shelf, shelf.w, 1.8, shelf.d)
      P('shelf', 'panel', shelf.cx, 0.0, shelf.cz, ss[0], ss[1], ss[2])
    }
    return n
  }

  /* ---------------- puja ---------------- */
  if (recipe === 'pooja') {
    const away = SIDES.filter((s) => !plan.doorSides.has(s))
    const altar = tryPlace(
      { w: Math.min(0.9, W - 0.3), d: 0.45, front: 0.6, sides: away.length ? away : SIDES, tall: true },
      { w: Math.min(0.75, W - 0.2), d: 0.4, front: 0.45, tall: true },
    )
    if (altar) {
      const as2 = sz(altar, altar.w, 0.9, altar.d)
      P('altar', 'wood', altar.cx, 0.0, altar.cz, as2[0], as2[1], as2[2])
      P('altar-top', 'clay', altar.cx, 0.9, altar.cz, as2[0] - 0.1, 0.45, as2[2] - 0.06)
      P('lamp-diya', 'lamp', altar.cx, 0.9, altar.cz, 0.12, 0.16, 0.12)
    }
    return n
  }

  /* ---------------- utility / store / dress ---------------- */
  if (recipe === 'utility' || recipe === 'store') {
    const unit = tryPlace(
      { w: Math.min(1.2, W - 0.3), d: 0.6, front: CLEAR.walkwayTight, tall: true },
      { w: Math.min(0.9, W - 0.2), d: 0.5, front: 0.5, tall: true },
    )
    if (unit) {
      const us = sz(unit, unit.w, 1.7, unit.d)
      P('shelving', 'panel', unit.cx, 0.0, unit.cz, us[0], us[1], us[2])
    }
    if (recipe === 'utility') {
      const wm = plan.place({ w: 0.6, d: 0.6, front: CLEAR.walkwayTight })
      if (wm) P('washer', 'metal', wm.cx, 0.0, wm.cz, 0.6, 0.85, 0.6)
    }
    return n
  }

  /* ---------------- foyer / lobby / landing ---------------- */
  if (recipe === 'foyer' || recipe === 'lobby') {
    const console_ = plan.place({ w: Math.min(1.1, W - 0.6), d: 0.35, front: CLEAR.walkway })
    if (console_) {
      const cs = sz(console_, console_.w, 0.78, console_.d)
      P('console', 'wood', console_.cx, 0.0, console_.cz, cs[0], cs[1], cs[2])
      P('console-plant', 'plant', console_.cx, 0.78, console_.cz, 0.24, 0.34, 0.24)
    }
    const bench = plan.place({ w: 1.0, d: 0.38, front: CLEAR.walkway })
    if (bench) {
      const bs = sz(bench, bench.w, 0.44, bench.d)
      P('bench', acc, bench.cx, 0.0, bench.cz, bs[0], bs[1], bs[2])
    }
    rug(0, 0, W * 0.6, D * 0.6)
    return n
  }

  /* circulation, stairs, shafts, everything else: keep the floor clear */
  return n
}

/** The same rule-based furniture for ONE room, in that room's local metres (centred on the room, y up from its floor,
 *  x east, z south) — the frame buildRoom uses — for the interior preview. Placement rules are unchanged. */
export function furnishSingleRoom(design: Design, level: number, roomId: string): DollBox[] {
  const floor = design.floors.find((f) => f.level === level)
  const room = floor?.rooms.find((r) => r.id === roomId)
  if (!floor || !room || room.outdoor) return []
  const cbm = (design as { cbm?: { floors: { rooms: { id: string; type: string }[] }[] } }).cbm
  const type = cbm?.floors.flatMap((f) => f.rooms).find((r) => r.id === roomId)?.type
  const cx = room.rect.x + room.rect.w / 2, cy = room.rect.y + room.rect.h / 2
  const boxes: DollBox[] = []
  const push: Push = (id, mat, pos, size) => { if (size[0] > 0.015 && size[1] > 0.015 && size[2] > 0.015) boxes.push({ id, mat, pos, size }) }
  furnishRoom(room, floor, type, 0, (mm) => (mm - cx) / 1000, (mm) => (mm - cy) / 1000, (mm) => mm / 1000, push)
  return boxes
}
