import type { Rect } from '../../geometry.ts'
import type { ArchitecturalFamily } from './architecturalFamilies.ts'
import type { SpecializedGrammarModel } from './specialized/types.ts'

export const FACADE_ZONE_KINDS = [
  'PRIMARY', 'SECONDARY', 'ENTRANCE', 'BALCONY', 'STAIR_TOWER',
  'UPPER', 'ROOFLINE', 'SERVICE', 'VOID',
] as const
export type FacadeZoneKind = (typeof FACADE_ZONE_KINDS)[number]

export const ARCHITECTURAL_FEATURE_TYPES = [
  'C_FRAME', 'L_FRAME', 'RECTANGLE_FRAME', 'DOUBLE_HEIGHT_FRAME', 'FLOATING_FRAME', 'CORNER_WRAP_FRAME',
  'PROJECTED_BOX', 'FLOATING_BOX', 'RECESSED_BOX', 'INTERLOCKING_BOX',
  'STONE_SPINE', 'WOOD_SPINE', 'VERTICAL_TOWER',
  'DOUBLE_HEIGHT_PORTAL', 'ENTRY_PORTAL',
  'JALI_SCREEN', 'VERTICAL_FIN_SCREEN', 'HORIZONTAL_LOUVER',
  'DEEP_OVERHANG', 'PERGOLA_FRAME', 'ROOF_FRAME',
  'BRIDGE_VOLUME', 'COURTYARD_SCREEN',
  // precedent elements from the reference photo set (docs/villa-precedents.md)
  'COLONNADE', 'FREEFORM_CANOPY', 'STEEL_GRID', 'TIMBER_BATTEN', 'STONE_PLINTH',
  'PERGOLA_COURT', 'FOLDED_CANOPY', 'PERFORATED_BRICK_WALL', 'BAY_WINDOW',
  'CANTILEVER_STAIR_TOWER', 'ROOF_GARDEN_EDGE', 'SOLAR_SHADE_ROOF',
  'GATE_PORTAL', 'CHIMNEY_TOWER', 'POOL_PAVILION',
] as const
export type ArchitecturalFeatureType = (typeof ARCHITECTURAL_FEATURE_TYPES)[number]
export type FacadeSide = 'N' | 'E' | 'S' | 'W'

/** A real exterior wall face, or an exposed edge of a real roof mass. */
export type FacadeZone = {
  /** Optional site anchors retain the old exterior-wall/roof representation. */
  anchorKind?: 'gate' | 'pool-sitout' | 'roof-interior'
  sourceSiteId?: string
  id: string
  kind: FacadeZoneKind
  floorId: string
  wallId: string | null
  hostMassIds: string[]
  roomId: string | null
  side: FacadeSide
  fixedMm: number
  startMm: number
  endMm: number
  elevationMm: number
  heightMm: number
  openingIds: string[]
}

/** Local u runs along the wall; z is absolute height. Offset/depth grow outward. */
export type FeaturePart = {
  id: string
  zoneId: string
  role: 'beam' | 'post' | 'panel' | 'screen' | 'slab' | 'box' | 'glass'
  materialHint?: 'stone' | 'wood' | 'metal' | 'wall' | 'glass'
  u0Mm: number
  u1Mm: number
  z0Mm: number
  z1Mm: number
  offsetMm: number
  depthMm: number
  /** Derived from the local span and facade normal; never an independent anchor. */
  world: Rect & { z: number; height: number }
}

export type FrameParameters = {
  widthRatio: number
  heightRatio: number
  thicknessMm: number
  projectionMm: number
  offsetRatio: number
  openSide: 'LEFT' | 'RIGHT'
}

export type ElementParameters = Partial<FrameParameters> & {
  widthRatio: number
  projectionMm: number
  rhythmCount: number
  pitchMm: number
  profile: 'square' | 'slim' | 'paired'
  slabEdge: 'flat' | 'upstand'
  materialHint: 'stone' | 'wood' | 'metal' | 'wall' | 'glass'
}

export type ArchitecturalFeature = {
  id: string
  type: ArchitecturalFeatureType
  importance: 'hero' | 'support'
  zoneIds: string[]
  parameters: FrameParameters | ElementParameters | null
  parts: FeaturePart[]
}

export type FacadeIssue = { code: string; message: string; featureId?: string; zoneId?: string }
export type ProceduralFacadeModel = {
  schemaVersion: 2
  sourcePlanId: string
  massingSeed: number
  architecturalFamily: ArchitecturalFamily
  status: 'valid' | 'rejected'
  zones: FacadeZone[]
  features: ArchitecturalFeature[]
  issues: FacadeIssue[]
  attemptsTried: number
  /** Optional for older saved models; fresh generation supplies checked component grammars. */
  specialized?: SpecializedGrammarModel
}
