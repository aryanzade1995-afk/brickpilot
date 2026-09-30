import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { validate } from '../src/lib/rules/index.ts'
import { rectArea, sharedEdge } from '../src/lib/geometry.ts'
import { buildMassing } from '../src/lib/three/buildMassing.ts'
import { assessBriefFit } from '../src/lib/engine/planner/fit.ts'

/* Deterministic tests for the rule + constraint planner (src/lib/engine/planner). */

const brief = (patch = {}) => {
  const b = defaultBrief()
  b.site.plotWidth = patch.plotWidth ?? 18
  b.site.plotDepth = patch.plotDepth ?? 24
  if (patch.storeys !== undefined) b.levels.storeys = patch.storeys
  if (patch.lift) b.levels.liftProvision = true
  if (patch.large) b.project.buildingType = 'large-villa'
  if (patch.beds) [b.rooms.bedroomsWithBath, b.rooms.bedroomsNoBath] = patch.beds
  if (patch.courtyard) b.rooms.priorities.courtyard = true
  if (patch.facing) {
    b.site.facing = patch.facing
    b.site.roadEdges = [patch.facing]
  }
  if (patch.variation) b.variation = patch.variation
  return b
}
const design = (patch, opts) => generate(compile(brief(patch)), opts)
const errors = (d) => validate(d).findings.filter((f) => f.severity === 'error')
const codes = (d) => new Set(errors(d).map((f) => f.code))
const overlap = (a, b) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

test('brief fit feedback updates as plot and room requirements change', () => {
  const b = defaultBrief()
  assert.equal(assessBriefFit(b).fits, true)
  b.site.plotWidth = 10
  b.site.plotDepth = 12
  assert.equal(assessBriefFit(b).fits, false)
  b.site.plotWidth = 25
  b.site.plotDepth = 30
  assert.equal(assessBriefFit(b).fits, true)
  b.rooms.bedroomsWithBath = 8
  b.rooms.bedroomsNoBath = 8
  assert.equal(assessBriefFit(b).fits, false)
})

/** a spread of feasible briefs: every one must pass every mandatory validator */
const FEASIBLE = [
  {}, { storeys: 0 }, { storeys: 2 }, { storeys: 2, lift: true }, { storeys: 3, beds: [3, 1] },
  { large: true }, { large: true, storeys: 2, lift: true }, { courtyard: true, plotWidth: 25, plotDepth: 25 },
  { facing: 'E' }, { facing: 'W', storeys: 2 }, { plotWidth: 30, plotDepth: 40, beds: [4, 2] },
  { plotWidth: 15, plotDepth: 18 }, { variation: 3 }, { variation: 7, storeys: 2 },
]

test('feasible briefs produce plans that pass every mandatory validator', () => {
  for (const p of FEASIBLE) {
    const d = design(p)
    assert.deepEqual(errors(d).map((f) => `${f.code}: ${f.message}`), [], JSON.stringify(p))
    assert.equal(d.algorithm, 'rule-constraint-planner-v1')
  }
})

test('generation is deterministic: same brief + seed gives an identical plan', () => {
  for (const p of [{}, { storeys: 2, lift: true }, { courtyard: true, plotWidth: 25, plotDepth: 25 }]) {
    assert.equal(JSON.stringify(design(p, { seed: 11 })), JSON.stringify(design(p, { seed: 11 })))
  }
})

test('all plan geometry is integer millimetres', () => {
  const d = design({ storeys: 2, lift: true })
  const ints = (...xs) => xs.every((x) => Number.isInteger(x))
  for (const f of d.floors) {
    for (const r of f.rooms) assert.ok(ints(r.rect.x, r.rect.y, r.rect.w, r.rect.h), r.semanticId)
    for (const w of f.walls) assert.ok(ints(w.a.x, w.a.y, w.b.x, w.b.y), w.id)
    for (const o of f.openings) assert.ok(ints(o.at.x, o.at.y, o.width), o.id)
    for (const c of f.columns) assert.ok(ints(c.at.x, c.at.y), c.id)
  }
})

test('every object carries a unique semantic id in the GF_ / FF_ scheme', () => {
  const d = design({ storeys: 1 })
  const [gf, ff] = d.floors
  const ids = (f) => new Set([
    ...f.rooms.map((r) => r.semanticId), ...f.openings.map((o) => o.id), ...f.walls.map((w) => w.id),
    ...f.columns.map((c) => c.id), ...f.beams.map((b) => b.id), ...f.shafts.map((s) => s.id),
  ])
  const g = ids(gf)
  const u = ids(ff)
  for (const id of ['GF_LIVING', 'GF_KITCHEN', 'GF_MAIN_DOOR', 'GF_STAIR', 'GF_CORRIDOR', 'GF_COLUMN_C01', 'GF_BEAM_B01'])
    assert.ok(g.has(id), id)
  for (const id of ['FF_MASTER_BED', 'FF_MASTER_BATH', 'FF_STAIR', 'FF_LOBBY', 'FF_MASTER_BATH_SHAFT'])
    assert.ok(u.has(id), id)
  assert.ok([...g].some((id) => /^GF_LIVING_WINDOW_\d\d$/.test(id)))
  for (const f of d.floors) for (const id of ids(f)) assert.ok(id.startsWith(`${f.prefix}_`), id)
  const all = d.floors.flatMap((f) => [...ids(f)])
  const count = d.floors.reduce((n, f) => n + f.rooms.length + f.openings.length + f.walls.length +
    f.columns.length + f.beams.length + f.shafts.length, 0)
  assert.equal(all.length, count, 'no id is shared by two objects')
})

test('upper floors never exceed the plate below; columns and the stair stack exactly', () => {
  for (const p of [{ storeys: 1 }, { storeys: 3, beds: [3, 1] }, { large: true, storeys: 2, lift: true }]) {
    const d = design(p)
    for (let i = 1; i < d.floors.length; i++) {
      const up = d.floors[i]
      const lo = d.floors[i - 1]
      for (const r of up.footprint)
        assert.equal(lo.footprint.reduce((a, q) => a + overlap(r, q), 0), rectArea(r), `${up.prefix} plate is supported`)
      for (const c of up.columns) {
        const below = lo.columns.find((q) => q.at.x === c.at.x && q.at.y === c.at.y)
        assert.ok(below, `${c.id} stacks`)
        assert.equal(below.id.slice(3), c.id.slice(3), 'a column keeps its grid number on every floor')
      }
      assert.deepEqual(up.rooms.find((r) => r.id === 'stair').rect, lo.rooms.find((r) => r.id === 'stair').rect)
    }
    assert.ok(d.structure.maxBeamSpanMm <= 6000)
  }
})

test('rooms tile each plate exactly with no overlaps, and every room has an outside wall', () => {
  for (const p of [{}, { storeys: 0 }, { courtyard: true, plotWidth: 25, plotDepth: 25 }]) {
    const d = design(p)
    for (const f of d.floors) {
      const enc = f.rooms.filter((r) => !r.outdoor)
      assert.equal(enc.reduce((a, r) => a + rectArea(r.rect), 0), f.footprint.reduce((a, r) => a + rectArea(r), 0))
      for (let i = 0; i < enc.length; i++)
        for (let j = i + 1; j < enc.length; j++) assert.equal(overlap(enc[i].rect, enc[j].rect), 0, `${enc[i].id}/${enc[j].id}`)
      for (const r of enc)
        assert.ok(f.walls.some((w) => w.kind === 'exterior' && w.rooms[0] === r.id), `${r.semanticId} has an outside wall`)
    }
  }
})

test('doors sit on the wall two rooms share and swing into the room they serve', () => {
  const d = design({ storeys: 2 })
  for (const f of d.floors) {
    const byId = new Map(f.rooms.map((r) => [r.id, r]))
    for (const o of f.openings.filter((x) => x.kind === 'door')) {
      const [a, b] = o.rooms.map((id) => byId.get(id))
      const e = sharedEdge(a.rect, b.rect)
      assert.ok(e, o.id)
      assert.equal(o.orient, e.side === 'N' || e.side === 'S' ? 'h' : 'v', o.id)
      // the kitchen type (T5) deliberately joins kitchen and dining through
      // their partition, wider than a door when it is a glazed slide / open gap
      const kitchenDining = [a.id, b.id].includes('kitchen') && [a.id, b.id].some((id) => id === 'dining' || id === 'livingDining')
      assert.ok(o.width <= 1000 || (kitchenDining && o.treatment), `${o.id} is too wide`)
      const attachedBath = (a.zone === 'private' && /bath/i.test(b.id)) || (b.zone === 'private' && /bath/i.test(a.id))
      assert.ok(o.orient !== 'v' || a.zone === 'circulation' || b.zone === 'circulation' || attachedBath || kitchenDining || a.outdoor || b.outdoor,
        `${o.id} cuts a vertical room partition`)
      // bedrooms are entered from circulation (or open to their own bath / balcony)
      if (a.zone === 'private') assert.ok(b.zone === 'circulation' || b.outdoor || /bath/.test(b.id), o.id)
      if (o.leaf === false) continue
      const c = o.orient === 'h' ? a.rect.y + a.rect.h / 2 : a.rect.x + a.rect.w / 2
      assert.equal(o.swing, c > (o.orient === 'h' ? o.at.y : o.at.x) ? 1 : -1, `${o.id} swings into ${a.id}`)
    }
  }
})

test('every bath has an outside ventilator and a plumbing shaft', () => {
  const d = design({ storeys: 1, beds: [3, 0] })
  for (const f of d.floors) {
    for (const r of f.rooms.filter((x) => /bath/i.test(x.id))) {
      assert.ok(f.openings.some((o) => o.kind === 'window' && o.rooms[0] === r.id && o.sill >= 1800), `${r.semanticId} ventilator`)
      assert.ok(f.shafts.some((s) => s.roomId === r.id), `${r.semanticId} shaft`)
    }
  }
  assert.ok(d.floors[1].shafts.every((s) => 'stackedOver' in s))
})

test('openings never cut a column', () => {
  const d = design({ large: true, storeys: 2 })
  for (const f of d.floors) {
    for (const o of f.openings) {
      for (const c of f.columns) {
        const onLine = o.orient === 'h' ? c.at.y === o.at.y : c.at.x === o.at.x
        const along = o.orient === 'h' ? Math.abs(c.at.x - o.at.x) : Math.abs(c.at.y - o.at.y)
        assert.ok(!onLine || along >= o.width / 2 + c.size / 2, `${o.id} vs ${c.id}`)
      }
    }
  }
})

test('mandatory validators reject corrupted plans', () => {
  const base = design({ storeys: 1 })
  assert.ok(validate(base).hardChecksPass)
  const mutate = (fn) => {
    const d = structuredClone(base)
    fn(d)
    return codes(d)
  }
  const door = (d, id) => d.floors[1].openings.find((o) => o.id === id)
  assert.ok(mutate((d) => { d.floors[1].footprint[0].w += 3000 }).has('UPPER_FLOOR_UNSUPPORTED'))
  // push the kitchen into whichever room shares its wall (layout-independent)
  assert.ok(mutate((d) => {
    const rooms = d.floors[0].rooms.filter((r) => !r.outdoor)
    const k = rooms.find((r) => r.id === 'kitchen')
    const n = rooms.find((r) => r !== k && sharedEdge(k.rect, r.rect))
    k.rect = { ...k.rect, x: n.rect.x, y: n.rect.y }
  }).has('ROOM_OVERLAP'))
  assert.ok(mutate((d) => { door(d, 'FF_MASTER_BED_DOOR').at.y += 1000 }).has('DOOR_WRONG_WALL'))
  assert.ok(mutate((d) => {
    const o = door(d, 'FF_MASTER_BED_DOOR')
    o.rooms = [o.rooms[1], o.rooms[0]]
  }).has('DOOR_SWING_BLOCKED'))
  assert.ok(mutate((d) => {
    d.floors[1].openings = d.floors[1].openings.filter((o) => o.id !== 'FF_MASTER_BATH_WINDOW_01')
  }).has('BATH_NO_VENTILATION'))
  assert.ok(mutate((d) => { d.floors[1].rooms.find((r) => r.id === 'stair').rect.x += 300 }).has('STAIR_MISALIGNED'))
  assert.ok(mutate((d) => { d.floors[1].columns[0].at.x += 700 }).has('COLUMN_MISALIGNED'))
  assert.ok(mutate((d) => {
    const f = d.floors[0]
    const w = f.openings.find((o) => o.kind === 'window' && f.columns.some((c) => o.orient === 'h' ? c.at.y === o.at.y : c.at.x === o.at.x))
    const c = f.columns.find((x) => w.orient === 'h' ? x.at.y === w.at.y : x.at.x === w.at.x)
    w.at = { ...c.at }
  }).has('OPENING_ON_COLUMN'))
  assert.ok(mutate((d) => { door(d, 'FF_MASTER_BATH_DOOR').rooms[1] = 'lobby1' }).has('DOOR_WRONG_WALL'))
  assert.ok(mutate((d) => {
    d.floors[1].openings = d.floors[1].openings.filter((o) => o.id !== 'FF_BED_03_DOOR')
  }).has('UNREACHABLE_ROOM'))
  assert.ok(mutate((d) => { door(d, 'FF_BED_03_DOOR').width = 1600 }).has('DOOR_TOO_WIDE'))
  assert.ok(mutate((d) => { d.floors[0].rooms[1].semanticId = d.floors[0].rooms[0].semanticId }).has('SEMANTIC_ID_DUPLICATE'))
})

test('impossible briefs are rejected, never squeezed into a passing plan', () => {
  const d = design({ plotWidth: 12, plotDepth: 18, storeys: 0, beds: [4, 2] })
  assert.ok(!validate(d).hardChecksPass)
  assert.ok(codes(d).has('AREA_BELOW_MINIMUM') || codes(d).has('MIN_ROOM_DIMENSION'))
})

test('the 3D model is built from the same semantic plan', () => {
  const d = design({ storeys: 1 })
  const massing = buildMassing(d)
  const stair = d.floors[0].stair
  assert.ok(stair.startSide)
  const flights = massing.boxes.filter((b) => b.kind === 'stair')
  assert.ok(flights.length > 0)
  // every stair box lies inside the plan's stair core (world metres ↔ plan mm)
  const xs = flights.map((b) => b.pos[0])
  const zs = flights.map((b) => b.pos[2])
  const spanX = Math.max(...xs) - Math.min(...xs)
  const spanZ = Math.max(...zs) - Math.min(...zs)
  assert.ok(spanX <= stair.rect.w / 1000 + 1e-6 && spanZ <= stair.rect.h / 1000 + 1e-6)
  assert.equal(validate(d).findings.filter((f) => f.code === 'PLAN_3D_OPENING_MISMATCH').length, 0)
})

/* T5: the brief's kitchen type sets the kitchen's connection to dining */

const kitchenDesign = (kitchen, patch = {}) => {
  const b = defaultBrief()
  b.site.plotWidth = 18
  b.site.plotDepth = 24
  b.lifestyle.kitchen = kitchen
  Object.assign(b.lifestyle, patch)
  return generate(compile(b))
}
const isDining = (id) => id === 'dining' || id === 'livingDining'
const kitchenLinks = (d) => d.floors[0].openings.filter((o) =>
  o.kind === 'door' && o.rooms.includes('kitchen') && o.rooms.some(isDining))

test('every kitchen type yields a plan that passes every hard check', () => {
  for (const kitchen of ['open', 'semi', 'closed']) {
    const r = validate(kitchenDesign(kitchen))
    assert.deepEqual(r.findings.filter((f) => f.severity === 'error').map((f) => f.code), [], kitchen)
    assert.ok(!r.findings.some((f) => f.code === 'KITCHEN_TYPE_DOWNGRADED'), `${kitchen} fits without downgrading`)
  }
})

test('semi-open: exactly one glazed sliding opening between kitchen and dining, hall door kept', () => {
  const d = kitchenDesign('semi')
  const links = kitchenLinks(d)
  assert.equal(links.length, 1)
  assert.equal(links[0].treatment, 'glazed-slide')
  assert.equal(links[0].leaf, false)
  assert.ok(links[0].width >= 1200 && links[0].width <= 1800)
  assert.equal(d.floors[0].openings.filter((o) => o.treatment === 'glazed-slide').length, 1)
  assert.ok(d.floors[0].openings.some((o) => o.id === 'GF_KITCHEN_DOOR' && o.rooms.includes('corridor')), 'the hall door stays')
})

test('open: one open gap of at least 1500 mm, no hall door while dining is reachable', () => {
  const d = kitchenDesign('open')
  const links = kitchenLinks(d)
  assert.equal(links.length, 1)
  assert.equal(links[0].treatment, 'open')
  assert.ok(links[0].width >= 1500, `${links[0].width} mm`)
  assert.ok(!d.floors[0].openings.some((o) => o.rooms.includes('kitchen') && o.rooms.includes('corridor')))
  assert.ok(!d.floors[0].unreachableRooms.includes('kitchen'))
})

test('closed: an 800 mm door to dining in addition to the hall door', () => {
  const d = kitchenDesign('closed')
  const links = kitchenLinks(d)
  assert.equal(links.length, 1)
  assert.equal(links[0].width, 800)
  assert.notEqual(links[0].leaf, false)
  assert.equal(links[0].treatment, undefined)
  assert.ok(d.floors[0].openings.some((o) => o.rooms.includes('kitchen') && o.rooms.includes('corridor')))
})

test('a kitchen built narrower than the brief asked for is reported as downgraded', () => {
  const d = structuredClone(kitchenDesign('semi'))
  d.model.brief.lifestyle.kitchen = 'open'
  const f = validate(d).findings.find((x) => x.code === 'KITCHEN_TYPE_DOWNGRADED')
  assert.ok(f)
  assert.equal(f.severity, 'warning')
})

test('a dry / wet split turns the utility into a larger, windowed wet kitchen', () => {
  const b = defaultBrief()
  b.lifestyle.dryWetSplit = true
  const u = compile(b).floors[0].spaces.find((s) => s.id === 'utility')
  assert.equal(u.name, 'Wet kitchen / utility')
  assert.deepEqual([u.min, u.target, u.max], [5, 7, 11])
  assert.equal(u.wantsWindow, true)
  const plain = compile(defaultBrief()).floors[0].spaces.find((s) => s.id === 'utility')
  assert.equal(plain.name, 'Utility')
  assert.equal(validate(kitchenDesign('semi', { dryWetSplit: true })).hardChecksPass, true)
})

test('glazed slides become glass in 3D; open kitchens leave the partition gap empty', () => {
  const glass = (d) => buildMassing(d).boxes.filter((x) => x.kind === 'glass' && x.id.includes('-slide')).length
  assert.equal(glass(kitchenDesign('semi')), 1)
  assert.equal(glass(kitchenDesign('open')), 0)
})