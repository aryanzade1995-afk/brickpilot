import type { Rect } from '../../../geometry.ts'

export const BALCONY_TYPES = ['RECESSED', 'PROJECTED', 'FLOATING', 'CORNER', 'WRAP', 'BOXED',
  'FRAME_INTEGRATED', 'PLANTER', 'PARTIAL_WIDTH', 'FULL_WIDTH'] as const
export const ENTRANCE_TYPES = ['RECESSED_ENTRY', 'DOUBLE_HEIGHT_PORTAL', 'STONE_ENTRY', 'WOOD_PORTAL',
  'SIDE_ENTRY', 'FLOATING_CANOPY', 'COURTYARD_ENTRY'] as const
export const WINDOW_TYPES = ['ALIGNED', 'ASYMMETRIC', 'HORIZONTAL_BAND', 'VERTICAL_STACK',
  'CORNER_GLAZING', 'FLOOR_TO_CEILING', 'FRAME_GROUPED', 'SCREENED'] as const
export const ROOFLINE_TYPES = ['FLAT_PARAPET', 'STEPPED_PARAPET', 'OFFSET_PARAPET', 'ROOFTOP_FRAME',
  'PERGOLA', 'ROOF_TERRACE', 'SCREENED_TERRACE', 'PLANTER_PARAPET'] as const
export const DEPTH_TYPES = ['DEEP_RECESS', 'SHALLOW_RECESS', 'MAIN_FACADE_PLANE', 'CLADDING_PLANE',
  'PROJECTED_SLAB', 'ARCHITECTURAL_FRAME', 'CANTILEVERED_MASS'] as const
export const GRAMMAR_TYPES = { BALCONY: BALCONY_TYPES, ENTRANCE: ENTRANCE_TYPES,
  WINDOW: WINDOW_TYPES, ROOFLINE: ROOFLINE_TYPES, DEPTH: DEPTH_TYPES } as const
export type GrammarCategory = keyof typeof GRAMMAR_TYPES
export type GrammarType = (typeof GRAMMAR_TYPES)[GrammarCategory][number]
export type GrammarOptions = Partial<{ [K in GrammarCategory]: (typeof GRAMMAR_TYPES)[K][number] }>
export type GrammarAnchor = { kind: 'WALL' | 'BALCONY' | 'ROOF' | 'ROOF_MASS'; sourceId: string; floorId: string }
export type GrammarLocalBox = { u: number; v: number; z: number; w: number; d: number; h: number }
export type GrammarPart = {
  id: string
  anchor: GrammarAnchor
  local: GrammarLocalBox
  world: Rect & { z: number; height: number }
  role: 'frame' | 'post' | 'beam' | 'rail' | 'glass' | 'planter' | 'finish' | 'slab' | 'screen' | 'recess' | 'cladding' | 'box' | 'cap'
  operation: 'ADD' | 'RECESS'
  material: 'wall' | 'stone' | 'timber' | 'metal' | 'glass' | 'concrete' | 'landscape'
  collection: 'FACADE' | 'BALCONIES' | 'ROOF' | 'WINDOWS' | 'LANDSCAPE'
}
export type GrammarAssembly = {
  id: string; category: GrammarCategory; type: GrammarType
  sourceRoomIds: string[]; openingIds: string[]; parts: GrammarPart[]
}
export type GrammarIssue = { code: string; message: string; assemblyId?: string; partId?: string }
export type SpecializedGrammarModel = {
  schemaVersion: 1; sourcePlanId: string; seed: number; status: 'valid' | 'rejected'
  assemblies: GrammarAssembly[]; issues: GrammarIssue[]
  omissions: { category: GrammarCategory; sourceId: string; requested: GrammarType | null; reason: string }[]
  limits: GrammarLimits
}
export type GrammarLimits = {
  toleranceMm: number; openingClearanceMm: number; doorApproachMm: number
  maxProjectionMm: number; maxCantileverMm: number; minWallRemainderMm: number
  shallowRecessMm: number; deepRecessMm: number; railHeightMm: number
  minBalconyClearDepthMm: number; minRoofPadWidthMm: number; minRoofPadDepthMm: number
  roofRouteWidthMm: number; maxRoofFeatureHeightMm: number
}
export const DEFAULT_GRAMMAR_LIMITS: GrammarLimits = {
  toleranceMm: 2, openingClearanceMm: 30, doorApproachMm: 1000,
  maxProjectionMm: 1200, maxCantileverMm: 900, minWallRemainderMm: 70,
  shallowRecessMm: 45, deepRecessMm: 130, railHeightMm: 1000,
  minBalconyClearDepthMm: 900, minRoofPadWidthMm: 1800, minRoofPadDepthMm: 1600,
  roofRouteWidthMm: 800, maxRoofFeatureHeightMm: 2400,
}
