import type { Rect, Point } from '../geometry.ts'
import type { CanonicalModel, Zone } from '../model/canonical.ts'
import type { MassingType, RoofSpec } from './massing/types.ts'
import type { DesignDNA } from './designDna.ts'
import type { Beam, Column, PlanStructure, Shaft, SupportZone } from './planner/types.ts'
import type { LayoutChoices } from './planner/layoutChoices.ts'

export type { RoofSpec }

export type PlacedRoom = {
  id: string
  /** stable architectural id, e.g. GF_LIVING, FF_MASTER_BED */
  semanticId: string
  name: string
  zone: Zone
  rect: Rect
  /** actual area in m² */
  area: number
  outdoor: boolean
  wantsWindow: boolean
}

export type Wall = {
  heightMm?: number
  a: Point
  b: Point
  thickness: number
  kind: 'exterior' | 'interior' | 'parapet'
  /** semantic id, e.g. GF_WALL_LIVING_CORRIDOR */
  id?: string
  /** room ids either side (null = outside) */
  rooms?: [string, string | null]
  /** on a structural grid line (carries beams / sits on columns) */
  structural?: boolean
}

export type Opening = {
  /** semantic id, e.g. GF_MAIN_DOOR, GF_LIVING_WINDOW_01 */
  id?: string
  kind: 'door' | 'window' | 'entry'
  /** midpoint of the opening on the wall centreline */
  at: Point
  orient: 'h' | 'v'
  width: number
  /** door leaf swing direction, for the arc */
  entranceDesign?: 'indian-carved' | 'wide-pivot' | 'framed-portico' | 'stone-surround'
  swing?: 1 | -1
  /** which end of the opening the hinge is at, along the wall */
  hinge?: 'a' | 'b'
  /** false = a cased opening with no leaf */
  leaf?: boolean
  /** how a leafless opening is finished: a wide open gap, or a glazed sliding screen */
  treatment?: 'open' | 'glazed-slide'
  /** sill height (windows), mm */
  sill?: number
  /** Optional explicit opening head height, mm above its source floor. */
  head?: number
  /** the spaces it joins — [from, to]; null = outside */
  rooms?: [string | null, string | null]
}

export type StairRun = {
  rect: Rect
  /** polyline of tread nosings for the drawing */
  treads: Point[][]
  direction: 'up'
  /** plan edge of `rect` where the first flight starts (the landing side of the spine) */
  startSide?: 'N' | 'S' | 'E' | 'W'
}

export type FloorPlan = {
  doubleHeightVoids?: import('./planner/doubleHeight.ts').DoubleHeightVoid[]
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
  /** GF, FF, SF, TF … */
  prefix?: string
  columns?: Column[]
  beams?: Beam[]
  shafts?: Shaft[]
  supportZones?: SupportZone[]
}

export type SiteFeature = { id: string; kind: 'parking' | 'driveway' | 'path' | 'lawn' | 'pool' | 'sitOut' | 'utilityYard'; rect: Rect; covered: boolean; roomId?: string }

export type Design = {
  planSeed?: number
  layoutChoices?: LayoutChoices
  siteFeatures?: SiteFeature[]
  siteNotes?: string[]
  id: string
  seed: string
  algorithm: string
  candidate: string
  massingType: MassingType
  dna: DesignDNA
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
  /** structural concept shared by every floor (absent on legacy designs) */
  structure?: PlanStructure
}
