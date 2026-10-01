import assert from 'node:assert/strict'
import test from 'node:test'
import { briefSchema, DIRECTIONS } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { suggestRooms } from '../src/lib/model/household.ts'
import { generate, generateCandidates } from '../src/lib/engine/generate.ts'
import { entryFacing, roomQuadrant, windowFacings } from '../src/lib/engine/orientation.ts'
import { preferenceScore, strictVastuFailures } from '../src/lib/engine/score.ts'
import { validate } from '../src/lib/rules/index.ts'
import { sharedEdge } from '../src/lib/geometry.ts'

/* T8: choose the best-scoring valid plan for the client's preferences. */

const caseA = (vastu = 'prefer', patch = {}) => {
  const b = briefSchema.parse({
    site: { plotWidth: 18, plotDepth: 24 },
    household: { members: ['adult', 'adult', 'senior', 'senior', 'teen', 'child'].map((role) => ({ role })) },
    lifestyle: { wfhCount: 1, vastu },
    ...patch,
  })
  const s = suggestRooms(b)
  Object.assign(b.rooms, { bedroomsWithBath: s.bedroomsWithBath, bedroomsNoBath: s.bedroomsNoBath, sharedBaths: s.sharedBaths, studies: s.studies })
  return compile(b)
}
const vastuSum = (score) => score.terms.filter((t) => t.group === 'vastu').reduce((a, t) => a + t.value, 0)

test('determinism: the same brief and seed choose the same plan twice', () => {
  for (const vastu of ['ignore', 'prefer', 'strict']) {
    const m = caseA(vastu)
    assert.equal(JSON.stringify(generate(m)), JSON.stringify(generate(m)), vastu)
  }
})

test('with Vastu preferred, the chosen plan scores at least as well as every other valid candidate', () => {
  const m = caseA('prefer')
  const { passing } = generateCandidates(m)
  assert.ok(passing.length > 1, 'there is a real choice to make')
  const chosen = generate(m)
  const score = preferenceScore(chosen).total
  for (const c of passing) assert.ok(score >= c.score.total, `${score} >= ${c.score.total}`)
  assert.ok(validate(chosen).hardChecksPass)
  // ties go to the earliest candidate
  const best = Math.max(...passing.map((c) => c.score.total))
  assert.deepEqual(chosen, passing.find((c) => c.score.total === best).design)
})

test('with Vastu ignored, Vastu contributes zero while sun and lifestyle still rank plans', () => {
  const d = generate(caseA('ignore'))
  const s = preferenceScore(d)
  assert.equal(vastuSum(s), 0)
  assert.equal(s.total, Math.round(s.terms.filter((t) => t.group !== 'vastu').reduce((a, t) => a + t.value, 0) * 100) / 100)
  assert.ok(s.terms.every((t) => typeof t.name === 'string' && t.name.length > 0))
})

test('strict Vastu never returns a north-east toilet or a misplaced kitchen when a candidate avoids them', () => {
  for (const variation of [0, 1, 2, 3]) {
    const m = caseA('strict', { variation })
    const { passing } = generateCandidates(m)
    const chosen = generate(m)
    if (passing.some((c) => c.strictOk)) {
      assert.deepEqual(strictVastuFailures(chosen), [], `variation ${variation}`)
      assert.ok(!validate(chosen).findings.some((f) => f.code === 'VASTU_STRICT_UNMET'))
    }
  }
})

test('VASTU_STRICT_UNMET is a warning that names what failed', () => {
  const m = caseA('strict')
  const failing = generateCandidates(m).passing.find((c) => !c.strictOk)
  assert.ok(failing, 'Case A has candidates that break strict Vastu')
  const f = validate(failing.design).findings.find((x) => x.code === 'VASTU_STRICT_UNMET')
  assert.equal(f?.severity, 'warning')
  for (const why of strictVastuFailures(failing.design)) assert.ok(f.message.includes(why))
})

test('strict weighs Vastu three times as much as prefer for the same plan', () => {
  const d = generate(caseA('prefer'))
  const strict = structuredClone(d)
  strict.model.brief.lifestyle.vastu = 'strict'
  assert.ok(Math.abs(vastuSum(preferenceScore(strict)) - 3 * vastuSum(preferenceScore(d))) < 1e-9)
})

test('orientation: the main entry faces the road side on every compass heading', () => {
  for (const side of DIRECTIONS) {
    const m = caseA('ignore', { site: { plotWidth: 18, plotDepth: 24, facing: side, roadEdges: [side] } })
    const d = generate(m)
    assert.equal(entryFacing(d), side)
    const q = roomQuadrant(d, 'kitchen')
    assert.ok(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'C'].includes(q))
    for (const f of windowFacings(d, 'kitchen')) assert.ok(DIRECTIONS.includes(f))
  }
})

test('Case A generates in under 1.5 s', () => {
  for (const vastu of ['prefer', 'strict']) {
    const m = caseA(vastu)
    generate(m)
    const t0 = performance.now()
    generate(m)
    const ms = performance.now() - t0
    assert.ok(ms < 1500, `${vastu}: ${ms.toFixed(0)} ms`)
  }
})

/* T9: a home office that clients visit sits on the ground floor beside the foyer */

const levelOf = (d, id) => d.floors.find((f) => f.rooms.some((r) => r.id === id))?.level
const room = (d, id, level = 0) => d.floors[level].rooms.find((r) => r.id === id)

test('case A with client visits: study 1 is on the ground floor, sharing a wall with the foyer', () => {
  const m = caseA('prefer', { lifestyle: { wfhCount: 1, vastu: 'prefer', clientVisits: true } })
  assert.ok(m.floors[0].spaces.some((s) => s.id === 'study1'))
  assert.ok(m.relationships.some((r) => r.a === 'foyer' && r.b === 'study1' && r.kind === 'adjacent'))
  const d = generate(m)
  assert.equal(levelOf(d, 'study1'), 0)
  assert.ok(sharedEdge(room(d, 'study1').rect, room(d, 'foyer').rect), 'study 1 touches the foyer')
  assert.deepEqual(validate(d).findings.filter((f) => f.severity === 'error').map((f) => f.code), [])
})

test('without client visits the study stays upstairs', () => {
  const d = generate(caseA('prefer', { lifestyle: { wfhCount: 1, vastu: 'prefer', clientVisits: false } }))
  assert.ok(levelOf(d, 'study1') > 0)
  assert.ok(validate(d).hardChecksPass)
})

test('client study holds across headings, variations and a second study', () => {
  for (const [facing, variation] of [['N', 0], ['E', 1], ['S', 2], ['W', 3]]) {
    const m = caseA('ignore', {
      site: { plotWidth: 18, plotDepth: 24, facing, roadEdges: [facing] },
      lifestyle: { wfhCount: 2, vastu: 'ignore', clientVisits: true },
      variation,
    })
    const b = m.brief
    const d = generate(m)
    assert.ok(validate(d).hardChecksPass, `${facing}/${variation}`)
    assert.equal(levelOf(d, 'study1'), 0)
    assert.ok(sharedEdge(room(d, 'study1').rect, room(d, 'foyer').rect), `${facing}/${variation}`)
    if (b.rooms.studies > 1) assert.ok(levelOf(d, 'study2') > 0, 'the second study keeps the current rule')
  }
})

test('a study sharing a wall with the living room costs 0.5 when someone works from home', () => {
  const d = generate(caseA('ignore', { lifestyle: { wfhCount: 1, vastu: 'ignore', clientVisits: true } }))
  const noisy = d.floors.flatMap((f) => f.rooms.filter((r) => r.id.startsWith('study')).map((s) =>
    f.rooms.some((l) => (l.id === 'living' || l.id === 'livingDining') && sharedEdge(s.rect, l.rect))))
  const terms = preferenceScore(d).terms.filter((t) => t.name.includes('(noise on calls)'))
  assert.equal(terms.length, noisy.filter(Boolean).length)
  assert.ok(terms.every((t) => t.value === -0.5))
  // no one working from home: no noise term at all
  const quiet = structuredClone(d)
  quiet.model.brief.lifestyle.wfhCount = 0
  assert.equal(preferenceScore(quiet).terms.filter((t) => t.name.includes('(noise on calls)')).length, 0)
})
