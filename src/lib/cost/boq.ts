import { paintColour } from '../finishes/paint.ts'
import type { Brief } from '../model/brief.ts'
import type { Design } from '../engine/types.ts'
import { measureDesign, type Quantities } from './quantities.ts'
import { resolveSpecification, specificationRate, rateBook, specsCatalogue } from './catalogue.ts'
import { boqRules, TRADES } from './data/boqRules.ts'
import { boqMeasures } from './boqMeasures.ts'
import { quantityRules } from './data/quantityRules.ts'
import { estimateLabel, policy, type CostSelection } from './specifications.ts'
import { selectionFromBrief } from './briefSelections.ts'
import { finishProduct } from '../finishes/catalogue.ts'
import { solarCostSchedule, SOLAR_RATE_VERSION, type SolarEstimate, type SolarCostContext } from '../solar/estimate.ts'
import { plumbingSchedule } from './plumbing.ts'
import { createPricingResolver, pricingContextKey, classifyTradeScope, type RateResolver } from './pricingContext.ts'
import type { PricingContext, ResearchLocation } from './research/types.ts'
import { estimateSiteLabour, type SiteLabourCalculation } from './labour.ts'
import { validatedLabour } from './data/validated.ts'

export type Trade = typeof TRADES[number]
export type Band = { low: number; high: number }
export type CostLine = { label: string; note: string; low: number; high: number; expected: number }
export type BoqLine = {
  id: string; item: string; specId: string; rateId: string; group: Trade; label: string; specification: string
  qty: number; quantity: number; unit: string; rate: number; amount: number
  materialRate: number; labourRate: number; materialAmount: number; labourAmount: number
  roomId?: string; floor?: number; note: string
  rateSource?: 'baseline' | 'researched' | 'manual'
  provenance?: string
  scopeCategory?: 'construction' | 'interiors'
}
export type CostEstimate = {
  solar?: SolarEstimate; currency: 'INR'; total: Band; expected: number; ratePerSqm: Band; ratePerSqft: number; lines: CostLine[]
  basis: string; label: string; qualification: string; confidence: 'C'; rateVersion: string
  included: string[]; excluded: string[]; assumptions: string[]; sources: string[]
  quantities: Quantities; selection: CostSelection; boq: BoqLine[]; sanityNote: string | null
  tradeTotals: { trade: Trade; amount: number; share: number; material: number; labour: number }[]
  procurement: { contractType: string; turnkey: number; material: number; labour: number; overhead: number; projectAddOns: number; total: number; note: string }
  defaultExpected: number; topCostDrivers: { item: string; label: string; amount: number; defaultAmount: number; difference: number }[]
  pricingContext?: {
    id: string
    location: ResearchLocation
    researchedCount: number
    manualCount: number
    baselineCount: number
    status: 'baseline' | 'researched' | 'partial'
    date: string
  }
  scopeTotals?: {
    construction: number
    interiors: number
    combined: number
  }
  labour?: SiteLabourCalculation
}
const units: Record<string, string> = { m2: 'm²', m3: 'm³' }
const band = (amount: number): Band => ({ low: amount * (1 - rateBook.settings.uncertaintyPct / 100), high: amount * (1 + rateBook.settings.uncertaintyPct / 100) })
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const v of Object.values(value)) freeze(v); Object.freeze(value) }
  return value
}
/** Stable room IDs take precedence; pre-catalogue semantic IDs remain readable. */
function roomSpec(brief: Brief, item: string, roomId?: string, semanticId?: string) {
  const saved = brief.specs.overrides
  if (roomId && saved[`${item}@${roomId}`] !== undefined) return resolveSpecification(brief, item, roomId)
  return resolveSpecification(brief, item, semanticId)
}
function priceLines(design: Design, brief: Brief, quantities: Quantities, useLegacySolar = true, resolver?: RateResolver): BoqLine[] {
  const measures = boqMeasures(design, quantities), boq: BoqLine[] = []
  const plumbing = plumbingSchedule(design, brief)
  Object.assign(measures.extra, {
    tanks: plumbing.overheadLitres / boqRules.allowances.tankRateCapacityLitres,
    undergroundTank: plumbing.underground?.pricingUnits ?? 0,
    drainTank: plumbing.drain?.pricingUnits ?? 0,
  })

  // Check if interior schedule replaces allowances
  const context = resolver?.context
  const interiorItems = (context?.interiorSchedule?.items || []).filter(i => i.includedInEstimate)
  const replacesInteriorsAllowance = interiorItems.some(i => i.replacesAllowanceId === 'interiors')

  for (const recipe of boqRules.recipes) {
    if (recipe.item === 'water-pipes' || recipe.item === 'drain-pipes' || (recipe.item === 'solar' && !useLegacySolar)) continue
    if (recipe.item === 'interiors' && replacesInteriorsAllowance) continue

    const add = (key: string, qty: number, label: string, roomId?: string, semanticId?: string, floor?: number, item = recipe.item) => {
      if (qty <= 0) return
      const spec = roomSpec(brief, item, roomId, semanticId)
      const targetRateId = recipe.rateId ?? spec.rateId
      const rate = resolver ? resolver.getRate(targetRateId) : specificationRate(targetRateId)
      const id = recipe.from === 'room' && recipe.key.startsWith('floor:') ? `floor:${roomId}` : `${item}:${recipe.from}:${key}${roomId ? `@${roomId}` : ''}`
      const rateSource = resolver?.isManual(targetRateId) ? 'manual' : resolver?.isResearched(targetRateId) ? 'researched' : 'baseline'
      const scopeCategory = classifyTradeScope(recipe.trade, item)

      boq.push({
        id, item, specId: `${item}/${spec.id}`, rateId: rate.id, group: recipe.trade, label,
        specification: item === 'interior-paint' ? `${spec.name} · ${paintColour(brief, roomId ?? semanticId).label}` :
          item === 'underground-water-tank' ? `${spec.name} · ${plumbing.underground?.capacityLitres ?? 0} L usable storage` :
          item === 'drain-tank' && plumbing.drain?.capacityLitres ? `${spec.name} · ${plumbing.drain.capacityLitres} L` :
          item === 'water-tanks' ? `${spec.name} · ${plumbing.overheadLitres} L overhead only` : spec.name,
        qty, quantity: qty, unit: units[rate.unit] ?? rate.unit,
        rate: rate.installed, amount: qty * rate.installed, materialRate: rate.material, labourRate: rate.labour,
        materialAmount: qty * rate.material, labourAmount: qty * rate.labour, roomId, floor, note: recipe.note,
        rateSource, provenance: 'provenance' in rate ? (rate as any).provenance : undefined,
        scopeCategory,
      })
    }
    if (recipe.from === 'room') {
      for (const r of measures.rooms) {
        const floorRecipe = recipe.roomFloorSpec ? boqRules.recipes.find(p => p.from === 'room' && p.key.startsWith('floor:') && r.values[p.key] > 0) : undefined
        add(recipe.key, r.values[recipe.key] ?? 0, `${r.name} · ${recipe.label}`, r.id, r.semanticId, r.floor, floorRecipe?.item ?? recipe.item)
      }
    } else if (recipe.from === 'extra') add(recipe.key, measures.extra[recipe.key] ?? 0, recipe.label)
    else {
      for (const f of quantities.perFloor) {
        const values = recipe.from === 'items' ? Object.fromEntries(Object.entries(f.items).map(([id, v]) => [id, v[recipe.measure]])) : recipe.from === 'steel' ? f.steelKg : f.formworkM2
        for (const [key, qty] of Object.entries(values)) if (recipe.key === key || (recipe.key.endsWith('*') && key.startsWith(recipe.key.slice(0, -1)))) {
          const label = recipe.key.endsWith('*') ? `${f.name} · ${recipe.label} · ${key.replaceAll('concrete.', '').replaceAll('masonry.', '')}` : `${f.name} · ${recipe.label}`
          add(`${f.level}:${key}`, qty, label, undefined, undefined, f.level)
        }
      }
    }
  }

  for (const run of plumbing.runs) {
    const item = run.system === 'water' ? 'water-pipes' : 'drain-pipes'
    const spec = resolveSpecification(brief, item)
    const targetRateId = `${spec.rateId}-${run.diameterMm}mm`
    const rate = resolver ? resolver.getRate(targetRateId) : specificationRate(targetRateId)
    const qty = run.lengthM
    const rateSource = resolver?.isManual(targetRateId) ? 'manual' : resolver?.isResearched(targetRateId) ? 'researched' : 'baseline'
    const scopeCategory = 'construction'

    boq.push({
      id: `${item}:pipe:${run.id}`, item, specId: `${item}/${spec.id}`, rateId: rate.id, group: 'Plumbing & sanitary',
      label: `${run.floorName} · ${run.purpose} · ${run.diameterMm} mm`, specification: `${spec.name} · ${run.diameterMm} mm ${run.sizeBasis}`,
      qty, quantity: qty, unit: 'm', rate: rate.installed, amount: qty * rate.installed, materialRate: rate.material, labourRate: rate.labour,
      materialAmount: qty * rate.material, labourAmount: qty * rate.labour, floor: run.floor, note: plumbing.notes[0],
      rateSource, provenance: 'provenance' in rate ? (rate as any).provenance : undefined,
      scopeCategory,
    })
  }

  // Include user-reviewed interior schedule items without double charging
  for (const item of interiorItems) {
    const lineId = `interior-item:${item.roomId}:${item.id}`
    const rate = item.estimatedRate
    const amount = item.count * rate
    boq.push({
      id: lineId,
      item: `interior-${item.category}`,
      specId: `interior/${item.itemType}`,
      rateId: `interior-rate-${item.id}`,
      group: 'Extras',
      label: `${item.roomName} · ${item.label}`,
      specification: item.specification,
      qty: item.count,
      quantity: item.count,
      unit: 'item',
      rate,
      amount,
      materialRate: rate,
      labourRate: 0,
      materialAmount: amount,
      labourAmount: 0,
      roomId: item.roomId,
      note: `Interior schedule item (${item.quantityBasis})${item.replacesAllowanceId ? `; replaces ${item.replacesAllowanceId} allowance` : ''}`,
      rateSource: 'manual',
      provenance: 'User interior item schedule',
      scopeCategory: 'interiors',
    })
  }

  return boq
}
function summaries(
  direct: number,
  selection: CostSelection,
  untaxedSolar = 0,
  includeStatutoryAllowances = true,
  siteLabour?: SiteLabourCalculation,
): CostLine[] {
  const isReplace = selection.labourMode === 'replace' && siteLabour !== undefined
  const worksDirect = isReplace ? Math.max(0, direct - siteLabour.embeddedLabour) : direct
  const labourAllowance = siteLabour ? siteLabour.siteLabourTotal : 0
  const worksBase = worksDirect + labourAllowance

  const overhead = worksBase * selection.overheadPercent / 100
  const contingency = (worksBase + overhead) * selection.contingencyPercent / 100
  const taxableBase = Math.max(0, worksBase - untaxedSolar) * (1 + selection.overheadPercent / 100) * (1 + selection.contingencyPercent / 100)
  const fee = worksBase * selection.feePercent / 100
  const approvals = includeStatutoryAllowances ? rateBook.settings.allowances.approvals : 0
  const connections = includeStatutoryAllowances ? rateBook.settings.allowances.connections : 0

  const values: [string, string, number][] = []

  if (siteLabour) {
    if (isReplace) {
      values.push([
        'Measured works & materials',
        `Materials and trade supply (INR ${Math.round(siteLabour.embeddedLabour).toLocaleString('en-IN')} embedded labour deducted; replaced by site labour line)`,
        worksDirect,
      ])
    } else {
      values.push([
        'Measured works & allowances',
        'Materials and installed labour; excludes site labour allowance and add-ons below',
        worksDirect,
      ])
    }
    values.push([
      'Site labour (crew-days)',
      `${siteLabour.note} Subject to overhead, contingency and GST.`,
      siteLabour.siteLabourTotal,
    ])
    values.push([
      'Contractor overhead & profit',
      `${selection.overheadPercent}% of works and site labour`,
      overhead,
    ])
    values.push([
      'Contingency',
      `${selection.contingencyPercent}% of works, labour plus overhead`,
      contingency,
    ])
    values.push([
      'Professional fees allowance',
      `${selection.feePercent}% of works and site labour; taxes on fees excluded`,
      fee,
    ])
  } else {
    values.push([
      'Measured works & allowances',
      'Materials and labour; excludes the add-ons below',
      direct,
    ])
    values.push([
      'Contractor overhead & profit',
      `${selection.overheadPercent}% of works`,
      overhead,
    ])
    values.push([
      'Contingency',
      `${selection.contingencyPercent}% of works plus overhead`,
      contingency,
    ])
    values.push([
      'Professional fees allowance',
      `${selection.feePercent}% of works; taxes on fees excluded`,
      fee,
    ])
  }

  values.push([
    'GST provision',
    selection.includeGst ? `${selection.gstPercent}% of non-solar works, overhead and contingency; solar tax excluded pending basis` : 'Excluded; confirm contractor tax treatment',
    selection.includeGst ? taxableBase * selection.gstPercent / 100 : 0,
  ])
  values.push([
    'Approvals allowance',
    'Provisional authority charges; separate from professional fees',
    approvals,
  ])
  values.push([
    'Connections allowance',
    'Provisional water / power connection charges',
    connections,
  ])

  return values.map(([label, note, expected]) => ({ label, note, expected, ...band(expected) }))
}
function buildBoq(
  design: Design,
  brief: Brief,
  selection: CostSelection,
  quantities: Quantities,
  solar: ReturnType<typeof solarCostSchedule>,
  pricingContext?: PricingContext | null,
): CostEstimate {
  const resolver = createPricingResolver(pricingContext)
  const boq = [...priceLines(design, brief, quantities, solar.useLegacy, resolver), ...solar.lines.map(l => ({ ...l, scopeCategory: 'construction' as const, rateSource: 'baseline' as const }))]
  const direct = boq.reduce((n, l) => n + l.amount, 0)
  const embeddedLabour = boq.reduce((n, l) => n + l.labourAmount, 0)
  const floorAreaSqft = quantities.floorArea * rateBook.settings.sqftPerSqm
  const storeys = quantities.perFloor.length || 1
  const siteLabour = estimateSiteLabour(floorAreaSqft, brief.finish, storeys, { ...selection, city: pricingContext?.location?.city }, embeddedLabour)

  const lines = summaries(direct, selection, solar.summary.grossInstallationCost, true, siteLabour)
  const expected = lines.reduce((n, l) => n + l.expected, 0)

  // Scope totals: statutory allowances and site labour charged in construction scope; sum reconciles to combined to the paisa
  const constructionDirect = boq.filter(l => l.scopeCategory !== 'interiors').reduce((n, l) => n + l.amount, 0)
  const interiorsDirect = boq.filter(l => l.scopeCategory === 'interiors').reduce((n, l) => n + l.amount, 0)
  const constructionLines = summaries(constructionDirect, selection, solar.summary.grossInstallationCost, true, siteLabour)
  const interiorsLines = summaries(interiorsDirect, selection, 0, false, undefined)
  const constructionTotal = constructionLines.reduce((n, l) => n + l.expected, 0)
  const interiorsTotal = interiorsLines.reduce((n, l) => n + l.expected, 0)
  const scopeTotals = {
    construction: Math.round(constructionTotal * 100) / 100,
    interiors: Math.round(interiorsTotal * 100) / 100,
    combined: Math.round(expected * 100) / 100,
  }

  const baseline = [...priceLines(design, { ...brief, specs: { overrides: {} } }, quantities, solar.useLegacy), ...solar.lines]
  const baseMap = new Map(baseline.map(l => [l.id, l.amount])), drivers = new Map<string, { item: string; label: string; amount: number; defaultAmount: number; difference: number }>()
  for (const l of boq) {
    const driver = drivers.get(l.item) ?? { item: l.item, label: specsCatalogue.items.find(i => i.id === l.item)?.label ?? l.label, amount: 0, defaultAmount: 0, difference: 0 }
    driver.amount += l.amount; driver.defaultAmount += baseMap.get(l.id) ?? 0; driver.difference = driver.amount - driver.defaultAmount
    drivers.set(l.item, driver)
  }
  const topCostDrivers = [...drivers.values()].sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || b.amount - a.amount).slice(0, boqRules.driverCount)
  const tradeTotals = TRADES.map(trade => {
    const scope = boq.filter(l => l.group === trade), amount = scope.reduce((n, l) => n + l.amount, 0)
    return { trade, amount, share: direct ? amount / direct : 0, material: scope.reduce((n, l) => n + l.materialAmount, 0), labour: scope.reduce((n, l) => n + l.labourAmount, 0) }
  })
  const material = tradeTotals.reduce((n, t) => n + t.material, 0), labour = tradeTotals.reduce((n, t) => n + t.labour, 0)
  const sqmRate = quantities.floorArea ? expected / quantities.floorArea : 0, ratePerSqft = sqmRate / rateBook.settings.sqftPerSqm
  const sanity = rateBook.sanityBands[brief.finish], soil = resolveSpecification(brief, 'soil-type'), sizes = quantities.structureSizing
  const assumptions = [...quantities.assumptions, ...boqRules.notes.map(note => solar.lines.length && note.startsWith('Trade shares use direct works') ? 'Trade shares use direct works only. The project GST provision excludes structured solar works and attributable overhead/contingency until a solar tax basis is provided; fees and authority allowances remain excluded.' : note),
    `Soil: ${soil.name}. Plinth: ${sizes.plinthHeightMm} mm. Footings and member sizes are approximate, not engineering certification.`,
    ...sizes.floors.map(f => `${quantities.perFloor.find(p => p.level === f.level)?.name ?? `Floor ${f.level}`}: columns ${[...new Set(f.columns.map(c => c.size))].join('/')} mm; beam depths ${[...new Set(f.beams.map(b => b.depthMm))].join('/')} mm; slab ${f.slabThicknessMm} mm.`),
    `Steel kg/m³: ${Object.entries(quantityRules.steelKgPerM3).map(([k, v]) => `${k} ${v}`).join(', ')}.`,
    `Approvals allowance INR ${rateBook.settings.allowances.approvals}; connections INR ${rateBook.settings.allowances.connections}.`,
    `Site labour: ${siteLabour.crewSize} crew @ INR ${siteLabour.blendedDailyRate}/day avg (${siteLabour.workingDays} working days / ${siteLabour.workingMonths.toFixed(1)} months). Mode: ${siteLabour.mode === 'additional' ? 'additional on-site allowance' : 'replaces embedded BOQ labour'}.`,
    ...Object.entries(brief.specs.overrides).filter(([id]) => boqRules.unpricedItems[id]).map(([id]) => `${id}: ${boqRules.unpricedItems[id]}`),
  ]
  const disabledExtras = specsCatalogue.items.filter(i => i.group === 'extras' && !(i.id === 'solar' && solar.summary.status !== 'undecided') && resolveSpecification(brief, i.id).id === 'off').map(i => `${i.label} (not selected)`)
  const unmeasuredSelections = specsCatalogue.items.filter(i => Object.keys(brief.specs.overrides).some(k=>k===i.id||k.startsWith(`${i.id}@`)) && i.options.some(o=>finishProduct(o.finishProductId)?.rate.basis === 'advisory'))
    .map(i => `${i.label}: ${boqRules.unpricedItems[i.id]??i.note}`)

  const researchedCount = boq.filter(l => l.rateSource === 'researched').length
  const manualCount = boq.filter(l => l.rateSource === 'manual').length
  const baselineCount = boq.filter(l => l.rateSource === 'baseline' || !l.rateSource).length

  if (researchedCount > 0) {
    assumptions.push(`Live rate research: ${researchedCount} rates researched in ${pricingContext?.location.city}; ${baselineCount} rates retain provisional concept allowances.`)
  }
  if (manualCount > 0) {
    assumptions.push(`Manual rate overrides: ${manualCount} rates set by user override.`)
  }
  if (pricingContext?.interiorSchedule?.items.length) {
    const inc = pricingContext.interiorSchedule.items.filter(i => i.includedInEstimate)
    assumptions.push(`Interior schedule: ${inc.length} user-reviewed furniture/joinery items included (total INR ${scopeTotals.interiors}).`)
  }

  const sourcesList = [
    ...(pricingContext && researchedCount > 0 ? [`Live web research (${pricingContext.location.city}) — ${researchedCount} items updated`] : []),
    rateBook.status,
    `${validatedLabour.status} (${validatedLabour.city}) — ${validatedLabour.sources[0]?.url}`,
    ...solar.summary.sources,
    ...policy.sources.map(s => `${s.label} — ${s.url}`),
  ]

  const pricingContextSummary = pricingContext ? {
    id: pricingContext.id,
    location: pricingContext.location,
    researchedCount,
    manualCount,
    baselineCount,
    status: (researchedCount > 0 ? (baselineCount > 0 ? 'partial' : 'researched') : 'baseline') as 'partial' | 'baseline' | 'researched',
    date: new Date().toISOString().slice(0, 10),
  } : undefined

  const rateVersionStr = `${boqRules.version} · ${pricingContext && researchedCount > 0 ? `${pricingContext.location.city} ${pricingContextSummary?.date}` : rateBook.settings.date}${solar.lines.length ? ` · ${SOLAR_RATE_VERSION}` : ''}`
  const basisStr = `${quantities.floorArea.toFixed(1)} m² source-plan floor area · measured members, openings and room finishes · ${pricingContext && researchedCount > 0 ? `${pricingContext.location.city} researched rates (${researchedCount} live, ${baselineCount} provisional)` : `provisional ${rateBook.settings.city} rates`}`

  const overheadLine = lines.find(l => l.label === 'Contractor overhead & profit')!
  const overheadAmount = overheadLine.expected
  const worksTotal = selection.labourMode === 'replace'
    ? (direct - embeddedLabour + siteLabour.siteLabourTotal)
    : (direct + siteLabour.siteLabourTotal)
  const procurementLabour = selection.labourMode === 'replace'
    ? siteLabour.siteLabourTotal
    : (labour + siteLabour.siteLabourTotal)

  const additionalLabourPerSqft = selection.labourMode === 'additional' && quantities.floorArea
    ? ((siteLabour.siteLabourTotal * (1 + selection.overheadPercent / 100) * (1 + selection.contingencyPercent / 100)) / (quantities.floorArea * rateBook.settings.sqftPerSqm))
    : 0
  const effectiveMaxSanity = sanity.max + additionalLabourPerSqft
  const sanityNote = sqmRate && (ratePerSqft < sanity.min || ratePerSqft > effectiveMaxSanity)
    ? 'This estimate is outside the configured reference range. Check measured scope, optional extras and provisional rates with a local contractor.'
    : null

  const baselineDirect = baseline.reduce((n, l) => n + l.amount, 0)
  const baselineEmbeddedLabour = baseline.reduce((n, l) => n + (l.labourAmount ?? 0), 0)
  const baselineLabour = estimateSiteLabour(floorAreaSqft, brief.finish, storeys, { ...selection, city: pricingContext?.location?.city }, baselineEmbeddedLabour)
  const defaultExpected = summaries(baselineDirect, selection, solar.summary.grossInstallationCost, true, baselineLabour).reduce((n, l) => n + l.expected, 0)

  return {
    solar: solar.summary, currency: 'INR', expected, total: band(expected), ratePerSqm: band(sqmRate), ratePerSqft, lines, boq, quantities, selection,
    label: estimateLabel(), qualification: policy.qualification, confidence: 'C', rateVersion: rateVersionStr,
    basis: basisStr,
    included: [...boqRules.included, ...solar.summary.inclusions], excluded: [...boqRules.excluded, ...solar.summary.exclusions, ...disabledExtras, ...unmeasuredSelections, ...(!selection.includeGst ? ['GST provision (not enabled)'] : [])],
    assumptions: [...assumptions, ...solar.summary.notes, ...solar.summary.energy.reasons, ...solar.summary.energy.basis],
    sources: sourcesList,
    sanityNote,
    tradeTotals,
    procurement: {
      contractType: resolveSpecification(brief, 'contract-type').name,
      turnkey: worksTotal + overheadAmount,
      material,
      labour: procurementLabour,
      overhead: overheadAmount,
      projectAddOns: expected - worksTotal - overheadAmount,
      total: expected,
      note: 'Same project scope: material + labour + overhead + project add-ons equals the expected total. Owner procurement does not remove material costs.',
    },
    defaultExpected,
    topCostDrivers,
    pricingContext: pricingContextSummary,
    scopeTotals,
    labour: siteLabour,
  }
}
const cache = new Map<string, CostEstimate>()
const quantityIds = new WeakMap<Quantities, number>()
let nextId = 0

/** Geometry → quantities → preset + overrides → rates → BOQ. Bounded content memo; no RNG. */
export function estimateBoq(
  design: Design,
  brief: Brief = design.model.brief,
  allowances?: CostSelection,
  solarContext?: SolarCostContext,
  pricingContext?: PricingContext | null,
): CostEstimate {
  // Defensive check if pricingContext was passed as 4th parameter
  let effectiveSolar = solarContext
  let effectivePricing = pricingContext
  if (solarContext && typeof solarContext === 'object' && ('rates' in solarContext || 'location' in solarContext)) {
    effectivePricing = solarContext as unknown as PricingContext
    effectiveSolar = undefined
  }

  const selection = selectionFromBrief(brief, design, allowances)
  const solar = solarCostSchedule(design, brief, effectiveSolar)
  const projected = { ...design, model: { ...design.model, brief } }
  const quantities = measureDesign(projected)
  if (!quantityIds.has(quantities)) quantityIds.set(quantities, ++nextId)
  const pKey = pricingContextKey(effectivePricing)
  const key = JSON.stringify([quantityIds.get(quantities), brief.finish, Object.entries(brief.specs.overrides).sort(([a], [b]) => a.localeCompare(b)), selection, solar, pKey])
  const cached = cache.get(key)
  if (cached) return cached
  const result = freeze(buildBoq(projected, brief, selection, quantities, solar, effectivePricing))
  cache.set(key, result)
  if (cache.size > boqRules.memoEntries) cache.delete(cache.keys().next().value!)
  return result
}
