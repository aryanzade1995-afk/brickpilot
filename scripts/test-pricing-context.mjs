import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createPricingResolver,
  pricingContextKey,
  classifyTradeScope,
  isLineInScope,
} from '../src/lib/cost/pricingContext.ts'
import { estimateBoq } from '../src/lib/cost/boq.ts'
import { specificationRate, resolveSpecification } from '../src/lib/cost/catalogue.ts'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/index.ts'

test('createPricingResolver falls back to static baseline when no overrides exist', () => {
  const resolver = createPricingResolver(null)
  const baselineRate = specificationRate('concrete-grade-m20')
  const resolved = resolver.getRate('concrete-grade-m20')

  assert.equal(resolved.id, 'concrete-grade-m20')
  assert.equal(resolved.material, baselineRate.material)
  assert.equal(resolved.labour, baselineRate.labour)
  assert.equal(resolved.installed, baselineRate.installed)
  assert.equal(resolved.source, 'baseline')
  assert.equal(resolved.city, 'Pune')
  assert.equal(resolved.date, '2026-10-03')
  assert.equal(resolver.isResearched('concrete-grade-m20'), false)
  assert.equal(resolver.isManual('concrete-grade-m20'), false)
})

test('createPricingResolver prioritizes researched rates over baseline', () => {
  const context = {
    id: 'snap_test_1',
    location: { city: 'Bengaluru', country: 'IN', currency: 'INR' },
    rates: {
      'concrete-grade-m20': {
        rateId: 'concrete-grade-m20',
        unit: 'm³',
        material: 5000,
        labour: 2000,
        installed: 7000,
        pricingBasis: 'hybrid',
        sources: [
          {
            url: 'https://rmc-blr.example.in',
            publisher: 'Bangalore RMC',
            date: '2026-10-24',
            fetchTimestamp: '2026-10-24T12:00:00Z',
            excerpt: 'Rs 5,000 per m3',
          },
        ],
        appliedAt: '2026-10-24T12:00:00Z',
        notes: 'Researched rate in Bengaluru',
      },
    },
  }

  const resolver = createPricingResolver(context)
  const resolved = resolver.getRate('concrete-grade-m20')

  assert.equal(resolved.material, 5000)
  assert.equal(resolved.labour, 2000)
  assert.equal(resolved.installed, 7000)
  assert.equal(resolved.source, 'researched')
  assert.equal(resolved.city, 'Bengaluru')
  assert.equal(resolved.date, '2026-10-24')
  assert.equal(resolver.isResearched('concrete-grade-m20'), true)
  assert.equal(resolver.isManual('concrete-grade-m20'), false)
})

test('createPricingResolver prioritizes manual overrides over researched and baseline rates', () => {
  const context = {
    id: 'snap_test_2',
    location: { city: 'Pune', country: 'IN', currency: 'INR' },
    rates: {
      'concrete-grade-m20': {
        rateId: 'concrete-grade-m20',
        unit: 'm³',
        material: 5000,
        labour: 2000,
        installed: 7000,
        pricingBasis: 'hybrid',
        sources: [],
        appliedAt: '2026-10-24T12:00:00Z',
      },
    },
    manualOverrides: {
      'concrete-grade-m20': {
        rateId: 'concrete-grade-m20',
        unit: 'm³',
        material: 5500,
        labour: 2500,
        installed: 8000,
        updatedAt: '2026-10-24T14:00:00Z',
        reason: 'Client preferred premium grade mix',
      },
    },
  }

  const resolver = createPricingResolver(context)
  const resolved = resolver.getRate('concrete-grade-m20')

  assert.equal(resolved.installed, 8000)
  assert.equal(resolved.source, 'manual')
  assert.equal(resolver.isManual('concrete-grade-m20'), true)
})

test('pricingContextKey produces distinct hash keys when context changes', () => {
  const key1 = pricingContextKey(null)
  const key2 = pricingContextKey({
    id: 'snap_1',
    location: { city: 'Pune', country: 'IN', currency: 'INR' },
    rates: {},
  })
  const key3 = pricingContextKey({
    id: 'snap_2',
    location: { city: 'Mumbai', country: 'IN', currency: 'INR' },
    rates: {
      'reinforcement-fe500d': {
        rateId: 'reinforcement-fe500d',
        unit: 'kg',
        material: 72,
        labour: 8,
        installed: 80,
        pricingBasis: 'hybrid',
        sources: [],
        appliedAt: '2026-10-24T10:00:00Z',
      },
    },
  })

  assert.notEqual(key1, key2)
  assert.notEqual(key2, key3)
})

test('classifyTradeScope and isLineInScope correctly segment trades', () => {
  assert.equal(classifyTradeScope('Civil & structure', 'concrete'), 'construction')
  assert.equal(classifyTradeScope('Masonry & plaster', 'masonry'), 'construction')
  assert.equal(classifyTradeScope('Flooring & tiling', 'floor-living'), 'interiors')
  assert.equal(classifyTradeScope('Painting', 'interior-paint'), 'interiors')

  assert.equal(isLineInScope('Civil & structure', 'concrete', 'combined'), true)
  assert.equal(isLineInScope('Civil & structure', 'concrete', 'construction'), true)
  assert.equal(isLineInScope('Civil & structure', 'concrete', 'interiors'), false)
  assert.equal(isLineInScope('Painting', 'interior-paint', 'interiors'), true)
  assert.equal(isLineInScope('Painting', 'interior-paint', 'construction'), false)
})

test('estimateBoq computes scopeTotals and applies researched rates', () => {
  const brief = defaultBrief()
  const model = compile(brief)
  const design = generate(model)

  const baselineEstimate = estimateBoq(design, brief)
  assert.ok(baselineEstimate.expected > 0)
  assert.ok(baselineEstimate.scopeTotals)
  assert.ok(baselineEstimate.scopeTotals.construction > 0)
  assert.ok(baselineEstimate.scopeTotals.interiors > 0)
  assert.equal(baselineEstimate.scopeTotals.combined, Math.round(baselineEstimate.expected * 100) / 100)

  const concSpec = resolveSpecification(brief, 'concrete-grade')
  const targetRateId = concSpec.rateId

  // Apply researched rate override for concrete
  const pricingContext = {
    id: 'snap_test_cost',
    location: { city: 'Pune', country: 'IN', currency: 'INR' },
    rates: {
      [targetRateId]: {
        rateId: targetRateId,
        unit: 'm³',
        material: 12000,
        labour: 3000,
        installed: 15000,
        pricingBasis: 'hybrid',
        sources: [
          {
            url: 'https://test.example.in',
            publisher: 'Test Supplier',
            date: '2026-10-24',
            fetchTimestamp: '2026-10-24T12:00:00Z',
            excerpt: 'Rs 15,000 per m3',
          },
        ],
        appliedAt: '2026-10-24T12:00:00Z',
      },
    },
  }

  const researchedEstimate = estimateBoq(design, brief, undefined, undefined, pricingContext)
  assert.ok(researchedEstimate.expected > baselineEstimate.expected)

  // Verify that concrete line has researched rateSource
  const concreteLine = researchedEstimate.boq.find((l) => l.rateId === targetRateId)
  assert.ok(concreteLine)
  assert.equal(concreteLine.rate, 15000)
  assert.equal(concreteLine.rateSource, 'researched')
  assert.equal(concreteLine.scopeCategory, 'construction')
})

test('estimateBoq suppresses interiors allowance when user interior schedule specifies replacesAllowanceId', () => {
  const brief = defaultBrief()
  const model = compile(brief)
  const design = generate(model)

  const contextWithInteriors = {
    id: 'snap_interiors',
    location: { city: 'Pune', country: 'IN', currency: 'INR' },
    rates: {},
    interiorSchedule: {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      items: [
        {
          id: 'wardrobe_master',
          roomId: 'f0_bed_master',
          roomName: 'Master Bedroom',
          itemType: 'wardrobe-fitted',
          label: 'Custom Floor-to-Ceiling Wardrobe',
          category: 'joinery',
          count: 1,
          dimensions: { w: 3000, d: 600, h: 2700 },
          specification: 'Marine ply with laminate shutter and soft close hardware',
          estimatedRate: 150000,
          amount: 150000,
          quantityBasis: 'user-entered',
          includedInEstimate: true,
          replacesAllowanceId: 'interiors',
        },
      ],
      totalAmount: 150000,
    },
  }

  const estimate = estimateBoq(design, brief, undefined, undefined, contextWithInteriors)

  // The lump-sum 'interiors' allowance line should NOT be in the BOQ
  const lumpSumLine = estimate.boq.find((l) => l.item === 'interiors')
  assert.equal(lumpSumLine, undefined)

  // The detailed interior schedule item MUST be in the BOQ
  const detailedItem = estimate.boq.find((l) => l.id === 'interior-item:f0_bed_master:wardrobe_master')
  assert.ok(detailedItem)
  assert.equal(detailedItem.amount, 150000)
  assert.equal(detailedItem.scopeCategory, 'interiors')
})
