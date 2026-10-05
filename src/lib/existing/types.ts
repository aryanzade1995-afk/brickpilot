import type { ElementState } from '../engine/planner/types.ts'

export type Pt = { x: number; y: number }

/** where a detection came from: the image analysis, or the user's own click */
export type Source = 'auto' | 'user'

/** A column seen in the photo. `img` is where its base meets the ground (image pixels). */
export type DetColumn = {
  id: string
  img: Pt
  /** where the top meets a beam, when seen */
  top?: Pt
  widthPx: number
  confidence: number
  source: Source
  /** the user checked this one; detections under the confidence floor must be confirmed */
  confirmed: boolean
}
export type DetBeam = { id: string; a: string; b: string; confidence: number; source: Source; confirmed: boolean }
/** a footing / pedestal / foundation pad with no column yet */
export type DetFooting = { id: string; img: Pt; confidence: number; source: Source; confirmed: boolean }
export type DetWall = { id: string; a: Pt; b: Pt; confidence: number; source: Source; confirmed: boolean }

export type Detections = {
  columns: DetColumn[]
  beams: DetBeam[]
  footings: DetFooting[]
  walls: DetWall[]
  /** what is visible, as far as the image analysis can tell */
  seen: { foundation: boolean; columns: boolean; beams: boolean; slab: boolean; walls: boolean }
}

export type Calibration =
  | { mode: 'scale'; a: string; b: string; distanceMm: number }
  | { mode: 'corners'; /** TL, TR, BR, BL in the image */ pts: Pt[]; widthMm: number; depthMm: number }
  | { mode: 'none' }

export type RoadSide = 'N' | 'E' | 'S' | 'W'

export type Answers = {
  plotWidthM: number
  plotDepthM: number
  columnSizeMm: number
  beamWidthMm: number
  roadSide: RoadSide
  storeysBuilt: number
  storeysWanted: number
  bedroomsWithBath: number
  bedroomsNoBath: number
  sharedBaths: number
  studies: number
  pooja: boolean
  utility: boolean
  parking: boolean
}

/** One element of the as-built structural map, with the state the planner must respect. */
export type MapElement =
  | { kind: 'column'; id: string; at: Pt; size: number; state: ElementState; confidence: number; confirmed: boolean }
  | { kind: 'footing'; id: string; at: Pt; state: ElementState; confidence: number; confirmed: boolean }
  | { kind: 'beam'; id: string; a: Pt; b: Pt; width: number; state: ElementState; confidence: number; confirmed: boolean }
  | { kind: 'wall'; id: string; a: Pt; b: Pt; thickness: number; state: ElementState; confidence: number; confirmed: boolean }

export const CONFIDENCE_FLOOR = 0.6

export const defaultAnswers = (): Answers => ({
  plotWidthM: 15, plotDepthM: 18, columnSizeMm: 230, beamWidthMm: 230, roadSide: 'S', storeysBuilt: 1, storeysWanted: 2,
  bedroomsWithBath: 2, bedroomsNoBath: 1, sharedBaths: 1, studies: 0, pooja: false, utility: false, parking: true,
})
