import type { Rect, Point } from '../geometry.ts'
import type { CanonicalModel, Zone } from '../model/canonical.ts'
import type { MassingType, RoofSpec } from './massing/types.ts'

export type { RoofSpec }

export type PlacedRoom = {
  id: string
  name: string
  zone: Zone
  rect: Rect
  /** actual area in m² */
  area: number
  outdoor: boolean
  wantsWindow: boolean
}

export type Wall = {
  a: Point
  b: Point
  thickness: number
  kind: 'exterior' | 'interior' | 'parapet'
}

export type Opening = {
  kind: 'door' | 'window' | 'entry'
  /** midpoint of the opening on the wall centreline */
  at: Point
  orient: 'h' | 'v'
  width: number
  /** door leaf swing direction, for the arc */
  swing?: 1 | -1
}

export type StairRun = {
  rect: Rect
  /** polyline of tread nosings for the drawing */
  treads: Point[][]
  direction: 'up'
}

export type FloorPlan = {
  level: number
  name: string
  /** bounding box of the floor footprint (mm) — camera framing / cost / coverage */
  outline: Rect
  /** the real footprint: a union of axis-aligned blocks (the massing) */
  footprint: Rect[]
  roof: RoofSpec
  /** open void inside the footprint (courtyard archetypes, ground floor) */
  courtyard?: Rect | null
  rooms: PlacedRoom[]
  walls: Wall[]
  openings: Opening[]
  stair?: StairRun
  reachable: boolean
  unreachableRooms: string[]
}

export type Design = {
  id: string
  seed: string
  algorithm: string
  candidate: string
  massingType: MassingType
  model: CanonicalModel
  floors: FloorPlan[]
  /** gross built-up area, m² (enclosed footprint × floors) */
  builtAreaSqm: number
  /** ground-floor enclosed footprint, m² */
  footprintSqm: number
  /** footprint including covered outdoor, m² */
  coveredFootprintSqm: number
  heightM: number
  /** covered footprint / plot area */
  coverage: number
  openingCounts: { doors: number; windows: number }
}
