import { replayedCost } from './replay.ts'
import type { Design } from '../engine/types.ts'
import type { Brief } from '../model/brief.ts'
import { estimateBoq, type CostEstimate } from './boq.ts'
import { parseSelection } from './specifications.ts'
import { writeSelectionToBrief } from './briefSelections.ts'
export { estimateBoq } from './boq.ts'
export type { Band, CostLine, BoqLine, CostEstimate } from './boq.ts'

/** Saved pre-catalogue controls migrate into a copy, never into source geometry. */
export function estimateSelectedBoq(design: Design, preferences?: unknown, brief: Brief = design.model.brief): CostEstimate {
  if (!preferences) return estimateBoq(design, brief)
  const projected = { ...brief, specs: { overrides: { ...brief.specs.overrides } } }
  const selection = parseSelection(preferences)
  writeSelectionToBrief(projected, design, selection)
  return estimateBoq(design, projected, selection)
}
/** Full current Brief wins; only untouched legacy projects import browser-only finish choices. */
export function estimateProjectBoq(design: Design, brief: Brief = design.model.brief, saved?: unknown): CostEstimate {
  const restored = replayedCost(design, brief, saved)
  if (restored) return restored
  if (saved && !parseSelection(saved).catalogue && brief.finish === 'mid' && !Object.keys(brief.specs.overrides).length) return estimateSelectedBoq(design, saved, brief)
  return estimateBoq(design, brief, saved ? parseSelection(saved) : undefined)
}
/** Export the same calculation as screen/PDF, including assumptions and provenance. */
export function boqCsv(cost: CostEstimate): string {
  const rows: (string | number)[][] = [[cost.label], [cost.qualification], ['Rate version', cost.rateVersion], [cost.basis],
    ['Group', 'Item', 'Specification', 'Quantity', 'Unit', 'Rate (INR)', 'Amount (INR)', 'Spec ID', 'Material (INR)', 'Labour (INR)', 'Assumption'],
    ...cost.boq.map(l => [l.group, l.label, l.specification, l.quantity, l.unit, l.rate, l.amount, l.specId, l.materialAmount, l.labourAmount, l.note]),
    ...cost.tradeTotals.map(t => ['Trade total', t.trade, '', '', '', '', t.amount, '', t.material, t.labour, `${(t.share * 100).toFixed(1)}% of works`]),
    ...cost.lines.map(l => ['Summary', l.label, l.note, '', '', '', l.expected]),
    ['Expected total', cost.expected], ['Low', cost.total.low], ['High', cost.total.high],
    ['INR / sq ft', cost.ratePerSqft], ['Turnkey works', cost.procurement.turnkey], ['Materials', cost.procurement.material], ['Labour', cost.procurement.labour],
    ['Default preset total', cost.defaultExpected],
    ...cost.topCostDrivers.map(d => ['Cost driver vs preset', d.label, '', '', '', '', d.amount, '', '', '', `Default ${d.defaultAmount}; difference ${d.difference}`]),
    ...cost.assumptions.map(a => ['Measurement assumption', a]),
    ...cost.excluded.map(a => ['Excluded', a]), ...cost.sources.map(a => ['Source', a])]
  return rows.map(row => row.map(value => {
    const text = String(value), safe = typeof value === 'string' && /^[\s]*[=+@-]/.test(text) ? `'${text}` : text
    return `"${safe.replaceAll('"', '""')}"`
  }).join(',')).join('\r\n')
}
