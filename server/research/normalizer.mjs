import { specificationRate } from '../../src/lib/cost/catalogue.ts'
import { outlierConfig } from './config.mjs'

/**
 * Deterministic evidence normalization, unit conversion, and rate proposal engine.
 * Implements source-agreement outlier logic, publisher deduplication, freshness bands,
 * and spread caps.
 */

const SQFT_TO_M2 = 10.7639104
const CFT_TO_M3 = 35.3146667
const FT_TO_M = 3.2808399

/**
 * Normalizes a single extracted evidence item against the target's required unit and baseline rate.
 */
export function normalizeEvidence(target, evidence, baseline, customConfig = outlierConfig) {
  const assumptions = []
  const quotedUnit = (evidence.quotedUnit || '').toLowerCase().trim()
  const reqUnit = (target.requiredUnit || '').trim()
  const price = evidence.quotedPrice
  const cfg = { ...outlierConfig, ...customConfig }

  let normalizedMaterial = null
  let normalizedLabour = null
  let normalizedInstalled = 0
  let valid = true
  let rejectionReason = undefined

  // Price validity check
  if (price === null || price === undefined || price <= 0 || !Number.isFinite(price)) {
    return {
      ...evidence,
      normalizedMaterialRate: null,
      normalizedLabourRate: null,
      normalizedInstalledRate: 0,
      targetUnit: reqUnit,
      conversionAssumptions: ['Non-positive or non-finite price quoted'],
      valid: false,
      rejectionReason: 'Invalid price: price must be a positive finite number',
    }
  }

  // Safety check 1: Never substitute raw cement bag or steel for ready-mix concrete
  if (target.rateId === 'boq-concrete-m20' && (quotedUnit.includes('bag') || quotedUnit.includes('kg'))) {
    return {
      ...evidence,
      normalizedMaterialRate: null,
      normalizedLabourRate: null,
      normalizedInstalledRate: 0,
      targetUnit: reqUnit,
      conversionAssumptions: ['Incompatible raw material quoted for composite concrete assembly'],
      valid: false,
      rejectionReason: 'Rejected: Cannot substitute raw cement bag or steel price directly for ready-mix concrete rate',
    }
  }

  // Safety check 2: Never substitute steel grade differences unflagged
  if (target.rateId === 'boq-steel' && quotedUnit.includes('m3')) {
    return {
      ...evidence,
      normalizedMaterialRate: null,
      normalizedLabourRate: null,
      normalizedInstalledRate: 0,
      targetUnit: reqUnit,
      conversionAssumptions: ['Incompatible unit m3 for steel reinforcement'],
      valid: false,
      rejectionReason: 'Rejected: Incompatible volume unit for steel rebars',
    }
  }

  // Unit conversion logic
  let unitConvertedPrice = price

  if (reqUnit === 'm²') {
    if (['sqft', 'sq ft', 'sq.ft', 'sft'].includes(quotedUnit)) {
      unitConvertedPrice = price * SQFT_TO_M2
      assumptions.push(`Converted from Rs ${price}/sqft to Rs ${Math.round(unitConvertedPrice)}/m² using standard factor ${SQFT_TO_M2.toFixed(4)}`)
    } else if (quotedUnit.includes('box') || quotedUnit.includes('carton')) {
      if (evidence.packSize && evidence.packSize > 0) {
        const sqftPerBox = evidence.packSize
        const pricePerSqft = price / sqftPerBox
        unitConvertedPrice = pricePerSqft * SQFT_TO_M2
        assumptions.push(`Converted from box (Rs ${price} for ${sqftPerBox} sqft) to Rs ${Math.round(unitConvertedPrice)}/m²`)
      } else {
        valid = false
        rejectionReason = 'Tile box pricing quoted without explicit coverage area in m² or sqft'
      }
    } else if (quotedUnit.includes('bucket') || quotedUnit.includes('20l') || quotedUnit.includes('litre')) {
      const litres = evidence.packSize && evidence.packSize > 0 ? evidence.packSize : 20
      const coverageM2 = litres * 7.0
      unitConvertedPrice = price / coverageM2
      assumptions.push(`Converted from ${litres}L paint pack (Rs ${price}) assuming 2-coat standard coverage of 7 m²/L (~${coverageM2} m² total coverage)`)
    } else if (['m2', 'm²', 'sqm'].includes(quotedUnit)) {
      unitConvertedPrice = price
    } else {
      valid = false
      rejectionReason = `Unsupported unit '${quotedUnit}' for target area unit '${reqUnit}'`
    }
  } else if (reqUnit === 'kg') {
    if (['tonne', 'metric tonne', 'mt'].includes(quotedUnit)) {
      unitConvertedPrice = price / 1000
      assumptions.push(`Converted from Rs ${price}/metric tonne to Rs ${unitConvertedPrice.toFixed(2)}/kg (/ 1000)`)
    } else if (['quintal', 'q'].includes(quotedUnit)) {
      unitConvertedPrice = price / 100
      assumptions.push(`Converted from Rs ${price}/quintal to Rs ${unitConvertedPrice.toFixed(2)}/kg (/ 1000)`)
    } else if (quotedUnit === 'kg') {
      unitConvertedPrice = price
    } else {
      valid = false
      rejectionReason = `Unsupported unit '${quotedUnit}' for target weight unit 'kg'`
    }
  } else if (reqUnit === 'm³') {
    if (['cft', 'cu.ft', 'cubic feet'].includes(quotedUnit)) {
      unitConvertedPrice = price * CFT_TO_M3
      assumptions.push(`Converted from Rs ${price}/cft to Rs ${Math.round(unitConvertedPrice)}/m³ (* ${CFT_TO_M3.toFixed(4)})`)
    } else if (['m3', 'm²', 'cum', 'cubic metre'].includes(quotedUnit)) {
      unitConvertedPrice = price
    } else {
      valid = false
      rejectionReason = `Unsupported unit '${quotedUnit}' for target volume unit 'm³'`
    }
  } else if (reqUnit === 'm') {
    if (['ft', 'foot', 'feet'].includes(quotedUnit)) {
      unitConvertedPrice = price * FT_TO_M
      assumptions.push(`Converted from Rs ${price}/ft to Rs ${Math.round(unitConvertedPrice)}/m (* ${FT_TO_M.toFixed(4)})`)
    } else if (['m', 'metre', 'meter'].includes(quotedUnit)) {
      unitConvertedPrice = price
    } else {
      valid = false
      rejectionReason = `Unsupported unit '${quotedUnit}' for target length unit 'm'`
    }
  } else if (reqUnit === 'item' || reqUnit === 'point') {
    unitConvertedPrice = price
  }

  // Handle pricing basis (supply-only, labour-only, installed)
  if (valid) {
    const basis = evidence.pricingBasis || 'supply-only'
    if (basis === 'supply-only') {
      normalizedMaterial = Math.round(unitConvertedPrice * 100) / 100
      normalizedLabour = baseline.labour
      normalizedInstalled = Math.round((normalizedMaterial + baseline.labour) * 100) / 100
      assumptions.push(`Supply-only material quote; combined with baseline labour rate of Rs ${baseline.labour}/${reqUnit}`)
    } else if (basis === 'labour-only') {
      normalizedLabour = Math.round(unitConvertedPrice * 100) / 100
      normalizedMaterial = baseline.material
      normalizedInstalled = Math.round((baseline.material + normalizedLabour) * 100) / 100
      assumptions.push(`Labour-only quote; combined with baseline material rate of Rs ${baseline.material}/${reqUnit}`)
    } else {
      // Installed
      normalizedInstalled = Math.round(unitConvertedPrice * 100) / 100
      // Never invent material/labour splits by subtracting baseline labour
      normalizedMaterial = null
      normalizedLabour = null
      assumptions.push(`Turnkey installed quotation from supplier (material and labour split not stated in quotation)`)
    }

    // Gross sanity bounds check (protects against gross unit mismatches or billion-rupee parse errors)
    const baselineInstalled = baseline.installed || (baseline.material + baseline.labour)
    if (baselineInstalled > 0) {
      const ratio = normalizedInstalled / baselineInstalled
      if (ratio < cfg.grossSanityMinRatio || ratio > cfg.grossSanityMaxRatio) {
        valid = false
        rejectionReason = `Outlier: Normalized rate Rs ${normalizedInstalled} is ${Math.round(ratio * 100)}% of baseline Rs ${baselineInstalled} (exceeds gross sanity bounds ${cfg.grossSanityMinRatio * 100}%-${cfg.grossSanityMaxRatio * 100}%)`
      }
    }
  }

  return {
    ...evidence,
    normalizedMaterialRate: normalizedMaterial,
    normalizedLabourRate: normalizedLabour,
    normalizedInstalledRate: normalizedInstalled,
    targetUnit: reqUnit,
    conversionAssumptions: assumptions,
    valid,
    rejectionReason,
  }
}

/**
 * Extracts a canonical publisher domain or identifier from evidence.
 */
export function getCanonicalPublisher(evidence) {
  if (evidence?.url) {
    try {
      const parsed = new URL(evidence.url)
      let hostname = parsed.hostname.toLowerCase().trim()
      if (hostname.startsWith('www.')) {
        hostname = hostname.slice(4)
      }
      if (hostname) return hostname
    } catch {
      // Ignore URL parse failure and fallback to publisher name
    }
  }
  if (evidence?.publisher) {
    return evidence.publisher.toLowerCase().trim()
  }
  return 'unknown'
}

/**
 * Classifies an evidence item's publication date into freshness bands.
 * - fresh: <= freshMaxDays (default 90d)
 * - aging: > freshMaxDays and <= acceptableMaxDays (default 91-180d)
 * - stale: > acceptableMaxDays (default > 180d)
 */
export function computeFreshnessBand(publishedDateStr, referenceDate = new Date(), customConfig = outlierConfig) {
  const cfg = { ...outlierConfig, ...customConfig }
  if (!publishedDateStr) {
    return { band: 'aging', daysOld: null }
  }
  const pubDate = new Date(publishedDateStr)
  if (Number.isNaN(pubDate.getTime())) {
    return { band: 'aging', daysOld: null }
  }
  const refTime = referenceDate instanceof Date ? referenceDate.getTime() : new Date(referenceDate).getTime()
  const diffMs = refTime - pubDate.getTime()
  const daysOld = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)))

  if (daysOld <= cfg.freshMaxDays) {
    return { band: 'fresh', daysOld }
  }
  if (daysOld <= cfg.acceptableMaxDays) {
    return { band: 'aging', daysOld }
  }
  return { band: 'stale', daysOld }
}

/**
 * Builds a rate proposal for a target given its normalized evidence items.
 * Enforces publisher deduplication, freshness filtering, median clustering,
 * spread caps, and single-source guardrails.
 */
export function buildRateProposal(target, normalizedEvidenceList, options = {}) {
  let baseline = options.baseline || target.baseline
  if (!baseline) {
    try {
      baseline = specificationRate(target.rateId)
    } catch {
      baseline = { material: 0, labour: 0, installed: 0 }
    }
  }

  const baselineMaterial = baseline.material
  const baselineLabour = baseline.labour
  const baselineInstalled = baseline.installed || (baselineMaterial + baselineLabour)

  const cfg = { ...outlierConfig, ...(options.config || {}) }
  const refDate = options.referenceDate ? new Date(options.referenceDate) : new Date()
  const today = refDate.toISOString().slice(0, 10)

  const validEvidence = normalizedEvidenceList.filter((e) => e.valid)

  if (validEvidence.length === 0) {
    // Retain baseline as provisional fallback
    return {
      rateId: target.rateId,
      targetId: target.targetId,
      itemId: target.itemId,
      itemLabel: target.itemLabel,
      trade: target.trade,
      unit: target.requiredUnit,
      baselineMaterial,
      baselineLabour,
      baselineInstalled,
      proposedMaterial: baselineMaterial,
      proposedLabour: baselineLabour,
      proposedInstalled: baselineInstalled,
      pricingBasis: 'hybrid',
      differencePercent: 0,
      evidence: normalizedEvidenceList,
      status: 'provisional-fallback',
      selectionReason: 'No verified live supplier quotations found; retaining baseline provisional concept rate.',
      freshnessDate: today,
    }
  }

  // 1. Freshness assessment: Classify each quote
  const annotatedEvidence = validEvidence.map((e) => {
    const freshness = computeFreshnessBand(e.publishedDate, refDate, cfg)
    return {
      ...e,
      freshnessBand: freshness.band,
      daysOld: freshness.daysOld,
    }
  })

  // Separate non-stale quotes (fresh or aging) from stale quotes (> acceptableMaxDays)
  const nonStaleEvidence = annotatedEvidence.filter((e) => e.freshnessBand !== 'stale')
  const staleEvidence = annotatedEvidence.filter((e) => e.freshnessBand === 'stale')

  // If ALL quotes are stale: cannot establish accepted consensus
  if (nonStaleEvidence.length === 0) {
    const singleOrFirst = staleEvidence[0]
    return {
      rateId: target.rateId,
      targetId: target.targetId,
      itemId: target.itemId,
      itemLabel: target.itemLabel,
      trade: target.trade,
      unit: target.requiredUnit,
      baselineMaterial,
      baselineLabour,
      baselineInstalled,
      proposedMaterial: baselineMaterial,
      proposedLabour: baselineLabour,
      proposedInstalled: baselineInstalled,
      pricingBasis: 'hybrid',
      differencePercent: 0,
      evidence: normalizedEvidenceList,
      status: 'stale',
      selectionReason: `All found supplier quotations (${staleEvidence.length}) are older than ${cfg.acceptableMaxDays} days (stale). Cannot establish active market consensus.`,
      freshnessDate: singleOrFirst.publishedDate || today,
    }
  }

  // 2. Group/deduplicate non-stale quotes by canonical publisher domain
  const publisherMap = new Map()
  for (const ev of nonStaleEvidence) {
    const pub = getCanonicalPublisher(ev)
    if (!publisherMap.has(pub)) {
      publisherMap.set(pub, [])
    }
    publisherMap.get(pub).push(ev)
  }

  // For each independent publisher, determine representative quote and median rate
  const independentPublishers = []
  for (const [publisher, quotes] of publisherMap.entries()) {
    const sortedQuotes = [...quotes].sort((a, b) => a.normalizedInstalledRate - b.normalizedInstalledRate)
    const midIdx = Math.floor(sortedQuotes.length / 2)
    const repQuote = sortedQuotes[midIdx]
    const medianRate = sortedQuotes.length % 2 === 1
      ? sortedQuotes[midIdx].normalizedInstalledRate
      : Math.round(((sortedQuotes[midIdx - 1].normalizedInstalledRate + sortedQuotes[midIdx].normalizedInstalledRate) / 2) * 100) / 100

    independentPublishers.push({
      publisher,
      installedRate: medianRate,
      representativeQuote: repQuote,
      allQuotes: quotes,
      count: quotes.length,
      hasMaterialLabour: quotes.every((q) => q.normalizedMaterialRate !== null && q.normalizedLabourRate !== null),
      materialRate: repQuote.normalizedMaterialRate,
      labourRate: repQuote.normalizedLabourRate,
      pricingBasis: repQuote.pricingBasis,
      publishedDate: repQuote.publishedDate,
    })
  }

  // 3. Single independent publisher handling
  if (independentPublishers.length === 1) {
    const single = independentPublishers[0]
    const rep = single.representativeQuote
    const propMat = rep.normalizedMaterialRate ?? baselineMaterial
    const propLab = rep.normalizedLabourRate ?? baselineLabour
    const propInst = single.installedRate
    const diffPct = baselineInstalled > 0 ? Math.round(((propInst - baselineInstalled) / baselineInstalled) * 1000) / 10 : 0

    const isInstalledWithoutSplit = rep.pricingBasis === 'installed' && rep.normalizedMaterialRate === null && rep.normalizedLabourRate === null
    const requiresSplit = baselineMaterial > 0 && baselineLabour > 0

    if (isInstalledWithoutSplit && requiresSplit) {
      return {
        rateId: target.rateId,
        targetId: target.targetId,
        itemId: target.itemId,
        itemLabel: target.itemLabel,
        trade: target.trade,
        unit: target.requiredUnit,
        baselineMaterial,
        baselineLabour,
        baselineInstalled,
        proposedMaterial: baselineMaterial,
        proposedLabour: baselineLabour,
        proposedInstalled: propInst,
        pricingBasis: 'installed',
        differencePercent: diffPct,
        evidence: normalizedEvidenceList,
        status: 'unresolved',
        selectionReason: `Installed turnkey quotation (Rs ${propInst}/${target.requiredUnit}) lacks stated material/labour breakdown; marked unresolved.`,
        freshnessDate: rep.publishedDate || today,
      }
    }

    // Check single-source against conservative baseline bounds
    const ratio = baselineInstalled > 0 ? propInst / baselineInstalled : 1.0
    const withinConservativeBounds = ratio >= cfg.singleSourceMinRatio && ratio <= cfg.singleSourceMaxRatio

    let status = 'single-source'
    let selectionReason = `Single verified supplier source (${single.publisher}${single.count > 1 ? ` with ${single.count} quotes` : ''}); uncorroborated single source requires manual verification.`

    if (!withinConservativeBounds) {
      status = 'conflict'
      selectionReason = `Single source quote from ${single.publisher} (Rs ${propInst}) diverges from baseline (${Math.round(ratio * 100)}%, outside ${Math.round(cfg.singleSourceMinRatio * 100)}%-${Math.round(cfg.singleSourceMaxRatio * 100)}% bounds) without corroboration.`
    }

    return {
      rateId: target.rateId,
      targetId: target.targetId,
      itemId: target.itemId,
      itemLabel: target.itemLabel,
      trade: target.trade,
      unit: target.requiredUnit,
      baselineMaterial,
      baselineLabour,
      baselineInstalled,
      proposedMaterial: propMat,
      proposedLabour: propLab,
      proposedInstalled: propInst,
      pricingBasis: rep.pricingBasis === 'installed' ? 'installed' : 'hybrid',
      differencePercent: diffPct,
      evidence: normalizedEvidenceList,
      status,
      selectionReason,
      freshnessDate: rep.publishedDate || today,
    }
  }

  // 4. Multiple independent publishers: Source Agreement & Outlier Pruning
  const sortedPubs = [...independentPublishers].sort((a, b) => a.installedRate - b.installedRate)
  const n = sortedPubs.length
  const medianInstalled = n % 2 === 1
    ? sortedPubs[Math.floor(n / 2)].installedRate
    : (sortedPubs[n / 2 - 1].installedRate + sortedPubs[n / 2].installedRate) / 2

  // Cluster around median using clusterTolerance (default 25%)
  const agreeingCluster = []
  const outlierPubs = []

  for (const pub of sortedPubs) {
    const deviation = medianInstalled > 0 ? Math.abs(pub.installedRate - medianInstalled) / medianInstalled : 0
    if (deviation <= cfg.clusterTolerance) {
      agreeingCluster.push(pub)
    } else {
      outlierPubs.push({ ...pub, deviation })
    }
  }

  // If agreeing cluster has fewer than minIndependentPublishers (default: 2) -> conflict
  if (agreeingCluster.length < cfg.minIndependentPublishers) {
    const medianRep = sortedPubs[Math.floor(n / 2)]
    const propMat = medianRep.materialRate ?? baselineMaterial
    const propLab = medianRep.labourRate ?? baselineLabour
    const propInst = medianInstalled
    const diffPct = baselineInstalled > 0 ? Math.round(((propInst - baselineInstalled) / baselineInstalled) * 1000) / 10 : 0

    return {
      rateId: target.rateId,
      targetId: target.targetId,
      itemId: target.itemId,
      itemLabel: target.itemLabel,
      trade: target.trade,
      unit: target.requiredUnit,
      baselineMaterial,
      baselineLabour,
      baselineInstalled,
      proposedMaterial: propMat,
      proposedLabour: propLab,
      proposedInstalled: propInst,
      pricingBasis: 'hybrid',
      differencePercent: diffPct,
      evidence: normalizedEvidenceList,
      status: 'conflict',
      selectionReason: `Multiple sources show divergent rates (${sortedPubs.map((s) => `${s.publisher}: Rs ${s.installedRate}`).join(', ')}). Fewer than ${cfg.minIndependentPublishers} independent sources agree within ${Math.round(cfg.clusterTolerance * 100)}% cluster tolerance. Manual review recommended.`,
      freshnessDate: today,
    }
  }

  // 5. Evaluate spread cap on agreeing cluster
  const clusterRates = agreeingCluster.map((p) => p.installedRate).sort((a, b) => a - b)
  const lowest = clusterRates[0]
  const highest = clusterRates[clusterRates.length - 1]
  const spread = highest > 0 ? (highest - lowest) / highest : 0

  if (spread > cfg.maxSpreadRatio) {
    const midCluster = agreeingCluster[Math.floor(agreeingCluster.length / 2)]
    const propMat = midCluster.materialRate ?? baselineMaterial
    const propLab = midCluster.labourRate ?? baselineLabour
    const propInst = midCluster.installedRate
    const diffPct = baselineInstalled > 0 ? Math.round(((propInst - baselineInstalled) / baselineInstalled) * 1000) / 10 : 0

    return {
      rateId: target.rateId,
      targetId: target.targetId,
      itemId: target.itemId,
      itemLabel: target.itemLabel,
      trade: target.trade,
      unit: target.requiredUnit,
      baselineMaterial,
      baselineLabour,
      baselineInstalled,
      proposedMaterial: propMat,
      proposedLabour: propLab,
      proposedInstalled: propInst,
      pricingBasis: 'hybrid',
      differencePercent: diffPct,
      evidence: normalizedEvidenceList,
      status: 'conflict',
      selectionReason: `Agreeing sources show spread of ${Math.round(spread * 100)}% (${clusterRates.map((s) => `Rs ${s}`).join(', ')}), exceeding ${Math.round(cfg.maxSpreadRatio * 100)}% spread cap. Manual review recommended.`,
      freshnessDate: today,
    }
  }

  // 6. Consensus achieved across agreeing cluster
  const avgInstalled = Math.round((clusterRates.reduce((sum, r) => sum + r, 0) / clusterRates.length) * 100) / 100
  const diffPct = baselineInstalled > 0 ? Math.round(((avgInstalled - baselineInstalled) / baselineInstalled) * 1000) / 10 : 0

  const allHaveMaterial = agreeingCluster.every((p) => p.hasMaterialLabour && p.materialRate !== null)
  const allHaveLabour = agreeingCluster.every((p) => p.hasMaterialLabour && p.labourRate !== null)

  let propMat = baselineMaterial
  let propLab = baselineLabour
  let status = 'accepted'
  let selectionReason = `Validated consensus across ${agreeingCluster.length} independent supplier sources (spread: ${Math.round(spread * 100)}%).${outlierPubs.length ? ` Pruned ${outlierPubs.length} outlier source(s).` : ''}`

  if (allHaveMaterial && allHaveLabour) {
    propMat = Math.round((agreeingCluster.reduce((sum, p) => sum + p.materialRate, 0) / agreeingCluster.length) * 100) / 100
    propLab = Math.round((agreeingCluster.reduce((sum, p) => sum + p.labourRate, 0) / agreeingCluster.length) * 100) / 100
  } else {
    // Some or all sources lack stated material/labour breakdown
    const requiresSplit = baselineMaterial > 0 && baselineLabour > 0
    if (requiresSplit) {
      status = 'unresolved'
      selectionReason = `Consensus installed turnkey quotation (Rs ${avgInstalled}/${target.requiredUnit}) lacks stated material/labour breakdown; keeping baseline split and marked unresolved.`
    }
  }

  // Most recent publication date in agreeing cluster
  const dates = agreeingCluster.map((p) => p.publishedDate).filter(Boolean).sort()
  const latestDate = dates.length > 0 ? dates[dates.length - 1] : today

  return {
    rateId: target.rateId,
    targetId: target.targetId,
    itemId: target.itemId,
    itemLabel: target.itemLabel,
    trade: target.trade,
    unit: target.requiredUnit,
    baselineMaterial,
    baselineLabour,
    baselineInstalled,
    proposedMaterial: propMat,
    proposedLabour: propLab,
    proposedInstalled: avgInstalled,
    pricingBasis: allHaveMaterial && allHaveLabour ? 'hybrid' : 'installed',
    differencePercent: diffPct,
    evidence: normalizedEvidenceList,
    status,
    selectionReason,
    freshnessDate: latestDate,
  }
}
