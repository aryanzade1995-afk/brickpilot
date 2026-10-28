import test from 'node:test'
import assert from 'node:assert/strict'
import {
  researchLocationSchema,
  scopeModeSchema,
  researchTargetSchema,
  sourceDocumentSchema,
  extractedEvidenceSchema,
  normalizedEvidenceSchema,
  proposedRateSchema,
  researchedRateOverrideSchema,
  manualRateOverrideSchema,
  acceptedPricingSnapshotSchema,
  interiorScheduleItemSchema,
  interiorItemScheduleSchema,
  pricingContextSchema,
  costResearchJobSchema,
} from '../src/lib/cost/research/schemas.ts'

test('researchLocationSchema validates Indian locations and rejects invalid currencies or pincodes', () => {
  const valid = researchLocationSchema.parse({
    city: 'Pune',
    state: 'Maharashtra',
    pincode: '411001',
    country: 'IN',
    currency: 'INR',
  })
  assert.equal(valid.city, 'Pune')
  assert.equal(valid.currency, 'INR')

  // Reject invalid pincode (must be 6 digits starting 1-9)
  assert.throws(() => {
    researchLocationSchema.parse({ city: 'Pune', pincode: '012345' })
  })

  // Reject invalid currency
  assert.throws(() => {
    researchLocationSchema.parse({ city: 'Pune', currency: 'USD' })
  })
})

test('scopeModeSchema permits only construction, interiors, and combined', () => {
  assert.equal(scopeModeSchema.parse('construction'), 'construction')
  assert.equal(scopeModeSchema.parse('interiors'), 'interiors')
  assert.equal(scopeModeSchema.parse('combined'), 'combined')
  assert.throws(() => scopeModeSchema.parse('everything'))
})

test('extractedEvidenceSchema enforces strict types, non-negative price, and valid ISO timestamps', () => {
  const now = new Date().toISOString()
  const today = now.slice(0, 10)

  const evidence = {
    evidenceId: 'ev_concrete_doc1',
    targetId: 'target_boq-concrete-m20',
    rateId: 'boq-concrete-m20',
    docId: 'doc_123',
    url: 'https://supplier.example.in/m20-concrete',
    publisher: 'Pune RMC Supply',
    publishedDate: today,
    fetchTimestamp: now,
    quotedPrice: 4250,
    quotedCurrency: 'INR',
    quotedUnit: 'm3',
    packSize: null,
    pricingBasis: 'supply-only',
    taxIncluded: 'unknown',
    deliveryIncluded: true,
    minOrder: '6 m3 transit mixer',
    locationMentioned: 'Pune',
    excerpt: 'UltraTech M20 grade ready-mix concrete price in Pune is Rs 4,250 per cubic metre',
    confidenceReasoning: 'Matches M20 RMC specification in Pune',
    specificationMatch: 'UltraTech M20 RMC',
  }

  const parsed = extractedEvidenceSchema.parse(evidence)
  assert.equal(parsed.quotedPrice, 4250)

  // Negative price must be rejected
  assert.throws(() => {
    extractedEvidenceSchema.parse({ ...evidence, quotedPrice: -500 })
  })

  // Non-INR currency must be rejected
  assert.throws(() => {
    extractedEvidenceSchema.parse({ ...evidence, quotedCurrency: 'EUR' })
  })
})

test('normalizedEvidenceSchema includes material, labour, and installed rates with conversion assumptions', () => {
  const now = new Date().toISOString()
  const norm = {
    evidenceId: 'ev_tiles_doc2',
    targetId: 'target_floor-living',
    rateId: 'spec-tile-gvt-1200x600',
    docId: 'doc_456',
    url: 'https://tiles.example.in/gvt-60x120',
    publisher: 'Kajaria Gallery',
    publishedDate: null,
    fetchTimestamp: now,
    quotedPrice: 62,
    quotedCurrency: 'INR',
    quotedUnit: 'sqft',
    packSize: 15.5,
    pricingBasis: 'supply-only',
    taxIncluded: false,
    deliveryIncluded: false,
    minOrder: '10 boxes',
    locationMentioned: 'Pune',
    excerpt: 'Kajaria 600x1200 mm floor tiles Rs 62 per sq ft',
    confidenceReasoning: 'Direct price per sqft',
    specificationMatch: '600x1200 GVT',
    normalizedMaterialRate: 667.36,
    normalizedLabourRate: 250,
    normalizedInstalledRate: 917.36,
    targetUnit: 'm²',
    conversionAssumptions: ['Converted from Rs 62/sqft to Rs 667/m² using factor 10.7639'],
    valid: true,
  }

  const parsed = normalizedEvidenceSchema.parse(norm)
  assert.equal(parsed.valid, true)
  assert.equal(parsed.normalizedInstalledRate, 917.36)
})

test('proposedRateSchema validates status, difference percentage, and baseline comparison', () => {
  const now = new Date().toISOString()
  const prop = {
    rateId: 'boq-concrete-m20',
    targetId: 'target_boq-concrete-m20',
    itemId: 'concrete',
    itemLabel: 'Ready-mix concrete M20',
    trade: 'Civil & structure',
    unit: 'm³',
    baselineMaterial: 4200,
    baselineLabour: 1200,
    baselineInstalled: 5400,
    proposedMaterial: 4250,
    proposedLabour: 1200,
    proposedInstalled: 5450,
    pricingBasis: 'hybrid',
    differencePercent: 0.9,
    evidence: [],
    status: 'accepted',
    selectionReason: 'Verified supplier quotation aligned with baseline labour',
    freshnessDate: now.slice(0, 10),
  }

  const parsed = proposedRateSchema.parse(prop)
  assert.equal(parsed.status, 'accepted')
  assert.equal(parsed.differencePercent, 0.9)
})

test('acceptedPricingSnapshotSchema records snapshot metadata, rates, and unresolved gaps', () => {
  const now = new Date().toISOString()
  const snapshot = {
    id: 'snapshot_1730000000',
    createdAt: now,
    location: { city: 'Pune', country: 'IN', currency: 'INR' },
    scope: 'combined',
    sourceFingerprint: 'f0a1b2c3d4e5',
    rates: {
      'boq-concrete-m20': {
        rateId: 'boq-concrete-m20',
        unit: 'm³',
        material: 4250,
        labour: 1200,
        installed: 5450,
        pricingBasis: 'hybrid',
        sources: [
          {
            url: 'https://rmc.example.in',
            publisher: 'Ultratech Pune',
            date: now.slice(0, 10),
            fetchTimestamp: now,
            excerpt: 'Rs 4,250 per cubic metre',
          },
        ],
        appliedAt: now,
        notes: 'Verified supplier rate',
      },
    },
    unresolvedGaps: [
      {
        rateId: 'boq-custom-timber',
        itemLabel: 'Custom timber joinery',
        reason: 'No supplier quotes found for specialty timber in Pune',
      },
    ],
  }

  const parsed = acceptedPricingSnapshotSchema.parse(snapshot)
  assert.equal(parsed.rates['boq-concrete-m20'].installed, 5450)
  assert.equal(parsed.unresolvedGaps.length, 1)
})
