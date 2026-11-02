import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

registerHooks({
  resolve(s, c, next) {
    return s.startsWith('@/')
      ? { url: new URL('../src/' + s.slice(2), import.meta.url).href, shortCircuit: true }
      : next(s, c)
  },
})

const storage = new Map()
globalThis.localStorage = {
  getItem: k => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, v),
  removeItem: k => storage.delete(k),
}
globalThis.window = { localStorage }

const { emptyImpact, parseImpact } = await import('../src/lib/impact/schema.ts')
const {
  housingTopic,
  waterImpact,
  roofHeatComparison,
  carbonImpact,
  pilotImpact,
  analyzeImpact,
  affordableAlternatives,
  calculateEcoSwaps,
  solarYield,
  solarFinancials,
  calculatePmSuryaGharSubsidy,
  accessibilityAudit,
  pmayEligibility,
  communityScale,
  cityRainfallLookup,
  calculateMonthlyWaterBalance,
  calculateImpactScores,
  calculateCarbonBreakdown,
} = await import('../src/lib/impact/analysis.ts')
const { buildImpactSummary } = await import('../src/lib/impact/summary.ts')
const { NATIONAL_STANDARDS, RWH_CITY_THRESHOLDS, lookupCityRwhRule } = await import('../src/lib/impact/data/nationalStandards.ts')
const { createBuildingModel } = await import('../src/lib/engine/buildingModel.ts')
const { defaultBrief } = await import('../src/lib/model/brief.ts')
const { compile } = await import('../src/lib/model/canonical.ts')
const { generate } = await import('../src/lib/engine/generate.ts')
const { estimateBoq } = await import('../src/lib/cost/boq.ts')
const { validate } = await import('../src/lib/rules/index.ts')
const { useSocialImpact } = await import('../src/state/socialImpact.ts')
const { useStudio } = await import('../src/state/studio.ts')
const { useProjects, applyCore, parseCore } = await import('../src/state/projects.ts')
const { translate } = await import('../src/lib/i18n/index.ts')

// Base Sample Project
const brief = defaultBrief()
brief.site.plotWidth = 25
brief.site.plotDepth = 30
const design = generate(compile(brief), { seed: 41 })
const cost = estimateBoq(design)
const report = validate(design)

test('unknown inputs remain unknown; schema rejects unsupported versions, nonfinite values and duplicate factors', () => {
  const doc = emptyImpact()
  assert.equal(waterImpact(doc.water, 'key').litres, null)
  assert.equal(roofHeatComparison({ roofAreaM2: 0, standardRoofU: 2, coolRoofU: 0.5, temperatureDifferenceK: 15 }), null)
  assert.equal(parseImpact({ ...doc, version: 2 }), null)
  assert.equal(parseImpact({ ...doc, budgetInr: Infinity }), null)
  assert.equal(parseImpact({ ...doc, water: { ...doc.water, runoff: 1.1 } }), null)
  const factor = { lineId: 'line', specId: 'a', unit: 'm²', low: 1, high: 2, source: 'EPD', boundary: 'A1-A3', geometryKey: 'key' }
  assert.equal(parseImpact({ ...doc, carbon: [factor, factor] }), null)
})

test('water reuses the shared loss-once calculation, conserves mass, supports zero and marks old roof inputs for review', () => {
  const w = { ...emptyImpact().water, rainfallMm: 10, areaM2: 100, runoff: 0.8, efficiency: 0.9, capacityL: 500, dailyDemandL: 100, source: 'Entered event', geometryKey: 'key' }
  const a = waterImpact(w, 'key')
  assert.equal(a.litres, 720)
  assert.equal(a.storage.overflowLitres, 220)
  assert.equal(a.storage.servedLitres, 100)
  assert.equal(a.storage.storageLitres, 400)
  assert.equal(a.litres, a.storage.storageLitres + a.storage.servedLitres + a.storage.overflowLitres)
  const zero = waterImpact({ ...w, rainfallMm: 0 }, 'key')
  assert.equal(zero.litres, 0)
  assert.equal(zero.storage.unmetLitres, 100)
  assert.equal(waterImpact(w, 'different-roof').litres, null)
  assert.equal(waterImpact({ ...w, source: '' }, 'key').litres, null)
})

test('roof comparison is only U area delta-T conduction; zero is real and no temperature reduction is inferred', () => {
  const c = { roofAreaM2: 100, standardRoofU: 2, coolRoofU: 0.5, temperatureDifferenceK: 10 }
  const res = roofHeatComparison(c)
  assert.equal(res.standardW, 2000)
  assert.equal(res.coolW, 500)
  assert.equal(res.differenceW, 1500)
  assert.equal(res.percentReduction, 75)
  assert.equal(roofHeatComparison({ ...c, temperatureDifferenceK: 0 }).differenceW, 0)
  assert.equal(roofHeatComparison({ ...c, roofAreaM2: 0 }), null)
})

test('carbon quantities match unit, specification and source geometry; mixed life-cycle boundaries never form one total', () => {
  const doc = emptyImpact()
  const [a, b] = cost.boq
  const factor = l => ({ lineId: l.id, specId: l.specId, unit: l.unit, low: 1, high: 2, source: 'User-entered EPD', boundary: 'A1-A3', geometryKey: cost.quantities.geometryKey })
  doc.carbon = [factor(a)]
  assert.equal(carbonImpact(cost, doc).low, a.quantity)
  for (const patch of [{ unit: 'incompatible' }, { geometryKey: 'different' }, { specId: 'different-product' }]) {
    const next = { ...doc, carbon: [{ ...doc.carbon[0], ...patch }] }
    assert.equal(carbonImpact(cost, next).covered, 0)
  }
  doc.carbon.push({ ...factor(b), boundary: 'A1-A5' })
  assert.equal(carbonImpact(cost, doc).mixedBoundaries, true)
  assert.equal(carbonImpact(cost, doc).low, null)
})

test('only the latest anonymous household outcome counts; evidence and comparable scope are required for reported benefits', () => {
  const doc = emptyImpact()
  const base = { householdCode: 'HH-1', date: '2026-10-01', stage: 'supported', evidence: 'Site note', baselineCostInr: 100, actualCostInr: 80, sameScope: true, measuredWaterL: 100, resilienceNote: 'Observed after rainfall' }
  doc.pilots = [{ ...base, id: '1' }, { ...base, id: '2', householdCode: 'hh-1', date: '2026-10-02', actualCostInr: 110, measuredWaterL: 120 }, { ...base, id: '3', householdCode: 'HH-2', evidence: '' }]
  const a = pilotImpact(doc)
  assert.equal(a.households, 1)
  assert.equal(a.costDifference, -10)
  assert.equal(a.measuredWaterL, 120)
  doc.pilots[1].sameScope = false
  assert.equal(pilotImpact(doc).costRecords, 0)
  assert.equal(pilotImpact(emptyImpact()).households, 0)
})

test('whole-building analysis and material comparisons are deterministic and cannot change quantities, architecture, selections or costs', () => {
  const before = JSON.stringify({ design, brief, cost, report })
  const doc = emptyImpact()
  const a = analyzeImpact(design, brief, cost, report, doc)
  const b = analyzeImpact(design, brief, cost, report, doc)
  assert.deepEqual(a, b)
  assert.equal(JSON.stringify({ design, brief, cost, report }), before)
  assert.ok(a.checks.some(c => c.id === 'flood' && c.status === 'Not checked'))
  for (const row of affordableAlternatives(cost)) {
    assert.ok(row.difference > 0)
    assert.equal(cost.boq.find(l => l.id === row.lineId).quantity, row.quantity)
  }
})

test('impact inputs survive project save, reload, switching, duplication and version restore without changing accepted design state', () => {
  useProjects.setState({ items: [], currentId: null, stage: 'concept' })
  useStudio.setState({ brief, result: null, pinned: null, layout: null, existing: null })
  useStudio.getState().run()
  const before = useStudio.getState()
  const doc = emptyImpact()
  doc.budgetInr = 2500000
  assert.ok(useSocialImpact.getState().update(doc))
  const saved = useProjects.getState().save({ name: 'Community pilot' })
  assert.ok(saved)
  assert.equal(useStudio.getState().result, before.result)
  assert.equal(useStudio.getState().pinned, before.pinned)
  assert.deepEqual(saved.core.socialImpact, doc)
  applyCore(parseCore(JSON.parse(JSON.stringify(saved.core))))
  assert.deepEqual(useSocialImpact.getState().document, doc)
  const changed = { ...doc, budgetInr: 2600000 }
  useSocialImpact.getState().update(changed)
  useProjects.getState().save({ label: 'Updated budget' })
  const project = useProjects.getState().items.find(p => p.id === saved.id)
  const version = project.versions.find(v => v.core.socialImpact.budgetInr === 2500000)
  assert.ok(useProjects.getState().restore(saved.id, version.id))
  assert.equal(useSocialImpact.getState().document.budgetInr, 2500000)
  const copy = useProjects.getState().duplicate(saved.id)
  assert.ok(copy)
  useProjects.getState().startNew()
  assert.equal(useSocialImpact.getState().document, null)
  useProjects.getState().open(copy)
  assert.equal(useSocialImpact.getState().document.budgetInr, 2500000)
  const legacy = { ...saved.core }
  delete legacy.socialImpact
  applyCore(parseCore(legacy))
  assert.equal(useSocialImpact.getState().document, null)
  const original = useSocialImpact.getState().document
  assert.equal(useSocialImpact.getState().update({ ...doc, budgetInr: -1 }), false)
  assert.equal(useSocialImpact.getState().document, original)
})

test('all views and housing-guidance responses support Hindi and Marathi through the existing language system', () => {
  for (const key of [
    'Social Impact',
    'Affordable housing',
    'Climate-smart homes',
    'Water conservation',
    'Sustainable construction',
    'Home safety',
    'Inclusive housing',
    'Community housing',
    'Housing assistant',
    'Essential tools',
    'Impact dashboard',
    'Building intelligence',
    'Pilot outcomes',
    'Compare measured finish lines first. Review product performance and local quotations before choosing a lower-cost option.',
  ]) {
    for (const language of ['hi', 'mr']) {
      assert.notEqual(translate(key, language), key)
    }
  }
})

test('guidance recognizes natural Hindi and Marathi word forms and never guesses an unrelated topic', () => {
  assert.equal(housingTopic('How can I lower costs?'), 'affordability')
  assert.equal(housingTopic('पाण्याची बचत कशी करू?'), 'water')
  assert.equal(housingTopic('निर्माण की लागत कम करनी है'), 'affordability')
  assert.equal(housingTopic('वायुवीजन कसे सुधारावे?'), 'climate')
  assert.equal(housingTopic('व्हीलचेअर प्रवेश'), 'access')
  assert.equal(housingTopic('Hello there'), null)
  assert.equal(housingTopic('chair'), null)
  assert.equal(housingTopic('stairs'), 'access')
})

test('working impact inputs rehydrate defensively and blocked storage is reported without pretending they were saved', async () => {
  const doc = emptyImpact()
  doc.budgetInr = 123456
  useSocialImpact.getState().update(doc)
  useSocialImpact.setState({ document: null })
  storage.set('formstead.social-impact.v1', JSON.stringify({ state: { document: doc }, version: 0 }))
  await useSocialImpact.persist.rehydrate()
  assert.equal(useSocialImpact.getState().document.budgetInr, 123456)
  storage.set('formstead.social-impact.v1', JSON.stringify({ state: { document: { version: 99 } }, version: 0 }))
  await useSocialImpact.persist.rehydrate()
  assert.equal(useSocialImpact.getState().document, null)
  const original = localStorage.setItem
  localStorage.setItem = () => { throw new Error('Storage full') }
  try {
    assert.equal(useSocialImpact.getState().update(doc), false)
    assert.match(useSocialImpact.getState().error, /storage/i)
    assert.equal(useSocialImpact.getState().document.budgetInr, 123456)
  } finally {
    localStorage.setItem = original
    useSocialImpact.getState().clear()
  }
})

test('city rainfall lookup resolves Indian meteorological data with fallback', () => {
  assert.equal(cityRainfallLookup('Pune').annualRainfallMm, 750)
  assert.equal(cityRainfallLookup('Mumbai').annualRainfallMm, 2200)
  assert.equal(cityRainfallLookup('delhi ncr').annualRainfallMm, 650)
  assert.equal(cityRainfallLookup('Unknown City').annualRainfallMm, 800)
})

test('calculateEcoSwaps finds lower-rate alternatives with positive rupee savings and embodied carbon delta', () => {
  const swaps = calculateEcoSwaps(cost)
  for (const swap of swaps) {
    assert.ok(swap.rupeeSaving > 0)
    assert.ok(swap.quantity > 0)
    assert.ok(typeof swap.isLowerCarbon === 'boolean')
    assert.ok(typeof swap.kgCo2eSaving === 'number')
  }
})

test('PM Surya Ghar CFA subsidy formula conforms strictly to statutory schedule', () => {
  assert.equal(calculatePmSuryaGharSubsidy(0.5), 15000)
  assert.equal(calculatePmSuryaGharSubsidy(1.0), 30000)
  assert.equal(calculatePmSuryaGharSubsidy(2.0), 60000)
  assert.equal(calculatePmSuryaGharSubsidy(2.5), 69000) // 60,000 + 0.5 * 18,000 = 69,000
  assert.equal(calculatePmSuryaGharSubsidy(3.0), 78000)
  assert.equal(calculatePmSuryaGharSubsidy(5.0), 78000) // Capped at 78,000
  assert.equal(calculatePmSuryaGharSubsidy(10.0), 78000) // Capped at 78,000
})

test('solarYield and solarFinancials compute capacity, PM Surya Ghar subsidy and payback periods', () => {
  const s = solarYield(100, 0.70)
  assert.equal(s.usableM2, 70)
  assert.equal(s.kw, 7)
  assert.equal(s.annualKwh, 7 * 1450)
  assert.equal(s.monthlyKwh.length, 12)

  // Tier 3 subsidy for >= 3kW is 78000
  const finSub = solarFinancials(s.kw, s.annualKwh, true)
  assert.equal(finSub.subsidy, 78000)
  assert.ok(finSub.paybackYears !== null && finSub.paybackYears > 0)
  assert.equal(finSub.cashFlow.length, 11)

  // Tier 1 (1kW) and Tier 2 (2kW) subsidies
  assert.equal(solarFinancials(1, 1450, true).subsidy, 30000)
  assert.equal(solarFinancials(2, 2900, true).subsidy, 60000)
  assert.equal(solarFinancials(5, 7250, false).subsidy, 0)
})

test('PMAY-U 2.0 eligibility and vertical carpet ceilings', () => {
  // Below 30m2 statutory minimum
  const belowMin = pmayEligibility(25)
  assert.equal(belowMin.eligible, false)
  assert.equal(belowMin.eligibleVerticals.length, 0)
  assert.match(belowMin.statusText, /below/i)

  // 40m2: Within BLC & AHP (45 sqm cap)
  const blc = pmayEligibility(40)
  assert.equal(blc.eligible, true)
  assert.deepEqual(blc.eligibleVerticals, ['BLC', 'AHP', 'ARH', 'ISS'])

  // 55m2: Exceeds BLC/AHP (45 sqm), within ARH (60 sqm)
  const arh = pmayEligibility(55)
  assert.equal(arh.eligible, true)
  assert.deepEqual(arh.eligibleVerticals, ['ARH', 'ISS'])

  // 90m2: Exceeds ARH (60 sqm), within ISS (120 sqm)
  const iss = pmayEligibility(90)
  assert.equal(iss.eligible, true)
  assert.deepEqual(iss.eligibleVerticals, ['ISS'])

  // 130m2: Above all PMAY-U 2.0 ceilings (120 sqm)
  const aboveAll = pmayEligibility(130)
  assert.equal(aboveAll.eligible, false)
  assert.equal(aboveAll.eligibleVerticals.length, 0)

  // Legacy note verification
  assert.match(blc.legacyNote, /Legacy PMAY-U/i)
  assert.match(blc.legacyNote, /30 m²/i)
})

test('Municipal RWH by-law lookup for listed and unlisted cities', () => {
  // Listed cities - per Requirement 1.3: all RWH cities have verified: false; Pune threshold is 300 m²
  assert.equal(lookupCityRwhRule('Bengaluru').plotThresholdM2, 60)
  assert.equal(lookupCityRwhRule('Bengaluru').verified, false)
  assert.equal(lookupCityRwhRule('Delhi').plotThresholdM2, 100)
  assert.equal(lookupCityRwhRule('Delhi').verified, false)
  assert.equal(lookupCityRwhRule('Pune').plotThresholdM2, 300)
  assert.equal(lookupCityRwhRule('Pune').verified, false)
  assert.equal(lookupCityRwhRule('Mumbai').plotThresholdM2, 300)
  assert.equal(lookupCityRwhRule('Mumbai').verified, false)
  assert.equal(lookupCityRwhRule('Chennai').plotThresholdM2, 0) // Mandatory for all sites
  assert.equal(lookupCityRwhRule('Chennai').verified, false)

  // Unlisted city fallback
  const unlisted = lookupCityRwhRule('Nagpur')
  assert.equal(unlisted.plotThresholdM2, null)
  assert.equal(unlisted.source, 'rule not loaded for this city')
  assert.equal(unlisted.verified, false)
})

test('accessibilityAudit evaluates route doors vs informational secondary doors and handles !ramp safely', () => {
  const bModel = createBuildingModel(design)
  const auditNoRamp = accessibilityAudit(bModel, null)
  assert.ok(['Pass', 'Partial', 'Fail'].includes(auditNoRamp.verdict))
  assert.equal(auditNoRamp.rampStatus, 'absent')
  assert.ok(auditNoRamp.reasons.length > 0)
  assert.ok(auditNoRamp.routeDefinitionNote.toLowerCase().includes('entrance'))

  // Check route doors classification
  for (const door of auditNoRamp.routeDoors) {
    assert.equal(door.isRouteDoor, true)
    assert.equal(door.passes900mm, door.width >= 900)
  }
  for (const door of auditNoRamp.informationalDoors) {
    assert.equal(door.isRouteDoor, false)
  }
  assert.equal(auditNoRamp.routeDoors.length + auditNoRamp.informationalDoors.length, auditNoRamp.totalDoors)
})

test('calculateImpactScores handles missing budget without crashing or producing false 0', () => {
  const scoresNoBudget = calculateImpactScores({
    annualHarvestCoverageDays: 80,
    roofAreaM2: 100,
    ecoCarbonSavingsKg: 500,
    totalEmbodiedKg: 25000,
    floorAreaM2: 120,
    hasBoq: true,
    coolRoofU: 0.5,
    ventilationCount: 4,
    accessVerdict: 'Pass',
    totalDoors: 6,
    budget: null, // missing budget
    costAfterSwaps: 2500000,
  })

  // Affordability sub-score should be marked as needs input and excluded from composite average
  assert.equal(scoresNoBudget.subScores.affordability.status, 'needs input')
  assert.equal(scoresNoBudget.subScores.affordability.score, null)
  assert.equal(scoresNoBudget.activeSubScoresCount, 4)
  assert.ok(scoresNoBudget.composite !== null && scoresNoBudget.composite > 0)
})

test('Single Source of Truth: buildImpactSummary produces matching KPI and Pillar numbers across 3 sample projects', () => {
  // Project 1: Compact plot
  const brief1 = defaultBrief()
  brief1.site.plotWidth = 15
  brief1.site.plotDepth = 20
  const design1 = generate(compile(brief1), { seed: 12 })
  const cost1 = estimateBoq(design1)
  const report1 = validate(design1)
  const doc1 = emptyImpact()
  doc1.budgetInr = 3000000

  // Project 2: Medium Villa plot
  const brief2 = defaultBrief()
  brief2.site.plotWidth = 25
  brief2.site.plotDepth = 30
  const design2 = generate(compile(brief2), { seed: 41 })
  const cost2 = estimateBoq(design2)
  const report2 = validate(design2)
  const doc2 = emptyImpact()
  doc2.budgetInr = 4500000

  // Project 3: Large plot with null budget
  const brief3 = defaultBrief()
  brief3.site.plotWidth = 35
  brief3.site.plotDepth = 40
  const design3 = generate(compile(brief3), { seed: 77 })
  const cost3 = estimateBoq(design3)
  const report3 = validate(design3)
  const doc3 = emptyImpact()
  doc3.budgetInr = null // No target budget set

  const projects = [
    { name: 'Compact', design: design1, brief: brief1, cost: cost1, report: report1, doc: doc1, city: 'Pune' },
    { name: 'Medium Villa', design: design2, brief: brief2, cost: cost2, report: report2, doc: doc2, city: 'Bengaluru' },
    { name: 'Large No-Budget', design: design3, brief: brief3, cost: cost3, report: report3, doc: doc3, city: 'Delhi' },
  ]

  for (const p of projects) {
    const summary = buildImpactSummary({
      design: p.design,
      brief: p.brief,
      cost: p.cost,
      report: p.report,
      document: p.doc,
      cityOverride: p.city,
    })

    // Assert KPI 1: Eco Savings matches Affordability pillar
    assert.equal(
      summary.kpis.affordability.ecoSavingsInr,
      summary.affordability.rupeeSavings,
      `[${p.name}] KPI ecoSavingsInr must equal affordability.rupeeSavings`
    )

    // Assert KPI 2: Water harvest days covers household demand
    assert.equal(
      summary.kpis.water.annualHarvestCoverageDays,
      summary.water.annualHarvestCoverageDays,
      `[${p.name}] KPI waterHarvestDays must equal water.annualHarvestCoverageDays`
    )
    assert.equal(
      summary.kpis.water.annualHarvestL,
      summary.water.annualHarvestL,
      `[${p.name}] KPI annualHarvestL must equal water.annualHarvestL`
    )

    // Assert KPI 3: Climate heat cut watts matches Climate pillar
    assert.equal(
      summary.kpis.climate.heatCutWatts,
      summary.climate.heatCutWatts,
      `[${p.name}] KPI heatCutWatts must equal climate.heatCutWatts`
    )

    // Assert KPI 4: Accessibility verdict matches Accessibility pillar
    assert.equal(
      summary.kpis.accessibility.verdict,
      summary.accessibility.verdict,
      `[${p.name}] KPI accessibilityVerdict must equal accessibility.verdict`
    )

    // Assert water metrics consistency:
    // Metric 1: Annual harvest covers N days
    assert.equal(
      summary.water.annualHarvestCoverageDays,
      Math.round(summary.water.annualHarvestL / summary.water.dailyDemandL)
    )

    // Metric 2: Full tank autonomy
    if (summary.water.tankCapacityL !== null && summary.water.tankCapacityL > 0) {
      assert.equal(
        summary.water.tankAutonomyDays,
        Math.round(summary.water.tankCapacityL / summary.water.dailyDemandL)
      )
    } else {
      assert.equal(summary.water.tankAutonomyDisplay, 'set a tank size')
    }

    // Assert composite score consistency
    if (p.doc.budgetInr === null) {
      assert.equal(summary.scores.subScores.affordability.status, 'needs input')
      assert.equal(summary.scores.subScores.affordability.score, null)
    } else {
      assert.equal(summary.scores.subScores.affordability.status, 'scored')
      assert.ok(typeof summary.scores.subScores.affordability.score === 'number')
    }
  }
})

test('communityScale accurately scales costs, rainwater volumes and carbon savings for multi-household clusters', () => {
  const scale = communityScale(2500000, 10, 500000, 100000, 500, 250000)
  assert.equal(scale.totalCost, 10 * 2500000 + 500000)
  assert.equal(scale.perHomeCost, 2550000)
  assert.equal(scale.totalRainwaterL, 1000000)
  assert.equal(scale.totalCarbonAvoidedTonnes, 5)
  assert.equal(scale.totalRupeesSaved, 2500000)
})

test('calculateMonthlyWaterBalance simulates 12 months with monsoon peak and tanker savings', () => {
  const bal = calculateMonthlyWaterBalance(750, 100, 0.85, 0.80, 540, 10000)
  assert.equal(bal.monthly.length, 12)
  assert.ok(bal.totalHarvestL > 40000)
  assert.ok(bal.tankerTripsSaved > 5)
  assert.ok(bal.tankerSavingsInr > 6000)
  const jul = bal.monthly.find(m => m.month === 'Jul')
  const jan = bal.monthly.find(m => m.month === 'Jan')
  assert.ok(jul.harvestL > jan.harvestL)
})

test('calculateCarbonBreakdown categorizes BOQ materials and yields non-zero total', () => {
  const brk = calculateCarbonBreakdown(cost)
  assert.ok(brk.totalKg > 0)
  assert.ok(brk.items.length > 0)
  const sumPct = brk.items.reduce((acc, i) => acc + i.percentage, 0)
  assert.ok(sumPct >= 98 && sumPct <= 102)
})

test('calculateMonthlyWaterBalance provides month-by-month tank simulation and 80% capture suggestion', () => {
  const sim = calculateMonthlyWaterBalance(800, 120, 0.85, 0.80, 540, 5000)
  assert.ok(sim.usableHarvestLitres > 0)
  assert.ok(sim.overflowLitres >= 0)
  assert.ok(sim.demandCoveredPercent > 0 && sim.demandCoveredPercent <= 100)
  assert.ok(sim.longestDryGapDays >= 0)
  assert.ok(sim.suggestedTankCapacity80Pct > 0)
  assert.equal(sim.monthly.length, 12)

  // Verify simulation conservation: usable harvest + overflow <= total harvest + initial storage
  assert.ok(sim.usableHarvestLitres + sim.overflowLitres <= sim.totalHarvestL + 5000)

  // Longest dry gap should decrease if tank is made significantly larger
  const largeTankSim = calculateMonthlyWaterBalance(800, 120, 0.85, 0.80, 540, 50000)
  assert.ok(largeTankSim.usableHarvestLitres >= sim.usableHarvestLitres)
  assert.ok(largeTankSim.demandCoveredPercent >= sim.demandCoveredPercent)
})

test('Sub-scores are continuous, non-saturating and meaningful across 5 differing fixtures', () => {
  // Fixture 1: Tiny low-cost plot, tight budget, no ramp
  const f1 = calculateImpactScores({
    annualHarvestCoverageDays: 45,
    usableHarvestLitres: 24300,
    annualDemandLitres: 197100,
    roofAreaM2: 50,
    ecoCarbonSavingsKg: 200,
    totalEmbodiedKg: 12000,
    floorAreaM2: 45,
    hasBoq: true,
    coolRoofU: 0.8,
    tempDeltaK: 12,
    roomsCount: 3,
    ventilationCount: 2,
    accessVerdict: 'Fail',
    routeDoorsPassCount: 1,
    routeDoorsTotalCount: 3,
    narrowestRouteDoorMm: 750,
    rampStatus: 'absent',
    rampGradientRatio: null,
    totalDoors: 4,
    budget: 1500000,
    costAfterSwaps: 1600000,
  })

  // Fixture 2: Large villa, ample budget, compliant ramp
  const f2 = calculateImpactScores({
    annualHarvestCoverageDays: 180,
    usableHarvestLitres: 97200,
    annualDemandLitres: 197100,
    roofAreaM2: 200,
    ecoCarbonSavingsKg: 2500,
    totalEmbodiedKg: 50000,
    floorAreaM2: 220,
    hasBoq: true,
    coolRoofU: 0.35,
    tempDeltaK: 15,
    roomsCount: 8,
    ventilationCount: 10,
    accessVerdict: 'Pass',
    routeDoorsPassCount: 6,
    routeDoorsTotalCount: 6,
    narrowestRouteDoorMm: 950,
    rampStatus: 'pass',
    rampGradientRatio: 12,
    totalDoors: 10,
    budget: 8000000,
    costAfterSwaps: 6500000,
  })

  // Fixture 3: Unconfigured budget (Affordability needs input)
  const f3 = calculateImpactScores({
    annualHarvestCoverageDays: 90,
    usableHarvestLitres: 48600,
    annualDemandLitres: 197100,
    roofAreaM2: 100,
    ecoCarbonSavingsKg: 600,
    totalEmbodiedKg: 25000,
    floorAreaM2: 110,
    hasBoq: true,
    coolRoofU: 0.5,
    tempDeltaK: 14,
    roomsCount: 4,
    ventilationCount: 4,
    accessVerdict: 'Partial',
    routeDoorsPassCount: 3,
    routeDoorsTotalCount: 4,
    narrowestRouteDoorMm: 850,
    rampStatus: 'fail',
    rampGradientRatio: 8,
    totalDoors: 5,
    budget: null,
    costAfterSwaps: 3000000,
  })

  // Fixture 4: Missing BOQ (Carbon needs input)
  const f4 = calculateImpactScores({
    annualHarvestCoverageDays: 110,
    usableHarvestLitres: 59400,
    annualDemandLitres: 197100,
    roofAreaM2: 90,
    ecoCarbonSavingsKg: 0,
    hasBoq: false,
    coolRoofU: 0.45,
    tempDeltaK: 13,
    roomsCount: 4,
    ventilationCount: 5,
    accessVerdict: 'Pass',
    routeDoorsPassCount: 4,
    routeDoorsTotalCount: 4,
    narrowestRouteDoorMm: 920,
    rampStatus: 'pass',
    rampGradientRatio: 12,
    totalDoors: 5,
    budget: 3500000,
    costAfterSwaps: 3200000,
  })

  // Fixture 5: Zero roof catchment (Water needs input)
  const f5 = calculateImpactScores({
    annualHarvestCoverageDays: 0,
    usableHarvestLitres: 0,
    annualDemandLitres: 197100,
    roofAreaM2: 0,
    ecoCarbonSavingsKg: 400,
    totalEmbodiedKg: 18000,
    floorAreaM2: 80,
    hasBoq: true,
    coolRoofU: 0.6,
    tempDeltaK: 10,
    roomsCount: 3,
    ventilationCount: 3,
    accessVerdict: 'Partial',
    routeDoorsPassCount: 2,
    routeDoorsTotalCount: 3,
    narrowestRouteDoorMm: 800,
    rampStatus: 'absent',
    rampGradientRatio: null,
    totalDoors: 4,
    budget: 2500000,
    costAfterSwaps: 2400000,
  })

  const fixtures = [f1, f2, f3, f4, f5]

  // Assert no NaN or Infinity anywhere
  for (const f of fixtures) {
    if (f.composite !== null) {
      assert.ok(!Number.isNaN(f.composite), 'Composite must not be NaN')
      assert.ok(Number.isFinite(f.composite), 'Composite must be finite')
    }
    for (const sub of Object.values(f.subScores)) {
      if (sub.score !== null) {
        assert.ok(!Number.isNaN(sub.score), `${sub.name} score must not be NaN`)
        assert.ok(Number.isFinite(sub.score), `${sub.name} score must be finite`)
        assert.ok(sub.score >= 0 && sub.score <= 100, `${sub.name} score must be within 0-100`)
      }
    }
  }

  // Assert F1 vs F2 sub-scores are continuous, distinct, and not stuck at flat baseline (25 or 50)
  assert.notEqual(f1.subScores.water.score, f2.subScores.water.score)
  assert.notEqual(f1.subScores.carbon.score, f2.subScores.carbon.score)
  assert.notEqual(f1.subScores.comfort.score, f2.subScores.comfort.score)
  assert.notEqual(f1.subScores.access.score, f2.subScores.access.score)
  assert.notEqual(f1.subScores.affordability.score, f2.subScores.affordability.score)

  // Access sub-score must not be a flat 25 for Fail or 100 for Pass
  assert.ok(f1.subScores.access.score !== 25, 'Access must not be constant 25')
  assert.ok(f1.subScores.access.score !== null && f1.subScores.access.score > 0 && f1.subScores.access.score < 50)
  assert.ok(f2.subScores.access.score !== null && f2.subScores.access.score > 80)

  // Needs-input handling
  assert.equal(f3.subScores.affordability.status, 'needs input')
  assert.equal(f3.activeSubScoresCount, 4)
  assert.equal(f4.subScores.carbon.status, 'needs input')
  assert.equal(f4.activeSubScoresCount, 4)
  // When roofAreaM2 is 0, both Water and Comfort need roof area input
  assert.equal(f5.subScores.water.status, 'needs input')
  assert.equal(f5.subScores.comfort.status, 'needs input')
  assert.equal(f5.activeSubScoresCount, 3)
})

test('Statutory standards verification integrity adheres strictly to official requirements', () => {
  // Only PM Surya Ghar and PMAY-U 2.0 remain verified: true with sourceUrl
  assert.equal(NATIONAL_STANDARDS.pmSuryaGhar.verified, true)
  assert.equal(NATIONAL_STANDARDS.pmSuryaGhar.sourceUrl, 'https://pmsuryaghar.gov.in/faq')
  assert.equal(NATIONAL_STANDARDS.pmayU2.verified, true)
  assert.equal(NATIONAL_STANDARDS.pmayU2.sourceUrl, 'https://pmaymis.gov.in/Open/Find_Beneficiary_Details_FAQ.aspx')

  // All other standards must be verified: false, sourceUrl: null, clause: null
  assert.equal(NATIONAL_STANDARDS.domesticLpcd.verified, false)
  assert.equal(NATIONAL_STANDARDS.domesticLpcd.sourceUrl, null)
  assert.equal(NATIONAL_STANDARDS.domesticLpcd.clause, null)

  assert.equal(NATIONAL_STANDARDS.runoffCoefficientRcc.verified, false)
  assert.equal(NATIONAL_STANDARDS.runoffCoefficientRcc.sourceUrl, null)
  assert.equal(NATIONAL_STANDARDS.runoffCoefficientRcc.clause, null)

  assert.equal(NATIONAL_STANDARDS.accessibleDoorClearWidthMm.verified, false)
  assert.equal(NATIONAL_STANDARDS.accessibleDoorClearWidthMm.sourceUrl, null)
  assert.equal(NATIONAL_STANDARDS.accessibleDoorClearWidthMm.clause, null)

  assert.equal(NATIONAL_STANDARDS.rampMaxGradientRatio.verified, false)
  assert.equal(NATIONAL_STANDARDS.rampMaxGradientRatio.sourceUrl, null)
  assert.equal(NATIONAL_STANDARDS.rampMaxGradientRatio.clause, null)

  assert.equal(NATIONAL_STANDARDS.standardRoofUValue.verified, false)
  assert.equal(NATIONAL_STANDARDS.standardRoofUValue.sourceUrl, null)
  assert.equal(NATIONAL_STANDARDS.standardRoofUValue.clause, null)

  assert.equal(NATIONAL_STANDARDS.coolRoofUValue.verified, false)
  assert.equal(NATIONAL_STANDARDS.coolRoofUValue.sourceUrl, null)
  assert.equal(NATIONAL_STANDARDS.coolRoofUValue.clause, null)

  // Pune threshold is 300 m² with verified: false
  assert.equal(RWH_CITY_THRESHOLDS.pune.plotThresholdM2, 300)
  assert.equal(RWH_CITY_THRESHOLDS.pune.verified, false)
  assert.ok(RWH_CITY_THRESHOLDS.pune.notes?.includes('conflict'))

  // All other RWH cities verified: false and clause: null
  for (const [cityName, rule] of Object.entries(RWH_CITY_THRESHOLDS)) {
    assert.equal(rule.verified, false, `RWH city ${cityName} must be unverified`)
    assert.equal(rule.clause, null, `RWH city ${cityName} clause must be null`)
  }
})
