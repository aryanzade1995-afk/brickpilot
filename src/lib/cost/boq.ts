import type { Brief } from '../model/brief.ts'
import type { Design } from '../engine/types.ts'
import { measureDesign, type Quantities } from './quantities.ts'
import { resolveSpecification, specificationRate, rateBook, specsCatalogue } from './catalogue.ts'
import { boqRules, TRADES } from './data/boqRules.ts'
import { boqMeasures } from './boqMeasures.ts'
import { quantityRules } from './data/quantityRules.ts'
import { estimateLabel, policy, type CostSelection } from './specifications.ts'
import { selectionFromBrief } from './briefSelections.ts'

export type Trade = typeof TRADES[number]
export type Band = { low: number; high: number }
export type CostLine = { label: string; note: string; low: number; high: number; expected: number }
export type BoqLine = {
  id: string; item: string; specId: string; rateId: string; group: Trade; label: string; specification: string
  qty: number; quantity: number; unit: string; rate: number; amount: number
  materialRate: number; labourRate: number; materialAmount: number; labourAmount: number
  roomId?: string; floor?: number; note: string
}
export type CostEstimate = {
  currency: 'INR'; total: Band; expected: number; ratePerSqm: Band; ratePerSqft: number; lines: CostLine[]
  basis: string; label: string; qualification: string; confidence: 'C'; rateVersion: string
  included: string[]; excluded: string[]; assumptions: string[]; sources: string[]
  quantities: Quantities; selection: CostSelection; boq: BoqLine[]; sanityNote: string | null
  tradeTotals: { trade: Trade; amount: number; share: number; material: number; labour: number }[]
  procurement: { contractType: string; turnkey: number; material: number; labour: number; overhead: number; projectAddOns: number; total: number; note: string }
  defaultExpected: number; topCostDrivers: { item: string; label: string; amount: number; defaultAmount: number; difference: number }[]
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
function priceLines(design: Design, brief: Brief, quantities: Quantities): BoqLine[] {
  const measures = boqMeasures(design, quantities), boq: BoqLine[] = []
  for (const recipe of boqRules.recipes) {
    const add = (key: string, qty: number, label: string, roomId?: string, semanticId?: string, floor?: number, item = recipe.item) => {
      if (qty <= 0) return
      const spec = roomSpec(brief, item, roomId, semanticId), rate = specificationRate(recipe.rateId ?? spec.rateId)
      const id = recipe.from === 'room' && recipe.key.startsWith('floor:') ? `floor:${roomId}` : `${item}:${recipe.from}:${key}${roomId ? `@${roomId}` : ''}`
      boq.push({ id, item, specId: `${item}/${spec.id}`, rateId: rate.id, group: recipe.trade, label,
        specification: spec.name, qty, quantity: qty, unit: units[rate.unit] ?? rate.unit,
        rate: rate.installed, amount: qty * rate.installed, materialRate: rate.material, labourRate: rate.labour,
        materialAmount: qty * rate.material, labourAmount: qty * rate.labour, roomId, floor, note: recipe.note })
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
        for (const [key, qty] of Object.entries(values)) if (recipe.key === key || recipe.key.endsWith('*') && key.startsWith(recipe.key.slice(0, -1))) {
          const label = recipe.key.endsWith('*') ? `${f.name} · ${recipe.label} · ${key.replaceAll('concrete.', '').replaceAll('masonry.', '')}` : `${f.name} · ${recipe.label}`
          add(`${f.level}:${key}`, qty, label, undefined, undefined, f.level)
        }
      }
    }
  }
  return boq
}
function summaries(direct: number, selection: CostSelection): CostLine[] {
  const overhead = direct * selection.overheadPercent / 100, contingency = (direct + overhead) * selection.contingencyPercent / 100
  const values = [
    ['Measured works & allowances', 'Materials and labour; excludes the add-ons below', direct],
    ['Contractor overhead & profit', `${selection.overheadPercent}% of works`, overhead],
    ['Contingency', `${selection.contingencyPercent}% of works plus overhead`, contingency],
    ['Professional fees allowance', `${selection.feePercent}% of works; taxes on fees excluded`, direct * selection.feePercent / 100],
    ['GST provision', selection.includeGst ? `${selection.gstPercent}% of works, overhead and contingency; confirm applicability` : 'Excluded; confirm contractor tax treatment', selection.includeGst ? (direct + overhead + contingency) * selection.gstPercent / 100 : 0],
    ['Approvals allowance', 'Provisional authority charges; separate from professional fees', rateBook.settings.allowances.approvals],
    ['Connections allowance', 'Provisional water / power connection charges', rateBook.settings.allowances.connections],
  ] as const
  return values.map(([label, note, expected]) => ({ label, note, expected, ...band(expected) }))
}
function buildBoq(design: Design, brief: Brief, selection: CostSelection, quantities: Quantities): CostEstimate {
  const boq = priceLines(design, brief, quantities), direct = boq.reduce((n, l) => n + l.amount, 0)
  const lines = summaries(direct, selection), expected = lines.reduce((n, l) => n + l.expected, 0)
  const baseline = priceLines(design, { ...brief, specs: { overrides: {} } }, quantities)
  const baseMap = new Map(baseline.map(l => [l.id, l.amount])), drivers = new Map<string, { item: string; label: string; amount: number; defaultAmount: number; difference: number }>()
  for (const l of boq) {
    const driver = drivers.get(l.item) ?? { item: l.item, label: specsCatalogue.items.find(i => i.id === l.item)!.label, amount: 0, defaultAmount: 0, difference: 0 }
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
  const assumptions = [...quantities.assumptions, ...boqRules.notes,
    `Soil: ${soil.name}. Plinth: ${sizes.plinthHeightMm} mm. Footings and member sizes are approximate, not engineering certification.`,
    ...sizes.floors.map(f => `${quantities.perFloor.find(p => p.level === f.level)?.name ?? `Floor ${f.level}`}: columns ${[...new Set(f.columns.map(c => c.size))].join('/')} mm; beam depths ${[...new Set(f.beams.map(b => b.depthMm))].join('/')} mm; slab ${f.slabThicknessMm} mm.`),
    `Steel kg/m³: ${Object.entries(quantityRules.steelKgPerM3).map(([k, v]) => `${k} ${v}`).join(', ')}.`,
    `Approvals allowance INR ${rateBook.settings.allowances.approvals}; connections INR ${rateBook.settings.allowances.connections}.`,
    ...Object.entries(brief.specs.overrides).filter(([id]) => boqRules.unpricedItems[id]).map(([id]) => `${id}: ${boqRules.unpricedItems[id]}`),
  ]
  const disabledExtras = specsCatalogue.items.filter(i => i.group === 'extras' && resolveSpecification(brief, i.id).id === 'off').map(i => `${i.label} (not selected)`)
  return { currency: 'INR', expected, total: band(expected), ratePerSqm: band(sqmRate), ratePerSqft, lines, boq, quantities, selection,
    label: estimateLabel(), qualification: policy.qualification, confidence: 'C', rateVersion: `${boqRules.version} · ${rateBook.settings.date}`,
    basis: `${quantities.floorArea.toFixed(1)} m² source-plan floor area · measured members, openings and room finishes · provisional ${rateBook.settings.city} rates`,
    included: [...boqRules.included], excluded: [...boqRules.excluded, ...disabledExtras, ...(!selection.includeGst ? ['GST provision (not enabled)'] : [])],
    assumptions, sources: [rateBook.status, ...policy.sources.map(s => `${s.label} — ${s.url}`)],
    sanityNote: sqmRate && (ratePerSqft < sanity.min || ratePerSqft > sanity.max) ? 'This estimate is outside the configured reference range. Check measured scope, optional extras and provisional rates with a local contractor.' : null,
    tradeTotals, procurement: { contractType: resolveSpecification(brief, 'contract-type').name, turnkey: direct + lines[1].expected,
      material, labour, overhead: lines[1].expected, projectAddOns: expected - direct - lines[1].expected, total: expected,
      note: 'Same project scope: material + labour + overhead + project add-ons equals the expected total. Owner procurement does not remove material costs.' },
    defaultExpected: summaries(baseline.reduce((n, l) => n + l.amount, 0), selection).reduce((n, l) => n + l.expected, 0), topCostDrivers,
  }
}
const cache = new Map<string, CostEstimate>()
const quantityIds = new WeakMap<Quantities, number>()
let nextId = 0
/** Geometry → quantities → preset + overrides → rates → BOQ. Bounded content memo; no RNG. */
export function estimateBoq(design: Design, brief: Brief = design.model.brief, allowances?: CostSelection): CostEstimate {
  const selection = selectionFromBrief(brief, design, allowances)
  const projected = { ...design, model: { ...design.model, brief } }
  const quantities = measureDesign(projected)
  if (!quantityIds.has(quantities)) quantityIds.set(quantities, ++nextId)
  const key = JSON.stringify([quantityIds.get(quantities), brief.finish, Object.entries(brief.specs.overrides).sort(([a], [b]) => a.localeCompare(b)), selection])
  const cached = cache.get(key)
  if (cached) return cached
  const result = freeze(buildBoq(projected, brief, selection, quantities))
  cache.set(key, result)
  if (cache.size > boqRules.memoEntries) cache.delete(cache.keys().next().value!)
  return result
}
