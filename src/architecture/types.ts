/* ------------------------------------------------------------------ *
 *  Architectural grammar — TYPES
 *
 *  The grammar is a set of *architectural rules* per style. It is
 *  completely independent of any geometry implementation: the same
 *  DesignSpec is consumed by the Blender procedural generator
 *  (blender/generator/*) to bake a GLB, and — as a fallback — by the
 *  existing three.js massing builder.
 *
 *      USER REQUIREMENTS + FLOOR PLAN (engine `Design`)
 *        → STYLE GRAMMAR  (rules, this file + grammar.ts)
 *        → generateDesign(requirements, seed)   (seeded resolution)
 *        → DesignSpec      (concrete "what to build", still no geometry)
 *        → Blender procedural generator          → GLB / GLTF
 *        → three.js viewer
 * ------------------------------------------------------------------ */

import type { Rect, Point } from '../lib/geometry.ts'
import type { Design } from '../lib/engine/types.ts'

/** the 8 supported styles — snake_case is the wire/Blender contract. Mapped
 *  1:1 from the UI `character` ids (see grammar.ts `STYLE_OF_CHARACTER`). */
export type StyleId =
  | 'modern_indian'
  | 'contemporary_indian'
  | 'modern_kerala'
  | 'kerala_contemporary'
  | 'luxury_indian_villa'
  | 'tropical_indian_modern'
  | 'minimal_indian'
  | 'courtyard_indian_modern'

export const STYLE_IDS: readonly StyleId[] = [
  'modern_indian',
  'contemporary_indian',
  'modern_kerala',
  'kerala_contemporary',
  'luxury_indian_villa',
  'tropical_indian_modern',
  'minimal_indian',
  'courtyard_indian_modern',
] as const

export type Direction4 = 'N' | 'S' | 'E' | 'W'

/** the plan footprint the engine resolved (already one of the 6 engine shapes) */
export type PlanShape = 'rectangular' | 'l_shape' | 'u_shape' | 't_shape' | 'courtyard' | 'square'

/** how the storeys relate in three dimensions — the volumetric strategy */
export type MassingStrategy =
  | 'stacked' //         storeys plumb
  | 'offset_volumes' //  upper storeys shifted in plan, reading as separate boxes
  | 'stepped' //         each storey steps back from the one below (terraces)
  | 'cantilever' //      an upper volume projects past the storey below
  | 'split_mass' //      two distinct volumes joined by a glazed link
  | 'linear' //          one long thin bar, single-loaded

/** room categories the grammar reasons about (mapped from engine room ids) */
export type RoomClass =
  | 'living'
  | 'dining'
  | 'kitchen'
  | 'bedroom'
  | 'master'
  | 'bathroom'
  | 'utility'
  | 'pooja'
  | 'study'
  | 'stair'
  | 'foyer'
  | 'lobby'
  | 'balcony'
  | 'parking'
  | 'verandah'
  | 'courtyard'
  | 'other'

export type CladMaterial =
  | 'teak'
  | 'stone_warm'
  | 'stone_dark'
  | 'laterite'
  | 'travertine'
  | 'exposed_concrete'
  | 'brick'
  | 'white_fins'

/* ================================================================== *
 *  RULE TYPES — architectural rules, no geometry
 * ================================================================== */

export type MassingRule = {
  /** plan footprints this style permits (the engine still picks the shape) */
  planShapes: PlanShape[]
  /** weighted volumetric strategies the seed chooses from */
  strategies: { kind: MassingStrategy; weight: number }[]
  /** [min,max] plan shift for offset / stepped strategies, mm */
  storeyOffsetMm: [number, number]
  /** [min,max] projection for the cantilever strategy, mm */
  cantileverMm: [number, number]
  /** [min,max] glazed-link width for split_mass, mm */
  splitGapMm: [number, number]
  /** ground floor may be larger than the uppers by up to this, mm (carport etc.) */
  groundExtendMm: number
  /** slender stair / feature tower rising above the roofline */
  featureTowerChance: number
  /** overall footprint width:depth cap */
  maxAspect: number
}

export type RoofRule = {
  kind: 'flat_parapet' | 'flat_band' | 'flat_eave' | 'mono_slope' | 'hip' | 'gable' | 'mixed'
  pitchDeg: [number, number]
  /** roof / fascia projection past the wall face, mm */
  eaveMm: [number, number]
  parapetMm: number
  /** bold white fascia band depth (flat_band), mm */
  bandMm: number
  /** each massing block gets its own roof form */
  perBlock: boolean
  /** a usable roof terrace with parapet + optional pergola */
  terraceChance: number
}

export type RoomWindowRule = {
  preferred: number
  max: number
  widthMm: [number, number]
  heightMm: [number, number]
  sillMm: number
  /** frosted / high-set / small — for bath, sometimes kitchen */
  privacy: boolean
  /** may become a full-width ribbon on a garden / court wall */
  allowStrip: boolean
  /** may become one oversized fixed pane facing the view / court */
  allowPicture: boolean
}

export type WindowRule = {
  byRoom: Partial<Record<RoomClass, RoomWindowRule>>
  fallback: RoomWindowRule
  /** window area ÷ that wall's area, per room */
  maxWindowRatio: number
  minWallBetweenWindowsMm: number
  minCornerOffsetMm: number
  minDoorWindowDistanceMm: number
  /** chance a qualifying social room gets a ribbon window on its best wall */
  stripGlazingChance: number
  /** chance a qualifying room gets one picture window */
  pictureWindowChance: number
  /** 0..1 — how strongly upper-floor street windows shrink / raise for privacy */
  upperPrivacyBias: number
}

export type DoorRule = {
  entryWidthMm: [number, number]
  internalWidthMm: number
  doubleLeafEntry: boolean
  /** projecting entrance canopy depth, mm (0 = none) */
  entryCanopyMm: number
  doubleHeightEntry: boolean
  /** a drive-through covered entry */
  porteCochere: boolean
}

export type BalconyRule = {
  /** which room classes get a balcony on upper floors */
  rooms: RoomClass[]
  depthMm: [number, number]
  minWidthMm: number
  maxPerFloor: number
  /** carved into the volume vs projecting out */
  recessedChance: number
  railStyle: 'bar' | 'baluster' | 'glass'
  /** one continuous verandah rather than discrete balconies */
  wrapVerandah: boolean
}

export type FacadeRule = {
  /** brise-soleil fins over the widest street-facing glazing */
  verticalFinsChance: number
  finDepthMm: [number, number]
  /** perforated screen */
  jaaliScreenChance: number
  jaaliWhere: ('entry' | 'stair' | 'street_wall' | 'court')[]
  /** timber / stone cladding panels on the facade */
  cladPanels: { material: CladMaterial; widthMm: [number, number]; twoStorey: boolean } | null
  /** dark full-height pier beside the entry */
  featurePier: { material: CladMaterial; chance: number } | null
  /** projecting horizontal band at every floor line, mm */
  stringCourseMm: number
  /** cantilevered weather hood over each opening, mm */
  chajjaMm: number
  /** raised plinth height, mm */
  plinthMm: number
  /** ground-floor base cladding (stone / laterite) */
  baseCladding: CladMaterial | null
  /** slatted pergola */
  pergola: ('roof' | 'verandah')[]
  /** covered verandah / sit-out on columns along the entry facade */
  verandah: { depthMm: [number, number]; columns: 'square' | 'round' | 'tapered'; columnMm: number; wrapCourt: boolean } | null
}

export type MaterialRule = {
  palette: 'white' | 'earth' | 'stone' | 'grey_concrete' | 'warm_stone'
  /** hex colours — the seed may swap up to `seededSwaps` of these to a variant */
  wall: string
  base: string
  trim: string
  roof: string
  frame: string
  accent: string
  glassTint: string
  /** alternates the seed may pick from, per slot */
  variants?: Partial<Record<'wall' | 'base' | 'roof' | 'accent', string[]>>
  seededSwaps: number
}

export type GenerationConstraints = {
  setbackMinMm: Record<Direction4, number>
  /** footprint ÷ plot area */
  maxCoverage: number
  minRoomDimMm: number
  floorHeightMm: [number, number]
  maxFloors: number
  minWallSegmentMm: number
  window: {
    maxWindowRatio: number
    minWallBetweenWindowsMm: number
    minCornerOffsetMm: number
    minDoorWindowDistanceMm: number
    maxWindowsPerRoom: number
    preferredWindowsPerRoom: number
  }
  balcony: { minDepthMm: number; maxDepthMm: number; minWidthMm: number }
  massing: { maxCantileverMm: number; minLinkMm: number; maxStoreyOffsetMm: number }
}

/* ================================================================== *
 *  THE COMPOSED GRAMMAR
 * ================================================================== */

export type StyleGrammar = {
  id: StyleId
  label: string
  summary: string
  /** the aspirational references this style is calibrated against */
  refs: string[]
  massing: MassingRule
  roof: RoofRule
  window: WindowRule
  door: DoorRule
  balcony: BalconyRule
  facade: FacadeRule
  material: MaterialRule
  /** style overrides layered on top of the global GenerationConstraints */
  constraints?: Partial<GenerationConstraints>
}

/* ================================================================== *
 *  DESIGN REQUIREMENTS — the input to generateDesign()
 *  (mirrors the wire spec the frontend would post to the Blender API)
 * ================================================================== */

export type DesignRequirements = {
  style: StyleId
  plotWidthMm: number
  plotDepthMm: number
  setbacksMm: Record<Direction4, number>
  entrySide: Direction4
  floors: number
  floorHeightMm: number
  bedrooms: number
  bathrooms: number
  parking: number
  seed: number
  /** the deterministic engine's floor plan — the hard structural constraint */
  floorPlan: Design
}

/* ================================================================== *
 *  DESIGN GENOME — the composed set of architectural decisions.
 *  Sits between the StyleGrammar/StylePattern (preferences) and the
 *  DesignSpec (geometry-free "what to build"). Serialisable, seeded,
 *  compatibility-checked. `resolveGenome()` produces it;
 *  `generateDesign()` feeds it to every resolver so the massing, roof,
 *  balcony, facade and window passes all agree on ONE design intent.
 *
 *  All string fields are terms from library/architecturalVocabulary.ts.
 * ================================================================== */

export type DesignGenome = {
  style: StyleId
  seed: number

  /* ---- massing ---- */
  /** the plan figure (derived from the engine's chosen footprint shape) */
  planFigure: string
  /** volumetric composition — the primary 3D move */
  massingComposition: string
  volumeCount: number
  compositionBalance: string
  horizontalEmphasis: string
  verticalEmphasis: string

  /* ---- floors ---- */
  upperFloorStrategy: string
  voidStrategy: string
  /** target ground-floor footprint ÷ buildable area */
  groundCoverage: number
  /** target upper-floor footprint ÷ ground-floor footprint */
  upperCoverage: number
  storeyOffsetMm: number
  cantileverMm: number

  /* ---- roof ---- */
  roof: string
  overhang: string
  roofDeck: boolean
  parapet: boolean

  /* ---- entrance ---- */
  entrance: string
  entrancePosition: string
  doubleHeightEntrance: boolean

  /* ---- balcony ---- */
  balcony: string
  balconyPosition: string
  balconyCount: number

  /* ---- facade ---- */
  facadeComposition: string
  screen: string
  materialPalette: string
  featureStone: boolean
  featureTower: boolean

  /* ---- glazing ---- */
  glazing: string
  windowStrategy: string
  cornerGlazing: boolean

  /* ---- courtyard / site ---- */
  courtyard: string
  parking: string
  landscape: string

  /* ---- derived descriptive tags ---- */
  characteristics: string[]

  /** repairs applied during resolution (compatibility fixes) */
  repaired: string[]
}

/** the canonical short signature used for dedup + architectural-similarity (§9) */
export type ArchitecturalFingerprint = {
  /** `${massingComposition}_${planFigure}` e.g. "offset_volumes_l_shape" */
  massing: string
  /** `${floors}f_${upperFloorStrategy}` e.g. "2f_partial_cantilever" */
  floors: string
  /** `${roof}` e.g. "floating_slab" */
  roof: string
  /** `${entrance}_${doubleHeight ? 'dh' : 'sh'}` */
  entrance: string
  /** `${balcony}_${balconyPosition}` */
  balcony: string
  /** `${facadeComposition}_${screen}_${materialPalette}` */
  facade: string
  /** courtyard type, 'none' if absent */
  courtyard: string
  /** stable 12-char hash of the six axes above — the dedup key */
  hash: string
}

/* ================================================================== *
 *  DESIGN SPEC — the resolved, seeded "what to build". Serialisable.
 *  This is the Blender generator's only input besides the style knobs.
 * ================================================================== */

export type RoofSpecOut = {
  kind: RoofRule['kind']
  pitchDeg: number
  eaveMm: number
  parapetMm: number
  bandMm: number
  /** low side for mono_slope / hip */
  fall?: Direction4
  terrace: boolean
}

export type MassBlock = {
  id: string
  level: number
  /** plan rect in mm, plot-origin frame (same as engine floor rects) */
  rect: Rect
  /** z of this block's slab top, mm */
  baseMm: number
  heightMm: number
  /** projection past the block below, per side, mm */
  cantilever: Partial<Record<Direction4, number>>
  roof: RoofSpecOut
}

export type WindowSpec = {
  id: string
  roomId: string
  roomClass: RoomClass
  level: number
  /** the hosting wall segment (mm, plot frame) */
  wall: { a: Point; b: Point }
  side: Direction4
  /** opening centre distance along the wall from a→b, mm */
  centerMm: number
  widthMm: number
  heightMm: number
  sillMm: number
  kind: 'standard' | 'privacy' | 'picture' | 'strip' | 'clerestory' | 'ventilator'
  /** vertical mullion bars for a wide slider */
  mullions: number
  facesCourt: boolean
  facesStreet: boolean
}

export type DoorSpec = {
  id: string
  kind: 'entry' | 'internal' | 'balcony' | 'court'
  roomId: string
  level: number
  wall: { a: Point; b: Point }
  side: Direction4
  centerMm: number
  widthMm: number
  heightMm: number
  double: boolean
  /** projecting canopy over an entry, mm (0 = none) */
  canopyMm: number
}

export type BalconySpec = {
  id: string
  roomId: string
  level: number
  /** the room edge the balcony attaches to */
  side: Direction4
  /** the balcony slab footprint (mm, plot frame) — outside the room */
  rect: Rect
  depthMm: number
  recessed: boolean
  /** how the balcony reads architecturally (derived from the plan geometry) */
  type: 'cantilever' | 'recessed' | 'corner' | 'continuous' | 'verandah'
  railStyle: 'bar' | 'baluster' | 'glass'
}

export type StairSpec = {
  id: string
  level: number
  /** stair footprint (mm, plot frame) */
  rect: Rect
  /** slab-top z this flight starts at, mm */
  fromMm: number
  /** the next floor level it reaches, mm */
  toMm: number
  steps: number
  /** direction you climb, plan frame */
  runDir: Direction4
  kind: 'straight' | 'dogleg'
}

export type FacadeElement =
  | { kind: 'fins'; level: number; side: Direction4; rect: Rect; count: number; depthMm: number }
  | { kind: 'jaali'; level: number; side: Direction4; rect: Rect; pattern: 'square' | 'diamond' | 'brick' }
  | { kind: 'clad'; level: number; side: Direction4; rect: Rect; material: CladMaterial; twoStorey: boolean }
  | { kind: 'feature_pier'; side: Direction4; at: Point; widthMm: number; depthMm: number; topMm: number; material: CladMaterial }
  | { kind: 'string_course'; level: number; projMm: number }
  | { kind: 'chajja'; level: number; overWindow: string; projMm: number }
  | { kind: 'plinth'; heightMm: number; projMm: number }
  | { kind: 'base_cladding'; material: CladMaterial; toLevel: number }
  | { kind: 'canopy'; at: Point; widthMm: number; depthMm: number; heightMm: number }
  | { kind: 'pergola'; where: 'roof' | 'verandah'; rect: Rect }
  | { kind: 'feature_tower'; at: Point; footprint: Rect; topMm: number; cladding: CladMaterial }
  | {
      kind: 'verandah'
      level: number
      rect: Rect
      columns: { style: 'square' | 'round' | 'tapered'; sizeMm: number; spacingMm: number }
    }

export type MaterialSlot = { color: string; roughness: number; metalness: number }
export type MaterialSpec = Record<
  'wall' | 'base' | 'trim' | 'roof' | 'frame' | 'accent' | 'glass' | 'floor' | 'ground',
  MaterialSlot
>

export type DesignSpecFloor = {
  level: number
  name: string
  heightMm: number
  baseMm: number
  blocks: MassBlock[]
  rooms: { id: string; class: RoomClass; rect: Rect; area: number; outdoor: boolean }[]
  windows: WindowSpec[]
  doors: DoorSpec[]
  balconies: BalconySpec[]
  stairs: StairSpec[]
  courtyard: Rect | null
}

export type DesignSpec = {
  version: 1
  /** deterministic: `${briefHash}-${style}-${seed}` */
  id: string
  style: StyleId
  seed: number
  grammar: { id: StyleId; label: string }
  plot: { widthMm: number; depthMm: number }
  setbacksMm: Record<Direction4, number>
  entrySide: Direction4
  requirements: {
    floors: number
    bedrooms: number
    bathrooms: number
    parking: number
    builtUpAreaSqm: number
    floorHeightMm: number
  }
  massing: {
    strategy: MassingStrategy
    planShape: PlanShape
    /** overall footprint bbox, mm */
    footprintMm: Rect
  }
  /** the composed architectural decision set this spec was resolved from */
  genome: DesignGenome
  /** canonical signature for dedup + architectural-similarity */
  fingerprint: ArchitecturalFingerprint
  floors: DesignSpecFloor[]
  facade: FacadeElement[]
  materials: MaterialSpec
  constraintsUsed: GenerationConstraints
  validation: { ok: boolean; issues: string[]; repaired: string[] }
}
