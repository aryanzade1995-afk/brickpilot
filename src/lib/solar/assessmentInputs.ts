import { z } from 'zod'
import { governmentSupportInputsSchema } from './governmentSupportInputs.ts'

const n = (min: number, max: number) => z.number().finite().min(min).max(max).nullable().default(null)
const text = z.string().trim().max(1000).nullable().default(null)
const url = z.string().url().regex(/^https?:\/\//).max(2000).nullable().default(null)
/** User-provided assessment basis, deliberately outside architectural and placement identity. */
export const solarAssessmentInputsSchema = z.strictObject({
  schemaVersion: z.literal(1).default(1),
  objective: z.enum(['unknown', 'bill-savings', 'outage-backup', 'both']).default('unknown'),
  legacyAllowance: z.enum(['preserve', 'exclude']).default('preserve'),
  governmentSupport: governmentSupportInputsSchema,
  electrical: z.strictObject({
    moduleSource: url, panelSpecificationKey: text, inverterSource: url, inverterName: text,
    moduleVocV: n(1, 200), moduleVmpV: n(1, 200), moduleIscA: n(.01, 100), moduleImpA: n(.01, 100),
    vocCoefficientPctPerC: n(-2, 0), vmpCoefficientPctPerC: n(-2, 0),
    minimumCellC: n(-60, 25), maximumCellC: n(25, 120),
    modulesPerString: n(1, 100).refine(v => v === null || Number.isInteger(v)),
    parallelStrings: n(1, 100).refine(v => v === null || Number.isInteger(v)),
    inverterAcKw: n(.1, 1000), inverterMaxDcKwp: n(.1, 2000), inverterMaxVocV: n(1, 2000),
    inverterMpptMinV: n(1, 2000), inverterMpptMaxV: n(1, 2000), inverterStartV: n(1, 2000),
    inverterMaxInputA: n(.01, 1000), inverterMaxShortCircuitA: n(.01, 1000),
    supplyPhase: z.enum(['unknown', 'single', 'three']).default('unknown'),
    inverterPhase: z.enum(['unknown', 'single', 'three']).default('unknown'),
  }).prefault({}),
  energy: z.strictObject({
    sourceUrl: url, referencePeriod: text, weatherBasis: text,
    latitudeDeg: n(-90, 90), longitudeDeg: n(-180, 180), trueAzimuthDeg: n(0, 359.999), tiltDeg: n(0, 90),
    annualPoaLowKwhM2: n(1, 4000), annualPoaHighKwhM2: n(1, 4000),
    // Aggregate non-shading conversion factor: shading is applied separately exactly once.
    nonShadingPrLow: n(.01, 1), nonShadingPrHigh: n(.01, 1), shadingLossLow: n(0, 1), shadingLossHigh: n(0, 1),
  }).prefault({}).superRefine((v, ctx) => {
    for (const [low, high] of [[v.annualPoaLowKwhM2, v.annualPoaHighKwhM2], [v.nonShadingPrLow, v.nonShadingPrHigh], [v.shadingLossLow, v.shadingLossHigh]])
      if (low !== null && high !== null && high < low) ctx.addIssue({ code: 'custom', message: 'Range upper bound must be at least its lower bound' })
  }),
}).prefault({})
export type SolarAssessmentInputs = z.infer<typeof solarAssessmentInputsSchema>
export const defaultSolarAssessmentInputs = () => solarAssessmentInputsSchema.parse({})
