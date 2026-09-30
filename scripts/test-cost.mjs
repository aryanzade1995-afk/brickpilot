import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { budgetStatus, costPerSqmAllIn, estimateCost } from '../src/lib/cost/index.ts'
import { FAMILY_FACTOR, FINISH_RATE_PER_SQM, STYLE_FACTOR, constructionRate } from '../src/lib/cost/rates.ts'
import { areaNeeded, assessBudgetFit, maxAffordableSqm, suggestCuts } from '../src/lib/cost/budgetFit.ts'
import { briefSchema } from '../src/lib/model/brief.ts'
import { suggestRooms } from '../src/lib/model/household.ts'

/* Cost from the budget's finish level (T6). */

const design = generate(compile(defaultBrief()))
/** re-cost the SAME verified design under a different budget answer */
const costWith = (budget) => {
  const d = structuredClone(design)
  Object.assign(d.model.brief.budget, budget)
  return estimateCost(d)
}

test('for the same design, mid costs more than basic and less than premium', () => {
  const [basic, mid, premium] = ['basic', 'mid', 'premium'].map((finish) => costWith({ finish }).expected)
  assert.ok(basic < mid && mid < premium, `${basic} < ${mid} < ${premium}`)
})

test('interiors and all-inclusive scopes add their own lines and cost more', () => {
  const construction = costWith({ scope: 'construction' })
  const interiors = costWith({ scope: 'withInteriors' })
  const all = costWith({ scope: 'all' })
  assert.ok(interiors.expected > construction.expected)
  assert.ok(all.expected > interiors.expected)
  const labels = (c) => c.lines.map((l) => l.label)
  assert.ok(!labels(construction).includes('Interiors'))
  assert.ok(labels(interiors).includes('Interiors'))
  assert.ok(!labels(interiors).includes('Landscaping + compound wall'))
  assert.ok(labels(all).includes('Interiors') && labels(all).includes('Landscaping + compound wall'))
  for (const c of [construction, interiors, all]) {
    assert.ok(labels(c).includes('External works allowance') && labels(c).includes('Professional fees allowance') && labels(c).includes('Contingency'))
    assert.equal(c.expected, (c.total.low + c.total.high) / 2)
  }
  assert.ok(construction.excluded.some((x) => x.startsWith('Interiors')))
  assert.ok(interiors.included.some((x) => x.startsWith('Interiors')))
})

test('budget status: within, tight and over', () => {
  const expected = costWith({}).expected
  const lakh = (inr) => inr / 1e5
  const within = costWith({ amountLakh: lakh(expected / 0.85) }).budget
  const tight = costWith({ amountLakh: lakh(expected / 0.95) }).budget
  const over = costWith({ amountLakh: lakh(expected * 0.8) }).budget
  assert.equal(within.status, 'within')
  assert.equal(tight.status, 'tight')
  assert.equal(over.status, 'over')
  assert.ok(within.deltaInr > 0 && over.deltaInr < 0)
  assert.ok(Math.abs(over.amountInr - expected * 0.8) < 1, 'lakh → INR')
  // exact thresholds
  assert.equal(budgetStatus(90, 100), 'within')
  assert.equal(budgetStatus(100, 100), 'tight')
  assert.equal(budgetStatus(100.01, 100), 'over')
})

test('style is a small modifier: the finish level sets the rate, style moves it at most -10% / +30%', () => {
  for (const f of Object.values(STYLE_FACTOR)) assert.ok(f >= 0.9 && f <= 1.3)
  const b = defaultBrief()
  b.style.character = 'luxury-indian'
  assert.ok(constructionRate(b) <= FINISH_RATE_PER_SQM.mid * 1.3)
  assert.equal(constructionRate(defaultBrief()), FINISH_RATE_PER_SQM.mid, 'mid, G+1, modern-indian, rectangular = the plain mid rate')
  assert.equal(constructionRate(defaultBrief(), 'courtyard'), FINISH_RATE_PER_SQM.mid * FAMILY_FACTOR.courtyard)
})

test('costPerSqmAllIn matches the full estimate per m² and grows with scope', () => {
  const b = design.model.brief
  const c = estimateCost(design)
  const family = design.structure?.family ?? 'rectangular'
  assert.ok(Math.abs(costPerSqmAllIn(b, family) * design.builtAreaSqm - c.expected) < 1, 'same lines, same answer')
  const all = structuredClone(b)
  all.budget.scope = 'all'
  assert.ok(costPerSqmAllIn(all) > costPerSqmAllIn(b))
  assert.ok(costPerSqmAllIn(b) > FINISH_RATE_PER_SQM.mid, 'all-in includes externals, fees and contingency')
})

/* T7: budget fit, checked on the brief before any plan exists */

const withRooms = (b) => {
  const s = suggestRooms(b)
  Object.assign(b.rooms, { bedroomsWithBath: s.bedroomsWithBath, bedroomsNoBath: s.bedroomsNoBath, sharedBaths: s.sharedBaths, studies: s.studies })
  return b
}
const caseA = (amountLakh = 80) => withRooms(briefSchema.parse({
  site: { plotWidth: 18, plotDepth: 24 },
  household: { members: ['adult', 'adult', 'senior', 'senior', 'teen', 'child'].map((role) => ({ role })) },
  lifestyle: { wfhCount: 1 },
  budget: { amountLakh },
}))

test('calibration: areaNeeded target is within ±20% of the built-up area actually generated', () => {
  const briefs = {
    'default 15x18 G+1': briefSchema.parse({}),
    'case A 18x24 G+1': caseA(),
    'couple G+0': withRooms(briefSchema.parse({ site: { plotWidth: 18, plotDepth: 24 }, levels: { storeys: 0 }, household: { members: [{ role: 'adult' }, { role: 'adult' }] } })),
    'big family G+2': briefSchema.parse({ site: { plotWidth: 25, plotDepth: 30 }, levels: { storeys: 2 }, rooms: { bedroomsWithBath: 4, bedroomsNoBath: 1, sharedBaths: 2, studies: 2 } }),
    'large villa G+1': briefSchema.parse({ project: { buildingType: 'large-villa' }, site: { plotWidth: 30, plotDepth: 40 }, rooms: { bedroomsWithBath: 4, bedroomsNoBath: 0, studies: 1 } }),
    'narrow 10x30 G+2': briefSchema.parse({ site: { plotWidth: 10, plotDepth: 30 }, levels: { storeys: 2 } }),
  }
  for (const [name, b] of Object.entries(briefs)) {
    const built = generate(compile(b)).builtAreaSqm
    const { minSqm, targetSqm } = areaNeeded(b)
    assert.ok(minSqm < targetSqm, name)
    assert.ok(Math.abs(targetSqm / built - 1) <= 0.2, `${name}: needs ${targetSqm} m², generated ${built} m²`)
  }
})

test('case A fits an 80 lakh budget comfortably', () => {
  const fit = assessBudgetFit(caseA())
  assert.equal(fit.status, 'comfortable', fit.message)
  assert.ok(fit.targetSqm <= fit.maxSqm)
  assert.match(fit.message, /^Your rooms need about \d+ m²; ₹80 L covers about \d+ m² at mid-range finish\.$/)
  assert.deepEqual(suggestCuts(caseA()), [], 'nothing to cut')
})

test('case B (60 lakh) is not comfortable, and 1-3 suggested cuts make it comfortable', () => {
  const b = caseA(60)
  assert.notEqual(assessBudgetFit(b).status, 'comfortable')
  const cuts = suggestCuts(b)
  assert.ok(cuts.length >= 1 && cuts.length <= 3, `${cuts.length} cuts`)
  for (const c of cuts) assert.ok(c.label && typeof c.patch === 'function' && c.savesLakh >= 0)
  const after = structuredClone(b)
  for (const c of cuts) c.patch(after)
  assert.equal(assessBudgetFit(after).status, 'comfortable')
  assert.equal(JSON.stringify(b), JSON.stringify(caseA(60)), 'suggestCuts never edits the brief it is given')
})

test('cuts never take a room a senior needs', () => {
  // two seniors need one bedroom with attached bath; a very small budget must not cut it
  const b = caseA(15)
  const seniorsRoomsBefore = Math.ceil(2 / 2)
  const after = structuredClone(b)
  for (const c of suggestCuts(b)) c.patch(after)
  assert.ok(after.rooms.bedroomsWithBath >= seniorsRoomsBefore)
  // even applying the bath cut repeatedly stops at the seniors' room
  const bathCut = { ...b, rooms: { ...b.rooms, bedroomsWithBath: 1 } }
  assert.ok(!suggestCuts(bathCut).some((c) => c.label.startsWith('Share a bathroom')))
})

test('affordable area scales with the budget and falls as the finish rises', () => {
  const b = caseA()
  const double = caseA(160)
  assert.ok(Math.abs(maxAffordableSqm(double) - 2 * maxAffordableSqm(b)) <= 1)
  const premium = structuredClone(b)
  premium.budget.finish = 'premium'
  assert.ok(maxAffordableSqm(premium) < maxAffordableSqm(b))
})