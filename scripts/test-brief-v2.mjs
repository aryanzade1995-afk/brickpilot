import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BRIEF_STEPS,
  FINISH_LABEL,
  GUESTS_LABEL,
  KITCHEN_LABEL,
  MEMBER_ROLE_LABEL,
  STAFF_LABEL,
  VASTU_LABEL,
  briefSchema,
  defaultBrief,
  occupantCount,
} from '../src/lib/model/brief.ts'
import { suggestRooms } from '../src/lib/model/household.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { assessBriefFit } from '../src/lib/engine/planner/fit.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { validate } from '../src/lib/rules/index.ts'

/* Brief v2: household and lifestyle questions (schema only). */

test('an empty brief parses with every new field at its default', () => {
  const b = briefSchema.parse({})
  assert.deepEqual(b.household, {
    members: [
      { role: 'adult', needsGroundFloor: false },
      { role: 'adult', needsGroundFloor: false },
      { role: 'child', needsGroundFloor: false },
      { role: 'child', needsGroundFloor: false },
    ],
    guests: 'occasional',
    staff: 'none',
  })
  assert.deepEqual(b.lifestyle, { kitchen: 'semi', dryWetSplit: false, wfhCount: 0, clientVisits: false, vastu: 'prefer' })

  assert.equal(occupantCount(b), 4)
  // default members are fresh objects, never a shared array
  const other = defaultBrief()
  other.household.members[0].role = 'senior'
  assert.equal(briefSchema.parse({}).household.members[0].role, 'adult')
})

test('a brief saved before household / lifestyle existed still loads', () => {
  const old = {
    project: { name: 'Old house', buildingType: 'villa' },
    site: { plotWidth: 15, plotDepth: 18, facing: 'N', roadEdges: ['N'], setbacks: { N: 3, E: 1.2, S: 2, W: 1.2 } },
    spaces: { occupants: 6, stepFree: true, livingDining: 'combined' },
    levels: { storeys: 1, floorToFloor: 3.1, stairWidth: 1000, liftProvision: false },
    rooms: { bedroomsWithBath: 3, bedroomsNoBath: 0, sharedBaths: 1, studies: 0, balcony: true, priorities: {} },
    style: { character: 'modern-indian', massing: 'auto', diversity: 'medium' },
    entry: { primarySide: 'auto', mainDoorWidth: 1200 },
    variation: 2,
  }
  const r = briefSchema.safeParse(old)
  assert.ok(r.success, r.success ? '' : r.error.message)
  assert.equal(r.data.spaces.occupants, 6, 'the legacy occupant count is kept')
  assert.equal(r.data.rooms.bedroomsWithBath, 3)
  assert.equal(r.data.household.members.length, 4)
  assert.equal(r.data.lifestyle.vastu, 'prefer')

})

test('a senior defaults to needing the ground floor; an explicit answer wins', () => {
  const b = briefSchema.parse({ household: { members: [{ role: 'senior' }, { role: 'adult' }, { role: 'senior', needsGroundFloor: false }] } })
  assert.deepEqual(b.household.members.map((m) => m.needsGroundFloor), [true, false, false])
  assert.equal(occupantCount(b), 3)
})

test('new fields are range-checked', () => {
  assert.ok(!briefSchema.safeParse({ household: { members: [] } }).success, 'at least one member')
  assert.ok(!briefSchema.safeParse({ household: { members: Array(21).fill({ role: 'adult' }) } }).success, 'at most 20')
  assert.ok(!briefSchema.safeParse({ lifestyle: { wfhCount: 5 } }).success)


})

test('every new enum has a label map, and the wizard keeps its 8 steps', () => {
  for (const map of [MEMBER_ROLE_LABEL, GUESTS_LABEL, STAFF_LABEL, KITCHEN_LABEL, VASTU_LABEL, FINISH_LABEL])
    assert.ok(Object.values(map).every((v) => typeof v === 'string' && v.length > 0))
  assert.equal(BRIEF_STEPS.length, 8)
  assert.equal(BRIEF_STEPS.find((s) => s.key === 'spaces').label, 'Household')
})

/* suggestRooms: household answers → room programme */

const household = (roles, { guests = 'occasional', wfhCount = 0 } = {}) =>
  briefSchema.parse({ household: { members: roles.map((role) => ({ role })), guests }, lifestyle: { wfhCount } })
const counts = ({ bedroomsWithBath, bedroomsNoBath, sharedBaths, studies }) => ({ bedroomsWithBath, bedroomsNoBath, sharedBaths, studies })

test('case A: couple, two seniors, a teen and a child', () => {
  const s = suggestRooms(household(['adult', 'adult', 'senior', 'senior', 'teen', 'child'], { wfhCount: 1 }))
  assert.deepEqual(counts(s), { bedroomsWithBath: 2, bedroomsNoBath: 2, sharedBaths: 1, studies: 1 })
  assert.ok(s.reasons.length > 0)
  assert.ok(s.reasons.includes('2 seniors → 1 ground-floor bedroom with attached bath'), s.reasons.join(' | '))
  assert.ok(s.reasons.every((r) => typeof r === 'string' && r.length > 0))
})

test('a single adult gets the master bedroom and a study for occasional guests', () => {
  const s = suggestRooms(household(['adult']))
  assert.deepEqual(counts(s), { bedroomsWithBath: 1, bedroomsNoBath: 0, sharedBaths: 1, studies: 1 })
  assert.ok(s.reasons.some((r) => r.includes('study doubles')))
})

test('an infant sleeps with the parents and adds no room', () => {
  const s = suggestRooms(household(['adult', 'adult', 'infant']))
  assert.deepEqual(counts(s), { bedroomsWithBath: 1, bedroomsNoBath: 0, sharedBaths: 1, studies: 1 })
  assert.ok(s.reasons.some((r) => r.includes('infant') && r.includes('no separate room')))
})

test('four adults with frequent guests: couple + 2 further adults + a guest room, no study', () => {
  const s = suggestRooms(household(['adult', 'adult', 'adult', 'adult'], { guests: 'frequent' }))
  assert.deepEqual(counts(s), { bedroomsWithBath: 4, bedroomsNoBath: 0, sharedBaths: 1, studies: 0 })
  assert.ok(s.reasons.some((r) => r.includes('guest bedroom')))
})

test('suggestRooms is pure: same answer twice, the brief untouched, results within schema limits', () => {
  const b = household(Array(20).fill('adult'), { guests: 'frequent', wfhCount: 4 })
  const before = JSON.stringify(b)
  const s = suggestRooms(b)
  assert.deepEqual(suggestRooms(b), s)
  assert.equal(JSON.stringify(b), before)
  assert.equal(s.bedroomsWithBath, 8, 'capped at the schema maximum')
  assert.equal(s.studies, 2, 'at most two studies')
  assert.ok(s.reasons.some((r) => r.startsWith('Capped bedroomsWithBath')))
  // the suggestion always fits back into the brief
  assert.ok(briefSchema.safeParse({ rooms: counts(s) }).success)
})

/* ground-floor bedrooms for members who need them (compile + hard check) */

const caseA = () => {
  const b = household(['adult', 'adult', 'senior', 'senior', 'teen', 'child'], { wfhCount: 1 })
  Object.assign(b.rooms, counts(suggestRooms(b)))
  return b
}
const bedrooms = (floor) => floor.spaces.filter((s) => s.zone === 'private')
const attachedBath = (model, bedId) =>
  model.relationships.some((r) => r.kind === 'adjacent' && r.a === bedId && /^bath\d/.test(r.b))

test('case A: 1 ground-floor parents bedroom with attached bath, 3 bedrooms upstairs', () => {
  const b = caseA()
  const m = compile(b)
  const [ground, upper] = m.floors
  assert.equal(bedrooms(ground).length, 1)
  const parents = bedrooms(ground)[0]
  assert.equal(parents.name, "Parents' bedroom")
  assert.equal(parents.role, 'parents')
  assert.ok(attachedBath(m, parents.id), 'the parents bedroom takes the first attached bath')
  assert.equal(bedrooms(upper).length, 3)
  const master = bedrooms(upper).find((s) => s.role === 'master')
  assert.equal(master?.name, 'Master bedroom', 'the first upper-floor bedroom is the master')
  assert.ok(attachedBath(m, master.id))
  assert.equal(m.floors.flatMap((f) => f.spaces).filter((s) => s.role === 'master').length, 1)
  // the parents room uses the master-bedroom area preset
  assert.deepEqual([parents.min, parents.target, parents.max], [master.min, master.target, master.max])
  assert.equal(assessBriefFit(b).fits, validate(generate(compile(b))).hardChecksPass, 'packing alone must not approve an invalid plan')
})

test('case A generates a plan that passes every hard check', () => {
  const b = caseA()
  b.site.plotWidth = 18
  b.site.plotDepth = 24
  const r = validate(generate(compile(b)))
  assert.deepEqual(r.findings.filter((f) => f.severity === 'error').map((f) => f.code), [])
})

test('with no one needing the ground floor, an upper-storey house keeps 0 ground bedrooms', () => {
  const b = household(['adult', 'adult', 'teen', 'child'])
  b.levels.storeys = 1
  const m = compile(b)
  assert.equal(bedrooms(m.floors[0]).length, 0)
  assert.equal(bedrooms(m.floors[1])[0].role, 'master')
})

test('ground-floor senior rooms are capped at the bedrooms the brief asks for', () => {
  const b = household(['senior', 'senior', 'senior', 'senior', 'senior'])
  b.rooms.bedroomsWithBath = 1
  b.rooms.bedroomsNoBath = 0
  const m = compile(b)
  assert.equal(bedrooms(m.floors[0]).length, 1, 'ceil(5 / 2) = 3 wanted, only 1 bedroom exists')
  assert.equal(bedrooms(m.floors[1]).length, 0)
})

test('GROUND_FLOOR_BEDROOM_MISSING is a hard error when a senior has no ground bedroom with a bath', () => {
  const b = household(['adult', 'senior'])
  b.site.plotWidth = 18
  b.site.plotDepth = 24
  b.rooms.bedroomsWithBath = 0
  b.rooms.bedroomsNoBath = 2
  const r = validate(generate(compile(b)))
  assert.ok(!r.hardChecksPass)
  assert.ok(r.findings.some((f) => f.code === 'GROUND_FLOOR_BEDROOM_MISSING' && f.severity === 'error'))
  // with a bedroom-with-bath available, the senior's room takes it and the check clears
  b.rooms.bedroomsWithBath = 1
  b.rooms.bedroomsNoBath = 1
  const ok = validate(generate(compile(b)))
  assert.ok(!ok.findings.some((f) => f.code === 'GROUND_FLOOR_BEDROOM_MISSING'))
})