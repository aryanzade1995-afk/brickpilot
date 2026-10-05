import { rectArea, rectBottom, rectRight, rectUnionEdges, type Rect } from '../geometry.ts'
import type { Design } from '../engine/types.ts'
import { validate } from '../rules/index.ts'
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
  return Math.min(rect.w, rect.h) < 900 ? `${r.name} would be only ${m(Math.min(rect.w, rect.h))} m wide. A room needs at least 0.9 m to stand in.` : null
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
  if (!r.outdoor && !insidePlate(plateFor(out, plan, level), next)) return fail(`${r.name} would leave the floor plate.`)
  if (r.outdoor) {
    if (Math.min(next.w, next.h) < 900) return fail(`${r.name} would be too narrow to use.`)
    if (!contains(envRect(plan), next)) return fail(`${r.name} would leave the area the plot allows to be built on (inside the setbacks).`)
    const hit = outdoorBlockers(out, plan, level, r, next)
    if (hit.length) return fail(`${r.name} would overlap ${hit.join(' and ')}.`)
    r.rect = next
    return ok(out, `${r.name} resized to ${m(next.w)} × ${m(next.h)} m.`, [id])
  }
  const tooSmall = sizeProblem(r, next)
  if (tooSmall) return fail(tooSmall)
  const vacants = floor.rooms.filter(isVacant)
  const affected = [id]
  for (const g of subtract(next, r.rect)) {
    let uncovered = [g]
    for (const v of vacants) uncovered = uncovered.flatMap((u) => subtract(u, v.rect))
    for (const u of uncovered) {
      const donor = floor.rooms.find((x) => x !== r && !isVacant(x) && !x.outdoor && overlapArea(x.rect, u) > 0)
      if (!donor) continue
      if (overlapArea(donor.rect, u) < rectArea(u) - 1000 || !contains(donor.rect, u))
        return fail(`${r.name} would reach into more than one room. Resize it so it only takes space from vacant areas or from one neighbour.`)
      const dwhy = movable(donor)
      if (dwhy) return fail(`${r.name} would take space from ${donor.name}. ${dwhy}`)
      const rest = subtract(donor.rect, u)
      if (rest.length !== 1) return fail(`${donor.name} cannot give up that corner and stay rectangular. Take the full width of its side instead.`)
      const dp = sizeProblem(donor, rest[0])
      if (dp) return fail(`${dp} (it would give up space to ${r.name}).`)
      donor.rect = rest[0]
      affected.push(donor.id)
    }
  }
  r.rect = next
  return ok(settle(out, plan, level), `${r.name} resized to ${m(next.w)} × ${m(next.h)} m.`, affected)
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
    // the beams that run away from this wall carry the new span
    let span = 0
    for (const f of plan.floors) for (const b of f.beams ?? []) {
      const ends = [b.a, b.b]
      const onLine = (p: { x: number; y: number }) => Math.abs((horizontal ? p.y : p.x) - (horizontal ? (side === 'N' ? baseBox(plan).y : baseBox(plan).y + baseBox(plan).h) : (side === 'W' ? baseBox(plan).x : baseBox(plan).x + baseBox(plan).w))) < 2
      const perpendicular = horizontal ? Math.abs(b.a.x - b.b.x) < 2 : Math.abs(b.a.y - b.b.y) < 2
      if (perpendicular && ends.some(onLine)) span = Math.max(span, b.span)
    }
    const current = O[side]
    const beamRoom = span ? 6000 - (span + current) : Infinity
    out[side] = {
      max: Math.max(0, Math.floor(Math.min(room, beamRoom) / MODULE) * MODULE),
      min: -Math.floor(Math.max(0, (Number.isFinite(thin) ? thin : 0) - 900) / MODULE) * MODULE,
    }
  }
  return out as OutlineLimits
}

/** move one outer wall of the whole villa. Every floor's edge on that wall moves with it; the rooms against it stretch or shrink, the columns on it go with it. */
export function resizeOutline(layout: LayoutDoc, plan: Design, side: keyof Outline, deltaMm: number): OpResult {
  if (plan.existingStructure) return fail('The villa is planned around a structure that is already built, so its outer walls cannot be moved.')
  const d = snapMm(deltaMm)
  if (!d) return fail('The wall did not move.')
  const out = clone(layout)
  const O = out.outline ?? noOutline()
  const before = boxNow(plan, O)
  const line = side === 'N' ? before.y : side === 'S' ? before.y + before.h : side === 'W' ? before.x : before.x + before.w
  const horizontal = side === 'N' || side === 'S'
  const touched: string[] = []
  for (const f of out.floors) for (const r of f.rooms) {
    if (r.outdoor) continue
    const edge = horizontal ? (side === 'N' ? r.rect.y : r.rect.y + r.rect.h) : (side === 'W' ? r.rect.x : r.rect.x + r.rect.w)
    if (Math.abs(edge - line) >= 2) continue
    touched.push(r.id)
    if (side === 'E') r.rect = { ...r.rect, w: r.rect.w + d }
    else if (side === 'W') r.rect = { ...r.rect, x: r.rect.x - d, w: r.rect.w + d }
    else if (side === 'S') r.rect = { ...r.rect, h: r.rect.h + d }
    else r.rect = { ...r.rect, y: r.rect.y - d, h: r.rect.h + d }
    if (r.rect.w < 900 || r.rect.h < 900) return fail(`${r.name} would be too narrow to stand in. Move the wall less.`)
  }
  if (!touched.length) return fail('No room touches that wall.')
  out.outline = { ...O, [side]: O[side] + d }
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
  return ok(next, `The ${names[side]} wall moved ${d > 0 ? 'out' : 'in'} ${m(Math.abs(d))} m.`, touched)
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
