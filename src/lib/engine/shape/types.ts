import type { Rect } from '../../geometry.ts'

/** compass edge — kept local to avoid a cycle with the brief schema */
export type Direction = 'N' | 'E' | 'S' | 'W'

export type RoofKind = 'flat' | 'flat-parapet' | 'mono-slope' | 'hip' | 'gable' | 'mixed'

export type RoofSpec = {
  kind: RoofKind
  /** pitch in degrees for mono-slope / hip / gable */
  pitchDeg?: number
  /** for mono-slope: the low side */
  fall?: Direction
  /** for `mixed`: one spec per block (index-aligned with the footprint blocks) */
  perBlock?: RoofSpec[]
}

/* ------------------------------------------------------------------ *
 *  Footprint shapes — the building silhouette, chosen before (and
 *  independently of) style and room layout. Six purposeful shapes the
 *  layout engine knows how to fill; `layout/` places rooms into the
 *  `blocks`, `buildMassing` extrudes them.
 * ------------------------------------------------------------------ */

export const SHAPES = ['square', 'rectangle', 'l-shape', 't-shape', 'u-shape', 'courtyard'] as const
export type Shape = (typeof SHAPES)[number]

export const SHAPE_LABEL: Record<Shape, string> = {
  square: 'Square',
  rectangle: 'Rectangle',
  'l-shape': 'L-shaped',
  't-shape': 'T-shaped',
  'u-shape': 'U-shaped',
  courtyard: 'Courtyard',
}

export const SHAPE_BLURB: Record<Shape, string> = {
  square: 'A compact near-square block — the shortest walls, the cheapest structure, every room close to the centre.',
  rectangle: 'A single long block across the plot — a clear front-to-back arrangement with generous street frontage.',
  'l-shape': 'Two wings meeting at the living room — one wing sleeps, the other cooks and services, with a sheltered corner outside.',
  't-shape': 'A central living hub with three short wings — good cross-ventilation and daylight on every face.',
  'u-shape': 'Wings on three sides around an open forecourt or garden the living room looks onto.',
  courtyard: 'Rooms wrapped around a private central court that brings light and air deep into the plan.',
}

/** one built shape — a rect-union footprint plus where the core and any void sit */
export type Footprint = {
  shape: Shape
  /** axis-aligned volumes in plot-mm; their union is the floor footprint */
  blocks: Rect[]
  /** the column the stair shares on every storey (mm, plot coords) */
  core: Rect
  /** an open void inside the union (u-shape / courtyard), else null */
  courtyard: Rect | null
  /** which edge of the footprint the entry is on */
  entryEdge: Direction
}

export type ShapeCtx = {
  /** buildable ground rect (envelope, already trimmed for the front strip) */
  env: Rect
  houseW: number
  houseH: number
  coreW: number
  coreH: number
  entryEdge: Direction
  grid: number
  storeys: number
  /** rough programme area of the busiest floor, m² — for `auto` */
  programSqm: number
}

export type ShapeRequest = {
  want: Shape | 'auto'
  /** integer seed — same seed + brief ⇒ same house */
  seed: number
}
