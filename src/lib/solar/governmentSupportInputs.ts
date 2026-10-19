import { z } from 'zod'

const answer = z.enum(['unknown', 'yes', 'no']).default('unknown')
/** Non-sensitive, self-reported applicability hints. Never an official eligibility record. */
export const governmentSupportInputsSchema = z.strictObject({
  schemaVersion: z.literal(1).default(1),
  country: z.enum(['unknown', 'IN', 'other']).default('unknown'),
  stateCode: z.string().regex(/^[A-Z]{2}$/).nullable().default(null),
  discom: z.enum(['unknown', 'MSEDCL', 'other']).default('unknown'),
  consumer: z.enum(['unknown', 'individual-residential', 'housing-association', 'non-residential']).default('unknown'),
  ownership: z.enum(['unknown', 'consumer-owned', 'third-party']).default('unknown'),
  gridConnection: answer, roofPermission: answer, previousCfa: answer,
  installation: z.enum(['unknown', 'new', 'expansion', 'relocated']).default('unknown'),
  equipment: z.enum(['unknown', 'vendor-review', 'non-dcr']).default('unknown'),
}).prefault({})
export type GovernmentSupportInputs = z.infer<typeof governmentSupportInputsSchema>
