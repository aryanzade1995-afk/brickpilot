import type { Design } from '../engine/types.ts'
import { measureDesign, type Quantities } from './quantities.ts'
import { estimateLabel, finishOption, parseSelection, policy, type CostSelection } from './specifications.ts'

export type Band = { low: number; high: number }
export type CostLine = { label: string; note: string; low: number; high: number; expected: number }
export type BoqLine = { id: string; group: string; label: string; specification: string; quantity: number; unit: 'm²'; rate: number; amount: number }
export type CostEstimate = {
  currency: 'INR'; total: Band; expected: number; ratePerSqm: Band; lines: CostLine[]
  basis: string; label: string; qualification: string; confidence: 'C'
  included: string[]; excluded: string[]; sources: string[]
  quantities: Quantities; selection: CostSelection; boq: BoqLine[]; sanityNote: string | null; rateVersion: string
}
const band = (amount: number): Band => ({ low: amount * (1 - policy.uncertaintyPercent / 100), high: amount * (1 + policy.uncertaintyPercent / 100) })

/** Geometry → quantities → specifications → rates → BOQ. No generator, RNG or mutation. */
export function estimateCost(design: Design, preferences?: unknown): CostEstimate {
  const quantities = measureDesign(design), selection = parseSelection(preferences), boq: BoqLine[] = []
  const add = (id: string, group: string, label: string, quantity: number, rate: number, specification: string) => {
    if (quantity > 0) boq.push({ id, group, label, quantity, unit: 'm²', rate, specification, amount: quantity * rate })
  }
  const r = policy.rates, q = quantities
  add('structure', 'Structure & walls', 'Structure allowance', q.floorArea, r.structure, policy.scope.structure)
  add('masonry', 'Structure & walls', 'Walls', q.wallArea, r.masonry, 'Masonry face area after opening deductions; RCC frame is separate')
  add('plaster', 'Structure & walls', 'Wall plaster', q.paintArea, r.plaster, 'Both wall faces; excludes paint')
  for (const room of q.rooms) {
    const option = finishOption('floor', selection.roomFloors[room.id] ?? selection.choices.floor)
    add(`floor:${room.id}`, 'Finishes', `${room.floor} · ${room.name}`, room.area, option.rate, option.label)
  }
  for (const [category, quantity, label] of [
    ['wall', q.paintArea, 'Wall finish'], ['door', q.doorArea, 'Door leaves & frames'],
    ['window', q.windowArea, 'Windows & glazed doors'], ['roof', q.roofArea, 'Terrace waterproofing'],
  ] as const) {
    const option = finishOption(category, selection.choices[category])
    add(category, 'Finishes', label, quantity, option.rate, option.label)
  }
  add('electrical', 'Services', 'Electrical allowance', q.floorArea, r.electrical, 'Area allowance; circuits and fittings are not specified')
  add('plumbing', 'Services', 'Plumbing & sanitary allowance', q.floorArea, r.plumbing, 'Area allowance; fixtures and service runs are not specified')
  add('paving', 'Site works', 'Planned paving', q.pavingArea, r.paving, 'Actual driveway, parking, paths, sit-out and utility yard union')
  add('lawn', 'Site works', 'Planned lawn', q.lawnArea, r.lawn, 'Actual lawn area; decorative planting excluded')
  add('pool', 'Site works', 'Pool allowance', q.poolArea, r.pool, 'Plan area allowance; depth, structure and equipment require quotes')
  const direct = boq.reduce((sum, item) => sum + item.amount, 0)
  const overhead = direct * selection.overheadPercent / 100
  const contingency = (direct + overhead) * selection.contingencyPercent / 100
  const fees = direct * selection.feePercent / 100
  const gst = selection.includeGst ? (direct + overhead + contingency) * selection.gstPercent / 100 : 0
  const summary = [
    ['Measured works & allowances', 'Materials and labour before overhead, fees, contingency and GST', direct],
    ['Contractor overhead', `${selection.overheadPercent}% of works`, overhead],
    ['Contingency', `${selection.contingencyPercent}% of works plus overhead`, contingency],
    ['Professional fees allowance', `${selection.feePercent}% of works; approvals and taxes on fees excluded`, fees],
    ['GST provision', selection.includeGst ? `${selection.gstPercent}% of works, overhead and contingency; confirm applicability` : 'Excluded; check contractor tax treatment before enabling', gst],
  ] as const
  const lines = summary.map(([label, note, expected]) => ({ label, note, expected, ...band(expected) }))
  const expected = lines.reduce((sum, item) => sum + item.expected, 0), rate = q.floorArea ? expected / q.floorArea : 0
  return { currency: 'INR', total: band(expected), expected, ratePerSqm: band(rate), lines, quantities, selection, boq,
    label: estimateLabel(), qualification: policy.qualification, confidence: 'C', rateVersion: policy.version,
    basis: `${q.floorArea.toFixed(1)} m² measured floor area · ${q.doorCount} door leaves · ${q.windowCount} glazed openings · ${policy.scope.rates}`,
    included: policy.scope.included, excluded: [...policy.scope.excluded, ...(!selection.includeGst ? ['GST and taxes on professional fees'] : ['Taxes on professional fees'])],
    sources: [policy.status, ...policy.sources.map(s => `${s.label} — ${s.url}`)],
    sanityNote: rate && (rate < policy.sanityPerSqm.low || rate > policy.sanityPerSqm.high)
      ? 'This estimate is outside the configured reference range. Check the scope and rates with a local contractor.' : null }
}
/** Export the same calculation as screen/PDF, including assumptions and provenance. */
export function boqCsv(cost: CostEstimate): string {
  const rows: (string | number)[][] = [[cost.label], [cost.qualification], ['Rate version', cost.rateVersion], [cost.basis],
    ['Group', 'Item', 'Specification', 'Quantity', 'Unit', 'Rate (INR)', 'Amount (INR)'],
    ...cost.boq.map(l => [l.group, l.label, l.specification, l.quantity, l.unit, l.rate, l.amount]),
    ...cost.lines.map(l => ['Summary', l.label, l.note, '', '', '', l.expected]),
    ['Expected total', cost.expected], ['Low', cost.total.low], ['High', cost.total.high],
    ...cost.quantities.assumptions.map(a => ['Measurement assumption', a]),
    ...cost.excluded.map(a => ['Excluded', a]), ...cost.sources.map(a => ['Source', a])]
  return rows.map(row => row.map(value => {
    const text = String(value), safe = typeof value === 'string' && /^[\s]*[=+@-]/.test(text) ? `'${text}` : text
    return `"${safe.replaceAll('"', '""')}"`
  }).join(',')).join('\r\n')
}
