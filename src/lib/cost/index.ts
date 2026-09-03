import type { Design } from '../engine/types.ts'
import type { Brief } from '../model/brief.ts'

export type Band = { low: number; high: number }
export type CostLine = { label: string; note: string; low: number; high: number }

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
}

/** placeholder ₹/m² base rates by finish character — replace with CPWD PAR + cost index */
const BASE_RATE: Record<Brief['style']['character'], number> = {
  'modern-indian': 22000,
  'contemporary-indian': 21500,
  'modern-kerala': 20500,
  'kerala-contemporary': 20500,
  'luxury-indian': 29000,
  'tropical-indian': 22500,
  'minimal-indian': 19500,
  'courtyard-indian': 21000,
}
const RATE_SPREAD = 0.14

export function estimateCost(design: Design): CostEstimate {
  const area = design.builtAreaSqm
  const large = design.model.brief.project.buildingType === 'large-villa'
  // a large villa carries longer spans, more glazing and a grander finish level
  const mid = BASE_RATE[design.model.brief.style.character] * (large ? 1.12 : 1)
  const rate: Band = { low: mid * (1 - RATE_SPREAD), high: mid * (1 + RATE_SPREAD) }

  const base: Band = { low: area * rate.low, high: area * rate.high }
  const external: Band = { low: base.low * 0.05, high: base.high * 0.07 }
  const fees: Band = { low: (base.low + external.low) * 0.06, high: (base.high + external.high) * 0.09 }
  const contingency: Band = {
    low: (base.low + external.low) * 0.08,
    high: (base.high + external.high) * 0.12,
  }

  const lines: CostLine[] = [
    { label: 'Base building works', note: `${area.toFixed(0)} m² × concept rate`, ...base },
    { label: 'External works allowance', note: 'site, boundary, services runs', ...external },
    { label: 'Professional fees allowance', note: 'design + statutory consultants', ...fees },
    { label: 'Contingency', note: 'concept-stage uncertainty', ...contingency },
    { label: 'Tax allowance', note: 'not modelled at concept stage', low: 0, high: 0 },
  ]

  const total: Band = {
    low: lines.reduce((s, l) => s + l.low, 0),
    high: lines.reduce((s, l) => s + l.high, 0),
  }

  return {
    currency: 'INR',
    total,
    expected: (total.low + total.high) / 2,
    ratePerSqm: rate,
    lines,
    basis: `${large ? 'Large villa · ' : ''}${design.floors.length} floors · ${area.toFixed(0)} m² built-up · ${design.openingCounts.doors} doors · ${design.openingCounts.windows} windows`,
    confidence: 'C',
    included: [
      'Structure, envelope and internal finishes at the selected character',
      'Standard internal plumbing, sanitary and electrical services',
      'Ordinary substructure at an assumed level ground',
    ],
    excluded: [
      'Land, statutory charges, legal and financing costs',
      'Site-specific foundations, retaining, dewatering',
      'Loose furniture, appliances, HVAC, solar, lifts, premium imports',
    ],
    sources: [
      'CPWD Plinth Area Rates + Cost Index (Govt. of India) — placeholder table',
      'BrickPilot regional feasibility reference (concept)',
    ],
  }
}
