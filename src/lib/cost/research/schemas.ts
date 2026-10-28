import { z } from 'zod'
import { TRADES } from '../data/boqRules.ts'

const amount = z.number().nonnegative().finite()
const text = z.string().min(1).max(12000)
const shortText = z.string().min(1).max(500)
const id = z.string().regex(/^[a-zA-Z0-9_.:@/-]+$/)

export const researchLocationSchema = z.strictObject({
  city: z.string().min(2).max(100),
  state: z.string().max(100).optional(),
  pincode: z.string().regex(/^[1-9][0-9]{5}$/).optional(),
  country: z.literal('IN').default('IN'),
  currency: z.literal('INR').default('INR'),
})

export const scopeModeSchema = z.enum(['construction', 'interiors', 'combined'])

export const researchTargetSchema = z.strictObject({
  targetId: id,
  rateId: id,
  itemId: id,
  itemLabel: shortText,
  trade: z.enum(TRADES),
  scope: z.enum(['construction', 'interiors', 'shared']),
  queryTerm: text,
  requiredUnit: shortText,
  basisRequired: z.enum(['installed', 'supply-only', 'labour-only']),
  specSummary: text,
  brandOrGrade: shortText.optional(),
})

export const sourceDocumentSchema = z.strictObject({
  docId: id,
  url: z.string().url(),
  title: text,
  publisher: shortText,
  fetchTimestamp: z.iso.datetime(),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
  textSample: z.string().max(32000),
  sourceType: z.enum(['supplier', 'manufacturer', 'marketplace', 'official-schedule', 'other']),
})

export const extractedEvidenceSchema = z.strictObject({
  evidenceId: id,
  targetId: id,
  rateId: id,
  docId: id,
  url: z.string().url(),
  publisher: shortText,
  publishedDate: z.iso.date().nullable(),
  fetchTimestamp: z.iso.datetime(),
  quotedPrice: amount,
  quotedCurrency: z.literal('INR'),
  quotedUnit: shortText,
  packSize: amount.nullable(),
  pricingBasis: z.enum(['supply-only', 'labour-only', 'installed']),
  taxIncluded: z.union([z.boolean(), z.literal('unknown')]),
  deliveryIncluded: z.union([z.boolean(), z.literal('unknown')]),
  minOrder: z.string().max(200).nullable(),
  locationMentioned: z.string().max(200).nullable(),
  excerpt: text,
  confidenceReasoning: text,
  specificationMatch: text,
})

export const normalizedEvidenceSchema = extractedEvidenceSchema.extend({
  normalizedMaterialRate: amount.nullable(),
  normalizedLabourRate: amount.nullable(),
  normalizedInstalledRate: amount,
  targetUnit: shortText,
  conversionAssumptions: z.array(text),
  valid: z.boolean(),
  rejectionReason: text.optional(),
})

export const proposedRateSchema = z.strictObject({
  rateId: id,
  targetId: id,
  itemId: id,
  itemLabel: shortText,
  trade: z.enum(TRADES),
  unit: shortText,
  baselineMaterial: amount,
  baselineLabour: amount,
  baselineInstalled: amount,
  proposedMaterial: amount,
  proposedLabour: amount,
  proposedInstalled: amount,
  pricingBasis: z.enum(['installed', 'supply-only', 'labour-only', 'hybrid']),
  differencePercent: z.number().finite(),
  evidence: z.array(normalizedEvidenceSchema),
  status: z.enum([
    'accepted',
    'provisional-fallback',
    'rejected',
    'conflict',
    'single-source',
    'stale',
    'unresolved',
    'unreadable',
  ]),
  selectionReason: text,
  freshnessDate: z.iso.date(),
})

export const researchedRateOverrideSchema = z.strictObject({
  rateId: id,
  unit: shortText,
  material: amount,
  labour: amount,
  installed: amount,
  pricingBasis: z.enum(['installed', 'supply-only', 'labour-only', 'hybrid']),
  sources: z.array(z.strictObject({
    url: z.string().url(),
    publisher: shortText,
    date: z.iso.date().nullable().optional(),
    fetchTimestamp: z.iso.datetime(),
    excerpt: text,
  })),
  appliedAt: z.iso.datetime(),
  isManualOverride: z.boolean().optional(),
  notes: text.optional(),
})

export const manualRateOverrideSchema = z.strictObject({
  rateId: id,
  unit: shortText,
  material: amount,
  labour: amount,
  installed: amount,
  updatedAt: z.iso.datetime(),
  reason: text.optional(),
})

export const acceptedPricingSnapshotSchema = z.strictObject({
  id: id,
  createdAt: z.iso.datetime(),
  location: researchLocationSchema,
  scope: scopeModeSchema,
  sourceFingerprint: z.string().min(1).max(128),
  rates: z.record(z.string(), researchedRateOverrideSchema),
  unresolvedGaps: z.array(z.strictObject({
    rateId: id,
    itemLabel: shortText,
    reason: text,
  })),
})

export const interiorScheduleItemSchema = z.strictObject({
  id: id,
  roomId: id,
  roomName: shortText,
  itemType: shortText,
  label: shortText,
  category: z.enum(['furniture', 'joinery', 'appliance', 'fixture']),
  count: z.number().int().positive(),
  dimensions: z.object({
    w: z.number().positive(),
    d: z.number().positive(),
    h: z.number().positive(),
  }).optional(),
  specification: text,
  estimatedRate: amount,
  amount: amount,
  quantityBasis: z.enum(['measured', 'assumed', 'user-entered']),
  includedInEstimate: z.boolean(),
  replacesAllowanceId: id.optional(),
})

export const interiorItemScheduleSchema = z.strictObject({
  schemaVersion: z.literal(1),
  updatedAt: z.iso.datetime(),
  items: z.array(interiorScheduleItemSchema),
  totalAmount: amount,
})

export const pricingContextSchema = z.strictObject({
  id: id,
  location: researchLocationSchema,
  rates: z.record(z.string(), researchedRateOverrideSchema),
  manualOverrides: z.record(z.string(), manualRateOverrideSchema).optional(),
  interiorSchedule: interiorItemScheduleSchema.optional(),
  scopeMode: scopeModeSchema.optional(),
})

export const costResearchJobSchema = z.strictObject({
  jobId: id,
  userId: z.string().optional(),
  status: z.enum([
    'queued',
    'researching',
    'extracting',
    'validating',
    'completed',
    'partial',
    'failed',
    'cancelled',
    'failed: interrupted',
    'historical proposal',
  ]),
  isHistorical: z.boolean().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  progress: z.strictObject({
    step: shortText,
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    message: text,
  }),
  location: researchLocationSchema,
  scope: scopeModeSchema,
  sourceFingerprint: z.string().min(1).max(128),
  proposals: z.array(proposedRateSchema),
  unresolvedTargets: z.array(z.strictObject({
    targetId: id,
    rateId: id,
    reason: text,
  })),
  error: text.nullable(),
})
