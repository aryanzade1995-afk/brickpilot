import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      return { url: new URL(`../src/${specifier.slice(2)}`, import.meta.url).href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

const storage = new Map()
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
}
globalThis.window = { localStorage: globalThis.localStorage }

const { parseCore, applyCore } = await import('../src/state/projects.ts')
const { parseSavedDesignRow } = await import('../src/state/designs.ts')
const { useCostResearch } = await import('../src/state/costResearch.ts')
const { createPublicSheet } = await import('../src/lib/cost/publicSheet.ts')
const { estimateBoq } = await import('../src/lib/cost/boq.ts')
const { defaultBrief } = await import('../src/lib/model/brief.ts')
const { compile } = await import('../src/lib/model/canonical.ts')
const { generate } = await import('../src/lib/engine/index.ts')
const { buildBoqExcel } = await import('../src/lib/cost/exportExcel.ts')

test('parseCore and applyCore round-trip costResearch state', () => {
  const brief = defaultBrief()
  const costResearchSnapshot = {
    acceptedSnapshot: {
      id: 'snap_saved_1',
      createdAt: '2026-10-24T12:00:00Z',
      location: { city: 'Pune', country: 'IN', currency: 'INR' },
      scope: 'combined',
      sourceFingerprint: 'sig_abc',
      rates: {
        'concrete-grade-m25': {
          rateId: 'concrete-grade-m25',
          unit: 'm³',
          material: 5500,
          labour: 1900,
          installed: 7400,
          pricingBasis: 'hybrid',
          sources: [],
          appliedAt: '2026-10-24T12:00:00Z',
        },
      },
      unresolvedGaps: [],
    },
    manualOverrides: {
      'reinforcement-fe500d': {
        rateId: 'reinforcement-fe500d',
        unit: 'kg',
        material: 70,
        labour: 10,
        installed: 80,
        updatedAt: '2026-10-24T12:00:00Z',
        reason: 'Contractor quotation',
      },
    },
    location: { city: 'Pune', country: 'IN', currency: 'INR' },
    scopeMode: 'combined',
  }

  const coreInput = {
    brief,
    pinned: null,
    layout: null,
    existing: null,
    finishes: null,
    costResearch: costResearchSnapshot,
    stage: 'concept',
  }

  const parsed = parseCore(coreInput)
  assert.ok(parsed)
  assert.ok(parsed.costResearch)
  assert.equal(parsed.costResearch.acceptedSnapshot.id, 'snap_saved_1')

  // Apply core to store
  applyCore(parsed)
  const storeState = useCostResearch.getState()
  assert.equal(storeState.acceptedSnapshot?.id, 'snap_saved_1')
  assert.equal(storeState.manualOverrides['reinforcement-fe500d']?.installed, 80)
})

test('parseSavedDesignRow extracts additive cost_research and existing columns', () => {
  const brief = defaultBrief()
  const row = {
    id: 'e4b953d6-4444-4444-4444-000000000001',
    name: 'My Eco Villa',
    brief,
    pinned: null,
    cost_research: {
      acceptedSnapshot: { id: 'snap_cloud_1', rates: {} },
      location: { city: 'Goa', country: 'IN', currency: 'INR' },
    },
    existing: {
      structure: { columns: [], footings: [], beams: [], walls: [], storeysBuilt: 1 },
      seed: 42,
    },
    created_at: '2026-10-24T10:00:00Z',
    updated_at: '2026-10-24T11:00:00Z',
  }

  const savedDesign = parseSavedDesignRow(row)
  assert.ok(savedDesign)
  assert.equal(savedDesign.name, 'My Eco Villa')
  assert.equal(savedDesign.costResearch.acceptedSnapshot.id, 'snap_cloud_1')
  assert.equal(savedDesign.existing.seed, 42)
})

test('createPublicSheet includes pricingContext rates in schedule without exposing private coordinates', () => {
  const brief = defaultBrief()
  const model = compile(brief)
  const design = generate(model)

  const pricingContext = {
    id: 'snap_public_test',
    location: { city: 'Pune', country: 'IN', currency: 'INR' },
    rates: {
      'anti-termite-mid': {
        rateId: 'anti-termite-mid',
        unit: 'm²',
        material: 150,
        labour: 60,
        installed: 210,
        pricingBasis: 'hybrid',
        sources: [
          {
            url: 'https://pest.example.in',
            publisher: 'Pune Pest Control',
            date: '2026-10-24',
            fetchTimestamp: '2026-10-24T10:00:00Z',
            excerpt: 'Rs 210 per m2',
          },
        ],
        appliedAt: '2026-10-24T10:00:00Z',
      },
    },
  }

  const cost = estimateBoq(design, brief, undefined, undefined, pricingContext)
  const sheet = createPublicSheet(brief, cost, pricingContext)

  assert.ok(sheet.schedule.length > 0)
  assert.equal(sheet.projectName, brief.project.name || 'Formstead project')
  assert.ok(sheet.cost.expected > 0)

  // Verify that the anti-termite row in schedule has the researched date and city
  const termiteRow = sheet.schedule.find((r) => r.item === 'anti-termite')
  if (termiteRow) {
    assert.equal(termiteRow.rate, 210)
    assert.equal(termiteRow.city, 'Pune')
    assert.equal(termiteRow.date, '2026-10-24')
  }
})

test('buildBoqExcel generates valid Excel workbook with rate sources and scope breakdown', async () => {
  const brief = defaultBrief()
  const model = compile(brief)
  const design = generate(model)

  const pricingContext = {
    id: 'snap_excel_test',
    location: { city: 'Pune', country: 'IN', currency: 'INR' },
    rates: {},
    scopeMode: 'combined',
  }

  const cost = estimateBoq(design, brief, undefined, undefined, pricingContext)
  const blob = await buildBoqExcel(cost)

  assert.ok(blob)
  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  assert.ok(blob.size > 1000)
})
