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
 *  ARTICULATION — the facade depth system.
 *
 *  Everything here exists to stop the model reading as a shoebox: the
 *  offsets that give a wall a *thickness* you can see, a floor plate an
 *  edge, an opening a reveal, and a parapet a cap. Ranges are resolved
 *  once, seeded, by generator/articulationResolver.ts; the viewer and
 *  the Blender bake both read the resolved numbers, never these.
 * ================================================================== */

export const ARTICULATION = {
  /* ---- floor plates: the horizontal shadow lines ------------------ */
  slabEdge: {
    /** upper plate projects past the wall face below — the drip shadow line */
    projMm: [600, 1200] as [number, number],
    /** projection where the plate only expresses a line, no balcony */
    trimProjMm: 150,
    /** exposed fascia depth of a projecting plate */
    fasciaMm: 320,
    /** reveal cut behind the fascia so the plate reads detached from the wall */
    shadowGapMm: 40,
    /** down-turned drip at the outer edge */
    dripMm: 30,
    dripThickMm: 25,
    /** a projection past this carries a balcony rather than a trim band */
    balconyThresholdMm: 900,
  },

  /* ---- openings: reveals, sills, heads ---------------------------- */
  reveal: {
    /** glass line set back from the outer wall face (jamb depth you see) */
    jambMm: [150, 200] as [number, number],
    /** head reveal — usually a touch deeper so the soffit catches shadow */
    headExtraMm: 25,
    /** the reveal return is this thick where it meets the frame */
    returnMm: 60,
    /** privacy / ventilator openings sit shallower — not worth the detail */
    minWidthForRevealMm: 700,
  },
  sill: {
    /** projection past the outer wall face */
    projMm: 60,
    /** thickness of the sill stone / band */
    thickMm: 50,
    /** the sill runs past the opening this far at each end */
    earMm: 75,
    /** weathering fall, degrees — drives a slight top-face slope */
    fallDeg: 6,
    /** down-turned drip on the underside of the sill nose */
    dripMm: 15,
  },
  frame: {
    /** master (outer) frame member — the section fixed to the reveal */
    masterMm: 75,
    /** sash (opening leaf) member, set inside the master */
    sashMm: 50,
    /** glass thickness */
    glassMm: 24,
    /** a pane wider than this is split by a sash mullion */
    mullionSpacingMm: 1450,
    /** the sash sits this far behind the master frame face */
    sashSetbackMm: 20,
  },

  /* ---- weather protection ---------------------------------------- */
  chajja: {
    /** cantilever past the wall face over an opening */
    projMm: [450, 750] as [number, number],
    thickMm: 90,
    /** runs past the opening at each end */
    earMm: 170,
    dripMm: 55,
    dripThickMm: 110,
    /** clear height above the opening head */
    aboveHeadMm: 55,
    /** only shade openings at least this wide — a ventilator needs none */
    minOpeningMm: 900,
    /** the orientations that actually earn a chhajja in the Indian sun */
    sides: ['S', 'W', 'E'] as const,
  },
  fin: {
    /** vertical brise-soleil projection past the wall face */
    projMm: [300, 450] as [number, number],
    /** fin face width (the thin dimension seen head-on) */
    thickMm: 80,
    /** centre-to-centre spacing across the shaded opening */
    spacingMm: [450, 700] as [number, number],
    /** fins run from sill to head plus this margin top and bottom */
    overrunMm: 120,
    /** west + south glazing wider than this earns fins */
    minOpeningMm: 1600,
    sides: ['W', 'S'] as const,
  },

  /* ---- screens: louvers + jaali ----------------------------------- */
  screen: {
    /** vertical timber batten section, mm (face × depth) */
    battenMm: [40, 80] as [number, number],
    /** centre-to-centre batten spacing */
    spacingMm: 120,
    /** the screen plane stands this far off the wall / rail behind it */
    standoffMm: 90,
    /** head + sill rail section carrying the battens */
    railMm: 60,
    /** jaali block module and its void */
    jaaliModuleMm: 200,
    jaaliVoidMm: 120,
    jaaliDepthMm: 110,
  },

  /* ---- parapet + coping ------------------------------------------ */
  parapet: {
    /** solid upstand around an unused roof */
    solidMm: 1000,
    /** taller upstand where the terrace is occupied (screen wall) */
    screenMm: 1500,
    /** the screen portion above the solid base is battened, not solid */
    screenSolidBaseMm: 450,
    thickMm: STRUCTURE.parapetWallMm,
  },
  coping: {
    /** projecting cap stone thickness */
    thickMm: 50,
    /** overhang each side of the parapet */
    projMm: 40,
    /** the drip groove under the overhang */
    dripMm: 12,
  },

  /* ---- base ------------------------------------------------------ */
  plinth: {
    /** finished floor above grade (mirrors STRUCTURE.plinthMm) */
    heightMm: STRUCTURE.plinthMm,
    /** projection past the wall face — the base course shadow */
    projMm: 90,
    /** a chamfered / recessed band at the top of the plinth */
    bandMm: 60,
  },

  /* ---- horizontal banding ---------------------------------------- */
  stringCourse: {
    projMm: 100,
    depthMm: 220,
  },
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
