import type { Design } from '../engine/types.ts'
import type { PlateFamily } from '../engine/planner/types.ts'
import { FINISH_LABEL, BUDGET_SCOPE_LABEL, type Brief } from '../model/brief.ts'
import { INTERIOR_AREA_SHARE, INTERIOR_RATE_PER_SQM, RATE_SPREAD, constructionRate } from './rates.ts'

export type Band = { low: number; high: number }
export type CostLine = { label: string; note: string; low: number; high: number }

export type BudgetStatus = 'within' | 'tight' | 'over'

export type CostEstimate = {
  currency: 'INR'
  total: Band
  expected: number
  ratePerSqm: Band
  lines: CostLine[]
  basis: string
  confidence: 'A' | 'B' | 'C'
  included: string[]
  excluded: string[]
  sources: string[]
  /** the brief's budget against the expected cost */
  budget: {
    amountInr: number
    expected: number
    /** budget − expected: positive is headroom, negative is overspend */
    deltaInr: number
    status: BudgetStatus
  }
}

const mid = (b: Band) => (b.low + b.high) / 2
const scale = (b: Band, k: number): Band => ({ low: b.low * k, high: b.high * k })

/**
 * Every cost line for `area` m² built-up. The single place the money is
 * worked out — estimateCost() and costPerSqmAllIn() both read it.
 */
function costLines(area: number, brief: Brief, family: PlateFamily): { rate: Band; lines: CostLine[] } {
  const r = constructionRate(brief, family)
  const rate: Band = { low: r * (1 - RATE_SPREAD), high: r * (1 + RATE_SPREAD) }
  const finish = FINISH_LABEL[brief.budget.finish].toLowerCase()
  const scope = brief.budget.scope

  const base: Band = scale(rate, area)
  const external: Band = { low: base.low * 0.05, high: base.high * 0.07 }
  const fees: Band = { low: (base.low + external.low) * 0.06, high: (base.high + external.high) * 0.09 }
  const contingency: Band = {
    low: (base.low + external.low) * 0.08,
    high: (base.high + external.high) * 0.12,
  }

  const lines: CostLine[] = [
    { label: 'Base building works', note: `${area.toFixed(0)} m² × ${finish} finish rate`, ...base },
    { label: 'External works allowance', note: 'site, boundary, services runs', ...external },
  ]
  if (scope === 'withInteriors' || scope === 'all') {
    const i = INTERIOR_RATE_PER_SQM[brief.budget.finish] * area * INTERIOR_AREA_SHARE
    lines.push({
      label: 'Interiors',
      note: `${finish} fit-out on ${Math.round(INTERIOR_AREA_SHARE * 100)}% of built-up area`,
      low: i * (1 - RATE_SPREAD),
      high: i * (1 + RATE_SPREAD),
    })
  }
  if (scope === 'all') {
    lines.push({ label: 'Landscaping + compound wall', note: '3% of base building works', ...scale(base, 0.03) })
  }
  lines.push(
    { label: 'Professional fees allowance', note: 'design + statutory consultants', ...fees },
    { label: 'Contingency', note: 'concept-stage uncertainty', ...contingency },
    { label: 'Tax allowance', note: 'not modelled at concept stage', low: 0, high: 0 },
  )
  return { rate, lines }
}

const totalOf = (lines: CostLine[]): Band => ({
  low: lines.reduce((s, l) => s + l.low, 0),
  high: lines.reduce((s, l) => s + l.high, 0),
})

export function budgetStatus(expected: number, amountInr: number): BudgetStatus {
  if (expected <= 0.9 * amountInr) return 'within'
  if (expected <= amountInr) return 'tight'
  return 'over'
}

/**
 * Expected INR per m² built-up, all in: construction at the brief's finish
 * level plus externals, fees, contingency and whatever the budget scope adds
 * (interiors, landscaping). Pure — for sizing a house to a budget (T7).
 */
export function costPerSqmAllIn(brief: Brief, family: PlateFamily = 'rectangular'): number {
  // every line scales with area, so any area gives the same rate
  return mid(totalOf(costLines(100, brief, family).lines)) / 100
}

export function estimateCost(design: Design): CostEstimate {
  const brief = design.model.brief
  const area = design.builtAreaSqm
  const large = brief.project.buildingType === 'large-villa'
  const family: PlateFamily = design.structure?.family ?? 'rectangular'
  const { rate, lines } = costLines(area, brief, family)
  const total = totalOf(lines)
  const expected = mid(total)
  const amountInr = brief.budget.amountLakh * 1e5
  const finish = FINISH_LABEL[brief.budget.finish]

  return {
    currency: 'INR',
    total,
    expected,
    ratePerSqm: rate,
    lines,
    budget: { amountInr, expected, deltaInr: amountInr - expected, status: budgetStatus(expected, amountInr) },
    basis: `${finish} finish · ${BUDGET_SCOPE_LABEL[brief.budget.scope].toLowerCase()} · ${large ? 'Large villa · ' : ''}${design.floors.length} floors · ${area.toFixed(0)} m² built-up · ${design.openingCounts.doors} doors · ${design.openingCounts.windows} windows`,
    confidence: 'C',
    included: [
      `Structure, envelope and internal finishes at a ${finish.toLowerCase()} finish level`,
      'Standard internal plumbing, sanitary and electrical services',
      'Ordinary substructure at an assumed level ground',
      ...(brief.budget.scope !== 'construction' ? [`Interiors at a ${finish.toLowerCase()} finish level`] : []),
      ...(brief.budget.scope === 'all' ? ['Landscaping and compound wall allowance'] : []),
    ],
    excluded: [
      'Land, statutory charges, legal and financing costs',
      'Site-specific foundations, retaining, dewatering',
      ...(brief.budget.scope === 'construction' ? ['Interiors: modular kitchen, wardrobes, false ceilings, lighting'] : []),
      'Loose furniture, appliances, HVAC, solar, lifts, premium imports',
    ],
    sources: [
      'Finish-level ₹/m² rates, Pune 2026 (approximate) — confirm with a local contractor',
      'CPWD Plinth Area Rates + Cost Index (Govt. of India) — reference only',
    ],
  }
}
