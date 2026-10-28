import { specificationRate } from './catalogue.ts'
import type { Trade } from './data/boqRules.ts'
import type { PricingContext, ResearchedRateOverride, ManualRateOverride, ScopeMode } from './research/types.ts'

export interface ResolvedRate {
  id: string
  unit: string
  material: number
  labour: number
  installed: number
  source: 'baseline' | 'researched' | 'manual'
  city: string
  date: string
  provenance: string
  sources?: {
    url: string
    publisher: string
    date?: string | null
    fetchTimestamp: string
    excerpt: string
  }[]
  isManualOverride?: boolean
  pricingBasis?: string
}

export interface RateResolver {
  getRate(rateId: string): ResolvedRate
  hasOverride(rateId: string): boolean
  isResearched(rateId: string): boolean
  isManual(rateId: string): boolean
  context: PricingContext | null
}

export function createPricingResolver(context?: PricingContext | null): RateResolver {
  const rates = context?.rates || {}
  const manual = context?.manualOverrides || {}
  const locationCity = context?.location.city || 'Pune'

  return {
    context: context || null,

    hasOverride(rateId: string): boolean {
      return Boolean(manual[rateId] || rates[rateId])
    },

    isManual(rateId: string): boolean {
      return Boolean(manual[rateId])
    },

    isResearched(rateId: string): boolean {
      return Boolean(rates[rateId] && !manual[rateId])
    },

    getRate(rateId: string): ResolvedRate {
      const manualEntry: ManualRateOverride | undefined = manual[rateId]
      if (manualEntry) {
        return {
          id: rateId,
          unit: manualEntry.unit,
          material: manualEntry.material,
          labour: manualEntry.labour,
          installed: manualEntry.material + manualEntry.labour,
          source: 'manual',
          city: locationCity,
          date: manualEntry.updatedAt ? manualEntry.updatedAt.slice(0, 10) : new Date().toISOString().slice(0, 10),
          provenance: manualEntry.reason ? `Manual override: ${manualEntry.reason}` : 'User manual rate override',
          isManualOverride: true,
        }
      }

      const researchedEntry: ResearchedRateOverride | undefined = rates[rateId]
      if (researchedEntry) {
        const sourcePublishers = researchedEntry.sources.map(s => s.publisher).filter(Boolean)
        const pubLabel = sourcePublishers.length ? sourcePublishers.join(', ') : 'Live web research'
        return {
          id: rateId,
          unit: researchedEntry.unit,
          material: researchedEntry.material,
          labour: researchedEntry.labour,
          installed: researchedEntry.installed,
          source: 'researched',
          city: locationCity,
          date: researchedEntry.appliedAt ? researchedEntry.appliedAt.slice(0, 10) : new Date().toISOString().slice(0, 10),
          provenance: `Live research in ${locationCity} (${pubLabel})`,
          sources: researchedEntry.sources,
          pricingBasis: researchedEntry.pricingBasis,
        }
      }

      const baseline = specificationRate(rateId)
      return {
        id: baseline.id,
        unit: baseline.unit,
        material: baseline.material,
        labour: baseline.labour,
        installed: baseline.installed,
        source: 'baseline',
        city: baseline.city || 'Pune',
        date: baseline.date || '2026-10-03',
        provenance: 'Provisional concept allowance (baseline rates dated 2026-10-03)',
      }
    },
  }
}

export function pricingContextKey(context?: PricingContext | null): string {
  if (!context) return 'baseline'
  const rateKeys = Object.keys(context.rates || {}).sort().map(k => `${k}:${context.rates[k].installed}`).join(',')
  const manualKeys = Object.keys(context.manualOverrides || {}).sort().map(k => `${k}:${context.manualOverrides![k].installed}`).join(',')
  const interiorKey = context.interiorSchedule?.items?.length ? `${context.interiorSchedule.items.length}:${context.interiorSchedule.totalAmount}` : '0'
  const scope = context.scopeMode || 'combined'
  return `${context.id || 'ctx'}_${context.location?.city || 'Pune'}_${scope}_${rateKeys}_${manualKeys}_${interiorKey}`
}

export function classifyTradeScope(trade: Trade, item: string): 'construction' | 'interiors' {
  if (['Civil & structure', 'Waterproofing', 'Exterior & site', 'Plumbing & sanitary'].includes(trade)) {
    return 'construction'
  }
  if (trade === 'Flooring & tiling' || trade === 'Painting') {
    return 'interiors'
  }
  if (trade === 'Doors & windows') {
    return item === 'internal-door' ? 'interiors' : 'construction'
  }
  if (trade === 'Electrical') {
    return ['light-fittings', 'fans', 'switches'].includes(item) ? 'interiors' : 'construction'
  }
  if (trade === 'Extras') {
    return item === 'interiors' ? 'interiors' : 'construction'
  }
  return 'construction'
}

export function isLineInScope(trade: Trade, item: string, scopeMode: ScopeMode = 'combined'): boolean {
  if (scopeMode === 'combined') return true
  const lineScope = classifyTradeScope(trade, item)
  return lineScope === scopeMode
}
