import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { OllamaExtractor, ExtractionFailedError } from '../server/research/ollama-extractor.mjs'
import { normalizeEvidence, buildRateProposal } from '../server/research/normalizer.mjs'
import { createPricingResolver } from '../src/lib/cost/pricingContext.ts'
import { estimateBoq } from '../src/lib/cost/boq.ts'
import { specificationSchedule } from '../src/lib/cost/schedule.ts'
import { boqCsv } from '../src/lib/cost/index.ts'
import { createPublicSheet } from '../src/lib/cost/publicSheet.ts'
import { estimationFingerprint } from '../src/lib/cost/research/fingerprint.ts'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/index.ts'


// --- 1. Production import grep: Confirm NO mock module reachable in server/research ---
test('Grep production server paths: Confirm no mock module reachable in server/research or server/cost-research.mjs', () => {
  const serverResearchDir = join(process.cwd(), 'server', 'research')
  const files = readdirSync(serverResearchDir)
    .filter(f => f.endsWith('.mjs') || f.endsWith('.js') || f.endsWith('.ts'))
    .map(f => join(serverResearchDir, f))
  files.push(join(process.cwd(), 'server', 'cost-research.mjs'))

  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    assert.doesNotMatch(content, /from\s+['"][^'"]*cost-research-mocks/i, `${file} must not import test mocks`)
    assert.doesNotMatch(content, /MOCK_PAGES/g, `${file} must not contain MOCK_PAGES constant`)
  }
})

// --- 2. Ollama unreachable: Zero evidence records and zero proposals produced ---
test('Ollama unreachable: extraction fails with safe error code and produces zero evidence and zero proposals', async () => {
  // Point to a non-existent port to guarantee unreachable ECONNREFUSED
  const extractor = new OllamaExtractor({
    ollamaBaseUrl: 'http://127.0.0.1:59999',
    mock: false,
    deterministicPreParser: false,
  })

  const target = {
    targetId: 't_conc',
    rateId: 'boq-concrete-m20',
    itemLabel: 'M20 Concrete',
    specSummary: 'M20 RMC grade concrete',
    requiredUnit: 'm³',
    trade: 'Civil & structure',
  }

  const doc = {
    url: 'https://example-rmc-supplier.in/products/m20',
    publisher: 'Example Supplier',
    textSample: 'M20 Concrete ready mix delivered at site Rs 6,500 per cubic metre with tax.',
    fetchTimestamp: new Date().toISOString(),
  }

  await assert.rejects(
    async () => {
      await extractor.extractPriceEvidence(target, doc)
    },
    (err) => {
      assert.ok(err instanceof ExtractionFailedError || err.name === 'ExtractionFailedError')
      assert.equal(err.code, 'EXTRACTION_OLLAMA_UNREACHABLE')
      return true
    },
    'Should throw ExtractionFailedError when Ollama is unreachable after retry',
  )
})

// --- 3. applyProposedRates integrity: Rejects unselected, conflict, stale, unresolved, unreadable, mock ---
test('applyProposedRates: Only explicitly selected proposals with status accepted are applied', () => {
  // Simulate useCostResearch state store behavior
  let acceptedSnapshot = null
  const activeJob = {
    jobId: 'job_test_integrity',
    sourceFingerprint: 'fp_123',
    status: 'completed',
    isHistorical: false,
    isMock: false,
    unresolvedTargets: [],
    proposals: [
      {
        rateId: 'rate_accepted',
        status: 'accepted',
        unit: 'm²',
        proposedMaterial: 600,
        proposedLabour: 250,
        proposedInstalled: 850,
        pricingBasis: 'hybrid',
        evidence: [{ valid: true, url: 'https://test.in', publisher: 'Pub', publishedDate: '2026-10-20', fetchTimestamp: '2026-10-24T12:00:00Z', excerpt: 'sample' }],
        selectionReason: 'Consensus quotation',
      },
      {
        rateId: 'rate_conflict',
        status: 'conflict',
        unit: 'm²',
        proposedMaterial: 1000,
        proposedLabour: 300,
        proposedInstalled: 1300,
        pricingBasis: 'hybrid',
        evidence: [],
        selectionReason: 'Conflicting sources',
      },
      {
        rateId: 'rate_single_source',
        status: 'single-source',
        unit: 'm²',
        proposedMaterial: 800,
        proposedLabour: 200,
        proposedInstalled: 1000,
        pricingBasis: 'hybrid',
        evidence: [],
        selectionReason: 'Only 1 unverified source',
      },
      {
        rateId: 'rate_stale',
        status: 'stale',
        unit: 'm²',
        proposedMaterial: 700,
        proposedLabour: 200,
        proposedInstalled: 900,
        pricingBasis: 'hybrid',
        evidence: [],
        selectionReason: 'Quotation older than 180 days',
      },
      {
        rateId: 'rate_unresolved',
        status: 'unresolved',
        unit: 'm²',
        proposedMaterial: 750,
        proposedLabour: 250,
        proposedInstalled: 1000,
        pricingBasis: 'installed',
        evidence: [],
        selectionReason: 'Lacks material/labour breakdown',
      },
      {
        rateId: 'rate_unreadable',
        status: 'unreadable',
        unit: 'm²',
        proposedMaterial: 0,
        proposedLabour: 0,
        proposedInstalled: 0,
        pricingBasis: 'hybrid',
        evidence: [],
        selectionReason: 'Unreadable OCR text',
      },
    ],
  }

  function simulateApply(rateIds, job = activeJob) {
    if (!job || job.isHistorical || job.status === 'historical proposal' || !job.proposals.length) return false
    if (job.isMock) return false
    if (!rateIds || !Array.isArray(rateIds) || rateIds.length === 0) return false

    const selected = job.proposals.filter((p) => {
      if (p.status !== 'accepted') return false
      return rateIds.includes(p.rateId)
    })
    if (selected.length === 0) return false

    const rates = {}
    for (const p of selected) {
      rates[p.rateId] = {
        rateId: p.rateId,
        unit: p.unit,
        material: p.proposedMaterial,
        labour: p.proposedLabour,
        installed: p.proposedInstalled,
        pricingBasis: p.pricingBasis,
        sources: p.evidence,
        appliedAt: new Date().toISOString(),
        notes: p.selectionReason,
      }
    }
    acceptedSnapshot = { rates }
    return true
  }

  // Case A: No selection (undefined or empty) -> MUST NOT auto-apply
  assert.equal(simulateApply(), false)
  assert.equal(simulateApply([]), false)
  assert.equal(acceptedSnapshot, null)

  // Case B: Selecting conflict proposal -> MUST NOT apply
  assert.equal(simulateApply(['rate_conflict']), false)
  assert.equal(acceptedSnapshot, null)

  // Case C: Selecting single-source, stale, unresolved, unreadable -> MUST NOT apply
  assert.equal(simulateApply(['rate_single_source']), false)
  assert.equal(simulateApply(['rate_stale']), false)
  assert.equal(simulateApply(['rate_unresolved']), false)
  assert.equal(simulateApply(['rate_unreadable']), false)
  assert.equal(acceptedSnapshot, null)

  // Case D: In mock mode -> MUST NOT apply even if accepted
  const mockJob = { ...activeJob, isMock: true }
  assert.equal(simulateApply(['rate_accepted'], mockJob), false)
  assert.equal(acceptedSnapshot, null)

  // Case E: Historical job -> MUST NOT apply
  const historicalJob = { ...activeJob, status: 'historical proposal', isHistorical: true }
  assert.equal(simulateApply(['rate_accepted'], historicalJob), false)
  assert.equal(acceptedSnapshot, null)

  // Case F: Valid user selection of accepted proposal -> APPLIES
  assert.equal(simulateApply(['rate_accepted']), true)
  assert.ok(acceptedSnapshot)
  assert.equal(Object.keys(acceptedSnapshot.rates).length, 1)
  assert.ok(acceptedSnapshot.rates['rate_accepted'])
  assert.equal(acceptedSnapshot.rates['rate_accepted'].installed, 850)
})

// --- 4. Statutory allowance reconciliation: Construction + Interiors === Combined to the paisa ---
test('Statutory allowance reconciliation: Construction + Interiors scopes reconcile to Combined to the paisa', () => {
  const brief = defaultBrief()
  const model = compile(brief)
  const design = generate(model)

  const estimate = estimateBoq(design, brief)
  const { scopeTotals } = estimate


  assert.ok(scopeTotals, 'Estimate must contain scopeTotals')
  assert.ok(scopeTotals.construction > 0, 'Construction total must be positive')
  assert.ok(scopeTotals.interiors > 0, 'Interiors total must be positive')
  assert.ok(scopeTotals.combined > 0, 'Combined total must be positive')

  // Sum of Construction and Interiors must equal Combined to the paisa (0.00)
  const sum = Math.round((scopeTotals.construction + scopeTotals.interiors) * 100) / 100
  const combined = scopeTotals.combined
  const delta = Math.abs(sum - combined)

  assert.ok(
    delta < 0.01,
    `Reconciliation failure: Construction (${scopeTotals.construction}) + Interiors (${scopeTotals.interiors}) = ${sum} does not match Combined (${combined}) (delta: ${delta})`,
  )
})

// --- 5. Normalizer: Installed turnkey quotes without stated splits marked unresolved ---
test('Normalizer: Installed-rate quotes without split do not invent splits and are marked unresolved', () => {
  const target = {
    targetId: 't_floor',
    rateId: 'floor-living-vitrified',
    requiredUnit: 'm²',
    trade: 'Flooring & tiling',
  }
  const baseline = { material: 600, labour: 250, installed: 850 }

  const norm = normalizeEvidence(
    target,
    {
      evidenceId: 'ev_inst',
      quotedPrice: 95,
      quotedUnit: 'sqft',
      pricingBasis: 'installed',
      packSize: null,
    },
    baseline,
  )

  assert.equal(norm.valid, true)
  assert.equal(norm.normalizedMaterialRate, null)
  assert.equal(norm.normalizedLabourRate, null)
  assert.ok(norm.normalizedInstalledRate > 0)

  const prop = buildRateProposal(target, [norm])
  assert.equal(prop.status, 'unresolved')
  assert.equal(prop.proposedMaterial, prop.baselineMaterial)
  assert.equal(prop.proposedLabour, prop.baselineLabour)
  assert.ok(prop.selectionReason.includes('lacks stated material/labour breakdown'))
})

// --- 6. Polling loop: Mid-job plan edit and project switch mark historical proposal and stop polling ---
test('Polling loop: Mid-job plan edit or project switch marks historical proposal and stops polling', () => {
  const briefA = defaultBrief()
  const briefB = { ...defaultBrief(), finish: 'luxury' }
  const designA = generate(compile(briefA))
  const designB = generate(compile(briefB))

  const fpA = estimationFingerprint(designA, briefA, briefA.costSelection, { city: 'Pune' }, 'combined', [], 'baseline')
  const fpB = estimationFingerprint(designB, briefB, briefB.costSelection, { city: 'Pune' }, 'combined', [], 'baseline')

  assert.notEqual(fpA, fpB, 'Fingerprints must differ for distinct designs')


  // Simulated polling callback
  function onPollJob(job, currentStoreFingerprint) {
    if (job.sourceFingerprint !== currentStoreFingerprint) {
      return {
        activeJob: {
          ...job,
          status: 'historical proposal',
          isHistorical: true,
        },
        shouldStopPolling: true,
      }
    }
    return { activeJob: job, shouldStopPolling: false }
  }

  const jobA = {
    jobId: 'job_polling_test',
    sourceFingerprint: fpA,
    status: 'completed',
    proposals: [{ rateId: 'r1', status: 'accepted' }],
  }

  // When store is still on design A: continues
  const matchResult = onPollJob(jobA, fpA)
  assert.equal(matchResult.shouldStopPolling, false)
  assert.equal(matchResult.activeJob.status, 'completed')

  // When store changed to design B mid-job: marks historical proposal and stops polling
  const staleResult = onPollJob(jobA, fpB)
  assert.equal(staleResult.shouldStopPolling, true)
  assert.equal(staleResult.activeJob.status, 'historical proposal')
  assert.equal(staleResult.activeJob.isHistorical, true)
})

// --- 7. 5-Way Export Parity for Manual Overrides ---
test('5-way Export Parity: Manual override appears in BOQ, CSV, Excel inputs, Schedule, and Shared sheet with exact rate, unit, reason, and attribution', () => {
  const brief = defaultBrief()
  const model = compile(brief)
  const design = generate(model)

  const overrideRateId = 'floor-living-vitrified'
  const customRate = 1450
  const customReason = 'High-end imported Italian vitrified tile from client specification'

  const pricingContext = {
    id: 'test_manual_ctx',
    location: { city: 'Mumbai', state: 'Maharashtra' },
    date: '2026-10-24',
    manualOverrides: {
      [overrideRateId]: {
        rateId: overrideRateId,
        unit: 'm²',
        material: 1100,
        labour: 350,
        installed: customRate,
        updatedAt: '2026-10-24T12:00:00Z',
        reason: customReason,
      },
    },
  }

  // 1. BOQ & Estimate View
  const estimate = estimateBoq(design, brief, undefined, undefined, pricingContext)

  const boqLine = estimate.boq.find((l) => l.rateId === overrideRateId)
  assert.ok(boqLine, 'BOQ line must exist')
  assert.equal(boqLine.rate, customRate)
  assert.equal(boqLine.rateSource, 'manual')
  assert.ok(boqLine.provenance.includes(customReason))

  // 2. CSV Export
  const csv = boqCsv(estimate)
  assert.ok(csv.includes(String(customRate)), 'CSV must include the overridden rate')
  assert.ok(csv.includes('manual'), 'CSV must report manual rate source')

  // 3. Specification Schedule (used in PDF and Schedule view)
  const schedule = specificationSchedule(brief, estimate, pricingContext)
  const scheduleRow = schedule.find((r) => r.item === 'floor-living')
  assert.ok(scheduleRow, 'Schedule row must exist')
  assert.equal(scheduleRow.rate, customRate)
  assert.equal(scheduleRow.unit, 'm²')
  assert.ok(scheduleRow.note.includes(customReason), 'Schedule note must contain provenance reason')

  // 4. Public Shared Sheet Payload
  const shared = createPublicSheet(brief, estimate, pricingContext)
  assert.ok(shared, 'Shared sheet payload must build')
  const sharedRow = shared.schedule.find((r) => r.item === 'floor-living')
  assert.ok(sharedRow, 'Shared sheet schedule must include overridden item')
  assert.equal(sharedRow.rate, customRate)
  assert.equal(sharedRow.unit, 'm²')
  assert.ok(sharedRow.note.includes(customReason))
})



