import { type Rect, rectBottom, rectRight } from '../geometry.ts'
import type { FloorPlan, Opening, PlacedRoom } from '../engine/types.ts'

/* ------------------------------------------------------------------ *
 *  Presentation furniture for the 2D plan — pure and deterministic.
 *  Drawing only: it never changes the plan. Every item stays inside
 *  its room (inset from the walls) and clear of every door / opening
 *  swing zone; an item that would clash is simply left out.
 * ------------------------------------------------------------------ */

export type Finish = 'wood' | 'tile' | 'wet' | 'paving' | 'none'

export type FurnitureShape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; role: Role; rx?: number }
  | { kind: 'circle'; cx: number; cy: number; r: number; role: Role }

/** how the drawing styles each piece */
export type Role =
  | 'bed' | 'pillow' | 'linen' | 'table' | 'seat' | 'soft' | 'rug' | 'counter' | 'appliance'
  | 'sanitary' | 'storage' | 'car' | 'plant' | 'water'

export type RoomFurniture = { roomId: string; finish: Finish; items: FurnitureShape[] }

type Side = 'N' | 'S' | 'E' | 'W'

/** what kind of room an id is, for furnishing */
export function roomKind(r: PlacedRoom): string {
  const id = r.id
  if (/^bath\d|^sharedBath|^accessibleBath|^staff(Bath|Toilet)/.test(id)) return 'bath'
  if (id.startsWith('bed')) return 'bed'
  if (id.startsWith('study')) return 'study'
  if (id.startsWith('lobby')) return 'lobby'
  if (id.startsWith('balcony')) return 'balcony'
  if (id === 'familyLounge') return 'lounge'
  return id
}

const FINISH: Record<string, Finish> = {
  bed: 'wood', study: 'wood', lounge: 'wood',
  living: 'tile', livingDining: 'tile', dining: 'tile', kitchen: 'tile', foyer: 'tile',
  corridor: 'tile', lobby: 'tile', pooja: 'tile', stair: 'tile', lift: 'tile',
  bath: 'wet', utility: 'wet',
  parking: 'paving', verandah: 'paving', balcony: 'paving', courtyard: 'paving',
}

/** clear floor inside the walls */
const INSET = 150

type Zone = Rect

/** the part of the room a door / opening needs to swing and pass through */
export function doorZones(room: PlacedRoom, openings: Opening[]): Zone[] {
  const r = room.rect
  const zones: Zone[] = []
  for (const o of openings) {
    if (o.kind === 'window' || !o.rooms?.includes(room.id)) continue
    const half = o.width / 2 + 100
    // a leaf swinging INTO this room needs its full arc; otherwise (the leaf
    // swings away, or there is no leaf) only a walking passage is kept clear
    const into = (roomSide: 1 | -1) => o.leaf !== false && o.kind !== 'window' && (o.swing ?? 1) === roomSide
    if (o.orient === 'h') {
      const down = Math.abs(o.at.y - r.y) < 2 // wall on the room's north edge → room lies below
      const reach = into(down ? 1 : -1) ? Math.max(900, o.width) + 150 : 750
      zones.push({ x: o.at.x - half, y: down ? o.at.y : o.at.y - reach, w: half * 2, h: reach })
    } else {
      const right = Math.abs(o.at.x - r.x) < 2
      const reach = into(right ? 1 : -1) ? Math.max(900, o.width) + 150 : 750
      zones.push({ x: right ? o.at.x : o.at.x - reach, y: o.at.y - half, w: reach, h: half * 2 })
    }
  }
  return zones
}

const hit = (a: Rect, b: Rect) => a.x < rectRight(b) && rectRight(a) > b.x && a.y < rectBottom(b) && rectBottom(a) > b.y
const bbox = (s: FurnitureShape): Rect => s.kind === 'rect' ? s : { x: s.cx - s.r, y: s.cy - s.r, w: s.r * 2, h: s.r * 2 }

/** which walls carry a door / opening for this room */
function doorSides(room: PlacedRoom, openings: Opening[]): Set<Side> {
  const r = room.rect
  const out = new Set<Side>()
  for (const o of openings) {
    if (o.kind === 'window' || !o.rooms?.includes(room.id)) continue
    if (o.orient === 'h') out.add(Math.abs(o.at.y - r.y) < 2 ? 'N' : 'S')
    else out.add(Math.abs(o.at.x - r.x) < 2 ? 'W' : 'E')
  }
  return out
}

/**
 * A frame against one wall: `a` runs along the wall, `d` into the room.
 * place(a, d, w, h) returns the plan rect of a w (along) × h (deep) item.
 */
function frame(r: Rect, side: Side) {
  const x0 = r.x + INSET
  const y0 = r.y + INSET
  const x1 = rectRight(r) - INSET
  const y1 = rectBottom(r) - INSET
  const along = side === 'N' || side === 'S' ? x1 - x0 : y1 - y0
  const depth = side === 'N' || side === 'S' ? y1 - y0 : x1 - x0
  const place = (a: number, d: number, w: number, h: number): Rect => {
    switch (side) {
      case 'N': return { x: x0 + a, y: y0 + d, w, h }
      case 'S': return { x: x0 + a, y: y1 - d - h, w, h }
      case 'W': return { x: x0 + d, y: y0 + a, w: h, h: w }
      default: return { x: x1 - d - h, y: y0 + a, w: h, h: w }
    }
  }
  return { along, depth, place }
}

/** walls ordered for a "back wall": no door first, then the longest */
function backWalls(room: PlacedRoom, openings: Opening[]): Side[] {
  const doors = doorSides(room, openings)
  const r = room.rect
  const len = (s: Side) => (s === 'N' || s === 'S' ? r.w : r.h)
  return (['N', 'E', 'S', 'W'] as Side[]).sort((p, q) =>
    Number(doors.has(p)) - Number(doors.has(q)) || len(q) - len(p))
}

const R = (x: Rect, role: Role, rx?: number): FurnitureShape => ({ kind: 'rect', ...x, role, ...(rx ? { rx } : {}) })
const C = (cx: number, cy: number, r: number, role: Role): FurnitureShape => ({ kind: 'circle', cx, cy, r, role })
const centre = (x: Rect) => ({ x: x.x + x.w / 2, y: x.y + x.h / 2 })

/** furniture for one room against a chosen back wall; empty if nothing fits */
function furnish(kind: string, room: PlacedRoom, side: Side): FurnitureShape[] {
  const { along: L, depth: D, place } = frame(room.rect, side)
  const out: FurnitureShape[] = []
  const mid = (w: number) => Math.max(0, (L - w) / 2)
  if (L < 600 || D < 600) return out
  switch (kind) {
    case 'bed': {
      const big = /master|parents/i.test(room.name)
      const bw = big ? 1800 : L >= 2700 ? 1500 : 1000
      if (L < bw || D < 2000 + 600) return out
      const bed = place(mid(bw), 0, bw, 2000)
      out.push(R(bed, 'bed', 40), R(place(mid(bw) + 60, 80, bw / 2 - 90, 380), 'pillow', 60),
        R(place(mid(bw) + bw / 2 + 30, 80, bw / 2 - 90, 380), 'pillow', 60),
        R(place(mid(bw), 1300, bw, 700), 'linen', 20))
      if (L >= bw + 2 * 500) {
        out.push(R(place(mid(bw) - 480, 0, 420, 400), 'storage'), R(place(mid(bw) + bw + 60, 0, 420, 400), 'storage'))
      }
      if (D >= 2000 + 600 + 600 + 700) out.push(R(place(Math.max(0, L - 1800), D - 600, Math.min(1800, L), 600), 'storage'))
      return out
    }
    case 'living': case 'livingDining': case 'lounge': {
      const zoneL = kind === 'livingDining' ? L * 0.55 : L
      const sw = Math.min(2600, zoneL - 400)
      if (sw < 1600 || D < 2600) return out
      const a0 = (zoneL - sw) / 2
      out.push(R(place(a0 - 100, 0, sw + 200, 2000), 'rug', 60))
      out.push(R(place(a0, 0, sw, 850), 'soft', 120))
      if (kind !== 'lounge' && D >= 3200) out.push(R(place(a0, 850, 850, 1100), 'soft', 120))
      out.push(R(place(a0 + sw / 2 - 450, 1150, 900, 520), 'table', 60))
      if (D >= 3600) out.push(R(place(a0 + sw / 2 - 900, D - 420, 1800, 420), 'storage'))
      if (kind === 'livingDining' && L - zoneL >= 2000) {
        const t = dining(L - zoneL - 300, D, (a, d, w, h) => place(zoneL + 150 + a, d, w, h))
        out.push(...t)
      }
      return out
    }
    case 'dining':
      return dining(L, D, place)
    case 'kitchen': {
      if (D < 1500) return out
      out.push(R(place(0, 0, L, 600), 'counter'))
      if (D >= 2400 && L >= 1500) out.push(R(place(0, 600, 600, Math.min(D - 1200, 1800)), 'counter'))
      const hob = place(Math.max(0, L * 0.3 - 300), 60, 600, 480)
      const c = centre(hob)
      for (const [dx, dy] of [[-140, -110], [140, -110], [-140, 110], [140, 110]]) out.push(C(c.x + dx, c.y + dy, 80, 'appliance'))
      out.push(R(place(Math.min(L - 800, L * 0.68), 80, 700, 440), 'sanitary', 60))
      return out
    }
    case 'bath': {
      if (L < 900 || D < 900) return out
      out.push(R(place(150, 0, 420, 520), 'sanitary', 60), C(centre(place(150, 420, 420, 300)).x, centre(place(150, 420, 420, 300)).y, 170, 'sanitary'))
      if (L >= 1400) out.push(R(place(700, 0, 550, 420), 'sanitary', 80))
      if (L >= 2400 && D >= 900) out.push(R(place(L - 900, 0, 900, Math.min(900, D)), 'water'))
      return out
    }
    case 'study': {
      const dw = Math.min(1400, L - 200)
      if (dw < 900 || D < 1600) return out
      out.push(R(place(mid(dw), 0, dw, 600), 'table'), C(centre(place(mid(dw), 700, dw, 500)).x, centre(place(mid(dw), 700, dw, 500)).y, 250, 'seat'))
      return out
    }
    case 'pooja': return [R(place(mid(Math.min(900, L)), 0, Math.min(900, L), 450), 'storage'), C(centre(place(mid(300), 550, 300, 300)).x, centre(place(mid(300), 550, 300, 300)).y, 110, 'plant')]
    case 'utility': return L >= 1300 ? [R(place(0, 0, 600, 600), 'appliance', 60), R(place(650, 0, Math.min(700, L - 650), 500), 'sanitary', 60)] : []
    case 'foyer': return L >= 1200 ? [R(place(mid(Math.min(1000, L - 200)), 0, Math.min(1000, L - 200), 350), 'storage')] : []
    case 'balcony': {
      const c = centre(place(0, 0, L, D))
      return [C(c.x - 550, c.y, 280, 'seat'), C(c.x + 550, c.y, 280, 'seat'), C(c.x, c.y, 230, 'table')]
    }
    case 'verandah': return [R(place(mid(Math.min(1600, L)), 0, Math.min(1600, L), 450), 'seat'), C(centre(place(150, D - 450, 400, 400)).x, centre(place(150, D - 450, 400, 400)).y, 220, 'plant')]
    case 'parking': {
      const r = room.rect
      const along = r.h >= r.w
      const cw = 1800
      const cl = Math.min(4400, (along ? r.h : r.w) - 400)
      if ((along ? r.w : r.h) < cw + 200 || cl < 3000) return []
      const c = centre(r)
      const car = along ? { x: c.x - cw / 2, y: c.y - cl / 2, w: cw, h: cl } : { x: c.x - cl / 2, y: c.y - cw / 2, w: cl, h: cw }
      return [R(car, 'car', 350)]
    }
    case 'courtyard': {
      const c = centre(room.rect)
      return [C(c.x, c.y, Math.min(900, Math.min(room.rect.w, room.rect.h) / 3), 'plant')]
    }
    default:
      return out
  }
}

function dining(L: number, D: number, place: (a: number, d: number, w: number, h: number) => Rect): FurnitureShape[] {
  const tw = Math.min(1800, L - 1400)
  const td = 900
  if (tw < 900 || D < td + 1400) return []
  const a0 = (L - tw) / 2
  const d0 = (D - td) / 2
  const out: FurnitureShape[] = [R(place(a0, d0, tw, td), 'table', 40)]
  const per = Math.max(1, Math.floor(tw / 600))
  for (let i = 0; i < per; i++) {
    const a = a0 + (tw / per) * (i + 0.5) - 225
    out.push(R(place(a, d0 - 520, 450, 450), 'seat', 60), R(place(a, d0 + td + 70, 450, 450), 'seat', 60))
  }
  if (L - tw >= 1400) out.push(R(place(a0 - 520, d0 + td / 2 - 225, 450, 450), 'seat', 60), R(place(a0 + tw + 70, d0 + td / 2 - 225, 450, 450), 'seat', 60))
  return out
}

const SLIDES = [0, -300, 300, -600, 600, -900, 900, -1200, 1200, -1500, 1500]

/** move a shape along the wall it is arranged against */
function shift(s: FurnitureShape, side: Side, by: number): FurnitureShape {
  if (!by) return s
  const alongX = side === 'N' || side === 'S'
  return s.kind === 'rect'
    ? { ...s, x: s.x + (alongX ? by : 0), y: s.y + (alongX ? 0 : by) }
    : { ...s, cx: s.cx + (alongX ? by : 0), cy: s.cy + (alongX ? 0 : by) }
}

/** the main piece that tells you what a room is — it must survive the clash filter */
const KEY: Partial<Record<Role, true>> = { bed: true, table: true, soft: true, counter: true, sanitary: true, car: true }

/**
 * Furniture for every room on a floor. For each room the back walls are tried
 * in order; the first wall whose key piece is clear of every door zone wins,
 * and any other piece that clashes is dropped.
 */
export function furnishFloor(floor: FloorPlan): RoomFurniture[] {
  return floor.rooms.map((room) => {
    const kind = roomKind(room)
    const finish = FINISH[kind] ?? (room.outdoor ? 'paving' : 'tile')
    const zones = doorZones(room, floor.openings)
    const inner: Rect = { x: room.rect.x + INSET - 1, y: room.rect.y + INSET - 1, w: room.rect.w - 2 * INSET + 2, h: room.rect.h - 2 * INSET + 2 }
    const inside = (s: FurnitureShape) => {
      const b = bbox(s)
      return b.x >= inner.x && b.y >= inner.y && rectRight(b) <= rectRight(inner) && rectBottom(b) <= rectBottom(inner)
    }
    // rugs lie flat, so a door may swing over one; everything else stays clear
    const clear = (s: FurnitureShape) => inside(s) && (s.role === 'rug' || zones.every((z) => !hit(bbox(s), z)))
    for (const side of backWalls(room, floor.openings)) {
      const base = furnish(kind, room, side)
      if (!base.length) continue
      // slide the arrangement along its wall to get the key piece clear of doors
      for (const step of SLIDES) {
        const items = base.map((s) => shift(s, side, step))
        const key = items.find((s) => KEY[s.role])
        if (key && !clear(key)) continue
        return { roomId: room.id, finish, items: items.filter(clear) }
      }
    }
    return { roomId: room.id, finish, items: [] }
  })
}
