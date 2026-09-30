/** compass edge — kept local to avoid a cycle with the brief schema */
export type Direction = 'N' | 'E' | 'S' | 'W'

/* ------------------------------------------------------------------ *
 *  Massing vocabulary shared by the brief, the UI and the planner.
 *  The planner (../planner) resolves every MassingType onto one of the
 *  plate families it can prove valid; the names stay stable so saved
 *  briefs and pinned directions keep working.
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
  /** for `mixed`: one spec per block (index-aligned with FloorPlan.footprint) */
  perBlock?: RoofSpec[]
}
