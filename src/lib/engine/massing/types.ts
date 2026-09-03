import type { Rect } from '../../geometry.ts'

/** compass edge — kept local to avoid a cycle with the brief schema */
export type Direction = 'N' | 'E' | 'S' | 'W'

/* ------------------------------------------------------------------ *
 *  Massing grammar — the architectural STRUCTURE of the house, chosen
 *  before (and independently of) style. A `MassingPlan` is a per-floor
 *  set of axis-aligned volumes (a "rect union"); the room engine fills
 *  it and buildMassing extrudes it.
 * ------------------------------------------------------------------ */

export const MASSING_TYPES = [
  'rectangular',
  'l-shape',
  't-shape',
  'u-shape',
  'courtyard',
  'rear-courtyard',
  'offset-box',
  'split-volume',
  'cantilever',
  'stepped',
  'interlocking',
  'central-core',
  'side-wing',
  'front-projection',
  'asymmetric',
] as const
export type MassingType = (typeof MASSING_TYPES)[number]

export const MASSING_LABEL: Record<MassingType, string> = {
  rectangular: 'Rectangular',
  'l-shape': 'L-shaped',
  't-shape': 'T-shaped',
  'u-shape': 'U-shaped',
  courtyard: 'Central courtyard',
  'rear-courtyard': 'Rear courtyard',
  'offset-box': 'Offset box',
  'split-volume': 'Split volume',
  cantilever: 'Cantilever',
  stepped: 'Stepped volumes',
  interlocking: 'Interlocking volumes',
  'central-core': 'Central core',
  'side-wing': 'Side wing',
  'front-projection': 'Front projection',
  asymmetric: 'Asymmetric',
}

export type Diversity = 'low' | 'medium' | 'high' | 'extreme'
export const DIVERSITIES: Diversity[] = ['low', 'medium', 'high', 'extreme']

export type RoofKind = 'flat' | 'flat-parapet' | 'mono-slope' | 'hip' | 'gable' | 'mixed'

export type RoofSpec = {
  kind: RoofKind
  /** pitch in degrees for mono-slope / hip / gable */
  pitchDeg?: number
  /** for mono-slope: the low side */
  fall?: Direction
  /** for `mixed`: one spec per block (index-aligned with FloorMassing.blocks) */
  perBlock?: RoofSpec[]
}

/** one storey of the massing: a union of boxes, some of which oversail the floor below */
export type FloorMassing = {
  level: number
  /** axis-aligned volumes in plot-millimetre coords; their union is the floor footprint */
  blocks: Rect[]
  /** indices into `blocks` that deliberately project past the floor below */
  cantilevers: number[]
  roof: RoofSpec
}

export type MassingPlan = {
  type: MassingType
  /** ground-first */
  floors: FloorMassing[]
  /** where the stair / service core sits (mm, plot coords) */
  coreBlock: Rect
  /** an open void inside the union (courtyard archetypes), else null */
  courtyard: Rect | null
  entrySide: Direction
}

export type MassingRequest = {
  type: MassingType | 'auto' | 'random'
  diversity: Diversity
  /** integer seed — same seed + brief ⇒ same house */
  seed: number
}
