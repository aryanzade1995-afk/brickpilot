import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeEvidence,
  buildRateProposal,
  getCanonicalPublisher,
  computeFreshnessBand,
} from '../server/research/normalizer.mjs'
import { outlierConfig } from '../server/research/config.mjs'

const sampleTarget = {
  targetId: 't_steel',
  rateId: 'boq-steel',
  itemId: 'steel-tmt',
  itemLabel: 'TMT Reinforcement Steel',
  trade: 'Civil & structure',
  requiredUnit: 'kg',
  baseline: { material: 70, labour: 15, installed: 85 },
}

const sampleTargetInstalled = {
  targetId: 't_conc',
  rateId: 'concrete-grade-m20',
  itemId: 'concrete-grade',
  itemLabel: 'M20 Concrete Ready-Mix',
  trade: 'Civil & structure',
  requiredUnit: 'm³',
  baseline: { material: 4700, labour: 1800, installed: 6500 },
}

// Fixed reference date for deterministic freshness testing: 2026-10-24
const REF_DATE = new Date('2026-10-24T12:00:00Z')

test('Canonical Publisher: Canonicalizes domains and deduplicates subdomains', () => {
  assert.equal(getCanonicalPublisher({ url: 'https://www.indiamart.com/proddetail/item1.html' }), 'indiamart.com')
  assert.equal(getCanonicalPublisher({ url: 'https://indiamart.com/company/profile.html' }), 'indiamart.com')
  assert.equal(getCanonicalPublisher({ url: 'https://sub.supplier.co.in/path?query=1' }), 'sub.supplier.co.in')
  assert.equal(getCanonicalPublisher({ url: 'invalid-url', publisher: 'UltraTech Cement Ltd' }), 'ultratech cement ltd')
  assert.equal(getCanonicalPublisher({ publisher: 'Tata Steel ' }), 'tata steel')
  assert.equal(getCanonicalPublisher({}), 'unknown')
})

test('Freshness Bands: Correctly categorizes fresh (<=90d), aging (91-180d), and stale (>180d)', () => {
  // 1. Fresh (30 days old: 2026-09-24)
  const fresh = computeFreshnessBand('2026-09-24', REF_DATE)
  assert.equal(fresh.band, 'fresh')
  assert.equal(fresh.daysOld, 30)

  // 2. Exactly at fresh boundary (90 days old: 2026-07-26)
  const freshBoundary = computeFreshnessBand('2026-07-26', REF_DATE)
  assert.equal(freshBoundary.band, 'fresh')
  assert.equal(freshBoundary.daysOld, 90)

  // 3. Aging (120 days old: 2026-06-26)
  const aging = computeFreshnessBand('2026-06-26', REF_DATE)
  assert.equal(aging.band, 'aging')
  assert.equal(aging.daysOld, 120)

  // 4. Exactly at acceptable boundary (180 days old: 2026-04-27)
  const agingBoundary = computeFreshnessBand('2026-04-27', REF_DATE)
  assert.equal(agingBoundary.band, 'aging')
  assert.equal(agingBoundary.daysOld, 180)

  // 5. Stale (>180 days old, e.g. 250 days old: 2026-02-16)
  const stale = computeFreshnessBand('2026-02-16', REF_DATE)
  assert.equal(stale.band, 'stale')
  assert.ok(stale.daysOld > 180)

  // 6. Unknown date defaults to aging
  const unknownDate = computeFreshnessBand(null, REF_DATE)
  assert.equal(unknownDate.band, 'aging')
  assert.equal(unknownDate.daysOld, null)
})

test('Publisher Deduplication: Multiple quotes from the same domain count as ONE publisher', () => {
  // 3 quotes from the SAME domain (indiamart.com)
  const quotesFromSameDomain = [
    {
      evidenceId: 'e1',
      valid: true,
      url: 'https://www.indiamart.com/seller1/steel',
      publisher: 'Seller 1 on IndiaMART',
      normalizedMaterialRate: 68,
      normalizedLabourRate: 15,
      normalizedInstalledRate: 83,
      pricingBasis: 'supply-only',
      publishedDate: '2026-10-10',
    },
    {
      evidenceId: 'e2',
      valid: true,
      url: 'https://www.indiamart.com/seller2/steel',
      publisher: 'Seller 2 on IndiaMART',
      normalizedMaterialRate: 70,
      normalizedLabourRate: 15,
      normalizedInstalledRate: 85,
      pricingBasis: 'supply-only',
      publishedDate: '2026-10-12',
    },
    {
      evidenceId: 'e3',
      valid: true,
      url: 'https://www.indiamart.com/seller3/steel',
      publisher: 'Seller 3 on IndiaMART',
      normalizedMaterialRate: 69,
      normalizedLabourRate: 15,
      normalizedInstalledRate: 84,
      pricingBasis: 'supply-only',
      publishedDate: '2026-10-15',
    },
  ]

  const proposal = buildRateProposal(sampleTarget, quotesFromSameDomain, { referenceDate: REF_DATE })

  // Must NOT form accepted consensus; must be classified as single-source
  assert.equal(proposal.status, 'single-source')
  assert.notEqual(proposal.status, 'accepted')
  assert.ok(proposal.selectionReason.includes('indiamart.com'))
  assert.ok(proposal.selectionReason.includes('3 quotes'))
})

test('Freshness Exclusion: Stale quotes (>180d) cannot form accepted consensus', () => {
  // 1. All quotes are stale -> proposal status is 'stale'
  const staleQuotes = [
    {
      evidenceId: 's1',
      valid: true,
      url: 'https://supplier-a.com/steel',
      publisher: 'Supplier A',
      normalizedMaterialRate: 65,
      normalizedLabourRate: 15,
      normalizedInstalledRate: 80,
      pricingBasis: 'supply-only',
      publishedDate: '2025-10-01', // ~388 days old
    },
    {
      evidenceId: 's2',
      valid: true,
      url: 'https://supplier-b.com/steel',
      publisher: 'Supplier B',
      normalizedMaterialRate: 66,
      normalizedLabourRate: 15,
      normalizedInstalledRate: 81,
      pricingBasis: 'supply-only',
      publishedDate: '2025-11-01', // ~357 days old
    },
  ]

  const staleProposal = buildRateProposal(sampleTarget, staleQuotes, { referenceDate: REF_DATE })
  assert.equal(staleProposal.status, 'stale')
  assert.ok(staleProposal.selectionReason.includes('stale'))

  // 2. One fresh quote and one stale quote:
  // Stale quote is excluded, leaving 1 independent fresh source -> single-source, NOT accepted!
  const mixedQuotes = [
    {
      evidenceId: 'fresh_1',
      valid: true,
      url: 'https://supplier-a.com/steel',
      publisher: 'Supplier A',
      normalizedMaterialRate: 68,
      normalizedLabourRate: 15,
      normalizedInstalledRate: 83,
      pricingBasis: 'supply-only',
      publishedDate: '2026-10-10', // 14 days old (fresh)
    },
    {
      evidenceId: 'stale_1',
      valid: true,
      url: 'https://supplier-b.com/steel',
      publisher: 'Supplier B',
      normalizedMaterialRate: 67,
      normalizedLabourRate: 15,
      normalizedInstalledRate: 82,
      pricingBasis: 'supply-only',
      publishedDate: '2025-10-01', // stale (> 180d)
    },
  ]

  const mixedProposal = buildRateProposal(sampleTarget, mixedQuotes, { referenceDate: REF_DATE })
  assert.equal(mixedProposal.status, 'single-source')
  assert.notEqual(mixedProposal.status, 'accepted')
})

test('Median Clustering: Prunes extreme deviants (>25% from median) and accepts agreeing consensus', () => {
  // 3 independent publishers:
  // Pub A: Rs 6,500/m³ (Steel Infra)
  // Pub B: Rs 6,700/m³ (RMC Depot)
  // Pub C: Rs 15,000/m³ (Extravagant / rogue quote)
  const quotes = [
    {
      evidenceId: 'q1',
      valid: true,
      url: 'https://steel-infra.com/concrete',
      publisher: 'Steel Infra',
      normalizedMaterialRate: 4700,
      normalizedLabourRate: 1800,
      normalizedInstalledRate: 6500,
      pricingBasis: 'supply-only',
      publishedDate: '2026-10-01',
    },
    {
      evidenceId: 'q2',
      valid: true,
      url: 'https://rmc-depot.com/concrete',
      publisher: 'RMC Depot',
      normalizedMaterialRate: 4900,
      normalizedLabourRate: 1800,
      normalizedInstalledRate: 6700,
      pricingBasis: 'supply-only',
      publishedDate: '2026-10-05',
    },
    {
      evidenceId: 'q3',
      valid: true,
      url: 'https://luxury-concreting.com/concrete',
      publisher: 'Luxury Concreting',
      normalizedMaterialRate: 13200,
      normalizedLabourRate: 1800,
      normalizedInstalledRate: 15000,
      pricingBasis: 'supply-only',
      publishedDate: '2026-10-10',
    },
  ]

  const proposal = buildRateProposal(sampleTargetInstalled, quotes, { referenceDate: REF_DATE })

  // Median is 6700. Deviation of 15000 is 123% > 25% tolerance -> pruned!
  // Agreeing cluster has Steel Infra (6500) and RMC Depot (6700) -> 2 independent sources
  assert.equal(proposal.status, 'accepted')
  assert.equal(proposal.proposedInstalled, 6600)
  assert.ok(proposal.selectionReason.includes('Pruned 1 outlier source'))
  assert.ok(proposal.selectionReason.includes('consensus across 2 independent supplier sources'))
})

test('Spread Cap Boundary: Agreeing cluster with spread <=35% accepted, >35% transitions to conflict', () => {
  // Case A: Spread is 30% (below 35% cap) -> accepted
  // Pub 1 = 1000, Pub 2 = 1420 -> spread = (1420 - 1000) / 1420 = 29.58%
  const withinCapQuotes = [
    {
      evidenceId: 'c1',
      valid: true,
      url: 'https://source-a.in/steel',
      publisher: 'Source A',
      normalizedMaterialRate: 1000,
      normalizedLabourRate: 0,
      normalizedInstalledRate: 1000,
      pricingBasis: 'supply-only',
      publishedDate: '2026-10-10',
    },
    {
      evidenceId: 'c2',
      valid: true,
      url: 'https://source-b.in/steel',
      publisher: 'Source B',
      normalizedMaterialRate: 1420,
      normalizedLabourRate: 0,
      normalizedInstalledRate: 1420,
      pricingBasis: 'supply-only',
      publishedDate: '2026-10-12',
    },
  ]

  // With cluster tolerance relaxed to 0.35 to isolate the spread cap
  const withinProposal = buildRateProposal(sampleTarget, withinCapQuotes, {
    referenceDate: REF_DATE,
    config: { clusterTolerance: 0.35, maxSpreadRatio: 0.35 },
  })
  assert.equal(withinProposal.status, 'accepted')

  // Case B: Spread is 38% (exceeds 35% cap) -> conflict
  // Pub 1 = 1000, Pub 2 = 1620 -> spread = (1620 - 1000) / 1620 = 38.2%
  const exceedingCapQuotes = [
    {
      evidenceId: 'c3',
      valid: true,
      url: 'https://source-a.in/steel',
      publisher: 'Source A',
      normalizedMaterialRate: 1000,
      normalizedLabourRate: 0,
      normalizedInstalledRate: 1000,
      pricingBasis: 'supply-only',
      publishedDate: '2026-10-10',
    },
    {
      evidenceId: 'c4',
      valid: true,
      url: 'https://source-b.in/steel',
      publisher: 'Source B',
      normalizedMaterialRate: 1620,
      normalizedLabourRate: 0,
      normalizedInstalledRate: 1620,
      pricingBasis: 'supply-only',
      publishedDate: '2026-10-12',
    },
  ]

  const exceedingProposal = buildRateProposal(sampleTarget, exceedingCapQuotes, {
    referenceDate: REF_DATE,
    config: { clusterTolerance: 0.40, maxSpreadRatio: 0.35 },
  })
  assert.equal(exceedingProposal.status, 'conflict')
  assert.ok(exceedingProposal.selectionReason.includes('exceeding 35% spread cap'))
})

test('Single-Source Guardrails: Single source cannot be promoted to accepted and checks baseline bounds', () => {
  // Case 1: Plausible single source within conservative bounds (0.4 to 2.5 of baseline)
  const plausibleSingle = [
    {
      evidenceId: 'single_1',
      valid: true,
      url: 'https://exclusive-supplier.in/steel',
      publisher: 'Exclusive Steel',
      normalizedMaterialRate: 72,
      normalizedLabourRate: 15,
      normalizedInstalledRate: 87,
      pricingBasis: 'supply-only',
      publishedDate: '2026-10-15',
    },
  ]

  const singleProp = buildRateProposal(sampleTarget, plausibleSingle, { referenceDate: REF_DATE })
  assert.equal(singleProp.status, 'single-source')
  assert.notEqual(singleProp.status, 'accepted')
  assert.ok(singleProp.selectionReason.includes('single source requires manual verification'))

  // Case 2: Extreme single source outside conservative bounds (e.g. 3.5x baseline) -> conflict
  const extremeSingle = [
    {
      evidenceId: 'single_extreme',
      valid: true,
      url: 'https://exclusive-supplier.in/steel',
      publisher: 'Exclusive Steel',
      normalizedMaterialRate: 300,
      normalizedLabourRate: 15,
      normalizedInstalledRate: 315,
      pricingBasis: 'supply-only',
      publishedDate: '2026-10-15',
    },
  ]

  const extremeProp = buildRateProposal(sampleTarget, extremeSingle, { referenceDate: REF_DATE })
  assert.equal(extremeProp.status, 'conflict')
  assert.ok(extremeProp.selectionReason.includes('diverges from baseline'))
})

test('Environment Configuration Overrides: Custom thresholds dynamically alter consensus behavior', () => {
  // Two sources with 22% spread: 1000 and 1280 (spread: 21.8%)
  const quotes = [
    {
      evidenceId: 'o1',
      valid: true,
      url: 'https://pub-1.in/item',
      publisher: 'Pub 1',
      normalizedMaterialRate: 1000,
      normalizedLabourRate: 0,
      normalizedInstalledRate: 1000,
      pricingBasis: 'supply-only',
      publishedDate: '2026-10-10',
    },
    {
      evidenceId: 'o2',
      valid: true,
      url: 'https://pub-2.in/item',
      publisher: 'Pub 2',
      normalizedMaterialRate: 1280,
      normalizedLabourRate: 0,
      normalizedInstalledRate: 1280,
      pricingBasis: 'supply-only',
      publishedDate: '2026-10-12',
    },
  ]

  // Default maxSpreadRatio (35%): Accepted
  const defaultProp = buildRateProposal(sampleTarget, quotes, { referenceDate: REF_DATE })
  assert.equal(defaultProp.status, 'accepted')

  // Overridden maxSpreadRatio = 15% (0.15): 21.8% exceeds 15% -> Conflict!
  const strictSpreadProp = buildRateProposal(sampleTarget, quotes, {
    referenceDate: REF_DATE,
    config: { maxSpreadRatio: 0.15 },
  })
  assert.equal(strictSpreadProp.status, 'conflict')
  assert.ok(strictSpreadProp.selectionReason.includes('exceeding 15% spread cap'))

  // Overridden minIndependentPublishers = 3: 2 sources insufficient -> Conflict!
  const threePubProp = buildRateProposal(sampleTarget, quotes, {
    referenceDate: REF_DATE,
    config: { minIndependentPublishers: 3 },
  })
  assert.equal(threePubProp.status, 'conflict')
  assert.ok(threePubProp.selectionReason.includes('Fewer than 3 independent sources agree'))
})
