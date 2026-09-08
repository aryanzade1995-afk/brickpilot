import type { Brief } from './brief.ts'

/* ------------------------------------------------------------------ *
 *  Design character — STYLE only (materials, roof expression, screens,
 *  columns, landscaping, the step-4 render prompt). Structure lives in
 *  `style.massing`. Themes are built from a shared BASE + a small delta
 *  each, so no single element is forced onto every house.
 *  The brief seed hashes `style.character`, so every theme is its own
 *  deterministic run.
 * ------------------------------------------------------------------ */

export type Character = Brief['style']['character']

export type RoofStyle = 'flat-parapet' | 'flat-eave' | 'flat-band' | 'pitched'
export type RailStyle = 'bar' | 'baluster' | 'glass'
/** how the massing grammar biases per-storey roof forms */
export type RoofBias = 'flat' | 'pitched' | 'mixed'
export type ColumnStyle = 'square' | 'round' | 'tapered'

export type GroupKey =
  | 'shell'
  | 'glazing'
  | 'slabs'
  | 'roof'
  | 'stair'
  | 'partition'
  | 'clad'
  | 'feature'
  | 'metal'
  | 'garden'
  | 'paving'
  | 'greenery'
  // ---- articulation materials: the detail needs its own surfaces ----
  /** raised base course — a darker, rougher stone than the wall above */
  | 'plinth'
  /** exposed RCC: floor-plate fascias, chhajjas, fins, sills, coping */
  | 'rcc'
  /** timber battens — balcony + stair screens, jaali */
  | 'louver'
  /** anodised aluminium window frames + sashes */
  | 'frame'
type Mat = {
  color: string
  roughness: number
  metalness?: number
  /** reflection strength; 1 = physically neutral. glass wants more, plaster less */
  env?: number
}

export type ThemeDef = {
  id: Character
  label: string
  blurb: string
  /** how the massing grammar should bias roof forms for this style */
  roofBias: RoofBias
  roof: {
    style: RoofStyle
    /** horizontal projection of the roof / fascia past the wall face, mm */
    eaveMm: number
    /** parapet upstand, mm (flat-parapet only) */
    parapetMm: number
    /** the bold white fascia band depth, mm (flat-band only) */
    bandMm: number
    /** deck / fascia slab thickness, mm */
    thickMm: number
    /** pitch for a `pitched` roof, degrees */
    pitchDeg: number
  }
  windows: {
    mullionMm: number
    widthMm: number
    /** habitable rooms smaller than this get no massing window */
    minRoomSqm: number
    /** at most this many windows on one facade of one storey */
    perFacade: number
    sillMm: number
    headMm: number
    /** panes wider than this get vertical mullion bars (a grouped slider) */
    groupMm: number
  }
  massing: {
    plinthProjMm: number
    balconyDepthMm: number
    /** cantilevered weather-hood over each window, mm projection (0 = none) */
    chajjaMm: number
    /** projecting horizontal band at every floor line, mm projection (0 = none) */
    stringCourseMm: number
  }
  accents: {
    /** a vertical timber-batten cladding strip on the entry facade */
    cladFacade: boolean
    cladWidthMm: number
    /** a dark full-height feature pier beside the entry */
    featureColumn: boolean
    /** a perforated timber jaali screen next to the entry */
    jaali: boolean
    railStyle: RailStyle
  }
  /** contemporary-villa vocabulary — a slim tower / fins / roof pergola.
   *  Present only where the style calls for it. All flat-shaded geometry. */
  modern?: {
    /** upper storeys project this far past the plan on the street facade, mm */
    cantileverMm: number
    /** a slender clad stair/feature tower rising above the roofline */
    featureTower: boolean
    /** vertical brise-soleil fins over the widest street-facing glazing */
    baffleScreen: boolean
    /** a slatted pergola + planting over part of the top terrace */
    roofPergola: boolean
  }
  /** a covered verandah / sit-out on posts along the entry facade */
  verandah?: {
    depthMm: number
    /** run it around the courtyard too (courtyard massing) */
    wrapCourt: boolean
  }
  /** a row of columns carrying the verandah / porch */
  columns?: {
    style: ColumnStyle
    /** column face size, mm */
    sizeMm: number
  }
  /** a two-storey glazed void at the entrance */
  doubleHeightEntry?: boolean
  /** site & garden treatment */
  landscape: {
    /** front / side hedge height, mm (0 = none) */
    hedgeMm: number
    /** small shrubs dotted near the entry */
    shrubs: number
    /** planter boxes on the stepped roof terraces */
    terraceGarden: boolean
    /** a stair mumty + water tank on the top terrace */
    roofServices: boolean
    /** compound-wall height when the brief asks for one, mm */
    boundaryMm: number
    /** dense tropical planting — palms + broadleaf clusters */
    tropical: boolean
  }
  materials: Record<GroupKey, Mat>
  renderPrompt: string
}

const GROUNDING =
  'Keep the massing, storey count, footprint and every opening position EXACTLY as the reference — change only material, light and context. No people, no text, no watermark.'

/* --------------------------- shared base --------------------------- */

const WHITE_MATERIALS: Record<GroupKey, Mat> = {
  shell: { color: '#ece7db', roughness: 0.82, env: 0.5 },
  glazing: { color: '#2f3e48', roughness: 0.14, metalness: 0.28, env: 1.7 },
  slabs: { color: '#d3c9b2', roughness: 0.92, env: 0.4 },
  roof: { color: '#f6f4ee', roughness: 0.62, env: 0.55 },
  stair: { color: '#d2c8ae', roughness: 0.9, env: 0.4 },
  partition: { color: '#e2d9c5', roughness: 0.92, env: 0.3 },
  clad: { color: '#e4ddce', roughness: 0.72, env: 0.4 },
  feature: { color: '#cfc8ba', roughness: 0.8, env: 0.4 },
  metal: { color: '#24242a', roughness: 0.36, metalness: 0.9, env: 1.4 },
  garden: { color: '#6f8f4f', roughness: 0.97, env: 0.2 },
  paving: { color: '#c6bfae', roughness: 0.95, env: 0.35 },
  greenery: { color: '#5d7c40', roughness: 0.94, env: 0.25 },
  // a base course reads darker and rougher than the plaster it carries
  plinth: { color: '#8e8677', roughness: 0.95, env: 0.28 },
  // off-form concrete — cooler and flatter than the plaster, so a chhajja and
  // a plate edge read as separate elements rather than a bulge in the wall
  rcc: { color: '#cdc9c0', roughness: 0.88, env: 0.38 },
  louver: { color: '#8a5f38', roughness: 0.62, env: 0.55 },
  frame: { color: '#3c3f44', roughness: 0.34, metalness: 0.78, env: 1.25 },
}

type Base = Omit<ThemeDef, 'id' | 'label' | 'blurb' | 'renderPrompt'>

type ThemeDelta = {
  roofBias?: RoofBias
  roof?: Partial<ThemeDef['roof']>
  windows?: Partial<ThemeDef['windows']>
  massing?: Partial<ThemeDef['massing']>
  accents?: Partial<ThemeDef['accents']>
  modern?: ThemeDef['modern']
  verandah?: ThemeDef['verandah']
  columns?: ThemeDef['columns']
  doubleHeightEntry?: boolean
  landscape?: Partial<ThemeDef['landscape']>
  materials?: Partial<Record<GroupKey, Partial<Mat>>>
}

const BASE: Base = {
  roofBias: 'flat',
  roof: { style: 'flat-eave', eaveMm: 520, parapetMm: 120, bandMm: 0, thickMm: 160, pitchDeg: 22 },
  windows: { mullionMm: 3400, widthMm: 2400, minRoomSqm: 11, perFacade: 2, sillMm: 730, headMm: 2400, groupMm: 1200 },
  massing: { plinthProjMm: 140, balconyDepthMm: 1550, chajjaMm: 420, stringCourseMm: 60 },
  accents: { cladFacade: true, cladWidthMm: 1700, featureColumn: false, jaali: false, railStyle: 'baluster' },
  landscape: { hedgeMm: 520, shrubs: 4, terraceGarden: true, roofServices: true, boundaryMm: 1600, tropical: false },
  materials: WHITE_MATERIALS,
}

/** deep-ish merge: sub-objects merged one level, `materials` merged per group */
function theme(id: Character, label: string, blurb: string, renderPrompt: string, d: ThemeDelta): ThemeDef {
  const mats = { ...BASE.materials } as Record<GroupKey, Mat>
  for (const k of Object.keys(d.materials ?? {}) as GroupKey[]) {
    mats[k] = { ...mats[k], ...d.materials![k] }
  }
  return {
    id,
    label,
    blurb,
    renderPrompt: `${renderPrompt} ${GROUNDING}`,
    roofBias: d.roofBias ?? BASE.roofBias,
    roof: { ...BASE.roof, ...d.roof },
    windows: { ...BASE.windows, ...d.windows },
    massing: { ...BASE.massing, ...d.massing },
    accents: { ...BASE.accents, ...d.accents },
    modern: d.modern,
    verandah: d.verandah,
    columns: d.columns,
    doubleHeightEntry: d.doubleHeightEntry,
    landscape: { ...BASE.landscape, ...d.landscape },
    materials: mats,
  }
}

const TEAK: Partial<Mat> = { color: '#96683c', roughness: 0.48, env: 0.75 }
const STONE_DARK: Partial<Mat> = { color: '#33322f', roughness: 0.88, env: 0.35 }

/* ----------------------------- catalogue --------------------------- */

export const THEMES: Record<Character, ThemeDef> = {
  'modern-indian': theme(
    'modern-indian',
    'Modern Indian',
    'Stacked white volumes, a slim deep roof, a baffle-screen tower.',
    'Photorealistic architectural concept of a contemporary Indian villa. Stacked crisp white plaster volumes, the upper floor cantilevering over a recessed carport, a slim deep flat roof oversailing with a sharp shadow line, a slender vertical stair tower clad in white baffle fins rising above the roofline, full-height vertical brise-soleil fins over the main glazing, floor-to-ceiling glass in disciplined bays, recessed balconies with frameless glass balustrades, a stone-clad entry pier, a slatted pergola with planting on the roof terrace. Warm late-afternoon light, clipped lawn, a few shrubs.',
    {
      roofBias: 'flat',
      roof: { style: 'flat-band', eaveMm: 720, parapetMm: 0, bandMm: 210, thickMm: 170 },
      windows: { mullionMm: 3200, widthMm: 2400, sillMm: 750, groupMm: 1150 },
      massing: { plinthProjMm: 150, balconyDepthMm: 1600, chajjaMm: 0, stringCourseMm: 70 },
      accents: { cladWidthMm: 1600, featureColumn: true, railStyle: 'glass' },
      modern: { cantileverMm: 1100, featureTower: true, baffleScreen: true, roofPergola: true },
      landscape: { hedgeMm: 600 },
      materials: { metal: { color: '#24242a' } },
    },
  ),
  'contemporary-indian': theme(
    'contemporary-indian',
    'Contemporary Indian',
    'Plaster planes over a stone base, wide sliding glass, deep hoods.',
    'Photorealistic architectural concept of a contemporary Indian house. Off-white plaster upper volumes sitting on a grey basalt-clad ground floor, wide aluminium-framed sliding glass, deep flat cantilevered hoods over the openings, a floating flat roof with a thin fascia, a timber-batten screen to the stair, a recessed double-height entrance behind a lily pool, slim black steel railings. Warm evening light, framed lawn, a champa tree by the gate.',
    {
      roofBias: 'flat',
      roof: { style: 'flat-eave', eaveMm: 640, parapetMm: 90, thickMm: 160 },
      windows: { mullionMm: 3600, widthMm: 2600, perFacade: 2, groupMm: 1300 },
      massing: { chajjaMm: 520, stringCourseMm: 40 },
      accents: { featureColumn: true, railStyle: 'bar' },
      doubleHeightEntry: true,
      materials: { feature: STONE_DARK, clad: TEAK, shell: { color: '#efe9dd' } },
    },
  ),
}

export const themeOf = (brief: Brief): ThemeDef => THEMES[brief.style.character]

/** step-4 view suffix appended to the per-theme prompt */
export const VIEW_PROMPT: Record<'front' | 'collage' | 'top' | 'interior', string> = {
  front: ' Straight-on front elevation, camera perpendicular to the entry facade, eye level, no lens distortion.',
  collage: ' A three-quarter aerial showing two facades and the roof, morning light.',
  top: ' A top-down roof and site view, plan-like, showing the footprint and terraces.',
  interior:
    ' Treat the highlighted room on this floor plan as one photoreal furnished interior at eye level; keep the room shape, wall and window positions exactly.',
}
