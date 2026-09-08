/* ------------------------------------------------------------------ *
 *  dims — the single source of truth for every architectural
 *  dimension. §15: NO MAGIC NUMBERS anywhere else in the pipeline.
 *
 *  Unit note: the whole engine + spec + Blender importer already work
 *  in **millimetres** (Blender's context.mm() converts to metres on
 *  the way out). We keep mm as the internal unit — one consistent
 *  unit, centralised here — rather than churning the entire codebase
 *  to metres. `M(x)` is provided for the few places that read nicer
 *  in metres.
 * ------------------------------------------------------------------ */

export const SPEC_UNIT = 'mm' as const

/** metres → millimetres, for readability at call sites */
export const M = (metres: number): number => Math.round(metres * 1000)

/* ================================================================== *
 *  STRUCTURE
 * ================================================================== */

export const STRUCTURE = {
  /** exterior load-bearing / infill wall thickness */
  extWallMm: 230,
  /** interior partition thickness */
  intWallMm: 115,
  /** parapet wall thickness */
  parapetWallMm: 150,

  /** target structural bay — research: 3.0–4.5 m economical for RCC houses */
  bayTargetMm: 3800,
  bayMinMm: 2700,
  bayMaxMm: 6000,

  /** column section by storey count above ground (G+0 → G+3) */
  columnMm: [230, 300, 300, 380] as const,
  /** how far a column may shift between storeys before a transfer beam is required */
  columnAlignToleranceMm: 50,
  /** porch / verandah column section */
  porchColumnMm: 250,

  /** beam depth by role */
  edgeBeamDepthMm: 350,
  internalBeamDepthMm: 400,
  transferBeamDepthMm: 550,
  canopyBeamDepthMm: 300,
  beamWidthMm: 230,

  /** floor slab + roof slab */
  slabThicknessMm: 150,
  roofSlabThicknessMm: 130,
  /** an unsupported slab edge may cantilever at most this far without a column */
  maxSlabCantileverMm: 1500,

  /** raised plinth above ground level */
  plinthMm: 450,
} as const

/* ================================================================== *
 *  FLOOR-TO-FLOOR
 * ================================================================== */

export const FLOOR = {
  minHeightMm: 2900,
  maxHeightMm: 4200,
  defaultHeightMm: 3100,
  /** structural zone (beam + slab) taken out of the clear floor height */
  structuralZoneMm: STRUCTURE.slabThicknessMm + STRUCTURE.internalBeamDepthMm,
} as const

/* ================================================================== *
 *  DOORS  (leaf sizes; the opening is leaf + frame)
 * ================================================================== */

export const DOOR = {
  entry: { widthMm: [1500, 2400] as [number, number], heightMm: 2400 },
  entryDoubleHeight: { widthMm: [1800, 2600] as [number, number], heightMm: 3600 },
  internal: { widthMm: 900, heightMm: 2100 },
  balcony: { widthMm: 1500, heightMm: 2400 },
  frameMm: 60,
  /** min clear wall each side of a door before an inside corner */
  cornerClearanceMm: 150,
} as const

/* ================================================================== *
 *  WINDOWS
 * ================================================================== */

export const WINDOW = {
  /** kind → [minW, maxW] × [minH, maxH] × default sill, mm */
  standard: { widthMm: [900, 2400] as [number, number], heightMm: [1200, 1800] as [number, number], sillMm: 750 },
  privacy: { widthMm: [450, 800] as [number, number], heightMm: [450, 900] as [number, number], sillMm: 1500 },
  picture: { widthMm: [1800, 4200] as [number, number], heightMm: [1800, 3000] as [number, number], sillMm: 350 },
  strip: { widthMm: [1600, 7000] as [number, number], heightMm: [500, 900] as [number, number], sillMm: 1500 },
  clerestory: { widthMm: [600, 2400] as [number, number], heightMm: [400, 700] as [number, number], sillMm: 2100 },
  ventilator: { widthMm: [400, 800] as [number, number], heightMm: [300, 500] as [number, number], sillMm: 2000 },

  /** §12 — NBC 2016: window area ≥ 10% of the room floor area */
  minLightVentRatio: 0.1,
  /** window area ÷ its wall area ceiling */
  maxWallRatio: 0.55,
  minWallBetweenMm: 600,
  minCornerOffsetMm: 450,
  /** clear distance a window must keep from a door / column edge */
  minDoorDistanceMm: 400,
  minColumnDistanceMm: 150,
  maxPerRoom: 3,
} as const

/* ================================================================== *
 *  BALCONIES
 * ================================================================== */

export const BALCONY = {
  depthMm: [1200, 2800] as [number, number],
  minWidthMm: 1400,
  railingHeightMm: 1000,
  /** a projecting balcony beyond this needs a column, not just a cantilever */
  maxCantileverMm: STRUCTURE.maxSlabCantileverMm,
  slabThicknessMm: 150,
} as const

/* ================================================================== *
 *  STAIRS  (research: NBC 2016 residential)
 * ================================================================== */

export const STAIR = {
  treadMm: 275, //         ≥ 250 NBC
  riserMm: 175, //         ≤ 190 NBC, 150–175 comfortable
  minWidthMm: 900, //      ≥ 900 for a dwelling
  minLandingMm: 900, //    ≥ stair width
  minHeadroomMm: 2100, //  ≥ 2.1 m NBC
  preferredHeadroomMm: 2300,
  maxRisersPerFlight: 12, //  landing required after 12
  handrailHeightMm: 900,
  /** 2R + T comfort rule bounds, mm */
  comfort2RT: [550, 700] as [number, number],
} as const

/* ================================================================== *
 *  CLEARANCES  (§13 collision matrix minimums, mm)
 * ================================================================== */

export const CLEARANCE = {
  doorToDoorMm: 150,
  doorToColumnMm: 150,
  windowToDoorMm: 400,
  windowToColumnMm: 150,
  windowToCornerMm: 450,
  balconyToWallMm: 0,
  stairToWallMm: 50,
  stairToDoorMm: 300,
  roofToBuildingMm: 0,
  columnToWallFaceMm: 20,
} as const

/* ================================================================== *
 *  SITE
 * ================================================================== */

export const SITE = {
  setbackMinMm: { N: 1200, E: 900, S: 900, W: 900 } as Record<'N' | 'E' | 'S' | 'W', number>,
  maxCoverage: 0.65,
  minRoomDimMm: 2400,
  /** the entry path from the plot line to the door */
  pathWidthMm: 1200,
} as const

/* ---- helpers ---------------------------------------------------- */

/** column section for a house with `floorsAbove` storeys above the one in question */
export function columnSectionMm(floorsAbove: number): number {
  const t = STRUCTURE.columnMm
  return t[Math.min(Math.max(floorsAbove, 0), t.length - 1)]
}

/** step count for a floor-to-floor rise, and the landing split */
export function stairSteps(riseMm: number): { risers: number; riserMm: number; treadMm: number; flights: number } {
  const risers = Math.max(2, Math.round(riseMm / STAIR.riserMm))
  const riserMm = Math.round(riseMm / risers)
  const flights = risers > STAIR.maxRisersPerFlight ? Math.ceil(risers / STAIR.maxRisersPerFlight) : 1
  return { risers, riserMm, treadMm: STAIR.treadMm, flights }
}
