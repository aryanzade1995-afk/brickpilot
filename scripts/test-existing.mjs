import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeImage, toDetections } from '../src/lib/existing/detect.ts'
import { sampleSite } from '../src/lib/existing/sample.ts'
import { homography, buildMapping } from '../src/lib/existing/calibrate.ts'
import { buildAsBuilt, rotateToRoad } from '../src/lib/existing/asBuilt.ts'
import { defaultAnswers } from '../src/lib/existing/types.ts'
import { briefFromAnswers, planAroundStructure } from '../src/lib/existing/plan.ts'
import { validateExisting } from '../src/lib/existing/validate.ts'
import { generateExisting } from '../src/lib/engine/generateExisting.ts'
import { compile } from '../src/lib/model/canonical.ts'

const ANSWERS = { ...defaultAnswers(), plotWidthM: 22, plotDepthM: 22, storeysBuilt: 1, storeysWanted: 1, bedroomsWithBath: 1, bedroomsNoBath: 1, sharedBaths: 1,
  utility: false, pooja: false }
const demo = () => {
  const img = sampleSite(), det = toDetections(analyzeImage(img)), t = img.truth
  det.columns.forEach((c) => { c.confirmed = true }); det.beams.forEach((b) => { b.confirmed = true })
  const cal = { mode: 'corners', pts: [t.backBase[0], t.backBase[3], t.frontBase[3], t.frontBase[0]], widthMm: t.widthMm, depthMm: t.depthMm }
  return { img, det, cal }
}
const grid = (xs, ys, size = 230) => ({ columns: ys.flatMap((y, j) => xs.map((x, i) => ({ id: `C${j}${i}`, at: { x, y }, size }))), footings: [], beams: [], walls: [], storeysBuilt: 1 })
const LEAN = { ...ANSWERS, storeysWanted: 1 }

test('image analysis finds the columns and the beams of the demo site', () => {
  const { img, det } = demo()
  assert.equal(det.columns.length, img.truth.columns)
  const truth = [...img.truth.frontBase, ...img.truth.backBase]
  for (const p of truth) assert.ok(det.columns.some((c) => Math.abs(c.img.x - p.x) <= 8 && Math.abs(c.img.y - p.y) <= 8), `column near ${p.x},${p.y}`)
  assert.ok(det.beams.length >= 3)
  assert.ok(det.columns.every((c) => c.confidence > 0 && c.confidence <= 1 && c.source === 'auto'))
})

test('four corners give true distances, one known distance sets a scale', () => {
  const { img } = demo()
  const t = img.truth, h = homography([t.backBase[0], t.backBase[3], t.frontBase[3], t.frontBase[0]], t.widthMm, t.depthMm)
  const a = h(t.backBase[0]), b = h(t.frontBase[3])
  assert.ok(Math.abs(a.x) < 1 && Math.abs(a.y) < 1 && Math.abs(b.x - 15000) < 1 && Math.abs(b.y - 7500) < 1)
  const mid = h(t.frontBase[1])   // the second front column stands one bay (5 m) along the front edge
  assert.ok(Math.abs(mid.x - 5000) < 60 && Math.abs(mid.y - 7500) < 60, `${mid.x},${mid.y}`)
  const cols = [{ id: 'a', img: { x: 0, y: 0 } }, { id: 'b', img: { x: 100, y: 0 } }]
  assert.equal(buildMapping({ mode: 'scale', a: 'a', b: 'b', distanceMm: 5000 }, cols).mmPerPx, 50)
  assert.equal(buildMapping({ mode: 'none' }, cols).toPlan, null)
})

test('the as-built map locks every element and asks about low-confidence detections', () => {
  const { det, cal } = demo()
  det.columns[0].confirmed = false; det.columns[0].confidence = 0.3
  const blocked = buildAsBuilt(det, cal, ANSWERS)
  assert.ok(blocked.ok, 'the rest still builds')
  assert.deepEqual(blocked.value.needsConfirmation, [det.columns[0].id])
  assert.equal(blocked.value.structure.columns.length, det.columns.length - 1, 'an unconfirmed low-confidence detection is not locked in')
  det.columns[0].confirmed = true
  const ok = buildAsBuilt(det, cal, ANSWERS)
  assert.ok(ok.ok && ok.value.needsConfirmation.length === 0 && ok.value.elements.every((e) => e.state === 'LOCKED'))
  assert.equal(ok.value.structure.columns.length, 8)
  const xs = [...new Set(ok.value.structure.columns.map((c) => c.at.x))].sort((p, q) => p - q), ys = [...new Set(ok.value.structure.columns.map((c) => c.at.y))].sort((p, q) => p - q)
  assert.equal(xs.length, 4); assert.equal(ys.length, 2)
  assert.ok(Math.abs(xs[3] - 15000) < 120 && Math.abs(ys[1] - 7500) < 120, `${xs} ${ys}`)
  assert.ok(buildAsBuilt({ ...det, columns: det.columns.slice(0, 1), beams: [] }, cal, ANSWERS).ok === false, 'one column cannot make a structure')
  assert.deepEqual(rotateToRoad({ x: 10, y: 0 }, 'E'), { x: -0, y: 10 })
  assert.deepEqual(rotateToRoad({ x: 3, y: 4 }, 'S'), { x: 3, y: 4 })
})

test('site image to valid 2D plan: locked columns never move, missing ones are proposed', () => {
  const { det, cal } = demo()
  const built = buildAsBuilt(det, cal, ANSWERS)
  assert.ok(built.ok)
  const plan = planAroundStructure(built.value, ANSWERS)
  assert.ok(plan.ok && plan.valid, plan.ok ? JSON.stringify(plan.existing.findings.slice(0, 3)) : plan.reason)
  const ground = plan.design.floors[0], { dx, dy } = plan.design.existingStructure
  for (const c of built.value.structure.columns) {
    const kept = ground.columns.find((d) => d.state === 'LOCKED' && d.at.x === c.at.x + dx && d.at.y === c.at.y + dy)
    assert.ok(kept && kept.size === c.size, `locked column ${c.id} kept exactly`)
  }
  assert.ok(ground.columns.some((c) => c.state === 'PROPOSED'), 'the grid needs columns the site does not have yet')
  assert.ok(ground.beams.every((b) => b.state === 'LOCKED' || b.state === 'PROPOSED'))
  assert.equal(plan.existing.errors, 0)
  assert.equal(plan.rules.counts.error, 0)
  assert.equal(JSON.stringify(planAroundStructure(built.value, ANSWERS, 1).design.floors[0].rooms), JSON.stringify(plan.design.floors[0].rooms), 'deterministic')
})

test('foundation only, incomplete columns and a full beam-column grid all plan', () => {
  const model = compile(briefFromAnswers({ ...LEAN, storeysWanted: 2, plotWidthM: 24, plotDepthM: 24, bedroomsNoBath: 1 }))
  const full = grid([0, 4000, 8000, 12000], [0, 5000, 10000])
  const withBeams = { ...full, beams: [{ id: 'B1', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, width: 230 }, { id: 'B2', a: { x: 4000, y: 0 }, b: { x: 8000, y: 0 }, width: 230 }] }
  const foundation = { columns: [], footings: full.columns.map((c) => ({ id: c.id, at: c.at })), beams: [], walls: [], storeysBuilt: 0 }
  const incomplete = { ...full, columns: full.columns.filter((_, i) => i !== 5 && i !== 6) }
  for (const [name, structure] of [['full grid', full], ['columns + beams', withBeams], ['foundation only', foundation], ['incomplete', incomplete]]) {
    const r = generateExisting(model, structure)
    assert.ok(r.design && r.valid, `${name}: ${r.reason ?? 'invalid'}`)
    const ground = r.design.floors[0]
    const lockedExpected = structure.columns.length
    assert.equal(ground.columns.filter((c) => c.state === 'LOCKED').length, lockedExpected, `${name}: every built column stays`)
    assert.ok(validateExisting(r.design).ok, name)
  }
  const none = generateExisting(model, { columns: [{ id: 'a', at: { x: 0, y: 0 }, size: 230 }], footings: [], beams: [], walls: [], storeysBuilt: 1 })
  assert.equal(none.design, null)
})

test('the validator catches a moved column, a room overlap and a door on a column', () => {
  const model = compile(briefFromAnswers({ ...LEAN, storeysWanted: 2, plotWidthM: 24, plotDepthM: 24 }))
  const r = generateExisting(model, grid([0, 4000, 8000, 12000], [0, 5000, 10000]))
  assert.ok(r.design && r.valid)
  const bad = structuredClone(r.design)
  const locked = bad.floors[0].columns.find((c) => c.state === 'LOCKED')
  locked.at.x += 40
  assert.ok(validateExisting(bad).findings.some((f) => f.code === 'LOCKED_COLUMN_CHANGED' && f.severity === 'error' && f.at))
  const overlap = structuredClone(r.design)
  const [a, b] = overlap.floors[0].rooms.filter((x) => !x.outdoor)
  b.rect = { ...a.rect }
  assert.ok(validateExisting(overlap).findings.some((f) => f.code === 'ROOM_OVERLAP'))
  const onColumn = structuredClone(r.design)
  const col = onColumn.floors[0].columns[0]
  onColumn.floors[0].openings.push({ id: 'X', kind: 'door', at: { ...col.at }, orient: 'h', width: 900 })
  assert.ok(validateExisting(onColumn).findings.some((f) => f.code === 'OPENING_COLUMN_CONFLICT'))
  const small = structuredClone(r.design)
  small.floors.flatMap((f) => f.rooms).find((x) => x.zone === 'private' && !x.outdoor).area = 2
  assert.ok(validateExisting(small).findings.some((f) => f.code === 'ROOM_TOO_SMALL'))
})

test('an over-ambitious programme is reported, not silently squeezed in', () => {
  const tiny = planAroundStructure(buildAsBuilt(demo().det, demo().cal, ANSWERS).value, { ...ANSWERS, bedroomsWithBath: 4, bedroomsNoBath: 3, sharedBaths: 3, studies: 2, storeysWanted: 1 })
  assert.ok(tiny.ok ? !tiny.valid : true)
})

test('automatic clean-up: one mask per column, outliers dropped, corners and beams derived', async () => {
  const { consistentColumns, autoCorners, carryBeams } = await import('../src/lib/existing/auto.ts')
  const mask = (x, w = 40, h = 200, y = 500) => ({ base: { x, y }, top: { x, y: y - h }, widthPx: w, heightPx: h, bbox: { x0: x - w / 2, y0: y - h, x1: x + w / 2, y1: y } })
  const row = [100, 200, 300, 400, 500].map((x) => mask(x))
  const pole = mask(250, 18, 520)          // tall and thin: a pole, not a column
  const twice = mask(102)                  // the same column found twice
  const kept = consistentColumns([...row, pole, twice])
  assert.equal(kept.length, 5)
  assert.ok(!kept.includes(pole))
  // two rows of bases give the four outer corners, one row gives none (the other side cannot be seen)
  const col = (x, y, id) => ({ id, img: { x, y }, widthPx: 20, confidence: 0.9, source: 'auto', confirmed: true })
  const grid = [col(100, 300, 'a'), col(300, 300, 'b'), col(500, 300, 'c'), col(60, 520, 'd'), col(300, 520, 'e'), col(540, 520, 'f')]
  assert.deepEqual(autoCorners(grid), [grid[0].img, grid[2].img, grid[5].img, grid[3].img])
  assert.equal(autoCorners([col(100, 400, 'a'), col(200, 402, 'b'), col(300, 401, 'c'), col(400, 399, 'd')]), null)
  // beams found against the first columns follow the final ones
  const beams = carryBeams([col(101, 301, 'o1'), col(299, 299, 'o2')], [{ id: 'x', a: 'o1', b: 'o2', confidence: 0.8, source: 'auto', confirmed: false }], grid)
  assert.equal(beams.length, 1)
  assert.deepEqual([beams[0].a, beams[0].b].sort(), ['a', 'b'])
})

test('a structure typed in by hand (columns, gaps, beams) is planned around when the photo cannot be read', async () => {
  const { planAroundStructure: plan } = await import('../src/lib/existing/plan.ts')
  const { buildAsBuilt: build } = await import('../src/lib/existing/asBuilt.ts')
  const { defaultAnswers: answers } = await import('../src/lib/existing/types.ts')
  const planAroundStructure = plan, buildAsBuilt = build, defaultAnswers = answers
  const run = (along, across, gx, gy, built, wanted, beams = true) => {
    const cols = [], bm = []
    for (let j = 0; j < across; j++) for (let i = 0; i < along; i++) cols.push({ id: `col-${cols.length + 1}`, img: { x: i * gx * 1000, y: j * gy * 1000 }, widthPx: 230, confidence: 1, source: 'user', confirmed: true })
    const at = (i, j) => cols[j * along + i].id
    if (beams) { for (let j = 0; j < across; j++) for (let i = 0; i < along - 1; i++) bm.push({ id: `b${bm.length}`, a: at(i, j), b: at(i + 1, j), confidence: 1, source: 'user', confirmed: true })
      for (let i = 0; i < along; i++) for (let j = 0; j < across - 1; j++) bm.push({ id: `b${bm.length}`, a: at(i, j), b: at(i, j + 1), confidence: 1, source: 'user', confirmed: true }) }
    const det = { columns: cols, beams: bm, footings: [], walls: [], seen: {} }
    const a = { ...defaultAnswers(), plotWidthM: 22, plotDepthM: 24, storeysBuilt: built, storeysWanted: wanted, bedroomsWithBath: 1, bedroomsNoBath: 1, sharedBaths: 1 }
    const ab = buildAsBuilt(det, { mode: 'scale', a: cols[0].id, b: cols[1].id, distanceMm: gx * 1000 }, a, { align: true })
    if (!ab.ok) return 'asBuilt: ' + ab.error
    const p = planAroundStructure(ab.value, a)
    return p.ok ? (p.valid ? 'VALID' : 'invalid: ' + [...p.rules.findings.filter(f => f.severity === 'error').map(f => f.message), ...(p.existing.ok ? [] : ['existing'])].slice(0, 2).join(' | ')) : 'no plan: ' + p.reason
  }
  
  assert.equal(run(4, 3, 5, 4, 1, 1), 'VALID')
  assert.equal(run(4, 3, 5, 4, 1, 2), 'VALID')
  // a frame too small for the rooms asked for is reported with the reason, never silently accepted
  assert.match(run(3, 3, 5, 4, 1, 1), /under its/)
})
