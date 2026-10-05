import { rectArea, rectBottom, rectRight, rectUnionEdges, type Rect } from '../geometry.ts'
import type { Design } from '../engine/types.ts'
import { validate } from '../rules/index.ts'
import { normalizeBrief, stairGeometry } from '../engine/planner/program.ts'
import { applyLayout, baseBox, boxNow, extractLayout, hasOutline, noOutline, shiftRect, type FloorLayout, type LayoutDoc, type LayoutRoom, type Outline } from './layout.ts'
import { MODULE, contains, intersect, joinIfRect, m, overlapArea, sameRect, snapMm, sqm, subtract, touchLength, unionRects } from './rects.ts'
import { ADDABLE_TYPES, OUTDOOR_TYPES, TYPE_SPEC, constraintsOf, type RoomType } from './roomTypes.ts'
import type { SiteFeature } from '../engine/types.ts'

/* ------------------------------------------------------------------ *
 *  Plan editing operations. Each one is a pure function: (layout) in,
 *  a new layout out, or a reason it cannot be done. Nothing here is
 *  accepted until `commit` has rebuilt the whole plan from the layout
 *  and the deterministic validator has passed it.
 *
 *  The rule that keeps every step valid: a floor is always exactly
 *  tiled by its rooms. Space that no room uses is a real "vacant"
 *  room, so a half-finished edit is never an invalid plan.
 * ------------------------------------------------------------------ */

export type Notice = { severity: 'error' | 'warning' | 'info'; message: string; roomId?: string }

export type OpOk = { ok: true; layout: LayoutDoc; notes: Notice[]; message: string; affected: string[] }
export type OpFail = { ok: false; reason: string }
export type OpResult = OpOk | OpFail

const fail = (reason: string): OpFail => ({ ok: false, reason })
const ok = (layout: LayoutDoc, message: string, affected: string[] = [], notes: Notice[] = []): OpOk => ({ ok: true, layout, message, affected, notes })

export const floorOf = (layout: LayoutDoc, level: number): FloorLayout | undefined => layout.floors.find((f) => f.level === level)
/** the floor plate as it stands now: the generated plate with the person's moved outer walls applied */
const plateFor = (layout: LayoutDoc, plan: Design, level: number): Rect[] => {
  const base = plan.floors.find((f) => f.level === level)?.footprint ?? []
  return hasOutline(layout.outline) ? base.map((r) => shiftRect(r, baseBox(plan), layout.outline!)) : base
}
const prefixOf = (plan: Design, level: number) => plan.floors.find((f) => f.level === level)?.prefix ?? (level === 0 ? 'GF' : `F${level}`)
const levelName = (plan: Design, level: number) => plan.floors.find((f) => f.level === level)?.name ?? `Floor ${level}`
const where = (plan: Design, level: number) => (level === 0 ? 'the ground floor' : levelName(plan, level).toLowerCase())

const clone = (layout: LayoutDoc): LayoutDoc => structuredClone(layout)
const area = (r: LayoutRoom) => sqm(r.rect)
export const isVacant = (r: LayoutRoom) => r.type === 'vacant'
/** every room can be edited; only a locked room is held. What an edit breaks is found by the rules after it, not guessed before it. */
const movable = (r: LayoutRoom): string | null => (r.locked ? `${r.name} is locked. Unlock it first.` : null)
/** the stair and lift stand on every floor as one shaft, and the rest of the plan's rooms are per floor */
const stayOnFloor = (r: LayoutRoom): string | null => (r.fixed ? `${r.name} belongs to every floor, so it cannot be sent to another one.` : r.outdoor ? `${r.name} is an open-air space and stays on its own floor.` : null)

/** the line the building and its open-air spaces must stay inside: the plot less the setbacks */
const envRect = (plan: Design): Rect => ({ x: plan.model.setbacksMm.W, y: plan.model.setbacksMm.N, w: plan.model.envelope.width, h: plan.model.envelope.depth })
/** the rooms (and the house itself) an open-air space would collide with */
function outdoorBlockers(layout: LayoutDoc, plan: Design, level: number, self: LayoutRoom | null, rect: Rect): string[] {
  const floor = floorOf(layout, level)
  const names = (floor?.rooms ?? []).filter((x) => x !== self && overlapArea(x.rect, rect) > 10_000 && (!isVacant(x))).map((x) => x.name)
  if (plateFor(layout, plan, level).some((p) => overlapArea(p, rect) > 10_000) && !names.length) names.push('the house')
  return names
}

const insidePlate = (plate: Rect[], r: Rect) => plate.reduce((a, p) => a + overlapArea(p, r), 0) >= rectArea(r) - 1000

/** how much of a rectangle's boundary lies on the outside of the floor plate, by side */
function exteriorLength(rect: Rect, plate: Rect[]): number {
  let total = 0
  for (const e of rectUnionEdges(plate, null)) {
    const horizontal = e.side === 'N' || e.side === 'S'
    if (horizontal) {
      if ((Math.abs(rect.y - e.a.y) < 2 && e.side === 'N') || (Math.abs(rectBottom(rect) - e.a.y) < 2 && e.side === 'S'))
        total += Math.max(0, Math.min(rectRight(rect), e.b.x) - Math.max(rect.x, e.a.x))
    } else if ((Math.abs(rect.x - e.a.x) < 2 && e.side === 'W') || (Math.abs(rectRight(rect) - e.a.x) < 2 && e.side === 'E'))
      total += Math.max(0, Math.min(rectBottom(rect), e.b.y) - Math.max(rect.y, e.a.y))
  }
  return total
}

/* --------------------------- vacancy: the invariant --------------------------- */

const pad = (n: number) => String(n).padStart(2, '0')

/** Re-derive the vacant rooms of one floor: everything the plate holds that no real room occupies. */
export function settle(layout: LayoutDoc, plan: Design, level: number): LayoutDoc {
  const out = clone(layout)
  const floor = floorOf(out, level)
  if (!floor) return out
  const accepted = new Set(floor.rooms.filter((r) => isVacant(r) && r.accepted).map((r) => `${r.rect.x},${r.rect.y},${r.rect.w},${r.rect.h}`))
  const open = floor.rooms.filter((r) => r.outdoor)
  const real = floor.rooms.filter((r) => !isVacant(r) && !r.outdoor)
  let free = plateFor(out, plan, level)
  for (const r of real) free = free.flatMap((f) => subtract(f, r.rect))
  const regions = unionRects(free.filter((f) => f.w > 0 && f.h > 0)).sort((a, b) => a.y - b.y || a.x - b.x)
  const prefix = prefixOf(plan, level)
  const vacant = regions.map((rect, i): LayoutRoom => ({
    id: `vacant${level}${i + 1}`, semanticId: `${prefix}_VACANT_${pad(i + 1)}`, name: 'Vacant space', type: 'vacant', kind: 'lounge', zone: 'circulation',
    rect, locked: false, fixed: false, constraints: constraintsOf('vacant'),
    ...(accepted.has(`${rect.x},${rect.y},${rect.w},${rect.h}`) ? { accepted: true } : {}),
  }))
  floor.rooms = [...real, ...open, ...vacant]
  return out
}

export const vacantRooms = (layout: LayoutDoc, level: number) => floorOf(layout, level)?.rooms.filter(isVacant) ?? []

/* ------------------------------ name / id helpers ----------------------------- */

const usedIds = (layout: LayoutDoc) => new Set(layout.floors.flatMap((f) => f.rooms.map((r) => r.id)))

function newIdentity(layout: LayoutDoc, plan: Design, level: number, type: RoomType) {
  const spec = TYPE_SPEC[type]
  const used = usedIds(layout)
  const sameType = layout.floors.flatMap((f) => f.rooms).filter((r) => r.type === type).length
  let id = spec.singleId && !used.has(spec.singleId) ? spec.singleId : ''
  let n = sameType + 1
  if (!id) { while (used.has(`${spec.idPrefix}${n}`) || used.has(`${spec.idPrefix}${n}x`)) n++; id = `${spec.idPrefix}${n}` }
  const semantic = new Set(layout.floors.flatMap((f) => f.rooms.map((r) => r.semanticId)))
  let k = n
  const base = `${prefixOf(plan, level)}_${spec.label.toUpperCase().replace(/\W+/g, '_')}`
  while (semantic.has(`${base}_${pad(k)}`)) k++
  return { id, semanticId: `${base}_${pad(k)}`, name: type === 'bedroom' ? `Bedroom ${n}` : sameType === 0 ? spec.label : `${spec.label} ${sameType + 1}` }
}

/* --------------------------------- lock / delete ------------------------------- */

export function toggleLock(layout: LayoutDoc, level: number, id: string): OpResult {
  const out = clone(layout)
  const r = floorOf(out, level)?.rooms.find((x) => x.id === id)
  if (!r) return fail('That room is not on this floor.')
  if (isVacant(r)) return fail('Vacant space cannot be locked. Give it a use first.')
  r.locked = !r.locked
  return ok(out, `${r.name} ${r.locked ? 'locked' : 'unlocked'}.`, [id])
}

export function deleteRoom(layout: LayoutDoc, plan: Design, level: number, id: string): OpResult {
  const out = clone(layout)
  const floor = floorOf(out, level)
  const r = floor?.rooms.find((x) => x.id === id)
  if (!floor || !r) return fail('That room is not on this floor.')
  const why = movable(r)
  if (why) return fail(why)
  if (isVacant(r)) return fail('This space is already vacant.')
  if (r.fixed) return fail(`${r.name} is how people get around the house. It can be moved, resized or swapped, but not deleted.`)
  const attached = floor.rooms.filter((x) => x.parent === id)
  const gone = new Set([id, ...attached.map((x) => x.id)])
  floor.rooms = floor.rooms.filter((x) => !gone.has(x.id))
  return ok(settle(out, plan, level), `${r.name} deleted${attached.length ? ` with its ${attached.map((x) => x.name.toLowerCase()).join(', ')}` : ''}.`, [...gone])
}

/* ------------------------------------- move ------------------------------------ */

export function swapRooms(layout: LayoutDoc, plan: Design, level: number, aId: string, bId: string): OpResult {
  {
    const f = floorOf(layout, level)
    const a = f?.rooms.find((x) => x.id === aId), b = f?.rooms.find((x) => x.id === bId)
    if (a && b && a !== b && (a.kind === 'stair' || b.kind === 'stair')) {
      const stair = a.kind === 'stair' ? a : b, other = stair === a ? b : a
      return moveStair(layout, plan, level, other.rect, isVacant(other) ? undefined : other.id)
    }
  }
  const out = clone(layout)
  const floor = floorOf(out, level)
  const a = floor?.rooms.find((x) => x.id === aId), b = floor?.rooms.find((x) => x.id === bId)
  if (!floor || !a || !b || a === b) return fail('Pick two different rooms to swap.')
  for (const r of [a, b]) { const why = movable(r); if (why) return fail(why) }
  if (isVacant(a) && isVacant(b)) return fail('Pick a room to swap with.')
  if (!!a.outdoor !== !!b.outdoor) return fail('An open-air space can only swap with another open-air space.')
  if (a.outdoor && b.outdoor) { const ra = a.rect; a.rect = b.rect; b.rect = ra; return ok(out, `${a.name} and ${b.name} swapped places.`, [aId, bId]) }
  if (isVacant(a) || isVacant(b)) {
    // a room swapped with vacant space takes that space, and the space it left becomes vacant
    const room = isVacant(a) ? b : a, space = isVacant(a) ? a : b
    room.rect = space.rect
    floor.rooms = floor.rooms.filter((x) => x !== space)
    return ok(settle(out, plan, level), `${room.name} moved into the vacant space.`, [room.id])
  }
  const ra = { ...a.rect }, rb = { ...b.rect }
  if (ra.w === rb.w && ra.h === rb.h) { a.rect = rb; b.rect = ra; return ok(settle(out, plan, level), `${a.name} and ${b.name} swapped places.`, [aId, bId]) }
  const joined = joinIfRect(ra, rb)
  if (joined) {
    // side by side: keep both sizes and exchange their order inside the rectangle they form together
    const stacked = ra.x === rb.x && ra.w === rb.w
    if (stacked) {
      const aFirst = ra.y < rb.y
      a.rect = { ...ra, y: aFirst ? joined.y + rb.h : joined.y }
      b.rect = { ...rb, y: aFirst ? joined.y : joined.y + ra.h }
    } else {
      const aFirst = ra.x < rb.x
      a.rect = { ...ra, x: aFirst ? joined.x + rb.w : joined.x }
      b.rect = { ...rb, x: aFirst ? joined.x : joined.x + ra.w }
    }
    return ok(settle(out, plan, level), `${a.name} and ${b.name} exchanged their order along the wall they share.`, [aId, bId])
  }
  // apart and unequal: the two rooms exchange places, each taking the shape of the space the other left
  a.rect = rb
  b.rect = ra
  return ok(settle(out, plan, level), `${a.name} and ${b.name} swapped places; each now has the size of the other's old space.`, [aId, bId])
}

export function moveRoom(layout: LayoutDoc, plan: Design, level: number, id: string, to: { x: number; y: number }): OpResult {
  const out = clone(layout)
  const floor = floorOf(out, level)
  const r = floor?.rooms.find((x) => x.id === id)
  if (!floor || !r) return fail('That room is not on this floor.')
  const why = movable(r)
  if (why) return fail(why)
  if (isVacant(r)) return fail('Vacant space cannot be moved.')
  const target: Rect = { x: snapMm(to.x), y: snapMm(to.y), w: r.rect.w, h: r.rect.h }
  if (sameRect(target, r.rect)) return fail('The room did not move.')
  if (r.kind === 'stair') return moveStair(layout, plan, level, target)
  if (r.outdoor) {
    if (!contains(envRect(plan), target)) return fail(`${r.name} would leave the area the plot allows to be built on (inside the setbacks).`)
    const hit = outdoorBlockers(out, plan, level, r, target)
    if (!hit.length) { r.rect = target; return ok(out, `${r.name} moved.`, [id]) }
    const other = floor.rooms.filter((x) => x !== r && x.outdoor && overlapArea(x.rect, target) >= rectArea(x.rect) * 0.4)
    const onlyOpenAir = hit.every((n) => floor.rooms.some((x) => x.outdoor && x.name === n))
    if (other.length === 1 && onlyOpenAir) return swapRooms(layout, plan, level, id, other[0].id)
    return fail(`${r.name} would overlap ${hit.join(' and ')}. Open-air spaces stand beside the house, not on it.`)
  }
  if (!r.outdoor && !insidePlate(plateFor(out, plan, level), target)) return fail(`${r.name} would leave the floor plate. Rooms stay inside the walls of the building.`)
  const others = floor.rooms.filter((x) => x !== r)
  const hit = others.filter((x) => !isVacant(x) && overlapArea(x.rect, target) > 0)
  if (!hit.length) { r.rect = target; return ok(settle(out, plan, level), `${r.name} moved.`, [id]) }
  // dropping a room on another room swaps them
  const best = hit.sort((p, q) => overlapArea(q.rect, target) - overlapArea(p.rect, target))[0]
  if (hit.length === 1 && overlapArea(best.rect, target) >= rectArea(best.rect) * 0.4) return swapRooms(layout, plan, level, id, best.id)
  return fail(`${r.name} would overlap ${hit.map((x) => x.name).join(' and ')}. Drop it on one room to swap, or onto vacant space.`)
}

/* ------------------------------------ resize ----------------------------------- */

/** Room sizes are the person's choice. The recommended minimum is shown as a note after the edit, never as a limit; only a sliver
 *  too thin to stand in is refused. */
function sizeProblem(r: LayoutRoom, rect: Rect): string | null {
  if (isVacant(r)) return null
  return Math.min(rect.w, rect.h) < MODULE ? `${r.name} would have no size left.` : null
}

type Side = 'N' | 'S' | 'E' | 'W'
const MIN_STAND = 900
/** how short a room may be squeezed along one direction: a person's width, the stair's legal flight, never for the lift */
type MinOf = (n: LayoutRoom, side: Side) => number
function minSizer(plan: Design): MinOf {
  const st = stairGeometry(normalizeBrief(plan.model))
  return (n, side) => {
    if (n.kind === 'lift') return Infinity
    if (n.kind !== 'stair') return MIN_STAND
    const len = side === 'E' || side === 'W' ? n.rect.w : n.rect.h, other = side === 'E' || side === 'W' ? n.rect.h : n.rect.w
    return len >= other ? st.depth : st.slotWidth
  }
}

/** how far `n` reaches into the strip `g` along the push direction of `side` */
function reach(n: Rect, g: Rect, side: Side): number {
  if (side === 'E') return g.x + g.w - n.x
  if (side === 'W') return n.x + n.w - g.x
  if (side === 'S') return g.y + g.h - n.y
  return n.y + n.h - g.y
}
const along = (r: Rect, side: Side) => (side === 'E' || side === 'W' ? r.w : r.h)
function shrinkFrom(r: Rect, side: Side, d: number): Rect {
  if (side === 'E') return { ...r, x: r.x + d, w: r.w - d }
  if (side === 'W') return { ...r, w: r.w - d }
  if (side === 'S') return { ...r, y: r.y + d, h: r.h - d }
  return { ...r, h: r.h - d }
}
function shift(r: Rect, side: Side, d: number): Rect {
  if (side === 'E') return { ...r, x: r.x + d }
  if (side === 'W') return { ...r, x: r.x - d }
  if (side === 'S') return { ...r, y: r.y + d }
  return { ...r, y: r.y - d }
}

/** Make room for `claim`: every room it runs into gives way in the direction `side`. A room that would get too thin is
 *  pushed along whole and passes the push on to the rooms behind it. Returns the ids moved, or why it cannot be done. */
function pushAway(rooms: LayoutRoom[], claim: Rect, side: Side, skip: Set<LayoutRoom>, depth = 0, plate?: Rect[], minOf: MinOf = () => MIN_STAND): string[] | string {
  if (depth > 12) return 'Too many rooms would have to move.'
  const moved: string[] = []
  for (const n of rooms) {
    if (skip.has(n) || isVacant(n) || n.outdoor || overlapArea(n.rect, claim) <= 0) continue
    if (n.locked) return `${n.name} is locked and is in the way. Unlock it first.`
    const d = reach(n.rect, claim, side)
    if (d <= 0) continue
    skip.add(n)
    const was = { ...n.rect }
    // a room gives up space down to its minimum (the stair keeps its legal flight, the lift its shaft); past that it slides along whole
    if (along(n.rect, side) - d >= minOf(n, side)) n.rect = shrinkFrom(n.rect, side, d)
    else {
      n.rect = shift(n.rect, side, d)
      if (plate && !insidePlate(plate, n.rect)) {
        // a pushed room still has to be usable: it gives up space down to its minimum width, never below
        const room = along(was, side) - Math.min(minOf(n, side), along(was, side))
        return `${n.name} has no space left to give${room > 0 ? `; it can give up at most ${m(room)} m here` : ''}. Make the villa bigger first, or resize less.`
      }
      const more = pushAway(rooms, n.rect, side, skip, depth + 1, plate, minOf)
      if (typeof more === 'string') return more
      moved.push(...more)
    }
    moved.push(n.id)
    moved.push(...followEdge(rooms, n, was, claim, side, d, skip))
  }
  return moved
}

/** the rooms that shared the edge a pushed room gave up follow it, so no thin empty strip is left between them */
function followEdge(rooms: LayoutRoom[], n: LayoutRoom, was: Rect, claim: Rect, side: Side, d: number, skip: Set<LayoutRoom>): string[] {
  const out: string[] = []
  const edge = side === 'S' ? was.y : side === 'N' ? was.y + was.h : side === 'E' ? was.x : was.x + was.w
  const horizontal = side === 'N' || side === 'S'
  for (const m of rooms) {
    if (m === n || skip.has(m) || isVacant(m) || m.outdoor || m.locked || m.kind === 'stair' || m.kind === 'lift') continue
    if (overlapArea(m.rect, claim) > 0) continue
    const far = side === 'S' ? m.rect.y + m.rect.h : side === 'N' ? m.rect.y : side === 'E' ? m.rect.x + m.rect.w : m.rect.x
    if (Math.abs(far - edge) >= 2) continue
    const inside = horizontal ? m.rect.x >= was.x - 1 && m.rect.x + m.rect.w <= was.x + was.w + 1 : m.rect.y >= was.y - 1 && m.rect.y + m.rect.h <= was.y + was.h + 1
    if (!inside) continue
    const next = side === 'S' ? { ...m.rect, h: m.rect.h + d } : side === 'N' ? { ...m.rect, y: m.rect.y - d, h: m.rect.h + d } : side === 'E' ? { ...m.rect, w: m.rect.w + d } : { ...m.rect, x: m.rect.x - d, w: m.rect.w + d }
    if (rooms.some((o) => o !== m && !isVacant(o) && !o.outdoor && overlapArea(o.rect, next) > 0)) continue
    m.rect = next
    out.push(m.id)
  }
  return out
}

/** rooms touching the edge that moved inward follow it when they fit within it, so the freed strip stays used */
function followIn(rooms: LayoutRoom[], self: LayoutRoom, before: Rect, after: Rect, side: Side): string[] {
  const out: string[] = []
  const line = side === 'E' ? before.x + before.w : side === 'W' ? before.x : side === 'S' ? before.y + before.h : before.y
  const d = along(before, side) - along(after, side)
  for (const n of rooms) {
    if (n === self || isVacant(n) || n.outdoor || n.locked) continue
    const touches = side === 'E' ? Math.abs(n.rect.x - line) < 2 : side === 'W' ? Math.abs(n.rect.x + n.rect.w - line) < 2 : side === 'S' ? Math.abs(n.rect.y - line) < 2 : Math.abs(n.rect.y + n.rect.h - line) < 2
    const within = side === 'E' || side === 'W' ? n.rect.y >= before.y - 1 && n.rect.y + n.rect.h <= before.y + before.h + 1 : n.rect.x >= before.x - 1 && n.rect.x + n.rect.w <= before.x + before.w + 1
    if (!touches || !within) continue
    n.rect = side === 'E' ? { ...n.rect, x: n.rect.x - d, w: n.rect.w + d } : side === 'W' ? { ...n.rect, w: n.rect.w + d } : side === 'S' ? { ...n.rect, y: n.rect.y - d, h: n.rect.h + d } : { ...n.rect, h: n.rect.h + d }
    out.push(n.id)
  }
  return out
}

/** resize one room on one floor: growing pushes the connected rooms along, shrinking lets them follow */
function resizeOn(floor: FloorLayout, r: LayoutRoom, next: Rect, plate: Rect[], minOf: MinOf): string[] | string {
  const before = r.rect
  const affected: string[] = [r.id]
  const sides: { side: Side; grow: number }[] = [
    { side: 'E', grow: next.x + next.w - (before.x + before.w) }, { side: 'W', grow: before.x - next.x },
    { side: 'S', grow: next.y + next.h - (before.y + before.h) }, { side: 'N', grow: before.y - next.y },
  ]
  for (const { side, grow } of sides) {
    if (grow > 0) {
      const claim = subtract(next, before).find((g) => (side === 'E' ? g.x >= before.x + before.w - 1 : side === 'W' ? g.x + g.w <= before.x + 1 : side === 'S' ? g.y >= before.y + before.h - 1 : g.y + g.h <= before.y + 1))
      if (!claim) continue
      const res = pushAway(floor.rooms, claim, side, new Set([r]), 0, plate, minOf)
      if (typeof res === 'string') return res
      affected.push(...res)
    }
  }
  r.rect = next
  for (const { side, grow } of sides) if (grow < 0) affected.push(...followIn(floor.rooms, r, before, next, side))
  const outside = floor.rooms.find((x) => !isVacant(x) && !x.outdoor && !insidePlate(plate, x.rect))
  if (outside) return `${outside.name} would be pushed out of the building. Make the villa bigger first (drag its orange outer wall), or resize less.`
  return affected
}

export function resizeRoom(layout: LayoutDoc, plan: Design, level: number, id: string, to: Rect): OpResult {
  const out = clone(layout)
  const floor = floorOf(out, level)
  const r = floor?.rooms.find((x) => x.id === id)
  if (!floor || !r) return fail('That room is not on this floor.')
  const why = movable(r)
  if (why) return fail(why)
  if (isVacant(r)) return fail('Vacant space is resized by giving it a use.')
  const next: Rect = { x: snapMm(to.x), y: snapMm(to.y), w: snapMm(to.w), h: snapMm(to.h) }
  if (next.w <= 0 || next.h <= 0) return fail('A room cannot be that small.')
  if (sameRect(next, r.rect)) return fail('The size did not change.')
  if (r.outdoor) {
    if (next.x < 0 || next.y < 0 || next.x + next.w > plan.model.plot.width || next.y + next.h > plan.model.plot.depth) return fail(`${r.name} would leave the plot.`)
    // the open-air spaces it grows into make way: they slide along, or give up space when they cannot slide
    const plot: Rect = { x: 0, y: 0, w: plan.model.plot.width, h: plan.model.plot.depth }
    const plate = plateFor(out, plan, level)
    const pushed: string[] = []
    for (const o of floor.rooms) {
      if (o === r || !o.outdoor || overlapArea(o.rect, next) <= 0) continue
      if (o.locked) return fail(`${o.name} is locked and is in the way. Unlock it first.`)
      const side: Side = next.x + next.w > r.rect.x + r.rect.w && o.rect.x >= r.rect.x + r.rect.w - 1 ? 'E' : next.x < r.rect.x && o.rect.x + o.rect.w <= r.rect.x + 1 ? 'W'
        : next.y + next.h > r.rect.y + r.rect.h && o.rect.y >= r.rect.y + r.rect.h - 1 ? 'S' : 'N'
      const d = reach(o.rect, next, side)
      const clear = (q: Rect) => contains(plot, q) && !plate.some((p) => overlapArea(p, q) > 10_000) && !floor.rooms.some((x) => x !== o && x !== r && overlapArea(x.rect, q) > 0)
      const slid = shift(o.rect, side, d), cut = shrinkFrom(o.rect, side, d)
      if (clear(slid)) o.rect = slid
      else if (along(o.rect, side) - d >= MIN_STAND) o.rect = cut
      else return fail(`${o.name} has no room to make way for ${r.name}. Move or shrink it first.`)
      pushed.push(o.id)
    }
    const hit = outdoorBlockers(out, plan, level, r, next)
    if (hit.length) return fail(`${r.name} would overlap ${hit.join(' and ')}.`)
    r.rect = next
    return ok(out, `${r.name} resized to ${m(next.w)} × ${m(next.h)} m${pushed.length ? `; ${pushed.length} open-air space${pushed.length > 1 ? 's' : ''} moved to make way` : ''}.`, [id, ...pushed])
  }
  if (!insidePlate(plateFor(out, plan, level), next)) {
    // past the outer wall: the room grows up to the wall (drag the orange outline to make the villa itself bigger)
    const plate = plateFor(out, plan, level)
    const bx = Math.min(...plate.map((p) => p.x)), by = Math.min(...plate.map((p) => p.y))
    const br = Math.max(...plate.map((p) => p.x + p.w)), bb = Math.max(...plate.map((p) => p.y + p.h))
    const x = Math.max(next.x, bx), y = Math.max(next.y, by)
    next.w = Math.min(next.x + next.w, br) - x; next.h = Math.min(next.y + next.h, bb) - y
    next.x = x; next.y = y
    if (sameRect(next, r.rect)) return fail(`${r.name} already reaches the outer wall. Drag the orange outline to make the villa bigger.`)
  }
  const tooSmall = sizeProblem(r, next)
  if (tooSmall) return fail(tooSmall)
  // the stair and lift are one shaft through every floor: they change size on all floors together
  const shaft = r.kind === 'stair' || r.kind === 'lift'
  const affected: string[] = []
  const was = { ...r.rect }
  for (const f of shaft ? out.floors : [floor]) {
    const target = f === floor ? r : f.rooms.find((x) => x.id === r.id && sameRect(x.rect, was))
    if (!target) continue
    if (target.locked) return fail(`${target.name} is locked on another floor.`)
    const res = resizeOn(f, target, next, plateFor(out, plan, f.level), minSizer(plan))
    if (typeof res === 'string') return fail(res)
    affected.push(...res)
  }
  // a push that moved the stair or lift on this floor moves it the same way on every other floor
  if (!shaft) {
    const before = floorOf(layout, level)!.rooms.filter((x) => x.kind === 'stair' || x.kind === 'lift')
    for (const b of before) {
      const now = floor.rooms.find((x) => x.id === b.id)
      if (!now || sameRect(now.rect, b.rect)) continue
      for (const f of out.floors) {
        if (f === floor) continue
        const there = f.rooms.find((x) => x.id === b.id && sameRect(x.rect, b.rect))
        if (!there) continue
        const res = resizeOn(f, there, { ...now.rect }, plateFor(out, plan, f.level), minSizer(plan))
        if (typeof res === 'string') return fail(`${res} (the ${b.name.toLowerCase()} moves on every floor)`)
        affected.push(...res)
      }
    }
  }
  let next2 = out
  for (const f of shaft || affected.length > 1 ? out.floors : [floor]) next2 = settle(next2, plan, f.level)
  const pushed = [...new Set(affected)].filter((x) => x !== id)
  return (ok(next2, `${r.name} resized to ${m(next.w)} × ${m(next.h)} m${shaft && out.floors.length > 1 ? ' on every floor' : ''}${pushed.length ? `; ${pushed.length} connected room${pushed.length > 1 ? 's' : ''} moved to make space` : ''}.`, [...new Set(affected)]))
}

/* ------------------------------ the stair: one shaft, every floor ------------------------------ */

/** Slide the stair along its band (the line of rooms it stands in) on one floor: the rooms between its old and new place
 *  shift over by the stair's length, so every room keeps its size and its neighbours. */
function slideStair(f: FloorLayout, stair: LayoutRoom, start: number, axis: 'x' | 'y', name: string): string | null {
  const old = stair.rect
  const len = axis === 'y' ? old.h : old.w
  const s0 = axis === 'y' ? old.y : old.x
  const lo = axis === 'y' ? old.x : old.y, hi = axis === 'y' ? old.x + old.w : old.y + old.h
  const st = (r: Rect) => (axis === 'y' ? r.y : r.x), en = (r: Rect) => (axis === 'y' ? r.y + r.h : r.x + r.w)
  const cross = (r: Rect) => (axis === 'y' ? [r.x, r.x + r.w] : [r.y, r.y + r.h])
  const set = (r: LayoutRoom, a0: number, a1: number) => { r.rect = axis === 'y' ? { ...r.rect, y: a0, h: a1 - a0 } : { ...r.rect, x: a0, w: a1 - a0 } }
  const up = start < s0
  // the span the rooms move through
  const span0 = up ? start : s0 + len, span1 = up ? s0 : start + len
  for (const n of f.rooms) {
    if (n === stair || isVacant(n) || n.outdoor) continue
    const [c0, c1] = cross(n.rect)
    const overlapsSpan = en(n.rect) > span0 && st(n.rect) < span1
    if (!overlapsSpan || c1 <= lo + 1 || c0 >= hi - 1) continue
    const inBand = c0 >= lo - 1 && c1 <= hi + 1
    if (!inBand) return `${n.name} on ${name} is in the way and is wider than the stair's band.`
    if (n.locked) return `${n.name} on ${name} is locked and is in the way.`
    if (st(n.rect) >= span0 - 1 && en(n.rect) <= span1 + 1) { set(n, st(n.rect) + (up ? len : -len), en(n.rect) + (up ? len : -len)); continue }
    // a room only partly inside the span keeps the part outside it
    if (up) set(n, st(n.rect), span0)
    else set(n, span1, en(n.rect))
    if (Math.min(n.rect.w, n.rect.h) < MIN_STAND) return `${n.name} on ${name} would be too small after the stair moves.`
  }
  set(stair, start, start + len)
  return null
}

export function moveStair(layout: LayoutDoc, plan: Design, level: number, target: Rect, swapWith?: string): OpResult {
  const out = clone(layout)
  const here = floorOf(out, level)?.rooms.find((x) => x.kind === 'stair')
  if (!here) return fail('This floor has no stair.')
  const old = { ...here.rect }
  const T = { x: snapMm(target.x), y: snapMm(target.y), w: snapMm(target.w), h: snapMm(target.h) }
  if (sameRect(T, old)) return fail('The stair did not move.')
  // within its own band the stair slides, keeping its size; the rooms it passes shift over on every floor
  const axis: 'x' | 'y' | null = Math.abs(T.x - old.x) < 2 && Math.abs(T.w - old.w) < 2 ? 'y' : Math.abs(T.y - old.y) < 2 && Math.abs(T.h - old.h) < 2 ? 'x' : null
  if (axis) {
    const len = axis === 'y' ? old.h : old.w
    const start = (axis === 'y' ? T.y : T.x) < (axis === 'y' ? old.y : old.x) ? (axis === 'y' ? T.y : T.x) : (axis === 'y' ? T.y + T.h : T.x + T.w) - len
    for (const f of out.floors) {
      const stair = f.rooms.find((x) => x.kind === 'stair')
      if (!stair) continue
      if (stair.locked) return fail('The stair is locked.')
      const why = slideStair(f, stair, start, axis, where(plan, f.level))
      if (why) return fail(why)
    }
    let res = out
    for (const f of out.floors) res = settle(res, plan, f.level)
    return ok(res, `The stair moved on every floor; the rooms beside it shifted over to make space.`, out.floors.flatMap((f) => f.rooms.map((x) => x.id)))
  }
  for (const f of out.floors) {
    const stair = f.rooms.find((x) => x.kind === 'stair')
    if (!stair) continue
    if (stair.locked) return fail('The stair is locked.')
    if (!insidePlate(plateFor(out, plan, f.level), T)) return fail(`The stair would leave the building on ${where(plan, f.level)}.`)
    const others = f.rooms.filter((x) => x !== stair && !isVacant(x) && !x.outdoor && overlapArea(x.rect, T) > 0)
    const picked = f.level === level && swapWith ? others.find((x) => x.id === swapWith) : undefined
    // the room in the way: the one dropped on, or on other floors the one covering most of the new spot
    const main = picked ?? [...others].sort((p, q) => overlapArea(q.rect, T) - overlapArea(p.rect, T))[0]
    for (const n of others) {
      if (n.locked) return fail(`${n.name} on ${where(plan, f.level)} is locked and is where the stair would go.`)
      if (n === main && (sameRect(n.rect, T) || contains(T, n.rect) || picked)) { n.rect = { ...old }; continue }
      const rest = subtract(n.rect, T)
      if (rest.length !== 1) return fail(`${n.name} on ${where(plan, f.level)} would be cut in two by the stair. Swap the stair with a room of about its size.`)
      n.rect = rest[0]
      if (Math.min(n.rect.w, n.rect.h) < MIN_STAND) return fail(`${n.name} on ${where(plan, f.level)} would be too narrow after the stair moves.`)
    }
    stair.rect = { ...T }
  }
  let res = out
  for (const f of out.floors) res = settle(res, plan, f.level)
  return ok(res, `The stair moved on every floor${out.floors.length > 1 ? '; the rooms where it now stands took its old place' : ''}.`, out.floors.flatMap((f) => f.rooms.map((x) => x.id)))
}

/* ------------------------------------- add ------------------------------------- */

/** a rectangle for a room of `type` cut from the vacant region `v`, or null when none fits */
function carve(v: Rect, areaSqm: number, c: ReturnType<typeof constraintsOf>, _zone: string, others: LayoutRoom[], plate: Rect[], wantAccess = true): Rect | null {
  const minW = 900
  // a room is as large as it wants to be, but never larger than the space it goes into
  const need = Math.max(1.5, Math.min(areaSqm, rectArea(v) / 1e6)) * 1e6
  const cands: Rect[] = []
  const wholeOk = rectArea(v) <= Math.max(c.maxSqm, c.targetSqm * 1.3) * 1e6 * 1.15
  if (wholeOk) cands.push(v)
  const snapUp = (x: number) => Math.ceil(x / MODULE - 1e-9) * MODULE
  const t1 = snapUp(need / v.h), t2 = snapUp(need / v.w)
  if (t1 < v.w) { cands.push({ x: v.x, y: v.y, w: t1, h: v.h }); cands.push({ x: v.x + v.w - t1, y: v.y, w: t1, h: v.h }) }
  if (t2 < v.h) { cands.push({ x: v.x, y: v.y, w: v.w, h: t2 }); cands.push({ x: v.x, y: v.y + v.h - t2, w: v.w, h: t2 }) }
  const circulation = others.filter((o) => o.zone === 'circulation' && !isVacant(o))
  let best: { rect: Rect; score: number } | null = null
  for (const rect of cands) {
    if (rectArea(rect) < need - 1000 || Math.min(rect.w, rect.h) < minW) continue
    const ratio = Math.max(rect.w, rect.h) / Math.min(rect.w, rect.h)
    const access = circulation.reduce((a, o) => a + touchLength(rect, o.rect), 0)
    const ext = exteriorLength(rect, plate)
    // a slice that takes the whole vacant region leaves no odd leftovers
    const leftover = rectArea(v) - rectArea(rect)
    if (wantAccess && access < 900) continue
    // no sliver is left behind: what remains of the vacant space is at least a hall's width in both directions
    if (subtract(v, rect).some((rest) => Math.min(rest.w, rest.h) < 900)) continue
    // what is left of the vacant space must still have a way in, or it would be sealed off
    const door = (o: LayoutRoom) => !isVacant(o) && (o.zone === 'circulation' || !['bed', 'bath', 'ensuite'].includes(o.kind))
    if (subtract(v, rect).some((rest) => !others.some((o) => door(o) && touchLength(rest, o.rect) >= 900))) continue
    if (c.windows === 'required' && ext < 1200) continue
    const score = (access >= 900 ? 3 : 0) + (ext >= 1200 ? 2 : 0) + (leftover === 0 ? 1.5 : 0) - Math.abs(rectArea(rect) / 1e6 - c.targetSqm) / Math.max(1, c.targetSqm) - (ratio > 2.2 ? 0.5 : 0)
    if (!best || score > best.score) best = { rect, score }
  }
  return best?.rect ?? null
}

export function bestVacantFor(layout: LayoutDoc, plan: Design, level: number, type: RoomType, areaSqm?: number): { vacant: LayoutRoom; rect: Rect } | null {
  const floor = floorOf(layout, level)
  if (!floor) return null
  const spec = TYPE_SPEC[type]
  let best: { vacant: LayoutRoom; rect: Rect; score: number } | null = null
  for (const v of floor.rooms.filter(isVacant)) {
    const rect = carve(v.rect, areaSqm ?? spec.targetSqm, constraintsOf(type), spec.zone, floor.rooms, plateFor(layout, plan, level)) ??
      (type === 'store' || type === 'puja' ? carve(v.rect, areaSqm ?? spec.targetSqm, constraintsOf(type), spec.zone, floor.rooms, plateFor(layout, plan, level), false) : null)
    if (!rect) continue
    const score = -rectArea(v.rect) / 1e8 + (sameRect(rect, v.rect) ? 2 : 0)
    if (!best || score > best.score) best = { vacant: v, rect, score }
  }
  return best
}

/** a free spot on the plot beside the house for an open-air space of this size, nearest to the house */
function outdoorSpot(layout: LayoutDoc, plan: Design, level: number, w: number, h: number): Rect | null {
  const floor = floorOf(layout, level)
  if (!floor) return null
  const env = envRect(plan)
  const plate = plateFor(layout, plan, level)
  const edges = [...plate, ...floor.rooms.map((r) => r.rect)]
  const xs = new Set<number>([env.x, env.x + env.w - w]), ys = new Set<number>([env.y, env.y + env.h - h])
  for (const r of edges) { xs.add(r.x - w); xs.add(r.x + r.w); xs.add(r.x); ys.add(r.y - h); ys.add(r.y + r.h); ys.add(r.y) }
  const house = plate.length ? { x: Math.min(...plate.map((p) => p.x)), y: Math.min(...plate.map((p) => p.y)), r: Math.max(...plate.map((p) => p.x + p.w)), b: Math.max(...plate.map((p) => p.y + p.h)) } : null
  let best: { rect: Rect; d: number } | null = null
  for (const x of xs) for (const y of ys) {
    const rect = { x, y, w, h }
    if (!contains(env, rect) || outdoorBlockers(layout, plan, level, null, rect).length) continue
    const d = house ? Math.hypot(Math.max(house.x - (x + w), 0, x - house.r), Math.max(house.y - (y + h), 0, y - house.b)) + (y < (house?.b ?? 0) ? 500 : 0) : 0
    if (!best || d < best.d) best = { rect, d }
  }
  return best?.rect ?? null
}

export function addRoom(layout: LayoutDoc, plan: Design, level: number, type: RoomType, vacantId?: string): OpResult {
  if (OUTDOOR_TYPES.includes(type)) {
    if (type === 'balcony' || type === 'courtyard') return fail('Balconies and courtyards belong to the shape of the house and cannot be added here.')
    const spot = outdoorSpot(layout, plan, level, type === 'parking' ? 5200 : 3400, type === 'parking' ? 5000 : 2600) ?? outdoorSpot(layout, plan, level, type === 'parking' ? 3000 : 2400, type === 'parking' ? 5000 : 2000)
    if (!spot) return fail(`There is no free space on the plot for a ${TYPE_SPEC[type].label.toLowerCase()}. Make another open-air space smaller first.`)
    const out = clone(layout)
    const idn = newIdentity(out, plan, level, type)
    const room: LayoutRoom = { id: idn.id, semanticId: idn.semanticId, name: type === 'parking' ? 'Covered parking' : 'Covered verandah', type, kind: TYPE_SPEC[type].kind, zone: 'outdoor', rect: spot, locked: false, fixed: false, outdoor: true, constraints: constraintsOf(type) }
    floorOf(out, level)!.rooms.push(room)
    return ok(out, `${room.name} added (${sqm(spot)} m²).`, [room.id])
  }
  if (!ADDABLE_TYPES.includes(type)) return fail('That kind of room cannot be added.')
  const out = clone(layout)
  const floor = floorOf(out, level)
  if (!floor) return fail('That floor is not in the plan.')
  const spec = TYPE_SPEC[type]
  const vacants = floor.rooms.filter(isVacant)
  if (!vacants.length) return fail(`There is no vacant space on ${where(plan, level)}. Delete or shrink a room first, then add the ${spec.label.toLowerCase()} into the space it frees.`)
  const choice = vacantId
    ? (() => { const v = vacants.find((x) => x.id === vacantId); const rect = v && (carve(v.rect, spec.targetSqm, constraintsOf(type), spec.zone, floor.rooms, plateFor(out, plan, level)) ?? carve(v.rect, spec.targetSqm, constraintsOf(type), spec.zone, floor.rooms, plateFor(out, plan, level), false)); return v && rect ? { vacant: v, rect } : null })()
    : bestVacantFor(out, plan, level, type)
  if (!choice) {
    const biggest = Math.max(...vacants.map((v) => sqm(v.rect)))
    return fail(`No vacant space can take a ${spec.label.toLowerCase()}: it needs a wall on the hall${spec.windows === 'required' ? ' and an outside wall for its window' : ''}, and the largest vacant space is ${biggest} m².`)
  }
  const idn = newIdentity(out, plan, level, type)
  const room: LayoutRoom = { id: idn.id, semanticId: idn.semanticId, name: idn.name, type, kind: spec.kind, zone: spec.zone, rect: choice.rect, locked: false, fixed: false, constraints: constraintsOf(type) }
  floor.rooms = [...floor.rooms.filter((x) => x.id !== choice.vacant.id), room]
  return ok(settle(out, plan, level), `${room.name} added (${area(room)} m²).`, [room.id])
}

/* --------------------------------- between floors ------------------------------- */

export function moveToFloor(layout: LayoutDoc, plan: Design, level: number, id: string, toLevel: number): OpResult {
  if (level === toLevel) return fail('The room is already on that floor.')
  const out = clone(layout)
  const from = floorOf(out, level), to = floorOf(out, toLevel)
  const r = from?.rooms.find((x) => x.id === id)
  if (!from || !to || !r) return fail('That floor or room is not in the plan.')
  const why = movable(r) ?? stayOnFloor(r)
  if (why) return fail(why)
  if (isVacant(r)) return fail('Vacant space stays on its floor.')
  if (from.rooms.some((x) => x.parent === id)) return fail(`${r.name} has an attached bath. Move or delete the bath first.`)
  if (r.parent) return fail(`${r.name} is the attached bath of another room and stays with it.`)
  if (!to.rooms.some(isVacant)) return fail(`There is no vacant space on ${where(plan, toLevel)}. Delete or shrink a room there first.`)
  const found = bestVacantFor(out, plan, toLevel, r.type as RoomType, Math.max(area(r), r.constraints.minSqm))
  if (!found) return fail(`No vacant space on ${where(plan, toLevel)} suits ${r.name}: it needs ${area(r)} m²${r.constraints.windows === 'required' ? ', an outside wall' : ''} and a wall on the hall.`)
  from.rooms = from.rooms.filter((x) => x !== r)
  const pf = prefixOf(plan, level), pt = prefixOf(plan, toLevel)
  const moved: LayoutRoom = { ...r, rect: found.rect, semanticId: r.semanticId.startsWith(`${pf}_`) ? `${pt}_${r.semanticId.slice(pf.length + 1)}` : `${pt}_${r.semanticId}` }
  to.rooms = [...to.rooms.filter((x) => x.id !== found.vacant.id), moved]
  const notes: Notice[] = []
  const rule = r.constraints.floor
  if (rule === 'ground' && toLevel !== 0) notes.push({ severity: 'warning', message: `${r.name} suits the ground floor best.`, roomId: id })
  return ok(settle(settle(out, plan, level), plan, toLevel), `${r.name} moved to ${where(plan, toLevel)}.`, [id], notes)
}

/** two rooms on different floors exchange floors: each takes the slot the other leaves, so every floor stays exactly tiled */
export function swapAcrossFloors(layout: LayoutDoc, plan: Design, levelA: number, aId: string, levelB: number, bId: string): OpResult {
  if (levelA === levelB) return swapRooms(layout, plan, levelA, aId, bId)
  const out = clone(layout)
  const fa = floorOf(out, levelA), fb = floorOf(out, levelB)
  const a = fa?.rooms.find((x) => x.id === aId), b = fb?.rooms.find((x) => x.id === bId)
  if (!fa || !fb || !a || !b) return fail('Both rooms must exist to swap them.')
  for (const r of [a, b]) {
    const why = movable(r) ?? stayOnFloor(r)
    if (why) return fail(why)
    if (isVacant(r)) return fail('Vacant space cannot be swapped. Move a room into it instead.')
    if (r.parent) return fail(`${r.name} is the attached bath of another room and stays with it.`)
    if ((r.id === a.id ? fa : fb).rooms.some((x) => x.parent === r.id)) return fail(`${r.name} has an attached bath. Move or delete the bath first.`)
  }
  const ra = a.rect, rb = b.rect
  const pa = prefixOf(plan, levelA), pb = prefixOf(plan, levelB)
  const rename = (sid: string, from: string, to: string) => (sid.startsWith(`${from}_`) ? `${to}_${sid.slice(from.length + 1)}` : `${to}_${sid}`)
  fa.rooms = fa.rooms.filter((x) => x !== a)
  fb.rooms = fb.rooms.filter((x) => x !== b)
  fa.rooms.push({ ...b, rect: ra, semanticId: rename(b.semanticId, pb, pa) })
  fb.rooms.push({ ...a, rect: rb, semanticId: rename(a.semanticId, pa, pb) })
  const notes: Notice[] = []
  for (const [r, lv] of [[a, levelB], [b, levelA]] as const) if (r.constraints.floor === 'ground' && lv !== 0) notes.push({ severity: 'warning', message: `${r.name} suits the ground floor best.`, roomId: r.id })
  return ok(settle(settle(out, plan, levelA), plan, levelB), `${a.name} and ${b.name} swapped floors: ${a.name} is now on ${where(plan, levelB)}, ${b.name} on ${where(plan, levelA)}.`, [aId, bId], notes)
}

/* -------------------------------- vacant optimizer ------------------------------- */

export type VacantOption =
  | { kind: 'expand'; roomId: string; roomName: string; gainSqm: number; resultSqm: number; withinMax: boolean }
  | { kind: 'add'; type: RoomType; label: string; areaSqm: number; reason: string }
  | { kind: 'open'; areaSqm: number }
  | { kind: 'keep' }

/** the part of vacant region `v` that room `n` can absorb and still be one rectangle: it must span the full side of `n` */
function growthInto(n: LayoutRoom, v: Rect): Rect | null {
  const nr = n.rect
  const BIG = 1e6
  const strips: Rect[] = [
    { x: rectRight(nr), y: nr.y, w: BIG, h: nr.h }, { x: nr.x - BIG, y: nr.y, w: BIG, h: nr.h },
    { x: nr.x, y: rectBottom(nr), w: nr.w, h: BIG }, { x: nr.x, y: nr.y - BIG, w: nr.w, h: BIG },
  ]
  let best: Rect | null = null
  for (const strip of strips) {
    const i = intersect(v, strip)
    if (!i || !joinIfRect(nr, i)) continue
    if (!best || rectArea(i) > rectArea(best)) best = i
  }
  return best
}

/** how much of the growth `g` a room takes: all of it, or only what keeps the room within its maximum size */
function expansionFor(n: LayoutRoom, g: Rect): Rect {
  const maxMm2 = n.constraints.maxSqm * 1e6
  if (rectArea(n.rect) + rectArea(g) <= maxMm2 * 1.02 || rectArea(n.rect) >= maxMm2) return g
  const wide = g.x === rectRight(n.rect) || rectRight(g) === n.rect.x
  const t = Math.max(MODULE, Math.floor(((maxMm2 - rectArea(n.rect)) / (wide ? g.h : g.w)) / MODULE) * MODULE)
  if (wide && t < g.w) return g.x === rectRight(n.rect) ? { ...g, w: t } : { ...g, x: rectRight(g) - t, w: t }
  if (!wide && t < g.h) return g.y === rectBottom(n.rect) ? { ...g, h: t } : { ...g, y: rectBottom(g) - t, h: t }
  return g
}

export function vacantOptions(layout: LayoutDoc, plan: Design, level: number, vacantId: string): VacantOption[] {
  const floor = floorOf(layout, level)
  const v = floor?.rooms.find((x) => x.id === vacantId)
  if (!floor || !v || !isVacant(v)) return []
  const options: VacantOption[] = []
  for (const n of floor.rooms) {
    if (n === v || isVacant(n) || n.fixed || n.outdoor || n.locked || n.type === 'open') continue
    const g = growthInto(n, v.rect)
    if (!g) continue
    // never grow beyond the room's maximum when a smaller share would do: take only what keeps it within range
    const part = expansionFor(n, g)
    if (sqm(part) < 1.5) continue
    const total = sqm(n.rect) + sqm(part)
    options.push({ kind: 'expand', roomId: n.id, roomName: n.name, gainSqm: sqm(part), resultSqm: Math.round(total * 10) / 10, withinMax: total <= n.constraints.maxSqm + 0.4 })
  }
  const original = new Set(plan.model.floors.flatMap((f) => f.spaces.map((s) => s.id)))
  const present = new Set(layout.floors.flatMap((f) => f.rooms.map((r) => r.id)))
  for (const type of ADDABLE_TYPES) {
    const spec = TYPE_SPEC[type]
    const rect = carve(v.rect, spec.targetSqm, constraintsOf(type), spec.zone, floor.rooms, plateFor(layout, plan, level)) ??
      (type === 'store' || type === 'puja' ? carve(v.rect, spec.targetSqm, constraintsOf(type), spec.zone, floor.rooms, plateFor(layout, plan, level), false) : null)
    if (!rect) continue
    const missing = [...original].some((id) => !present.has(id) && (id.startsWith(spec.idPrefix) || spec.singleId === id))
    options.push({ kind: 'add', type, label: spec.label, areaSqm: sqm(rect), reason: missing ? `The brief asked for a ${spec.label.toLowerCase()} and the plan no longer has one.` : spec.note })
  }
  if (sqm(v.rect) >= 4) options.push({ kind: 'open', areaSqm: sqm(v.rect) })
  options.push({ kind: 'keep' })
  return options
}

export function expandNeighbour(layout: LayoutDoc, plan: Design, level: number, vacantId: string, roomId: string): OpResult {
  const out = clone(layout)
  const floor = floorOf(out, level)
  const v = floor?.rooms.find((x) => x.id === vacantId), n = floor?.rooms.find((x) => x.id === roomId)
  if (!floor || !v || !n || !isVacant(v)) return fail('That space is not vacant any more.')
  const why = movable(n)
  if (why) return fail(why)
  const g = growthInto(n, v.rect)
  if (!g) return fail(`${n.name} cannot grow into that space and stay rectangular.`)
  const take = expansionFor(n, g)
  const union = joinIfRect(n.rect, take)
  if (!union) return fail(`${n.name} cannot grow into that space and stay rectangular.`)
  n.rect = union
  floor.rooms = floor.rooms.filter((x) => x !== v)
  return ok(settle(out, plan, level), `${n.name} expanded to ${area(n)} m².`, [roomId])
}

export function fillVacant(layout: LayoutDoc, plan: Design, level: number, vacantId: string, type: RoomType): OpResult {
  return addRoom(layout, plan, level, type, vacantId)
}

export function openSpace(layout: LayoutDoc, plan: Design, level: number, vacantId: string): OpResult {
  const out = clone(layout)
  const floor = floorOf(out, level)
  const v = floor?.rooms.find((x) => x.id === vacantId)
  if (!floor || !v || !isVacant(v)) return fail('That space is not vacant any more.')
  const idn = newIdentity(out, plan, level, 'open')
  Object.assign(v, { id: idn.id, semanticId: idn.semanticId, name: 'Open space', type: 'open', constraints: constraintsOf('open'), accepted: undefined })
  return ok(out, `Vacant space turned into open space (${area(v)} m²).`, [v.id])
}

export function keepVacant(layout: LayoutDoc, level: number, vacantId: string): OpResult {
  const out = clone(layout)
  const v = floorOf(out, level)?.rooms.find((x) => x.id === vacantId)
  if (!v || !isVacant(v)) return fail('That space is not vacant any more.')
  v.accepted = true
  return ok(out, 'Space kept vacant.', [vacantId])
}

/** the optimizer's own choice: put the whole space to use. A room beside it that is under its target grows into it, else a room the
 *  brief asked for comes back, else it becomes open space. A room type the person just deleted is never put straight back. */
export function autoOptimize(layout: LayoutDoc, plan: Design, level: number, vacantId: string, exclude: RoomType[] = []): OpResult {
  const floor = floorOf(layout, level)
  const v = floor?.rooms.find((x) => x.id === vacantId)
  if (!floor || !v) return fail('That space is not vacant any more.')
  const options = vacantOptions(layout, plan, level, vacantId).filter((o) => o.kind !== 'add' || !exclude.includes(o.type))
  const whole = (a: number) => (a >= sqm(v.rect) - 0.2 ? 0.3 : 0)
  const score = (o: VacantOption): number => {
    if (o.kind === 'expand') {
      const n = floor.rooms.find((x) => x.id === o.roomId)!
      const deficit = Math.max(0, n.constraints.targetSqm - sqm(n.rect)) / Math.max(1, n.constraints.targetSqm)
      return o.withinMax ? (whole(o.gainSqm) ? 0.6 : 0.1) + deficit * 0.8 : 0.05
    }
    if (o.kind === 'add') {
      const base = o.reason.startsWith('The brief asked') ? 1.2 : { study: 0.45, store: 0.35, puja: 0.3, washroom: 0.3 }[o.type as string] ?? 0.05
      return base + whole(o.areaSqm)
    }
    if (o.kind === 'open') return sqm(v.rect) >= 6 ? 0.5 : 0.2
    return 0.1
  }
  const ranked = [...options].sort((a, b) => score(b) - score(a))
  for (const o of ranked) {
    const res = o.kind === 'expand' ? expandNeighbour(layout, plan, level, vacantId, o.roomId)
      : o.kind === 'add' ? addRoom(layout, plan, level, o.type, vacantId)
        : o.kind === 'open' ? openSpace(layout, plan, level, vacantId) : keepVacant(layout, level, vacantId)
    if (res.ok) return { ...res, message: `Auto-optimize: ${res.message}` }
  }
  return fail('Nothing could use that space.')
}

/** adaptive replanning after an edit: only vacancies the edit created are touched, and only the rooms beside them */
export function replanNearby(before: LayoutDoc, after: LayoutDoc, plan: Design, levels: number[]): { layout: LayoutDoc; notes: string[] } {
  let layout = after
  const notes: string[] = []
  const gone = new Set(before.floors.flatMap((f) => f.rooms.filter((r) => !isVacant(r)).map((r) => r.id)))
  for (const f of after.floors) for (const r of f.rooms) gone.delete(r.id)
  const removedTypes = before.floors.flatMap((f) => f.rooms.filter((r) => gone.has(r.id) && r.type !== 'fixed').map((r) => r.type as RoomType))
  for (const level of levels) {
    const old = new Set(vacantRooms(before, level).map((v) => `${v.rect.x},${v.rect.y},${v.rect.w},${v.rect.h}`))
    for (const v of vacantRooms(layout, level)) {
      if (old.has(`${v.rect.x},${v.rect.y},${v.rect.w},${v.rect.h}`) || v.accepted) continue
      const res = autoOptimize(layout, plan, level, v.id, removedTypes)
      if (res.ok && commit(plan, res.layout).ok) { layout = res.layout; notes.push(res.message) }
    }
  }
  return { layout, notes }
}

/* --------------------------------- recheck & commit ------------------------------- */

export type Committed = { ok: true; design: Design; layout: LayoutDoc; notes: Notice[] } | { ok: false; reason: string; errors: Notice[] }

/** soft rules from the room types: floor preference and plumbing */
export function softNotes(layout: LayoutDoc, plan: Design, only?: string[]): Notice[] {
  const notes: Notice[] = []
  for (const f of layout.floors) for (const r of f.rooms) {
    if (r.type === 'fixed' || isVacant(r) || (only && !only.includes(r.id))) continue
    const c = r.constraints
    if (c.floor === 'ground' && f.level !== 0) notes.push({ severity: 'warning', message: `${r.name} is on ${where(plan, f.level)}; a ${r.type} suits the ground floor best.`, roomId: r.id })
    if (c.plumbing) {
      const others = layout.floors.flatMap((x) => x.rooms.filter((q) => q.constraints.plumbing && q.id !== r.id && (x.level === f.level ? touchLength(q.rect, r.rect) > 0 : overlapArea(q.rect, r.rect) > 0)))
      if (!others.length) notes.push({ severity: 'info', message: `${r.name} needs plumbing and has no wet room beside or below it, so it gets its own pipe run.`, roomId: r.id })
    }
  }
  for (const f of layout.floors) for (const v of f.rooms.filter((x) => isVacant(x) && !x.accepted))
    notes.push({ severity: 'info', message: `${levelName(plan, f.level)} has ${sqm(v.rect)} m² of vacant space. Choose how to use it.`, roomId: v.id })
  return notes
}

/** rebuild the whole plan from the layout and hold it to every deterministic rule */
export function commit(plan: Design, layout: LayoutDoc, before?: LayoutDoc, affected?: string[]): Committed {
  let design: Design
  try { design = applyLayout(plan, layout) } catch (error) {
    return { ok: false, reason: `The plan could not be rebuilt (${error instanceof Error ? error.message : 'unknown error'}).`, errors: [] }
  }
  const report = validate(design)
  const errors = report.findings.filter((f) => f.severity === 'error').map((f): Notice => ({ severity: 'error', message: f.message, roomId: f.roomId }))
  if (errors.length) return { ok: false, reason: errors.slice(0, 3).map((e) => e.message).join(' '), errors }
  // a locked room must be exactly where it was
  if (before) for (const f of before.floors) for (const r of f.rooms.filter((x) => x.locked)) {
    const now = layout.floors.find((x) => x.level === f.level)?.rooms.find((x) => x.id === r.id)
    if (!now || !sameRect(now.rect, r.rect)) return { ok: false, reason: `${r.name} is locked and cannot move.`, errors: [] }
  }
  return { ok: true, design, layout, notes: [...softNotes(layout, plan, affected), ...report.findings.filter((f) => f.severity === 'warning' && (!affected || (f.roomId && affected.includes(f.roomId)))).map((f): Notice => ({ severity: 'warning', message: f.message, roomId: f.roomId }))] }
}

/** a plan can be edited when rebuilding it from its own layout reproduces a valid plan (the standard families) */
export function isEditable(plan: Design): boolean {
  try {
    const layout = extractLayout(plan)
    const design = applyLayout(plan, layout)
    return validate(design).hardChecksPass && design.floors.every((f, i) => f.openings.length === plan.floors[i].openings.length)
  } catch { return false }
}

/* --------------------------- the outer walls of the villa -------------------------- */

export type OutlineLimits = Record<keyof Outline, { min: number; max: number }>

/** how far each outer wall can move: the plot's setback line, the longest beam a column line can carry, and a room that must stay standable */
export function outlineLimits(layout: LayoutDoc, plan: Design): OutlineLimits {
  const O = layout.outline ?? noOutline()
  const now = boxNow(plan, O)
  const env = { x: plan.model.setbacksMm.W, y: plan.model.setbacksMm.N, r: plan.model.setbacksMm.W + plan.model.envelope.width, b: plan.model.setbacksMm.N + plan.model.envelope.depth }
  const out: Partial<OutlineLimits> = {}
  for (const side of ['N', 'S', 'E', 'W'] as const) {
    const horizontal = side === 'N' || side === 'S'
    const line = side === 'N' ? now.y : side === 'S' ? now.y + now.h : side === 'W' ? now.x : now.x + now.w
    const room = side === 'N' ? now.y - env.y : side === 'S' ? env.b - (now.y + now.h) : side === 'W' ? now.x - env.x : env.r - (now.x + now.w)
    let thin = Infinity
    for (const f of layout.floors) for (const r of f.rooms) {
      const touches = horizontal ? (Math.abs((side === 'N' ? r.rect.y : r.rect.y + r.rect.h) - line) < 2) : (Math.abs((side === 'W' ? r.rect.x : r.rect.x + r.rect.w) - line) < 2)
      if (touches && !isVacant(r) && !r.outdoor) thin = Math.min(thin, horizontal ? r.rect.h : r.rect.w)
    }
    out[side] = {
      max: Math.max(0, Math.floor(room / MODULE) * MODULE),
      min: -Math.floor(Math.max(0, (Number.isFinite(thin) ? thin : 0) - MODULE) / MODULE) * MODULE,
    }
  }
  return out as OutlineLimits
}

/** move one outer wall of the whole villa. Every floor's edge on that wall moves with it; the rooms against it stretch or shrink, the columns on it go with it. */
export function resizeOutline(layout: LayoutDoc, plan: Design, side: keyof Outline, deltaMm: number): OpResult {
  if (plan.existingStructure) return fail('The villa is planned around a structure that is already built, so its outer walls cannot be moved.')
  const d = snapMm(deltaMm)
  if (!d) return fail('The wall did not move.')
  // when the whole step does not fit, the wall goes as far as it can
  const first = moveWall(layout, plan, side, d)
  if (first.ok) return first
  for (let t = Math.abs(d) - MODULE; t >= MODULE; t -= MODULE) {
    const res = moveWall(layout, plan, side, Math.sign(d) * t)
    if (res.ok) return res
  }
  return first
}

function moveWall(layout: LayoutDoc, plan: Design, side: keyof Outline, d: number): OpResult {
  const out = clone(layout)
  const O = out.outline ?? noOutline()
  const before = boxNow(plan, O)
  const line = side === 'N' ? before.y : side === 'S' ? before.y + before.h : side === 'W' ? before.x : before.x + before.w
  const horizontal = side === 'N' || side === 'S'
  const touched: string[] = []
  const shafts: { floor: FloorLayout; room: LayoutRoom }[] = []
  for (const f of out.floors) for (const r of f.rooms) {
    if (r.outdoor || isVacant(r)) continue
    const edge = horizontal ? (side === 'N' ? r.rect.y : r.rect.y + r.rect.h) : (side === 'W' ? r.rect.x : r.rect.x + r.rect.w)
    if (Math.abs(edge - line) >= 2) continue
    touched.push(r.id)
    // the stair and lift keep their size: a wall moving in slides them inward and they push the rooms behind them
    if (d < 0 && (r.kind === 'stair' || r.kind === 'lift')) { shafts.push({ floor: f, room: r }); continue }
    if (side === 'E') r.rect = { ...r.rect, w: r.rect.w + d }
    else if (side === 'W') r.rect = { ...r.rect, x: r.rect.x - d, w: r.rect.w + d }
    else if (side === 'S') r.rect = { ...r.rect, h: r.rect.h + d }
    else r.rect = { ...r.rect, y: r.rect.y - d, h: r.rect.h + d }
    if (r.rect.w < MODULE || r.rect.h < MODULE) return fail(`${r.name} would have no space left. Move the wall less.`)
  }
  if (!touched.length) return fail('No room touches that wall.')
  out.outline = { ...O, [side]: O[side] + d }
  const after = boxNow(plan, out.outline)
  const env = envRect(plan)
  if (!contains(env, after)) return fail('The villa would go past the setback line (the open margin the plot must keep), so it could not be built.')
  const inward: Side = side === 'N' ? 'S' : side === 'S' ? 'N' : side === 'E' ? 'W' : 'E'
  for (const { floor: f, room: r } of shafts) {
    r.rect = shift(r.rect, inward, -d)
    const res = pushAway(f.rooms, r.rect, inward, new Set([r]), 0, plateFor(out, plan, f.level), minSizer(plan))
    if (typeof res === 'string') return fail(res)
    touched.push(...res)
  }
  // open-air spaces keep their place against the house: one that touched the moved wall goes with it, and one the wall would run into is pushed out of the way
  const alongWall = (r: Rect) => (horizontal ? Math.min(r.x + r.w, before.x + before.w) - Math.max(r.x, before.x) > 0 : Math.min(r.y + r.h, before.y + before.h) - Math.max(r.y, before.y) > 0)
  for (const f of out.floors) {
    const plate = plateFor(out, plan, f.level)
    for (const r of f.rooms) {
      if (!r.outdoor) continue
      const rect = { ...r.rect }
      const attached = alongWall(rect) && (side === 'E' ? Math.abs(rect.x - line) < 2 : side === 'W' ? Math.abs(rect.x + rect.w - line) < 2 : side === 'S' ? Math.abs(rect.y - line) < 2 : Math.abs(rect.y + rect.h - line) < 2)
      if (attached) { if (horizontal) rect.y += side === 'S' ? d : -d; else rect.x += side === 'E' ? d : -d }
      else if (d > 0 && plate.some((p) => overlapArea(p, rect) > 10_000)) {
        if (side === 'E') rect.x = line + d
        else if (side === 'W') rect.x = line - d - rect.w
        else if (side === 'S') rect.y = line + d
        else rect.y = line - d - rect.h
        touched.push(r.id)
      }
      r.rect = rect
    }
  }
  const names = { N: 'north', S: 'south', E: 'east', W: 'west' }
  const levels = [...new Set(out.floors.map((f) => f.level))]
  let next = out
  for (const level of levels) next = settle(next, plan, level)
  return (ok(next, `The ${names[side]} wall moved ${d > 0 ? 'out' : 'in'} ${m(Math.abs(d))} m.`, touched))
}

/* ----------------------- site features: driveway, yards, pool, sit-out ----------------------- */

export const EDITABLE_FEATURES: SiteFeature['kind'][] = ['driveway', 'utilityYard', 'pool', 'sitOut', 'path']

/** put a site feature where the person wants it; it keeps that place while it stays clear of the house and the other features */
export function setFeature(layout: LayoutDoc, plan: Design, kind: SiteFeature['kind'], rect: Rect): OpResult {
  if (!EDITABLE_FEATURES.includes(kind)) return fail('That part of the site follows the house automatically.')
  const r = { x: snapMm(rect.x), y: snapMm(rect.y), w: snapMm(rect.w), h: snapMm(rect.h) }
  if (Math.min(r.w, r.h) < 900) return fail('A site feature needs at least 0.9 m in each direction.')
  if (r.x < 0 || r.y < 0 || r.x + r.w > plan.model.plot.width || r.y + r.h > plan.model.plot.depth) return fail('That would take it outside the plot.')
  const out = clone(layout)
  out.features = { ...out.features, [kind]: r }
  return ok(out, `${kind === 'utilityYard' ? 'Utility yard' : kind === 'sitOut' ? 'Sit-out' : kind[0].toUpperCase() + kind.slice(1)} set to ${m(r.w)} × ${m(r.h)} m.`, [])
}

/** hand a site feature back to the automatic layout */
export function resetFeature(layout: LayoutDoc, kind: SiteFeature['kind']): OpResult {
  if (!layout.features?.[kind]) return fail('That feature is already automatic.')
  const out = clone(layout)
  const rest = { ...out.features }
  delete rest[kind]
  out.features = rest
  return ok(out, 'Back to the automatic layout.', [])
}
