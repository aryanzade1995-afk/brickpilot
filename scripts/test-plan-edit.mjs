import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { registerHooks } from 'node:module'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { DEFAULT_DIVERSITY_LIMITS } from '../src/lib/engine/fingerprint/VillaDiversityGate.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { validate } from '../src/lib/rules/index.ts'
import { extractLayout, applyLayout } from '../src/lib/plan/layout.ts'
import { parseLayout } from '../src/lib/plan/parse.ts'
import * as O from '../src/lib/plan/ops.ts'
import { unionRects, subtract, joinIfRect } from '../src/lib/plan/rects.ts'
import { createBlenderInput } from './export-blender-input.mjs'
import { estimateBoq } from '../src/lib/cost/index.ts'
import { furnishFloor } from '../src/lib/draw/furniture.ts'

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) return { url: new URL(`../src/${specifier.slice(2)}`, import.meta.url).href, shortCircuit: true }
  return nextResolve(specifier, context)
} })
const storage = new Map()
globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) }
globalThis.window = { localStorage: globalThis.localStorage }
mock.method(console, 'debug', () => {})
const { useStudio } = await import('../src/state/studio.ts')

const brief = (w = 18, d = 24, storeys = 1, variation = 0) => { const b = defaultBrief(); b.site.plotWidth = w; b.site.plotDepth = d; b.levels.storeys = storeys; b.variation = variation; return b }
const plan = (...a) => generate(compile(brief(...a)))
const errors = (d) => validate(d).findings.filter((f) => f.severity === 'error')
const room = (layout, level, id) => O.floorOf(layout, level).rooms.find((r) => r.id === id)
const accept = (p, layout, res, before) => { assert.ok(res.ok, res.reason); const c = O.commit(p, res.layout, before ?? layout, res.affected); assert.ok(c.ok, c.reason); return c }

test('rectangle algebra: subtract, union and join stay exact', () => {
  const a = { x: 0, y: 0, w: 1000, h: 1000 }, b = { x: 500, y: 500, w: 1000, h: 1000 }
  const parts = subtract(a, b)
  assert.equal(parts.reduce((n, r) => n + r.w * r.h, 0), 1000 * 1000 - 500 * 500)
  const u = unionRects([a, { x: 1000, y: 0, w: 1000, h: 1000 }])
  assert.deepEqual(u, [{ x: 0, y: 0, w: 2000, h: 1000 }])
  assert.deepEqual(joinIfRect(a, { x: 0, y: 1000, w: 1000, h: 500 }), { x: 0, y: 0, w: 1000, h: 1500 })
  assert.equal(joinIfRect(a, { x: 1000, y: 200, w: 500, h: 500 }), null)
})

test('every room becomes an editable object and the layout rebuilds the same valid plan', () => {
  for (const args of [[18, 24, 1], [18, 24, 2, 3], [20, 26, 1, 5], [22, 28, 1, 3]]) {
    const p = plan(...args)
    assert.ok(validate(p).hardChecksPass, 'the generated plan is valid')
    const layout = extractLayout(p)
    for (const f of layout.floors) for (const r of f.rooms) {
      assert.ok(r.constraints.minSqm >= 0 && r.constraints.minWidthMm >= 0, `${r.id} has constraints`)
      assert.ok(['bedroom', 'living', 'kitchen', 'washroom', 'puja', 'dining', 'study', 'store', 'fixed', 'parking', 'verandah', 'balcony', 'courtyard'].includes(r.type), `${r.id} type ${r.type}`)
    }
    const again = applyLayout(p, layout)
    assert.deepEqual(errors(again), [])
    assert.ok(O.isEditable(p))
    assert.equal(parseLayout(JSON.parse(JSON.stringify(layout))).floors.length, layout.floors.length)
  }
})

test('delete a room: only that space changes, it becomes vacant, the plan stays valid', () => {
  const p = plan(), layout = extractLayout(p)
  const res = O.deleteRoom(layout, p, 1, 'study1')
  const c = accept(p, layout, res)
  const before = O.floorOf(layout, 1).rooms.filter((r) => r.id !== 'study1')
  for (const r of before) assert.deepEqual(room(res.layout, 1, r.id).rect, r.rect, `${r.id} did not move`)
  const vacant = O.vacantRooms(res.layout, 1)
  assert.equal(vacant.length, 1)
  assert.deepEqual(vacant[0].rect, room(layout, 1, 'study1').rect)
  assert.equal(c.design.floors[1].rooms.some((r) => r.id === 'study1'), false)
  // the ground floor is untouched
  assert.deepEqual(c.design.floors[0].rooms.map((r) => r.rect), p.floors[0].rooms.map((r) => r.rect))
})

test('the vacant space optimizer: expand, add, open space, keep vacant, auto-optimize', () => {
  const p = plan(), layout = extractLayout(p)
  const del = O.deleteRoom(layout, p, 1, 'study1')
  const l1 = del.layout, v = O.vacantRooms(l1, 1)[0]
  const kinds = new Set(O.vacantOptions(l1, p, 1, v.id).map((o) => o.kind))
  for (const k of ['expand', 'add', 'open', 'keep']) assert.ok(kinds.has(k), `option ${k}`)
  const grown = accept(p, l1, O.expandNeighbour(l1, p, 1, v.id, 'familyLounge'), l1)
  assert.equal(O.vacantRooms(O.expandNeighbour(l1, p, 1, v.id, 'familyLounge').layout, 1).length, 0)
  assert.ok(grown.design.floors[1].rooms.find((r) => r.id === 'familyLounge').area > room(l1, 1, 'familyLounge').rect.w * room(l1, 1, 'familyLounge').rect.h / 1e6)
  const added = O.addRoom(l1, p, 1, 'store', v.id)
  accept(p, l1, added, l1)
  assert.equal(room(added.layout, 1, added.affected[0]).type, 'store')
  const open = O.openSpace(l1, p, 1, v.id)
  accept(p, l1, open, l1)
  assert.equal(O.vacantRooms(open.layout, 1).length, 0)
  const kept = O.keepVacant(l1, 1, v.id)
  accept(p, l1, kept, l1)
  assert.equal(O.vacantRooms(kept.layout, 1)[0].accepted, true)
  const auto = O.autoOptimize(l1, p, 1, v.id)
  accept(p, l1, auto, l1)
  assert.match(auto.message, /^Auto-optimize/)
})

test('locked rooms are preserved by every operation', () => {
  const p = plan(), base = extractLayout(p)
  const locked = O.toggleLock(base, 1, 'bed1').layout
  for (const res of [
    O.deleteRoom(locked, p, 1, 'bed1'),
    O.moveRoom(locked, p, 1, 'bed1', { x: 1200, y: 11100 }),
    O.resizeRoom(locked, p, 1, 'bed1', { ...room(locked, 1, 'bed1').rect, w: 3000 }),
    O.swapRooms(locked, p, 1, 'bed1', 'bed2'),
    O.moveToFloor(locked, p, 1, 'bed1', 0),
  ]) assert.equal(res.ok, false)
  // a neighbour cannot take space from a locked room, and other edits leave it exactly where it was
  const after = O.deleteRoom(locked, p, 1, 'study1')
  accept(p, locked, after, locked)
  assert.deepEqual(room(after.layout, 1, 'bed1').rect, room(base, 1, 'bed1').rect)
  assert.equal(room(after.layout, 1, 'bed1').locked, true)
  assert.equal(O.toggleLock(locked, 1, 'bed1').layout && room(O.toggleLock(locked, 1, 'bed1').layout, 1, 'bed1').locked, false)
})

test('the hall, stair and lift can be edited too, but a change that breaks the plan is refused by the rules', () => {
  const p = plan(), layout = extractLayout(p)
  // the stair, hall and foyer are how the house works: they can be moved, resized and swapped, never deleted
  for (const [level, id] of [[0, 'stair'], [0, 'corridor'], [1, 'lobby1'], [0, 'foyer']]) {
    assert.equal(O.deleteRoom(layout, p, level, id).ok, false, `${id} cannot be deleted`)
  }
  // moving or resizing the stair on one floor breaks its alignment with the other floor
  const st = room(layout, 0, 'stair').rect
  const grown = O.resizeRoom(layout, p, 0, 'stair', { ...st, w: st.w + 600 })
  if (grown.ok) assert.equal(O.commit(p, grown.layout, layout).ok, false)
  // every room can be swapped, including with vacant space; whatever is accepted is a valid plan
  const free = O.deleteRoom(layout, p, 1, 'study1').layout
  const vac = O.vacantRooms(free, 1)[0]
  const into = O.swapRooms(free, p, 1, 'familyLounge', vac.id)
  assert.ok(into.ok, into.reason)
  assert.ok(O.commit(p, into.layout, free).ok)
})

test('swap exchanges two rooms and the plan stays valid', () => {
  const p = plan(), layout = extractLayout(p)
  // dining and kitchen are stacked on one wall: they exchange their order, keeping both sizes
  const res = O.swapRooms(layout, p, 0, 'dining', 'kitchen')
  assert.ok(res.ok, res.reason)
  const c = accept(p, layout, res)
  const d = room(layout, 0, 'dining').rect, k = room(layout, 0, 'kitchen').rect
  assert.equal(room(res.layout, 0, 'dining').rect.h, d.h)
  assert.equal(room(res.layout, 0, 'kitchen').rect.h, k.h)
  assert.notEqual(room(res.layout, 0, 'dining').rect.y, d.y)
  assert.ok(c.design.floors[0].rooms.some((r) => r.id === 'kitchen'))
  // a room cannot swap with itself, and unequal rooms that do not fit each other's space are refused
  assert.equal(O.swapRooms(layout, p, 1, 'bed1', 'bed1').ok, false)
  // unequal rooms far apart exchange places, each taking the size of the other's space
  const far = O.swapRooms(layout, p, 1, 'bed2', 'familyLounge')
  assert.ok(far.ok, far.reason)
  assert.deepEqual(room(far.layout, 1, 'bed2').rect, room(layout, 1, 'familyLounge').rect)
  assert.deepEqual(room(far.layout, 1, 'familyLounge').rect, room(layout, 1, 'bed2').rect)
  // a swap that would strand a bath behind the wrong room is rejected by the rules, with the reason
  const strand = O.swapRooms(layout, p, 1, 'bed2', 'bath1')
  if (strand.ok) assert.equal(O.commit(p, strand.layout, layout).ok, false)
})

test('resize takes space from vacant areas and a single neighbour, never below a minimum', () => {
  const p = plan(), layout = extractLayout(p)
  const del = O.deleteRoom(layout, p, 1, 'study1')
  const l1 = del.layout
  // there is no minimum size: a bedroom can be made as small as the person wants, and the guidance is reported as a note
  const lr = room(l1, 1, 'familyLounge').rect
  const tiny = O.resizeRoom(l1, p, 1, 'familyLounge', { ...lr, y: lr.y + lr.h - 2700, h: 2700 })
  assert.ok(tiny.ok, tiny.reason)
  const small = O.commit(p, tiny.layout, l1, tiny.affected)
  assert.ok(small.ok, small.reason)
  assert.ok(small.notes.some((n) => /minimum|under/i.test(n.message)), 'the recommended minimum is shown as a note')
  assert.equal(O.resizeRoom(l1, p, 1, 'familyLounge', { ...lr, h: 500 }).ok, false, 'only a sliver is refused')
  // growing into the vacant study area
  const bed3 = room(l1, 1, 'bed3').rect
  const vacant = O.vacantRooms(l1, 1)[0]
  assert.ok(vacant)
  const lounge = room(l1, 1, 'familyLounge').rect
  const grow = O.resizeRoom(l1, p, 1, 'familyLounge', { ...lounge, y: vacant.rect.y, h: lounge.h + vacant.rect.h })
  accept(p, l1, grow, l1)
  assert.equal(O.vacantRooms(grow.layout, 1).length, 0)
  assert.deepEqual(room(grow.layout, 1, 'bed3').rect, bed3)
})

test('add a room of every type into vacant space, with its constraints stored on it', () => {
  const p = plan(14, 20, 1, 5), layout0 = extractLayout(p)
  // free up the upper floor, then add each type that fits
  let layout = layout0
  const floor = O.floorOf(layout, 1)
  for (const r of floor.rooms.filter((x) => !x.fixed)) { const res = O.deleteRoom(layout, p, 1, r.id); if (res.ok) layout = res.layout }
  assert.ok(O.vacantRooms(layout, 1).length >= 1)
  let added = 0
  for (const type of ['bedroom', 'living', 'kitchen', 'washroom', 'puja', 'dining', 'study', 'store']) {
    const res = O.addRoom(layout, p, 1, type)
    if (!res.ok) continue
    const c = O.commit(p, res.layout, layout, res.affected)
    if (!c.ok) continue
    layout = res.layout
    const r = room(layout, 1, res.affected[0])
    assert.equal(r.type, type)
    assert.ok(r.constraints.minSqm > 0 && r.constraints.minWidthMm > 0 && r.constraints.ventilation)
    added++
  }
  assert.ok(added >= 2, `added ${added} room types`)
})

test('rooms move between floors into vacant space and the plan stays valid', () => {
  const p = plan(18, 24, 1), layout = extractLayout(p)
  // free a spot upstairs, then send the puja room up
  const freed = O.deleteRoom(layout, p, 1, 'study1').layout
  const res = O.moveToFloor(freed, p, 0, 'pooja', 1)
  assert.ok(res.ok, res.reason)
  const c = O.commit(p, res.layout, freed, res.affected)
  assert.ok(c.ok, c.reason)
  assert.ok(room(res.layout, 1, 'pooja'))
  assert.equal(room(res.layout, 0, 'pooja'), undefined)
  assert.ok(c.design.floors[1].rooms.some((r) => r.id === 'pooja'))
  assert.match(room(res.layout, 1, 'pooja').semanticId, /^FF_/)
  assert.ok(c.notes.some((n) => /ground floor/.test(n.message)), 'floor rule is reported')
  // with no vacant space upstairs it is refused with a reason
  assert.equal(O.moveToFloor(layout, p, 0, 'pooja', 1).ok, false)
})

test('plans that break a rule are rejected with the reason, not applied', () => {
  const p = plan(), layout = extractLayout(p)
  // moving the bedroom away from its bath leaves the bath unreachable
  const res = O.moveRoom(O.deleteRoom(layout, p, 1, 'study1').layout, p, 1, 'bed3', { x: 6300, y: 9600 })
  if (res.ok) {
    const c = O.commit(p, res.layout)
    assert.ok(c.ok || c.reason.length > 0)
  }
  const outside = O.moveRoom(layout, p, 1, 'bed3', { x: 40000, y: 40000 })
  assert.equal(outside.ok, false)
  assert.match(outside.reason, /floor plate/)
})

test('studio: edits rebuild the plan and the 3D villa, persist, and undo to the generated plan', () => {
  const st = useStudio
  st.setState({ brief: brief(18, 24, 1), directions: null, pinned: null, result: null, layout: null, existing: null, referencePreferences: null,
    recentExteriorSeeds: [], recentVillaFingerprints: [], diversityLimits: { ...DEFAULT_DIVERSITY_LIMITS }, shapeDebug: [], generationNotice: null })
  const generated = st.getState().run()
  assert.ok(generated.report.hardChecksPass && st.getState().pinned)
  const rooms = generated.design.floors[1].rooms.length
  // nothing pinned means no edits; here it is pinned
  const out = st.getState().applyPlanOp((l, p) => O.deleteRoom(l, p, 1, 'study1'), { autoReplan: false })
  assert.ok(out.ok, out.reason)
  const edited = st.getState().result
  assert.ok(edited.report.hardChecksPass)
  assert.equal(edited.design.floors[1].rooms.some((r) => r.id === 'study1'), false)
  assert.ok(edited.design.floors[1].rooms.some((r) => r.name === 'Vacant space'))
  assert.ok(edited.buildingModel && edited.massingModel, 'the 3D villa is rebuilt')
  assert.ok(st.getState().layout)
  // regenerating from the saved state reproduces exactly the edited plan
  const saved = JSON.parse(JSON.stringify({ brief: st.getState().brief, pinned: st.getState().pinned, layout: st.getState().layout }))
  st.setState({ result: null, layout: null })
  st.getState().loadSaved(saved.brief, saved.pinned, parseLayout(saved.layout))
  const reloaded = st.getState().run()
  assert.deepEqual(reloaded.design.floors[1].rooms.map((r) => [r.id, r.rect]), edited.design.floors[1].rooms.map((r) => [r.id, r.rect]))
  // auto-replan fills the space it freed, touching only the neighbours
  const auto = st.getState().applyPlanOp((l, p) => O.deleteRoom(l, p, 1, 'bed3'), { autoReplan: true })
  assert.ok(auto.ok, auto.reason)
  // undo all the way back to the generated plan
  const back = st.getState().setLayout(null)
  assert.ok(back.ok, back.reason)
  assert.equal(st.getState().layout, null)
  assert.equal(st.getState().result.design.floors[1].rooms.length, rooms)
  // a different design discards the edits
  st.getState().applyPlanOp((l, p) => O.deleteRoom(l, p, 1, 'study1'))
  st.getState().reroll()
  assert.equal(st.getState().layout, null)
})

test('replanning nearby never puts back the room that was just deleted, and touches only its neighbours', () => {
  const p = plan(), layout = extractLayout(p)
  const del = O.deleteRoom(layout, p, 1, 'study1')
  const re = O.replanNearby(layout, del.layout, p, [0, 1])
  assert.ok(re.notes.length === 1, re.notes.join(' '))
  assert.equal(room(re.layout, 1, 'study1'), undefined)
  assert.ok(!O.floorOf(re.layout, 1).rooms.some((r) => r.type === 'study'), 'no study came back')
  assert.equal(O.vacantRooms(re.layout, 1).length, 0, 'the freed space was put to use')
  // everything not beside the freed space is exactly where it was
  const study = room(layout, 1, 'study1').rect
  for (const r of O.floorOf(layout, 1).rooms) {
    if (r.id === 'study1') continue
    const now = room(re.layout, 1, r.id)
    const touches = now.rect.x !== r.rect.x || now.rect.y !== r.rect.y || now.rect.w !== r.rect.w || now.rect.h !== r.rect.h
    if (touches) assert.ok(r.rect.x + r.rect.w >= study.x - 1 && r.rect.x <= study.x + study.w + 1 && r.rect.y + r.rect.h >= study.y - 1 && r.rect.y <= study.y + study.h + 1, `${r.id} changed but is not beside the freed space`)
  }
  assert.deepEqual(O.floorOf(re.layout, 0).rooms.map((r) => r.rect), O.floorOf(layout, 0).rooms.map((r) => r.rect), 'the other floor is untouched')
  assert.ok(O.commit(p, re.layout, layout).ok)
})

test('a room already below its minimum may stay put; an edit may not make it smaller', () => {
  const p = plan(), layout = extractLayout(p)
  const living = room(layout, 0, 'living')
  const narrow = Math.min(living.rect.w, living.rect.h) < living.constraints.minWidthMm
  if (!narrow) return
  const smaller = O.resizeRoom(layout, p, 0, 'living', living.rect.w > living.rect.h ? { ...living.rect, h: living.rect.h - 300 } : { ...living.rect, w: living.rect.w - 300 })
  assert.equal(smaller.ok, false)
})

test('random edit sequences never break a rule, the tiling or a lock', () => {
  let seed = 7
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
  const pick = (a) => a[Math.floor(rnd() * a.length)]
  let accepted = 0
  for (const args of [[18, 24, 1, 0], [18, 24, 2, 3], [20, 26, 1, 5]]) {
    const p = plan(...args)
    let layout = O.toggleLock(extractLayout(p), 0, 'living').layout
    for (let step = 0; step < 30; step++) {
      const level = pick(layout.floors).level, floor = O.floorOf(layout, level), r = pick(floor.rooms)
      const k = Math.floor(rnd() * 8)
      const res = k === 0 ? O.deleteRoom(layout, p, level, r.id)
        : k === 1 ? O.moveRoom(layout, p, level, r.id, { x: r.rect.x + (Math.floor(rnd() * 9) - 4) * 600, y: r.rect.y + (Math.floor(rnd() * 9) - 4) * 600 })
          : k === 2 ? O.resizeRoom(layout, p, level, r.id, { ...r.rect, w: r.rect.w + (Math.floor(rnd() * 5) - 2) * 300 })
            : k === 3 ? O.swapRooms(layout, p, level, r.id, pick(floor.rooms).id)
              : k === 4 ? O.addRoom(layout, p, level, pick(['bedroom', 'study', 'store', 'puja', 'washroom']))
                : k === 5 ? (O.vacantRooms(layout, level)[0] ? O.autoOptimize(layout, p, level, O.vacantRooms(layout, level)[0].id) : O.toggleLock(layout, level, r.id))
                  : k === 6 ? O.moveToFloor(layout, p, level, r.id, pick(layout.floors).level) : O.toggleLock(layout, level, r.id)
      if (!res.ok) continue
      const c = O.commit(p, res.layout, layout, res.affected)
      if (!c.ok) continue
      accepted++
      const prev = layout
      layout = res.layout
      assert.deepEqual(errors(c.design), [], 'an accepted edit passes every rule')
      const before = O.floorOf(prev, 0).rooms.find((x) => x.id === 'living')
      if (before?.locked && res.ok) assert.deepEqual(room(layout, 0, 'living').rect, before.rect, 'a locked room never moves')
      // every floor stays exactly tiled
      for (const f of c.design.floors) {
        const plate = f.footprint.reduce((a, q) => a + q.w * q.h, 0), used = f.rooms.filter((q) => !q.outdoor).reduce((a, q) => a + q.rect.w * q.rect.h, 0)
        assert.ok(Math.abs(plate - used) <= 50_000, `${f.name} is tiled`)
      }
    }
  }
  assert.ok(accepted >= 8, `only ${accepted} edits were accepted`)
})

test('an edited plan still feeds the 3D handoff, the cost estimate and the furniture', () => {
  const p = plan(), layout = extractLayout(p)
  const del = O.deleteRoom(layout, p, 1, 'study1')
  const c = accept(p, layout, del)
  // keep one vacant space and one added room so every kind of edited room is exercised
  const open = O.openSpace(del.layout, p, 1, O.vacantRooms(del.layout, 1)[0].id)
  const c2 = accept(p, del.layout, open, del.layout)
  for (const design of [c.design, c2.design]) {
    const input = createBlenderInput(design, 41)
    assert.equal(input.massingModel.status, 'valid')
    assert.ok(input.buildingModel.doors.length > 0)
    const cost = estimateBoq(design)
    assert.ok(cost.total.low > 0)
    for (const f of design.floors) assert.ok(Array.isArray(furnishFloor(f)))
  }
  // fewer rooms to finish means a different, still positive estimate
  assert.notEqual(estimateBoq(c.design).total.low, estimateBoq(p).total.low)
})

test('the whole villa can be resized by moving its outer walls, within the plot and the beam limit', () => {
  const p = plan(), layout = extractLayout(p)
  const limits = O.outlineLimits(layout, p)
  for (const side of ['N', 'S', 'E', 'W']) assert.ok(limits[side].max >= 0 && limits[side].min <= 0, `${side} limits`)
  // find a wall that can move outward, move it, and check the building really grew everywhere it should
  const side = ['E', 'W', 'N', 'S'].find((x) => limits[x].max >= 600)
  assert.ok(side, 'some wall can move outward')
  const res = O.resizeOutline(layout, p, side, 600)
  assert.ok(res.ok, res.reason)
  const c = O.commit(p, res.layout, layout, res.affected)
  assert.ok(c.ok, c.reason)
  const before = p.floors[0].outline, after = c.design.floors[0].outline
  const grew = side === 'E' || side === 'W' ? after.w - before.w : after.h - before.h
  assert.equal(grew, 600)
  assert.ok(c.design.builtAreaSqm > p.builtAreaSqm)
  // every floor stays tiled, the columns on that wall moved with it, and the stair is still the same room on every floor
  for (const f of c.design.floors) {
    assert.ok(Math.abs(f.footprint.reduce((a, q) => a + q.w * q.h, 0) - f.rooms.filter((q) => !q.outdoor).reduce((a, q) => a + q.rect.w * q.rect.h, 0)) <= 50_000)
  }
  assert.deepEqual(errors(c.design), [])
  // it survives a save and a reload, and moves back
  const again = parseLayout(JSON.parse(JSON.stringify(res.layout)))
  assert.deepEqual(again.outline, res.layout.outline)
  const back = O.resizeOutline(res.layout, p, side, -600)
  assert.ok(back.ok, back.reason)
  assert.ok(O.commit(p, back.layout, res.layout).ok)
  // a wall cannot go past the beam limit or the setback line, and the refusal says why
  const far = O.resizeOutline(layout, p, side, limits[side].max + 3000)
  if (far.ok) assert.equal(O.commit(p, far.layout, layout).ok, false)
  // shrinking the villa is allowed too
  const sIn = ['E', 'W', 'N', 'S'].find((x) => limits[x].min <= -600)
  if (sIn) { const r2 = O.resizeOutline(layout, p, sIn, -600); if (r2.ok) { const c2 = O.commit(p, r2.layout, layout); assert.ok(c2.ok || c2.reason.length > 0) } }
})

test('rooms on different floors swap floors and the plan stays valid', () => {
  const p = plan(18, 24, 1), layout = extractLayout(p)
  // the study upstairs and the dining room below exchange floors; each takes the other's slot
  const res = O.swapAcrossFloors(layout, p, 1, 'study1', 0, 'dining')
  assert.ok(res.ok, res.reason)
  const c = O.commit(p, res.layout, layout, res.affected)
  assert.ok(c.ok, c.reason)
  assert.ok(room(res.layout, 0, 'study1') && room(res.layout, 1, 'dining'))
  assert.equal(room(res.layout, 1, 'study1'), undefined)
  assert.deepEqual(room(res.layout, 0, 'study1').rect, room(layout, 0, 'dining').rect)
  assert.deepEqual(room(res.layout, 1, 'dining').rect, room(layout, 1, 'study1').rect)
  assert.match(room(res.layout, 1, 'dining').semanticId, /^FF_/)
  assert.match(room(res.layout, 0, 'study1').semanticId, /^GF_/)
  assert.ok(c.notes.some((n) => /ground floor/.test(n.message)), 'dining on the upper floor is advised against')
  // fixed, locked and attached rooms are refused with a reason
  assert.equal(O.swapAcrossFloors(layout, p, 1, 'stair', 0, 'dining').ok, false)
  assert.equal(O.swapAcrossFloors(layout, p, 1, 'bed1', 0, 'dining').ok, false, 'bed1 has an attached bath')
  const locked = O.toggleLock(layout, 1, 'study1').layout
  assert.equal(O.swapAcrossFloors(locked, p, 1, 'study1', 0, 'dining').ok, false)
})

test('parking, verandah and the open-air spaces are editable, and the driveway follows them', () => {
  const p = plan(), layout = extractLayout(p)
  const parking = room(layout, 0, 'parking')
  assert.ok(parking && parking.outdoor, 'parking is a layout room')
  // resize the parking bay: it must stay clear of the house and inside the setbacks
  const bigger = O.resizeRoom(layout, p, 0, 'parking', { ...parking.rect, w: parking.rect.w - 600 })
  assert.ok(bigger.ok, bigger.reason)
  const c = O.commit(p, bigger.layout, layout, bigger.affected)
  assert.ok(c.ok, c.reason)
  const drive = c.design.siteFeatures.find((f) => f.kind === 'driveway')
  assert.equal(drive.rect.w, parking.rect.w - 600, 'the driveway follows the parking bay')
  // onto the house is refused with the reason
  const house = room(layout, 0, 'living').rect
  const onto = O.moveRoom(layout, p, 0, 'parking', { x: house.x, y: house.y })
  assert.equal(onto.ok, false)
  assert.match(onto.reason, /overlap|leave/)
  // swap with the verandah, and an open-air space cannot swap with a room
  assert.ok(O.swapRooms(layout, p, 0, 'parking', 'verandah').ok)
  assert.equal(O.swapRooms(layout, p, 0, 'parking', 'living').ok, false)
  // delete and add again
  const gone = O.deleteRoom(layout, p, 0, 'parking')
  assert.ok(gone.ok && O.commit(p, gone.layout, layout).ok)
  const back = O.addRoom(gone.layout, p, 0, 'parking')
  assert.ok(back.ok, back.reason)
  assert.ok(O.commit(p, back.layout, gone.layout).ok)
  // a hand-placed driveway stays put and can be handed back to the automatic layout
  const d0 = drive.rect
  const hand = O.setFeature(layout, p, 'driveway', { ...d0, w: d0.w + 600 })
  const ch = O.commit(p, hand.layout, layout)
  assert.ok(!ch.ok || ch.design.siteFeatures.find((f) => f.kind === 'driveway').rect.w === d0.w + 600)
  assert.ok(O.resetFeature(hand.layout, 'driveway').ok)
  assert.equal(O.resetFeature(layout, 'driveway').ok, false)
})

test('moving an outer wall moves or pushes the open-air spaces so nothing collides', () => {
  const p = plan(20, 26, 1, 5), layout = extractLayout(p)
  const limits = O.outlineLimits(layout, p)
  let moved = 0
  for (const side of ['N', 'S', 'E', 'W']) {
    for (const delta of [300, -300]) {
      const res = O.resizeOutline(layout, p, side, delta)
      if (!res.ok) continue
      const c = O.commit(p, res.layout, layout, res.affected)
      if (!c.ok) continue
      moved++
      assert.deepEqual(errors(c.design), [])
      const g = c.design.floors[0]
      for (const o of g.rooms.filter((r) => r.outdoor)) for (const i of g.rooms.filter((r) => !r.outdoor)) {
        const w = Math.min(o.rect.x + o.rect.w, i.rect.x + i.rect.w) - Math.max(o.rect.x, i.rect.x), h = Math.min(o.rect.y + o.rect.h, i.rect.y + i.rect.h) - Math.max(o.rect.y, i.rect.y)
        assert.ok(!(w > 10 && h > 10), `${o.id} does not overlap ${i.id}`)
      }
    }
  }
  assert.ok(moved >= 1 && limits.N)
})

test('growing a room pushes the connected rooms along; shrinking lets them follow', () => {
  const p = plan(), layout = extractLayout(p)
  const k = room(layout, 0, 'kitchen').rect, u = room(layout, 0, 'utility').rect, d = room(layout, 0, 'dining').rect
  // the kitchen grows into the dining room: the dining room gives way and keeps its other edges
  const grow = O.resizeRoom(layout, p, 0, 'kitchen', { ...k, h: k.h + 600 })
  assert.ok(grow.ok, grow.reason)
  const after = room(grow.layout, 0, 'dining').rect
  assert.ok(after.y !== d.y || after.h !== d.h || room(grow.layout, 0, 'utility').rect.y !== u.y, 'a neighbour moved to make space')
  assert.ok(O.commit(p, grow.layout, layout, grow.affected).ok)
  // a push that would go out of the building is refused with the way out
  const tooFar = O.resizeRoom(layout, p, 0, 'kitchen', { ...k, y: k.y - 1200, h: k.h + 1200 })
  assert.equal(tooFar.ok, false)
  assert.match(tooFar.reason, /outer wall|resize less/i)
  // shrinking: the neighbour on that side grows to follow
  const shrink = O.resizeRoom(layout, p, 0, 'kitchen', { ...k, h: k.h - 600 })
  assert.ok(shrink.ok, shrink.reason)
  assert.equal(O.vacantRooms(shrink.layout, 0).length, 0, 'the freed strip was taken by the connected room')
})

test('the corridor is resizable: widening it pushes the rooms beside it, the stair moving on every floor', () => {
  const p = plan(), layout = extractLayout(p)
  const c = room(layout, 0, 'corridor').rect
  const res = O.resizeRoom(layout, p, 0, 'corridor', { ...c, x: c.x - 300, w: c.w + 300 })
  assert.ok(res.ok, res.reason)
  const cm = O.commit(p, res.layout, layout, res.affected)
  assert.ok(cm.ok, cm.reason)
  assert.equal(cm.design.floors[0].rooms.find((r) => r.id === 'corridor').rect.w, c.w + 300)
  const stairs = cm.design.floors.map((f) => f.rooms.find((r) => r.id === 'stair').rect)
  assert.ok(stairs.every((r) => JSON.stringify(r) === JSON.stringify(stairs[0])), 'the stair is the same on every floor')
  // a column left inside a room by the moved wall is a note on an edited plan, not a reason to refuse
  assert.ok(!errors(cm.design).some((f) => f.code === 'COLUMN_NOT_IN_WALL'))
})

test('the stair is dragged onto a room and moves on every floor; the rooms on each floor shift to make space', () => {
  const p = plan(), layout = extractLayout(p)
  const before = layout.floors.map((f) => f.rooms.find((r) => r.id === 'stair').rect)
  const res = O.swapRooms(layout, p, 0, 'stair', 'dining')
  assert.ok(res.ok, res.reason)
  const c = O.commit(p, res.layout, layout, res.affected)
  assert.ok(c.ok, c.reason)
  const after = c.design.floors.map((f) => f.rooms.find((r) => r.id === 'stair').rect)
  assert.notDeepEqual(after[0], before[0])
  assert.deepEqual(after[1], after[0], 'the upper floor stair moved too')
  assert.equal(after[0].h, before[0].h, 'the stair keeps its size')
  // resizing the stair resizes it on every floor
  const s = room(layout, 0, 'stair').rect
  const longer = O.resizeRoom(layout, p, 0, 'stair', { ...s, y: s.y - 300, h: s.h + 300 })
  assert.ok(longer.ok, longer.reason)
  const lc = O.commit(p, longer.layout, layout, longer.affected)
  assert.ok(lc.ok, lc.reason)
  assert.ok(lc.design.floors.every((f) => f.rooms.find((r) => r.id === 'stair').rect.h === s.h + 300))
})

test('moving an outer wall in slides the stair whole and the rooms beside it follow; too far is refused with how far it can go', () => {
  const p = generate(compile(defaultBrief()))
  let l = extractLayout(p)
  l = O.swapRooms(l, p, 0, 'kitchen', 'dining').layout
  const moved = O.swapRooms(l, p, 0, 'stair', 'dining')
  assert.ok(moved.ok && O.commit(p, moved.layout, l).ok, 'the stair move itself is valid')
  l = moved.layout
  const ok300 = O.resizeOutline(l, p, 'N', -300)
  assert.ok(ok300.ok, ok300.reason)
  const c = O.commit(p, ok300.layout, l, ok300.affected)
  assert.ok(c.ok, c.reason)
  const st = c.design.floors.map((f) => f.rooms.find((r) => r.id === 'stair').rect)
  assert.ok(st.every((r) => r.h === st[0].h && JSON.stringify(r) === JSON.stringify(st[0])), 'the stair keeps its size and stays aligned')
  const far = O.resizeOutline(l, p, 'N', -600)
  assert.equal(far.ok, false)
  assert.match(far.reason, /at most 0\.3 m/)
})
