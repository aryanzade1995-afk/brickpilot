import type { Brief } from '../model/brief.ts'
import type { CostEstimate } from './boq.ts'
import { specificationSchedule } from './schedule.ts'
import { publicSheetSchema } from './deliverySchemas.ts'
import type { z } from 'zod'
export type PublicSheet = z.infer<typeof publicSheetSchema>
/** Deliberately excludes the private household brief, room coordinates and edit state. */
export function createPublicSheet(brief: Brief, cost: CostEstimate): PublicSheet {
  return publicSheetSchema.parse({ schemaVersion: 1, projectName: brief.project.name || 'Formstead project',
    createdAt: new Date().toISOString(), schedule: specificationSchedule(brief, cost), cost })
}
