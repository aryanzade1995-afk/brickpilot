import { z } from 'zod'

/** Editable concept assumptions, not statutory or engineering limits. */
export const solarAllocationPolicySchema = z.strictObject({
  schemaVersion: z.literal(1).default(1), basis: z.literal('concept-only').default('concept-only'),
  edgeClearanceMm: z.number().finite().min(0).max(100000).default(600),
  obstacleClearanceMm: z.number().finite().min(0).max(100000).default(300),
  accessWidthMm: z.number().finite().min(600).max(5000).default(800),
  minFreeTerraceRatio: z.number().finite().min(0).max(1).default(.3),
}).prefault({})
export const solarPlacementPolicySchema = z.strictObject({
  schemaVersion: z.literal(1).default(1), basis: z.literal('concept-only').default('concept-only'),
  tiltDeg: z.number().finite().min(0).max(90).default(15),
  mountingHeightMm: z.number().finite().min(0).max(10000).default(400),
  rowGapMm: z.number().finite().min(0).max(100000).default(800),
  moduleGapMm: z.number().finite().min(0).max(10000).default(50),
  supportOverhangMm: z.number().finite().min(0).max(10000).default(100),
  minSupportDepthMm: z.number().finite().positive().max(10000).default(600),
  maintenanceSideMm: z.number().finite().min(0).max(10000).default(50),
  maintenanceRowMm: z.number().finite().min(0).max(10000).default(200),
  maxCandidateChecks: z.number().int().min(100).max(100000).default(20000),
}).prefault({})
export type SolarPlacementPolicy = z.infer<typeof solarPlacementPolicySchema>
