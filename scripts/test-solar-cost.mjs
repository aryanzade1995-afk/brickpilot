import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { defaultBrief, geometryBrief } from '../src/lib/model/brief.ts'
import { solarConfigurationSchema, solarConfigurationSignature, solarPanelSpecificationKey, solarSignature, recoverStoredSolar } from '../src/lib/model/solar.ts'
import { solarAssessmentInputsSchema } from '../src/lib/solar/assessmentInputs.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { generateAlternativeDesign } from '../src/lib/engine/generateAlternativeDesign.ts'
import { previewSolarEditor, applySolarEditor } from '../src/lib/solar/editor.ts'
import { estimateSolarEnergy, assessInverter } from '../src/lib/solar/estimate.ts'
import { estimateBoq, estimateProjectBoq, boqCsv } from '../src/lib/cost/index.ts'
import { finishSignature } from '../src/lib/cost/finishAssignments.ts'
import { pricingSignature, snapshotCost, restoreCostReplay } from '../src/lib/cost/replay.ts'
import { savedCostSchema, publicSheetSchema } from '../src/lib/cost/deliverySchemas.ts'
import { planAzimuthToTrue } from '../src/lib/solar/coordinates.ts'

const brief = defaultBrief(); brief.site.plotWidth = 25; brief.site.plotDepth = 30
const design = generate(compile(brief)), architecture = generateAlternativeDesign(design, 12)
const context = { ...architecture, facadeModel: architecture.facadeGrammar }
const configuration = solarConfigurationSchema.parse({ intention: 'install-now', inputs: {
  panel: { id: 'test-550', name: 'Test module', source: 'illustrative', revision: 'test-v1', dimensionsMm: { width: 1134, height: 2278, thickness: 35 }, ratedPowerW: 550 },
  request: { kind: 'panel-count', panelCount: 2 }, orientation: { planNorthBearingDeg: 0 },
} })
const preview = previewSolarEditor(design, configuration, architecture)
const applied = applySolarEditor(brief, preview, preview.roof)
const layout = applied.solar.calculated.layout
const priced = () => estimateBoq(design, applied, undefined, context)
const pv = cost => cost.boq.filter(l => l.id.startsWith('solar-pv:'))
const close = (a, b) => assert.ok(Math.abs(a - b) < .001, `${a} != ${b}`)

test('only applied validated inventory creates an itemized system and replaces a legacy allowance', () => {
  const legacy = { ...applied, specs: { overrides: { solar: 'on' } } }
  const cost = estimateBoq(design, legacy, undefined, context)
  assert.equal(cost.solar.status, 'applied'); assert.equal(cost.solar.panelCount, 2); assert.equal(cost.solar.capacityKwp, 1.1)
  assert.equal(pv(cost).length, 8); assert.ok(!cost.boq.some(l => l.item === 'solar'))
  assert.equal(pv(cost).find(l => l.id === 'solar-pv:panels').qty, 2)
  close(cost.solar.grossInstallationCost, pv(cost).reduce((n, l) => n + l.amount, 0))
  assert.equal(cost.solar.assistance.deductedInr, 0)
  assert.equal(cost.solar.inverter.state, 'pending')
  assert.match(pv(cost).find(l => l.id === 'solar-pv:inverter').label, /allowance/)
  for (const line of pv(cost)) { close(line.materialAmount + line.labourAmount, line.amount); assert.match(line.note, /Pune.*2026-10-19/); assert.match(line.note, /Not a supplier quotation/) }
  close(cost.expected, cost.lines.reduce((n, l) => n + l.expected, 0))
  close(cost.procurement.total, cost.procurement.material + cost.procurement.labour + cost.procurement.overhead + cost.procurement.projectAddOns)
  assert.equal(savedCostSchema.safeParse(cost).success, true)
})

test('undecided legacy allowance remains explicit; other non-installed intentions never add installation costs', () => {
  const legacy = { ...brief, specs: { overrides: { solar: 'on' } } }
  const old = estimateBoq(design, legacy, undefined, context)
  assert.equal(old.solar.status, 'legacy-allowance'); assert.equal(old.solar.legacyAllowanceCost, 250000)
  assert.equal(old.boq.find(l => l.item === 'solar').amount, 250000); assert.equal(old.solar.panelCount, 0)
  for (const intention of ['undecided', 'not-included', 'reserve-space']) {
    const next = structuredClone(legacy); next.solar.intention = intention
    if (intention === 'undecided') next.solar.assessmentInputs.legacyAllowance = 'exclude'
    const cost = estimateBoq(design, next, undefined, context)
    assert.equal(pv(cost).length, 0); assert.equal(cost.solar.grossInstallationCost, 0); assert.equal(cost.solar.legacyAllowanceCost, 0)
    assert.equal(cost.solar.energy.annualKwh, null); assert.ok(!cost.boq.some(l => l.item === 'solar' && l.amount > 0))
  }
})

test('draft, missing context, stale roof, invalid flag and fabricated valid flag cannot charge installation', () => {
  const values = [
    [{ ...brief, solar: configuration }, context], [applied, undefined],
    [{ ...applied, solar: { ...applied.solar, calculated: { ...applied.solar.calculated, layout: { ...layout, roofSignature: 'stale' } } } }, context],
    [{ ...applied, solar: { ...applied.solar, calculated: { ...applied.solar.calculated, layout: { ...layout, validity: { state: 'needs-review', reasonCodes: ['ROOF_CHANGED'] } } } } }, context],
  ]
  const forged = structuredClone(applied); forged.solar.calculated.layout.panels[0].positionMm.x += 1000000
  values.push([forged, context])
  for (const [b, c] of values) { const cost = estimateBoq(design, b, undefined, c); assert.equal(cost.solar.status, 'needs-review'); assert.equal(pv(cost).length, 0); assert.equal(cost.solar.panelCount, 0) }
})

test('tax provision has no solar tax assumption and subsidy never reduces the project total', () => {
  const base = estimateBoq(design, brief, undefined, context)
  const selection = { ...base.selection, includeGst: true }
  const withSolar = estimateBoq(design, applied, selection, context), withoutSolar = estimateBoq(design, brief, selection, context)
  close(withSolar.lines.find(l => l.label === 'GST provision').expected, withoutSolar.lines.find(l => l.label === 'GST provision').expected)
  assert.ok(withSolar.expected > withoutSolar.expected + withSolar.solar.grossInstallationCost)
  assert.match(withSolar.excluded.join(' '), /Solar taxes pending/)
})

test('assessment-only edits retain canonical panels, architecture and finish identity but invalidate pricing replay', () => {
  const next = structuredClone(applied); next.solar.assessmentInputs.objective = 'both'
  const p = previewSolarEditor(design, next.solar, architecture), saved = applySolarEditor(next, p, p.roof)
  assert.deepEqual(saved.solar.calculated.layout, layout)
  assert.equal(solarConfigurationSignature(saved.solar), solarConfigurationSignature(applied.solar))
  assert.notEqual(solarSignature(saved.solar), solarSignature(applied.solar)); assert.notEqual(pricingSignature(saved), pricingSignature(applied))
  assert.deepEqual(geometryBrief(saved), geometryBrief(brief)); assert.equal(finishSignature(saved), finishSignature(brief))
  const cost = estimateBoq(design, saved, undefined, context)
  assert.equal(cost.solar.backup, 'pending'); assert.equal(cost.solar.objective, 'both'); assert.equal(cost.expected, priced().expected)
  assert.match(cost.assumptions.join(' '), /cannot meet the backup goal/)
  assert.ok(!pv(cost).some(l => /battery/i.test(l.label)))
  assert.deepEqual(recoverStoredSolar(JSON.parse(JSON.stringify(saved.solar))), saved.solar)
  const corruptAssessment = structuredClone(saved.solar); corruptAssessment.assessmentInputs.objective = 'invalid'
  const recovered = recoverStoredSolar(corruptAssessment)
  assert.deepEqual(recovered.calculated, saved.solar.calculated)
  assert.equal(recovered.assessmentInputs.objective, 'unknown')
})

function withEnergy() {
  const solar = structuredClone(applied.solar), first = layout.panels[0]
  solar.inputs.location = { ...solar.inputs.location, latitudeDeg: 18.5, longitudeDeg: 73.8 }
  solar.assessmentInputs.energy = { sourceUrl: 'https://example.test/resource', referencePeriod: 'Fixture 2000–2020', weatherBasis: 'Test scenario range; no probability claim', latitudeDeg: 18.5, longitudeDeg: 73.8,
    trueAzimuthDeg: planAzimuthToTrue(first.azimuthDeg, 0), tiltDeg: first.tiltDeg,
    annualPoaLowKwhM2: 1600, annualPoaHighKwhM2: 1800, nonShadingPrLow: .75, nonShadingPrHigh: .85, shadingLossLow: .05, shadingLossHigh: .15 }
  return solar
}
test('energy uses explicit POA × actual capacity × non-shading factor × shading scenario bounds', () => {
  const solar = withEnergy(); solar.inputs.monthlyConsumptionKwh = 250
  const result = estimateSolarEnergy(layout, solar)
  assert.equal(result.state, 'preliminary-range')
  assert.deepEqual(result.annualKwh, { low: Math.floor(1.1 * 1600 * .75 * .85 / 10) * 10, high: Math.ceil(1.1 * 1800 * .85 * .95 / 10) * 10 })
  assert.equal(result.annualConsumptionKwh, 3000)
  assert.match(result.basis.join(' '), /not a statistical confidence interval/)
  const preview = previewSolarEditor(design, solar, architecture), saved = applySolarEditor(brief, preview, preview.roof)
  assert.equal(estimateBoq(design, saved, undefined, context).solar.energy.state, 'preliminary-range')
})
test('energy refuses missing loss/weather/source data, mismatched orientation/location and mixed arrays', () => {
  for (const change of [s => s.assessmentInputs.energy.sourceUrl = null, s => s.assessmentInputs.energy.weatherBasis = null,
    s => s.assessmentInputs.energy.shadingLossHigh = null, s => s.assessmentInputs.energy.longitudeDeg = 75,
    s => s.assessmentInputs.energy.trueAzimuthDeg = (s.assessmentInputs.energy.trueAzimuthDeg + 90) % 360,
    s => s.inputs.orientation.planNorthBearingDeg = null]) {
    const solar = withEnergy(); change(solar); const result = estimateSolarEnergy(layout, solar)
    assert.equal(result.state, 'insufficient-information'); assert.equal(result.annualKwh, null)
  }
  assert.equal(estimateSolarEnergy(layout, applied.solar).annualConsumptionKwh, null)
  const mixed = structuredClone(layout); mixed.panels[1].azimuthDeg = (mixed.panels[0].azimuthDeg + 90) % 360
  assert.equal(estimateSolarEnergy(mixed, withEnergy()).state, 'insufficient-information')
})

function withElectrical() {
  const solar = structuredClone(applied.solar)
  solar.assessmentInputs.electrical = { moduleSource: 'https://example.test/module', panelSpecificationKey: solarPanelSpecificationKey(solar.inputs.panel), inverterSource: 'https://example.test/inverter', inverterName: 'Fixture 1 kW',
    moduleVocV: 50, moduleVmpV: 42, moduleIscA: 14, moduleImpA: 13, vocCoefficientPctPerC: -.25, vmpCoefficientPctPerC: -.3, minimumCellC: 0, maximumCellC: 75,
    modulesPerString: 2, parallelStrings: 1, inverterAcKw: 1, inverterMaxDcKwp: 1.5, inverterMaxVocV: 600,
    inverterMpptMinV: 60, inverterMpptMaxV: 500, inverterStartV: 60, inverterMaxInputA: 16, inverterMaxShortCircuitA: 20, supplyPhase: 'single', inverterPhase: 'single' }
  return solar
}
test('inverter concept checks temperature-corrected voltages, current, power, phase, module version and full inventory', () => {
  assert.equal(assessInverter(layout, withElectrical()).state, 'concept-compatible')
  for (const change of [e => e.inverterMaxVocV = 90, e => e.inverterMpptMinV = 120, e => e.inverterMaxInputA = 10,
    e => e.modulesPerString = 3, e => e.inverterPhase = 'three', e => e.inverterMaxDcKwp = .8, e => e.panelSpecificationKey = 'other-module']) {
    const solar = withElectrical(); change(solar.assessmentInputs.electrical); assert.equal(assessInverter(layout, solar).state, 'incompatible')
  }
  const missing = withElectrical(); missing.assessmentInputs.electrical.inverterSource = null
  assert.equal(assessInverter(layout, missing).state, 'pending')
  const wrongWattage = withElectrical(); wrongWattage.assessmentInputs.electrical.moduleImpA = 10
  assert.match(assessInverter(layout, wrongWattage).reasons.join(' '), /wattage/)
})

test('strict assessment schema rejects nonfinite, reversed range, fractions in string count and non-web sources', () => {
  for (const value of [{ objective: 'backup-ready' }, { electrical: { modulesPerString: 1.5 } }, { energy: { nonShadingPrLow: .9, nonShadingPrHigh: .8 } },
    { energy: { shadingLossHigh: Infinity } }, { energy: { sourceUrl: 'javascript:alert(1)' } }]) assert.equal(solarAssessmentInputsSchema.safeParse(value).success, false)
})

test('snapshot and CSV preserve quantities, gross cost, pending backup and assistance without trusting stale replay', () => {
  const cost = priced(), snapshot = snapshotCost(design, applied, cost)
  assert.deepEqual(snapshot.cost.solar, cost.solar)
  restoreCostReplay(snapshot)
  assert.equal(estimateProjectBoq(design, applied).solar.status, 'needs-review')
  assert.equal(estimateProjectBoq(design, applied, undefined, context).solar.grossInstallationCost, cost.solar.grossInstallationCost)
  const csv = boqCsv(cost); assert.match(csv, /PV modules/); assert.match(csv, /Gross solar installation/); assert.match(csv, /INR 0 deducted/)
  const bad = structuredClone(cost); bad.solar.grossInstallationCost++
  assert.equal(savedCostSchema.safeParse(bad).success, false)
  assert.ok(publicSheetSchema.shape.cost.safeParse(cost).data.solar)
})

registerHooks({ resolve(s, c, next) { return s.startsWith('@/') ? { url: new URL(`../src/${s.slice(2)}`, import.meta.url).href, shortCircuit: true } : next(s, c) } })
const storage = new Map()
globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) }
globalThis.window = { localStorage: globalThis.localStorage }
const { useStudio } = await import('../src/state/studio.ts')
test('live edit, save/reload and version inputs retain the both goal without changing pinned building identity', () => {
  useStudio.getState().loadSaved(brief, { massing: design.massingType, seed: 12, planSeed: design.planSeed, planner: 'baseline' })
  useStudio.getState().run()
  const before = useStudio.getState(), source = before.result.design
  useStudio.getState().edit(b => { b.solar.assessmentInputs.objective = 'both' })
  const after = useStudio.getState()
  assert.equal(after.brief.solar.assessmentInputs.objective, 'both'); assert.equal(after.result.cost.solar.backup, 'pending')
  assert.equal(after.result.design, source); assert.equal(after.pinned, before.pinned); assert.equal(after.layout, before.layout)
  const saved = JSON.parse(JSON.stringify(after.brief)), pinned = after.pinned
  useStudio.getState().loadSaved(saved, pinned); useStudio.getState().run()
  assert.equal(useStudio.getState().brief.solar.assessmentInputs.objective, 'both')
  assert.equal(useStudio.getState().result.cost.solar.backup, 'pending')
})

test('solar Excel and both PDF exports carry the same gross subtotal and count with no assistance deduction', async t => {
  const previousWindow = globalThis.window
  delete globalThis.window
  t.after(() => { globalThis.window = previousWindow })
  const { buildBoqExcel } = await import('../src/lib/cost/exportExcel.ts')
  const { buildReportPdf } = await import('../src/lib/report/buildPdf.ts')
  const { buildSpecSheetPdf } = await import('../src/lib/report/specSheet.ts')
  const { specificationSchedule } = await import('../src/lib/cost/schedule.ts')
  const { validate } = await import('../src/lib/rules/index.ts')
  const { default: ExcelJS } = await import('exceljs')
  const cost = priced(), book = new ExcelJS.Workbook()
  await book.xlsx.load(Buffer.from(await (await buildBoqExcel(cost, 'Solar integration fixture')).arrayBuffer()))
  const solarSheet = book.getWorksheet('Solar assessment')
  assert.ok(solarSheet)
  const rows = solarSheet.getSheetValues().filter(Boolean)
  assert.equal(rows.find(r => r[1] === 'Applied PV panels')[2], 2)
  assert.equal(rows.find(r => r[1] === 'Gross installation INR')[2], cost.solar.grossInstallationCost)
  assert.match(rows.find(r => r[1] === 'Potential assistance')[2], /INR 0 deducted/)
  const report = await buildReportPdf({ projectName: 'Solar integration fixture', brief: applied, design, report: validate(design), cost, planImages: [], massingImages: [], conceptImages: [], specPhotos: {} })
  const reportText = Buffer.from(await report.arrayBuffer()).toString('latin1')
  assert.match(reportText, /ROOFTOP SOLAR/); assert.match(reportText, /2 panels; 1.1 kWp DC/)
  const sheet = await buildSpecSheetPdf({ projectName: 'Solar integration fixture', schedule: specificationSchedule(applied, cost), cost, photos: {} })
  const sheetText = Buffer.from(await sheet.arrayBuffer()).toString('latin1')
  assert.match(sheetText, /ROOFTOP SOLAR ASSESSMENT/); assert.match(sheetText, /INR 0 deducted/)
})
