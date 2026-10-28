import type { Trade } from '../data/boqRules.ts'

export type ScopeMode = 'construction' | 'interiors' | 'combined'

export interface ResearchLocation {
  city: string
  state?: string
  pincode?: string
  country: 'IN'
  currency: 'INR'
}

export interface ResearchTarget {
  targetId: string
  rateId: string
  itemId: string
  itemLabel: string
  trade: Trade
  scope: 'construction' | 'interiors' | 'shared'
  queryTerm: string
  requiredUnit: string
  basisRequired: 'installed' | 'supply-only' | 'labour-only'
  specSummary: string
  brandOrGrade?: string
}

export interface SourceDocument {
  docId: string
  url: string
  title: string
  publisher: string
  fetchTimestamp: string
  contentDigest: string
  textSample: string
  sourceType: 'supplier' | 'manufacturer' | 'marketplace' | 'official-schedule' | 'other'
}

export interface ExtractedEvidence {
  evidenceId: string
  targetId: string
  rateId: string
  docId: string
  url: string
  publisher: string
  publishedDate: string | null
  fetchTimestamp: string
  quotedPrice: number
  quotedCurrency: 'INR'
  quotedUnit: string
  packSize: number | null
  pricingBasis: 'supply-only' | 'labour-only' | 'installed'
  taxIncluded: boolean | 'unknown'
  deliveryIncluded: boolean | 'unknown'
  minOrder: string | null
  locationMentioned: string | null
  excerpt: string
  confidenceReasoning: string
  specificationMatch: string
}

export interface NormalizedEvidence extends ExtractedEvidence {
  normalizedMaterialRate: number | null
  normalizedLabourRate: number | null
  normalizedInstalledRate: number
  targetUnit: string
  conversionAssumptions: string[]
  valid: boolean
  rejectionReason?: string
}

export interface ProposedRate {
  rateId: string
  targetId: string
  itemId: string
  itemLabel: string
  trade: Trade
  unit: string
  baselineMaterial: number
  baselineLabour: number
  baselineInstalled: number
  proposedMaterial: number
  proposedLabour: number
  proposedInstalled: number
  pricingBasis: 'installed' | 'supply-only' | 'labour-only' | 'hybrid'
  differencePercent: number
  evidence: NormalizedEvidence[]
  status: 'accepted' | 'provisional-fallback' | 'rejected' | 'conflict' | 'single-source' | 'stale' | 'unresolved' | 'unreadable'
  selectionReason: string
  freshnessDate: string
  isMock?: boolean
}


export interface ResearchedRateOverride {
  rateId: string
  unit: string
  material: number
  labour: number
  installed: number
  pricingBasis: 'installed' | 'supply-only' | 'labour-only' | 'hybrid'
  sources: {
    url: string
    publisher: string
    date?: string | null
    fetchTimestamp: string
    excerpt: string
  }[]
  appliedAt: string
  isManualOverride?: boolean
  notes?: string
}

export interface ManualRateOverride {
  rateId: string
  unit: string
  material: number
  labour: number
  installed: number
  updatedAt: string
  reason?: string
}

export interface AcceptedPricingSnapshot {
  id: string
  createdAt: string
  location: ResearchLocation
  scope: ScopeMode
  sourceFingerprint: string
  rates: Record<string, ResearchedRateOverride>
  unresolvedGaps: {
    rateId: string
    itemLabel: string
    reason: string
  }[]
}

export interface InteriorScheduleItem {
  id: string
  roomId: string
  roomName: string
  itemType: string
  label: string
  category: 'furniture' | 'joinery' | 'appliance' | 'fixture'
  count: number
  dimensions?: { w: number; d: number; h: number }
  specification: string
  estimatedRate: number
  amount: number
  quantityBasis: 'measured' | 'assumed' | 'user-entered'
  includedInEstimate: boolean
  replacesAllowanceId?: string
}

export interface InteriorItemSchedule {
  schemaVersion: 1
  updatedAt: string
  items: InteriorScheduleItem[]
  totalAmount: number
}

export interface PricingContext {
  id: string
  location: ResearchLocation
  rates: Record<string, ResearchedRateOverride>
  manualOverrides?: Record<string, ManualRateOverride>
  interiorSchedule?: InteriorItemSchedule
  scopeMode?: ScopeMode
}

export interface CostResearchJob {
  jobId: string
  userId?: string
  status:
    | 'queued'
    | 'researching'
    | 'extracting'
    | 'validating'
    | 'completed'
    | 'partial'
    | 'failed'
    | 'cancelled'
    | 'failed: interrupted'
    | 'historical proposal'
  isHistorical?: boolean
  isMock?: boolean
  mockNotice?: string
  createdAt: string

  updatedAt: string
  progress: {
    step: string
    completed: number
    total: number
    message: string
  }
  location: ResearchLocation
  scope: ScopeMode
  sourceFingerprint: string
  proposals: ProposedRate[]
  unresolvedTargets: {
    targetId: string
    rateId: string
    reason: string
  }[]
  error: string | null
}
