export const MASSING_FAMILIES = [
  'L_SHAPED', 'U_SHAPED', 'COURTYARD', 'OFFSET_BLOCKS', 'INTERLOCKING_BLOCKS',
  'STACKED_VOLUMES', 'STEPPED', 'TWIN_WING', 'CANTILEVERED', 'TERRACED',
  'LINEAR', 'CLUSTERED', 'SPLIT_VOLUME', 'PAVILION', 'ASYMMETRIC',
] as const
export type MassingFamily = (typeof MASSING_FAMILIES)[number]
export type MassRole = 'primary' | 'secondary' | 'livingWing' | 'bedroomWing' | 'stairTower' |
  'entrance' | 'verticalFeature' | 'upperVolume' | 'terraceVolume'
export type QuarterTurn = 0 | 90 | 180 | 270

/** Millimetres; x/y locate the unrotated rectangle, rotation is about its centre.
 * Elevation is relative to ground-floor FFL. Roof masses are unoccupied envelopes. */
export type Mass = {
  id: string
  floor: number
  x: number
  y: number
  width: number
  depth: number
  height: number
  rotation: QuarterTurn
  role: MassRole
  parentId: string | null
  elevation: number
  usage: 'enclosed' | 'roof' | 'terrace' | 'canopy' | 'support'
  sourceFloorId: string
  sourceRoomIds: string[]
  /** A hollow, unoccupied architectural roof envelope; never a new room. */
  shell?: boolean
  bearingSupports?: string[]
}
export type MassingIssue = { code: string; message: string; massId?: string }
export type FamilyAssessment = { family: MassingFamily; compatible: boolean; reason: string }
export type MassingModel = {
  schemaVersion: 1
  sourcePlanId: string
  seed: number
  units: 'mm'
  family: MassingFamily
  status: 'valid' | 'rejected'
  masses: Mass[]
  issues: MassingIssue[]
  familyAssessments: FamilyAssessment[]
  /** Full geometric gate result for the accepted/last attempted variation. */
  architectureReport: import('./ArchitectureValidator.ts').ArchitectureReport | null
  attemptsTried: number
  /** Front/side/top union perimeters, independent of mass IDs/decomposition. */
  silhouetteSignature: string | null
  generationMode?: 'plan-envelope-v1'
  architectureLimits?: import('./ArchitectureValidator.ts').ArchitectureLimits
}
