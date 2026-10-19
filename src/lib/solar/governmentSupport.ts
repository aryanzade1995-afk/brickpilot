import { z } from 'zod'
import rawRules from './data/pm-surya-ghar.v1.json' with { type: 'json' }
import type { SolarConfiguration } from '../model/solar.ts'
import { governmentSupportInputsSchema, type GovernmentSupportInputs } from './governmentSupportInputs.ts'

const officialUrl = z.string().url().refine(value => {
  const url = new URL(value)
  return url.protocol === 'https:' && ['mnre.gov.in', 'www.pib.gov.in', 'cdnbbsr.s3waas.gov.in', 'www.mahadiscom.in', 'pmsuryaghar.gov.in'].includes(url.hostname) && !url.username && !url.password
}, 'Government guidance must link to a reviewed official HTTPS source')
const money = z.number().finite().int().nonnegative()
const rateBand = z.strictObject({ firstBandInrPerKwp: money, additionalBandInrPerKwp: money, maximumInr: money })
export const governmentSchemeRulesSchema = z.strictObject({
  schemaVersion: z.literal(1), id: z.literal('pm-surya-ghar-capex-cfa'), revision: z.string().min(1), authority: z.string().min(1),
  verifiedOn: z.iso.date(), reviewAfterDays: z.number().int().min(1).max(365), schemePeriodEnd: z.iso.date(),
  applyUrl: z.literal('https://pmsuryaghar.gov.in/'), scope: z.string(),
  consumerCategories: z.array(z.enum(['individual-residential', 'housing-association'])).min(1), excludedCategories: z.array(z.literal('non-residential')),
  individual: z.strictObject({ capacityBasis: z.literal('installed-module-DC-kWp'), firstBandKwp: z.literal(2), additionalBandKwp: z.literal(1), general: rateBand, special: rateBand, fractionalCapacity: z.literal('pro-rata'), additionalAbove3Kwp: z.literal(0) }),
  association: z.strictObject({ capacityLimitKwp: z.literal(500), capacityPerDwellingKwp: z.literal(3), generalInrPerKwp: money, specialInrPerKwp: money, includesIndividualInstallationsInCapacityLimit: z.literal(true) }),
  specialCategoryStateCodes: z.array(z.string().regex(/^[A-Z]{2}$/)),
  conditions: z.array(z.strictObject({ id: z.string().min(1), source: z.string().min(1), section: z.string(), summary: z.string() })).min(1),
  sources: z.array(z.strictObject({ id: z.string().min(1), label: z.string().min(1), publishedOn: z.iso.date().nullable(), verifiedOn: z.iso.date(), url: officialUrl })).min(1),
  stateSupport: z.strictObject({ status: z.literal('not-assessed'), amountInr: z.null(), sourceIds: z.array(z.string()).length(0), note: z.string() }),
  msedclGuidance: z.strictObject({ stateCode: z.literal('MH'), discom: z.literal('MSEDCL'), sourceId: z.string(), url: officialUrl }),
}).superRefine((r, ctx) => {
  const sources = new Set(r.sources.map(s => s.id))
  if (sources.size !== r.sources.length || r.conditions.some(c => !sources.has(c.source)) || !sources.has(r.msedclGuidance.sourceId)) ctx.addIssue({ code: 'custom', message: 'Every rule must have a unique, reviewed source reference' })
  if (r.sources.some(s => s.verifiedOn !== r.verifiedOn || s.publishedOn !== null && s.publishedOn > r.verifiedOn)) ctx.addIssue({ code: 'custom', message: 'Source verification dates must match the reviewed rules pack' })
  for (const band of [r.individual.general, r.individual.special]) if (band.maximumInr !== band.firstBandInrPerKwp * r.individual.firstBandKwp + band.additionalBandInrPerKwp * r.individual.additionalBandKwp) ctx.addIssue({ code: 'custom', message: 'Published maximum must agree with the capacity bands' })
})
export type GovernmentSchemeRules = z.infer<typeof governmentSchemeRulesSchema>
export const governmentSchemeRules: GovernmentSchemeRules = governmentSchemeRulesSchema.parse(rawRules)

export const INDIAN_STATES = [
  ['AN', 'Andaman and Nicobar Islands'], ['AP', 'Andhra Pradesh'], ['AR', 'Arunachal Pradesh'], ['AS', 'Assam'], ['BR', 'Bihar'], ['CH', 'Chandigarh'], ['CG', 'Chhattisgarh'], ['DH', 'Dadra and Nagar Haveli and Daman and Diu'], ['DL', 'Delhi'], ['GA', 'Goa'], ['GJ', 'Gujarat'], ['HR', 'Haryana'], ['HP', 'Himachal Pradesh'], ['JK', 'Jammu and Kashmir'], ['JH', 'Jharkhand'], ['KA', 'Karnataka'], ['KL', 'Kerala'], ['LA', 'Ladakh'], ['LD', 'Lakshadweep'], ['MP', 'Madhya Pradesh'], ['MH', 'Maharashtra'], ['MN', 'Manipur'], ['ML', 'Meghalaya'], ['MZ', 'Mizoram'], ['NL', 'Nagaland'], ['OD', 'Odisha'], ['PY', 'Puducherry'], ['PB', 'Punjab'], ['RJ', 'Rajasthan'], ['SK', 'Sikkim'], ['TN', 'Tamil Nadu'], ['TG', 'Telangana'], ['TR', 'Tripura'], ['UP', 'Uttar Pradesh'], ['UK', 'Uttarakhand'], ['WB', 'West Bengal'],
] as const
export function normalizeIndianState(code: string | null | undefined): string | null {
  const clean = code?.trim().toUpperCase().replace(/^IN-/, '') ?? ''
  const aliases: Record<string, string> = { UT: 'UK', TS: 'TG', OR: 'OD', CT: 'CG', DD: 'DH', DN: 'DH' }
  const candidate = aliases[clean] ?? clean
  return INDIAN_STATES.some(([id]) => id === candidate) ? candidate : null
}
/** The questionnaire stays in its draft until the shared solar Preview/Apply path saves it. */
export function supportInputsForSolar(solar: SolarConfiguration): GovernmentSupportInputs {
  const inputs = governmentSupportInputsSchema.parse(solar.assessmentInputs.governmentSupport)
  return { ...inputs, stateCode: normalizeIndianState(inputs.stateCode ?? solar.inputs.location.stateCode) }
}
export type GovernmentSupportState = 'unknown' | 'potentially-eligible' | 'inapplicable' | 'outdated-information'
export type SupportReason = 'outdated' | 'location' | 'state-conflict' | 'non-residential' | 'no-grid' | 'no-permission' | 'non-dcr' | 'relocated' | 'prior-support' | 'model-scope' | 'missing-basic-inputs' | 'association-review' | 'preliminary-only'
export type GovernmentSupportAssessment = { state: GovernmentSupportState; eligibility: 'unverified'; reasons: SupportReason[]; rateCategory: 'general' | 'special' | null; showMsedcl: boolean; msedclConditional: boolean; showFinancialGuidance: boolean }
export function assessGovernmentSupport(inputs: GovernmentSupportInputs, today = new Date().toISOString().slice(0, 10), rules = governmentSchemeRules, projectState?: string | null): GovernmentSupportAssessment {
  const stateCode = normalizeIndianState(inputs.stateCode)
  const verified = Date.parse(`${rules.verifiedOn}T00:00:00Z`), now = Date.parse(`${today}T00:00:00Z`)
  const outdated = !z.iso.date().safeParse(today).success || !Number.isFinite(now) || now < verified || now - verified > rules.reviewAfterDays * 86400000 || today > rules.schemePeriodEnd
  const result: GovernmentSupportAssessment = { state: 'unknown', eligibility: 'unverified', reasons: [], rateCategory: stateCode ? rules.specialCategoryStateCodes.includes(stateCode) ? 'special' : 'general' : null,
    showMsedcl: inputs.country === 'IN' && stateCode === 'MH' && inputs.discom !== 'other', msedclConditional: inputs.discom === 'unknown', showFinancialGuidance: !outdated }
  if (outdated) return { ...result, state: 'outdated-information', reasons: ['outdated'], showFinancialGuidance: false }
  if (inputs.country === 'other') return { ...result, state: 'inapplicable', reasons: ['location'], showFinancialGuidance: false }
  if (inputs.consumer === 'non-residential') return { ...result, state: 'inapplicable', reasons: ['non-residential'], showFinancialGuidance: false }
  if (inputs.gridConnection === 'no') return { ...result, state: 'inapplicable', reasons: ['no-grid'], showFinancialGuidance: false }
  if (inputs.roofPermission === 'no') return { ...result, state: 'inapplicable', reasons: ['no-permission'], showFinancialGuidance: false }
  if (inputs.equipment === 'non-dcr') return { ...result, state: 'inapplicable', reasons: ['non-dcr'], showFinancialGuidance: false }
  if (inputs.installation === 'relocated') return { ...result, state: 'inapplicable', reasons: ['relocated'], showFinancialGuidance: false }
  const knownProjectState = normalizeIndianState(projectState)
  if (stateCode && knownProjectState && stateCode !== knownProjectState) return { ...result, reasons: ['state-conflict'], showFinancialGuidance: false, showMsedcl: false }
  if (inputs.ownership === 'third-party') return { ...result, reasons: ['model-scope'], showFinancialGuidance: false }
  if (inputs.previousCfa === 'yes' || inputs.installation === 'expansion') return { ...result, reasons: ['prior-support'], showFinancialGuidance: false }
  if (inputs.consumer === 'housing-association') return { ...result, reasons: ['association-review'] }
  if (inputs.country !== 'IN' || !stateCode || inputs.consumer !== 'individual-residential' || inputs.ownership !== 'consumer-owned' || inputs.gridConnection !== 'yes' || inputs.roofPermission !== 'yes' || inputs.previousCfa !== 'no' || inputs.installation !== 'new') return { ...result, reasons: ['missing-basic-inputs'] }
  return { ...result, state: 'potentially-eligible', reasons: ['preliminary-only'] }
}
