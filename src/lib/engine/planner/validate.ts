import { type Rect, rectArea, rectBottom, rectRight, sharedEdge } from '../../geometry.ts'
import type { Design, FloorPlan, Opening, PlacedRoom } from '../types.ts'
import { COLUMN, MAX_BEAM_SPAN, MAX_CANTILEVER, normalizeBrief, stairGeometry } from './program.ts'
import { reachability } from './index.ts'

/* ------------------------------------------------------------------ *
 *  Mandatory plan validators. Any finding here is an `error`: the plan
 *  is rejected (never offered as a direction, flagged on the plan).
 *  They check the finished geometry itself — not the planner's intent —
 *  so they also catch a hand-edited or corrupted design.
 * ------------------------------------------------------------------ */

export type PlanFinding = {
  code: string
  category: 'geometry' | 'egress' | 'topology' | 'vertical' | 'planning'
  message: string
  roomId?: string
}

const overlapArea = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(rectRight(a), rectRight(b)) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(rectBottom(a), rectBottom(b)) - Math.max(a.y, b.y))

/** area of `r` covered by a union of disjoint rects */
const coveredBy = (r: Rect, union: Rect[]) => union.reduce((a, u) => a + overlapArea(r, u), 0)

const lineOf = (o: Opening) => (o.orient === 'h' ? o.at.y : o.at.x)
const alongOf = (o: Opening) => (o.orient === 'h' ? o.at.x : o.at.y)

const WET_BATH = (r: PlacedRoom) => r.zone === 'service' && /bath/i.test(r.id)
const isCirculation = (r: PlacedRoom | undefined) => !!r && r.zone === 'circulation'

/** the swing envelope of a door leaf: a square of the leaf width on the side it swings to */
function swingBox(o: Opening): Rect {
  const inward = o.swing ?? 1
  return o.orient === 'h'
    ? { x: o.at.x - o.width / 2, y: inward > 0 ? o.at.y : o.at.y - o.width, w: o.width, h: o.width }
    : { x: inward > 0 ? o.at.x : o.at.x - o.width, y: o.at.y - o.width / 2, w: o.width, h: o.width }
}

export function planFindings(design: Design): PlanFinding[] {
  const out: PlanFinding[] = []
  const add = (code: string, category: PlanFinding['category'], message: string, roomId?: string) =>
    out.push({ code, category, message, roomId })
  const ids = new Map<string, number>()
  const env = design.model
  const envRect: Rect = {
    x: env.setbacksMm.W, y: env.setbacksMm.N, w: env.envelope.width, h: env.envelope.depth,
  }

  design.floors.forEach((floor, fi) => {
    const lower: FloorPlan | undefined = design.floors[fi - 1]
    const byId = new Map(floor.rooms.map((r) => [r.id, r]))
    const enclosed = floor.rooms.filter((r) => !r.outdoor)
    const count = (id: string | undefined) => id && ids.set(id, (ids.get(id) ?? 0) + 1)

    // ---- semantic identity ----
    for (const r of floor.rooms) {
      if (!r.semanticId) add('SEMANTIC_ID_MISSING', 'planning', `${r.name} has no semantic id.`, r.id)
      count(r.semanticId)
    }
    ;[...floor.walls, ...floor.openings, ...(floor.columns ?? []), ...(floor.beams ?? []), ...(floor.shafts ?? [])]
      .forEach((x) => count(x.id))

    // ---- the plate is exactly tiled by its rooms ----
    const plateArea = floor.footprint.reduce((a, r) => a + rectArea(r), 0)
    const roomArea = enclosed.reduce((a, r) => a + rectArea(r.rect), 0)
    if (Math.abs(plateArea - roomArea) > 50_000)
      add('PLATE_NOT_TILED', 'geometry',
        `${floor.name}: rooms cover ${(roomArea / 1e6).toFixed(1)} m² of a ${(plateArea / 1e6).toFixed(1)} m² floor plate.`)

    // ---- every room (and every outdoor space) inside the setback envelope ----
    for (const r of floor.rooms) {
      if (r.id === 'courtyard' && !r.outdoor) continue
      if (coveredBy(r.rect, [envRect]) < rectArea(r.rect) - 1000)
        add('SETBACK_BREACH', 'geometry', `${r.name} on ${floor.name.toLowerCase()} crosses the setback line.`, r.id)
    }
    // ---- outdoor spaces clear of each other and of the house ----
    for (const o of floor.rooms.filter((r) => r.outdoor)) {
      for (const p of floor.rooms) {
        if (p === o || (p.outdoor && floor.rooms.indexOf(p) < floor.rooms.indexOf(o))) continue
        if (overlapArea(o.rect, p.rect) > 10_000)
          add('OUTDOOR_OVERLAP', 'geometry', `${o.name} overlaps ${p.name}.`, o.id)
      }
    }

    // ---- vertical support: the upper plate sits wholly on the plate below ----
    if (lower) {
      for (const r of floor.footprint) {
        if (coveredBy(r, lower.footprint) < rectArea(r) - 1000)
          add('UPPER_FLOOR_UNSUPPORTED', 'vertical',
            `${floor.name} extends past the floor below — part of its plate has no wall, column or beam under it.`)
      }
      for (const b of floor.rooms.filter((r) => r.outdoor && r.id.startsWith('balcony'))) {
        // unsupported depth = uncovered area spread along the balcony's long side
        const depth = Math.round((rectArea(b.rect) - coveredBy(b.rect, lower.footprint)) / Math.max(b.rect.w, b.rect.h))
        if (depth > MAX_CANTILEVER)
          add('CANTILEVER_EXCEEDED', 'vertical', `${b.name} cantilevers ${depth} mm — over the ${MAX_CANTILEVER} mm limit.`, b.id)
      }
    }

    // ---- structure: columns stack, sit in walls; beams within span ----
    if (floor.columns) {
      const onWall = (p: { x: number; y: number }) => floor.walls.some((w) => {
        const h = Math.abs(w.a.y - w.b.y) < 2
        return h
          ? Math.abs(p.y - w.a.y) < 2 && p.x >= Math.min(w.a.x, w.b.x) - 2 && p.x <= Math.max(w.a.x, w.b.x) + 2
          : Math.abs(p.x - w.a.x) < 2 && p.y >= Math.min(w.a.y, w.b.y) - 2 && p.y <= Math.max(w.a.y, w.b.y) + 2
      })
      for (const c of floor.columns) {
        if (!onWall(c.at)) add('COLUMN_NOT_IN_WALL', 'geometry', `${c.id} stands free inside a room.`)
        if (lower?.columns && !lower.columns.some((d) => Math.abs(d.at.x - c.at.x) < 2 && Math.abs(d.at.y - c.at.y) < 2))
          add('COLUMN_MISALIGNED', 'vertical', `${c.id} has no column directly below it.`)
      }
      for (const b of floor.beams ?? [])
        if (b.span > MAX_BEAM_SPAN) add('BEAM_SPAN_EXCEEDED', 'vertical', `${b.id} spans ${b.span} mm (max ${MAX_BEAM_SPAN}).`)
    }

    // ---- openings: on the right wall, clear of columns and of each other ----
    const cols = floor.columns ?? []
    const leafBoxes = new Map<string, Rect[]>()
    for (const o of floor.openings) {
      const [aId, bId] = o.rooms ?? [null, null]
      const a = aId ? byId.get(aId) : undefined
      const b = bId ? byId.get(bId) : undefined
      const label = o.id ?? `${o.kind} on ${floor.name}`
      if (o.kind === 'door' && (!a || !b)) {
        add('DOOR_WRONG_WALL', 'topology', `${label} does not join two spaces.`)
        continue
      }
      if (o.kind === 'door' && a && b) {
        const e = sharedEdge(a.rect, b.rect)
        const h = e && (e.side === 'N' || e.side === 'S')
        const fits = e && (h ? 'h' : 'v') === o.orient &&
          Math.abs((h ? e.seg.a.y : e.seg.a.x) - lineOf(o)) < 2 &&
          alongOf(o) - o.width / 2 >= (h ? e.seg.a.x : e.seg.a.y) - 1 &&
          alongOf(o) + o.width / 2 <= (h ? e.seg.b.x : e.seg.b.y) + 1
        if (!fits) add('DOOR_WRONG_WALL', 'topology', `${label} is not on the wall shared by ${a.name} and ${b.name}.`, a.id)
        const attachedBath = (a.zone === 'private' && WET_BATH(b)) || (b.zone === 'private' && WET_BATH(a))
        if (o.orient === 'v' && !isCirculation(a) && !isCirculation(b) && !attachedBath && !a.outdoor && !b.outdoor)
          add('VERTICAL_ROOM_PARTITION_DOOR', 'topology', `${label} cuts the vertical partition between ${a.name} and ${b.name}.`, a.id)
        if (o.width > 1000)
          add('DOOR_TOO_WIDE', 'topology', `${label} is ${o.width} mm wide; internal openings are limited to 1000 mm.`, a.id)
      }
      if ((o.kind === 'window' || o.kind === 'entry') && a) {
        const r = a.rect
        const onEdge = o.orient === 'h'
          ? (Math.abs(o.at.y - r.y) < 2 || Math.abs(o.at.y - rectBottom(r)) < 2) && o.at.x - o.width / 2 >= r.x - 1 && o.at.x + o.width / 2 <= rectRight(r) + 1
          : (Math.abs(o.at.x - r.x) < 2 || Math.abs(o.at.x - rectRight(r)) < 2) && o.at.y - o.width / 2 >= r.y - 1 && o.at.y + o.width / 2 <= rectBottom(r) + 1
        if (!onEdge) add('OPENING_OFF_ROOM', 'geometry', `${label} is not on an outside wall of ${a.name}.`, a.id)
      }
      for (const c of cols) {
        const cl = o.orient === 'h' ? c.at.y : c.at.x
        const ca = o.orient === 'h' ? c.at.x : c.at.y
        if (Math.abs(cl - lineOf(o)) < 2 && Math.abs(ca - alongOf(o)) < o.width / 2 + COLUMN / 2)
          add('OPENING_ON_COLUMN', 'geometry', `${label} cuts through ${c.id}.`)
      }
      if (o.leaf !== false && o.kind !== 'window' && a) {
        const box = swingBox(o)
        if (coveredBy(box, [a.rect]) < rectArea(box) - 1000)
          add('DOOR_SWING_BLOCKED', 'topology', `${label} swings outside ${a.name}.`, a.id)
        const mine = leafBoxes.get(a.id) ?? []
        if (mine.some((m) => overlapArea(m, box) > 10_000))
          add('DOOR_SWING_BLOCKED', 'topology', `${label} swings into another door in ${a.name}.`, a.id)
        mine.push(box)
        leafBoxes.set(a.id, mine)
      }
    }
    for (let i = 0; i < floor.openings.length; i++) {
      for (let j = i + 1; j < floor.openings.length; j++) {
        const p = floor.openings[i]
        const q = floor.openings[j]
        if (p.orient !== q.orient || Math.abs(lineOf(p) - lineOf(q)) > 2) continue
        if (Math.abs(alongOf(p) - alongOf(q)) < (p.width + q.width) / 2)
          add('OPENINGS_OVERLAP', 'geometry', `${p.id ?? p.kind} and ${q.id ?? q.kind} overlap on one wall.`)
      }
    }

    // ---- wet areas breathe ----
    for (const r of enclosed.filter(WET_BATH)) {
      const vent = floor.openings.some((o) => o.kind === 'window' && o.rooms?.[0] === r.id && o.width >= 600)
      if (!vent) add('BATH_NO_VENTILATION', 'planning', `${r.name} has no ventilator on an outside wall.`, r.id)
    }

    // ---- privacy: bedrooms are never passages, ensuites open only to their bedroom ----
    for (const o of floor.openings) {
      if (o.kind !== 'door' || !o.rooms?.[0] || !o.rooms[1]) continue
      const [x, y] = o.rooms.map((id) => byId.get(id!))
      for (const [r, other] of [[x, y], [y, x]] as const) {
        if (!r || !other) continue
        if (r.zone === 'private' && !(isCirculation(other) || other.outdoor || (WET_BATH(other) && !/shared|accessible/i.test(other.id))))
          add('DOOR_PRIVACY', 'topology', `${r.name} opens into ${other.name} — a bedroom must be entered from circulation.`, r.id)
      }
    }

    // ---- reachability, recomputed from the door graph itself ----
    for (const id of reachability(floor.rooms, floor.openings, floor.level))
      if (!floor.unreachableRooms.includes(id))
        add('UNREACHABLE_ROOM', 'topology', `${byId.get(id)?.name ?? id} cannot be reached through a door.`, id)
  })

  for (const [id, n] of ids) if (n > 1) add('SEMANTIC_ID_DUPLICATE', 'planning', `Semantic id ${id} is used ${n} times.`)

  // ---- stair core: big enough, identical on every floor ----
  if (design.floors.length > 1) {
    const st = stairGeometry(normalizeBrief(design.model))
    const rects = design.floors.map((f) => f.rooms.find((r) => r.id === 'stair')?.rect)
    for (const r of rects) {
      if (!r) continue
      const across = Math.min(r.w, r.h)
      const along = Math.max(r.w, r.h)
      if (across < st.slotWidth - 1 || along < st.depth - 1)
        add('STAIR_TOO_SMALL', 'vertical', `The stair is ${across} × ${along} mm; ${st.risers} risers need ${st.slotWidth} × ${st.depth} mm.`, 'stair')
    }
    const base = rects[0]
    if (base && rects.some((r) => r && (r.x !== base.x || r.y !== base.y || r.w !== base.w || r.h !== base.h)))
      add('STAIR_MISALIGNED', 'vertical', 'The stair core is not the same rectangle on every floor.')
  }
  return out
}
