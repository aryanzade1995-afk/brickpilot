import type { Point, Rect } from '../../geometry.ts'
import type { FloorProgram, Relationship, SpaceReq, Zone } from '../../model/canonical.ts'

/* ------------------------------------------------------------------ *
 *  Rule + constraint residential planner — stage types.
 *
 *  UserBrief → NormalizedBrief → SiteModel → StructuralGrid →
 *  ProgramRequirements → FloorPlatePlan → RoomGraph → RoomPlacement →
 *  WallGraph → StairCore → DoorPlacement → WindowPlacement →
 *  WetAreaPlanning → StructuralConcept → Validation → PlanModel
 *
 *  All geometry is integer millimetres. The plan is laid out in a local
 *  (u, v) frame — u runs along the circulation spine, v across it — and
 *  transformed once into plan coordinates (x east, y south; the road /
 *  entry is always plan-south). Nothing here is a screen position.
 * ------------------------------------------------------------------ */

export type Orientation = 'x' | 'y'
/** A = back band, S = circulation spine, B = front band */
export type Band = 'A' | 'S' | 'B'
/** the plate families the planner can build and prove valid */
export type PlateFamily = 'rectangular' | 'stepped' | 'l-shape' | 'courtyard' | 'twin-wing' | 'u-wing' | 'courtyard-ring' | 'pavilion'

export type RoomKind =
  | 'foyer' | 'living' | 'dining' | 'livingDining' | 'kitchen' | 'utility' | 'pooja'
  | 'stair' | 'lift' | 'corridor' | 'lobby' | 'lounge' | 'bed' | 'ensuite' | 'bath'
  | 'study' | 'parking' | 'verandah' | 'courtyard' | 'balcony'

export type NormalizedBrief = {
  storeys: number
  floorToFloorMm: number
  flightWidthMm: number
  lift: boolean
  large: boolean
  mainDoorMm: number
  twoCar: boolean
  floors: FloorProgram[]
  relationships: Relationship[]
}

export type SiteModel = {
  plot: Rect
  envelope: Rect
  /** depth reserved at the front (plan-south) for parking / verandah */
  fillPlot?: boolean
  /** the house plate grows to fill the buildable area (large villa) */
  growPlate?: boolean
  maxEnclosedMm2?: number
  frontStripMm: number
  /** where the enclosed plate may go: envelope less the front strip */
  houseZone: Rect
}

export type RoomReq = {
  /** canonical programme id (bed1, kitchen, …) — what the rest of the app keys on */
  id: string
  semanticId: string
  name: string
  zone: Zone
  kind: RoomKind
  minSqm: number
  targetSqm: number
  maxSqm: number
  /** absolute minimum clear width along the band, mm */
  minWidthMm: number
  /** fixed width (stair / lift slots) */
  fixedWidthMm?: number
  wet: boolean
  habitable: boolean
  outdoor: boolean
  /** ensuite → its bedroom id */
  parent?: string
  space: SpaceReq
}

/** RoomGraph node group: rooms that must stay contiguous, in order, in one band */
export type Unit = {
  key: string
  rooms: RoomReq[]
  band: 'A' | 'B'
  movable: boolean
  /** pinned to the u = 0 end of its band (stair core, foyer) */
  anchor: boolean
}

export type FloorRequirements = {
  level: number
  prefix: string
  rooms: RoomReq[]
  spine: RoomReq
  units: Unit[]
  outdoor: RoomReq[]
}

export type LocalRoom = { req: RoomReq; band: Band; u0: number; u1: number }

export type FloorPlate = {
  level: number
  /** u-extent of this floor (always starts at 0 — the stair end) */
  length: number
  /** per band, the occupied u-intervals */
  segments: Record<Band, [number, number][]>
}

export type Column = { id: string; at: Point; size: number; grid: string }
export type Beam = { id: string; a: Point; b: Point; span: number }
export type SupportZone = { id: string; rect: Rect; support: 'columns' | 'cantilever' }
export type Shaft = { id: string; roomId: string; rect: Rect; stackedOver: string | null }

export type PlanStructure = {
  orientation: Orientation
  mirror: boolean
  family: PlateFamily
  /** plan-coordinate grid axes, named 1..n / A..D */
  axes: { id: string; orient: 'h' | 'v'; at: number }[]
  maxBeamSpanMm: number
}
