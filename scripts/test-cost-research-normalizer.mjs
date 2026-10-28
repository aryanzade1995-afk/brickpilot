import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeEvidence, buildRateProposal } from '../server/research/normalizer.mjs'

test('normalizeEvidence correctly converts sqft to m² with factor ~10.7639', () => {
  const target = {
    targetId: 't_floor',
    rateId: 'floor-living-vitrified',
    requiredUnit: 'm²',
    trade: 'Flooring & tiling',
  }
  const baseline = { material: 600, labour: 250, installed: 850 }
  const evidence = {
    evidenceId: 'ev_1',
    quotedPrice: 65,
    quotedUnit: 'sqft',
    pricingBasis: 'supply-only',
    packSize: null,
  }

  const norm = normalizeEvidence(target, evidence, baseline)
  assert.equal(norm.valid, true)
  assert.equal(norm.targetUnit, 'm²')
  // 65 * 10.7639104 = 699.65
  assert.equal(Math.round(norm.normalizedMaterialRate), 700)
  assert.equal(norm.normalizedLabourRate, 250)
  assert.equal(Math.round(norm.normalizedInstalledRate), 950)
  assert.ok(norm.conversionAssumptions[0].includes('sqft to Rs'))
})

test('normalizeEvidence converts tile box pricing only when box coverage is known', () => {
  const target = {
    targetId: 't_floor',
    rateId: 'floor-living-vitrified',
    requiredUnit: 'm²',
    trade: 'Flooring & tiling',
  }
  const baseline = { material: 600, labour: 250, installed: 850 }

  // Case 1: Box coverage is known (15.5 sqft)
  const normWithCoverage = normalizeEvidence(
    target,
    {
      evidenceId: 'ev_box_ok',
      quotedPrice: 961,
      quotedUnit: 'box',
      pricingBasis: 'supply-only',
      packSize: 15.5,
    },
    baseline,
  )
  assert.equal(normWithCoverage.valid, true)
  assert.equal(Math.round(normWithCoverage.normalizedMaterialRate), 667)

  // Case 2: Box coverage is null/missing -> must reject
  const normNoCoverage = normalizeEvidence(
    target,
    {
      evidenceId: 'ev_box_bad',
      quotedPrice: 961,
      quotedUnit: 'box',
      pricingBasis: 'supply-only',
      packSize: null,
    },
    baseline,
  )
  assert.equal(normNoCoverage.valid, false)
  assert.ok(normNoCoverage.rejectionReason.includes('Tile box pricing quoted without explicit coverage area'))
})

test('normalizeEvidence rejects raw cement bag or steel for ready-mix concrete assembly', () => {
  const target = {
    targetId: 't_conc',
    rateId: 'boq-concrete-m20',
    requiredUnit: 'm³',
    trade: 'Civil & structure',
  }
  const baseline = { material: 4500, labour: 1500, installed: 6000 }

  const normBag = normalizeEvidence(
    target,
    {
      evidenceId: 'ev_cement_bag',
      quotedPrice: 380,
      quotedUnit: '50kg bag',
      pricingBasis: 'supply-only',
      packSize: 50,
    },
    baseline,
  )

  assert.equal(normBag.valid, false)
  assert.ok(normBag.rejectionReason.includes('Cannot substitute raw cement bag or steel price directly for ready-mix concrete'))
})

test('normalizeEvidence rejects extreme price outliers (< 20% or > 500% of baseline)', () => {
  const target = {
    targetId: 't_conc',
    rateId: 'concrete-grade-m20',
    requiredUnit: 'm³',
    trade: 'Civil & structure',
  }
  const baseline = { material: 4680, labour: 1820, installed: 6500 }

  // Extreme low outlier (e.g. Rs 500 installed vs Rs 6500 baseline)
  const normLow = normalizeEvidence(
    target,
    {
      evidenceId: 'ev_low',
      quotedPrice: 200,
      quotedUnit: 'm3',
      pricingBasis: 'installed',
      packSize: null,
    },
    baseline,
  )
  assert.equal(normLow.valid, false)
  assert.ok(normLow.rejectionReason.includes('Outlier'))

  // Extreme high outlier (e.g. Rs 50,000 vs Rs 6500 baseline)
  const normHigh = normalizeEvidence(
    target,
    {
      evidenceId: 'ev_high',
      quotedPrice: 50000,
      quotedUnit: 'm3',
      pricingBasis: 'installed',
      packSize: null,
    },
    baseline,
  )
  assert.equal(normHigh.valid, false)
  assert.ok(normHigh.rejectionReason.includes('Outlier'))
})

test('buildRateProposal handles consensus, conflict, and fallback states', () => {
  const target = {
    targetId: 't_conc',
    rateId: 'concrete-grade-m20',
    itemId: 'concrete-grade',
    itemLabel: 'M20 Concrete',
    trade: 'Civil & structure',
    requiredUnit: 'm³',
  }

  // 1. Fallback state when evidence is empty
  const fallbackProp = buildRateProposal(target, [])
  assert.equal(fallbackProp.status, 'provisional-fallback')
  assert.equal(fallbackProp.proposedInstalled, fallbackProp.baselineInstalled)

  // 2. Consensus state: 2 sources in close agreement
  const consensusProp = buildRateProposal(target, [
    {
      evidenceId: 'e1',
      valid: true,
      normalizedMaterialRate: 4800,
      normalizedLabourRate: 1820,
      normalizedInstalledRate: 6620,
      pricingBasis: 'supply-only',
      publisher: 'RMC Supplier A',
    },
    {
      evidenceId: 'e2',
      valid: true,
      normalizedMaterialRate: 5000,
      normalizedLabourRate: 1820,
      normalizedInstalledRate: 6820,
      pricingBasis: 'supply-only',
      publisher: 'RMC Supplier B',
    },
  ])
  assert.equal(consensusProp.status, 'accepted')
  assert.equal(consensusProp.proposedInstalled, 6720)
  assert.ok(consensusProp.selectionReason.includes('consensus across 2 independent supplier sources'))

  // 3. Conflict state: 2 sources with large divergence (> 40%)
  const conflictProp = buildRateProposal(target, [
    {
      evidenceId: 'e1',
      valid: true,
      normalizedMaterialRate: 4000,
      normalizedLabourRate: 1820,
      normalizedInstalledRate: 5820,
      pricingBasis: 'supply-only',
      publisher: 'Supplier Cheap',
    },
    {
      evidenceId: 'e2',
      valid: true,
      normalizedMaterialRate: 9000,
      normalizedLabourRate: 1820,
      normalizedInstalledRate: 10820,
      pricingBasis: 'supply-only',
      publisher: 'Supplier Ultra',
    },
  ])
  assert.equal(conflictProp.status, 'conflict')
  assert.ok(conflictProp.selectionReason.includes('divergent rates'))
})

test('buildRateProposal marks installed turnkey quotes without split as unresolved and never invents splits', () => {
  const target = {
    targetId: 't_conc',
    rateId: 'concrete-grade-m20',
    itemId: 'concrete-grade',
    itemLabel: 'M20 Concrete',
    trade: 'Civil & structure',
    requiredUnit: 'm³',
  }

  // 1. Single installed quote without split
  const singleInstalledProp = buildRateProposal(target, [
    {
      evidenceId: 'e_inst_1',
      valid: true,
      normalizedMaterialRate: null,
      normalizedLabourRate: null,
      normalizedInstalledRate: 7200,
      pricingBasis: 'installed',
      publisher: 'Turnkey Contractor A',
      publishedDate: '2026-10-20',
    },
  ])
  assert.equal(singleInstalledProp.status, 'unresolved')
  assert.equal(singleInstalledProp.proposedInstalled, 7200)
  // Splits must remain baseline, never invented by subtracting baseline labour
  assert.equal(singleInstalledProp.proposedMaterial, singleInstalledProp.baselineMaterial)
  assert.equal(singleInstalledProp.proposedLabour, singleInstalledProp.baselineLabour)
  assert.ok(singleInstalledProp.selectionReason.includes('lacks stated material/labour breakdown'))

  // 2. Consensus of multiple installed quotes without splits
  const consensusInstalledProp = buildRateProposal(target, [
    {
      evidenceId: 'e_inst_1',
      valid: true,
      normalizedMaterialRate: null,
      normalizedLabourRate: null,
      normalizedInstalledRate: 7000,
      pricingBasis: 'installed',
      publisher: 'Turnkey Contractor A',
    },
    {
      evidenceId: 'e_inst_2',
      valid: true,
      normalizedMaterialRate: null,
      normalizedLabourRate: null,
      normalizedInstalledRate: 7200,
      pricingBasis: 'installed',
      publisher: 'Turnkey Contractor B',
    },
  ])
  assert.equal(consensusInstalledProp.status, 'unresolved')
  assert.equal(consensusInstalledProp.proposedInstalled, 7100)
  assert.equal(consensusInstalledProp.proposedMaterial, consensusInstalledProp.baselineMaterial)
  assert.equal(consensusInstalledProp.proposedLabour, consensusInstalledProp.baselineLabour)
  assert.ok(consensusInstalledProp.selectionReason.includes('lacks stated material/labour breakdown'))
})

