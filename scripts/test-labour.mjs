import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { estimateBoq } from '../src/lib/cost/boq.ts'
import { estimateSiteLabour, resolveCityWageBenchmark } from '../src/lib/cost/labour.ts'
import { defaultSelection } from '../src/lib/cost/specifications.ts'
import { validatedLabour } from '../src/lib/cost/data/validated.ts'

const close = (a, b, epsilon = 1e-4) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`)

test('Site Labour: Duration formula matches specification sanity check (2,500 sqft standard)', () => {
  // Sanity check from spec:
  // 2,500 sqft standard 1 storey: 2,500 * 0.6 * 1.0 * 1.0 = 1500 person-days -> ceil(1500/6) = 250 days (~9.6 months)
  const calc1 = estimateSiteLabour(2500, 'standard', 1, { crewSize: 6 })
  assert.equal(calc1.personDays, 1500)
  assert.equal(calc1.workingDays, 250)
  close(calc1.workingMonths, 250 / 26, 0.1)

  // 2 storeys: 2,500 * 0.6 * 1.0 * 1.05 = 1575 person-days -> ceil(1575/6) = 263 days (~10.1 months)
  const calc2 = estimateSiteLabour(2500, 'standard', 2, { crewSize: 6 })
  assert.equal(calc2.personDays, 1575)
  assert.equal(calc2.workingDays, 263)
  close(calc2.workingMonths, 263 / 26, 0.1)
})

test('Site Labour: Blended rate calculation adheres to 1:2 skilled:unskilled mix', () => {
  const d = validatedLabour.defaults
  assert.equal(d.skilledDailyRate, 1100)
  assert.equal(d.unskilledDailyRate, 600)
  close(d.skilledShare, 1 / 3, 1e-4)

  const calc = estimateSiteLabour(2000, 'standard', 1)
  // (1/3)*1100 + (2/3)*600 = 366.67 + 400 = 766.67
  close(calc.blendedDailyRate, 766.67, 0.05)
  close(calc.dailyCrewCost, 6 * 766.67, 0.5)
})

test('Site Labour: Days override takes precedence over calculated days', () => {
  const calcAuto = estimateSiteLabour(2500, 'standard', 1, { crewSize: 6 })
  assert.equal(calcAuto.workingDays, 250)

  const calcOverride = estimateSiteLabour(2500, 'standard', 1, { crewSize: 6, daysOverride: 180 })
  assert.equal(calcOverride.workingDays, 180)
  assert.equal(calcOverride.daysOverride, 180)
  assert.equal(calcOverride.siteLabourTotal, Math.round(180 * calcOverride.dailyCrewCost))
})

test('Site Labour: Monotonic behavior across area and crew size', () => {
  // More area gives more days (same crew)
  const small = estimateSiteLabour(1500, 'standard', 1, { crewSize: 6 })
  const medium = estimateSiteLabour(2500, 'standard', 1, { crewSize: 6 })
  const large = estimateSiteLabour(4000, 'standard', 1, { crewSize: 6 })
  assert.ok(small.workingDays < medium.workingDays)
  assert.ok(medium.workingDays < large.workingDays)

  // Larger crew gives fewer days but identical person-days
  const crew4 = estimateSiteLabour(2500, 'standard', 1, { crewSize: 4 })
  const crew8 = estimateSiteLabour(2500, 'standard', 1, { crewSize: 8 })
  assert.equal(crew4.personDays, crew8.personDays)
  assert.ok(crew8.workingDays < crew4.workingDays)
})

test('Site Labour: Full estimate reconciliation in "additional" mode', () => {
  const brief = defaultBrief()
  const design = generate(compile(brief))
  const sel = defaultSelection()
  assert.equal(sel.labourMode, 'additional')

  const cost = estimateBoq(design, brief, sel)

  // Labour object populated
  assert.ok(cost.labour)
  assert.equal(cost.labour.mode, 'additional')
  assert.ok(cost.labour.siteLabourTotal > 0)
  assert.ok(cost.labour.workingDays > 0)
  assert.ok(cost.labour.workingMonths > 0)

  // Line item present
  const labourLine = cost.lines.find(l => l.label === 'Site labour (crew-days)')
  assert.ok(labourLine)
  assert.equal(labourLine.expected, cost.labour.siteLabourTotal)

  // Reconciliation: sum of all lines equals expected total
  const sumLines = cost.lines.reduce((n, l) => n + l.expected, 0)
  close(cost.expected, sumLines, 0.01)

  // Procurement breakdown reconciles
  close(
    cost.procurement.material + cost.procurement.labour + cost.procurement.overhead + cost.procurement.projectAddOns,
    cost.expected,
    0.01,
  )
  close(cost.procurement.turnkey + cost.procurement.projectAddOns, cost.expected, 0.01)

  // Scope totals reconcile
  if (cost.scopeTotals) {
    close(cost.scopeTotals.construction + cost.scopeTotals.interiors, cost.expected, 0.01)
  }
})

test('Site Labour: Full estimate reconciliation in "replace" mode', () => {
  const brief = defaultBrief()
  const design = generate(compile(brief))
  const sel = { ...defaultSelection(), labourMode: 'replace' }

  const cost = estimateBoq(design, brief, sel)

  assert.ok(cost.labour)
  assert.equal(cost.labour.mode, 'replace')

  // Line item present
  const labourLine = cost.lines.find(l => l.label === 'Site labour (crew-days)')
  assert.ok(labourLine)
  assert.equal(labourLine.expected, cost.labour.siteLabourTotal)

  // Works line reflects deduction of embedded labour
  const worksLine = cost.lines[0]
  assert.equal(worksLine.label, 'Measured works & materials')
  const directWorks = cost.boq.reduce((n, l) => n + l.amount, 0)
  close(worksLine.expected, directWorks - cost.labour.embeddedLabour, 0.01)

  // Reconciliation: sum of all lines equals expected total
  const sumLines = cost.lines.reduce((n, l) => n + l.expected, 0)
  close(cost.expected, sumLines, 0.01)

  // Procurement breakdown reconciles
  close(
    cost.procurement.material + cost.procurement.labour + cost.procurement.overhead + cost.procurement.projectAddOns,
    cost.expected,
    0.01,
  )
  close(cost.procurement.turnkey + cost.procurement.projectAddOns, cost.expected, 0.01)

  // Scope totals reconcile
  if (cost.scopeTotals) {
    close(cost.scopeTotals.construction + cost.scopeTotals.interiors, cost.expected, 0.01)
  }
})

test('Site Labour: Auto mode resolves city benchmark tiers accurately', () => {
  // Pune (Tier 2 default)
  const pune = resolveCityWageBenchmark('Pune')
  assert.equal(pune.city, 'Pune')
  assert.equal(pune.tier, 2)
  assert.equal(pune.skilledDailyRate, 1100)
  assert.equal(pune.unskilledDailyRate, 600)

  // Mumbai (Tier 1)
  const mumbai = resolveCityWageBenchmark('Mumbai')
  assert.equal(mumbai.city, 'Mumbai')
  assert.equal(mumbai.tier, 1)
  assert.equal(mumbai.skilledDailyRate, 1350)
  assert.equal(mumbai.unskilledDailyRate, 750)

  // Nashik (Tier 3)
  const nashik = resolveCityWageBenchmark('Nashik')
  assert.equal(nashik.city, 'Nashik')
  assert.equal(nashik.tier, 3)
  assert.equal(nashik.skilledDailyRate, 950)
  assert.equal(nashik.unskilledDailyRate, 500)

  // Rural (Tier 4)
  const rural = resolveCityWageBenchmark('rural')
  assert.equal(rural.tier, 4)

  // Unknown city falls back cleanly to Pune / Tier 2
  const fallback = resolveCityWageBenchmark('Unknown City 123')
  assert.equal(fallback.city, 'Pune')
  assert.equal(fallback.tier, 2)

  // Auto estimation with city
  const calcMumbai = estimateSiteLabour(2500, 'standard', 1, { wageMode: 'auto', city: 'Mumbai' })
  assert.equal(calcMumbai.wageMode, 'auto')
  assert.equal(calcMumbai.city, 'Mumbai')
  // (1/3)*1350 + (2/3)*750 = 450 + 500 = 950
  close(calcMumbai.blendedDailyRate, 950, 0.01)
  assert.ok(calcMumbai.wageSourceLabel.includes('Mumbai benchmark'))
})

test('Site Labour: Manual mode with customDailyWage overrides blended rate', () => {
  const customWage = 650
  const calc = estimateSiteLabour(2500, 'standard', 1, {
    wageMode: 'manual',
    customDailyWage: customWage,
    crewSize: 6,
  })

  assert.equal(calc.wageMode, 'manual')
  assert.equal(calc.blendedDailyRate, customWage)
  assert.equal(calc.customDailyWage, customWage)
  assert.equal(calc.dailyCrewCost, 6 * customWage)
  assert.equal(calc.siteLabourTotal, calc.workingDays * 6 * customWage)
  assert.ok(calc.wageSourceLabel.includes('Manual rate'))
  assert.ok(calc.note.includes('Manual rate'))
})

test('Site Labour: Full BOQ estimate reconciliation with Manual wage override', () => {
  const brief = defaultBrief()
  const design = generate(compile(brief))
  const selAuto = defaultSelection()
  const costAuto = estimateBoq(design, brief, selAuto)

  // With a lower manual contractor rate (e.g. INR 550/day)
  const selManual = { ...defaultSelection(), wageMode: 'manual', customDailyWage: 550 }
  const costManual = estimateBoq(design, brief, selManual)

  assert.equal(costManual.labour.wageMode, 'manual')
  assert.equal(costManual.labour.blendedDailyRate, 550)
  assert.ok(costManual.labour.siteLabourTotal < costAuto.labour.siteLabourTotal)
  assert.ok(costManual.expected < costAuto.expected)

  // Reconciliation: sum of lines equals expected total
  const sumLines = costManual.lines.reduce((n, l) => n + l.expected, 0)
  close(costManual.expected, sumLines, 0.01)

  // Procurement breakdown reconciles
  close(
    costManual.procurement.material + costManual.procurement.labour + costManual.procurement.overhead + costManual.procurement.projectAddOns,
    costManual.expected,
    0.01,
  )
})

