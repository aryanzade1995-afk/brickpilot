import type { Brief } from './brief.ts'

/* ------------------------------------------------------------------ *
 *  Design character — a real constraint, not a label. It drives the
 *  window rhythm (engine), the roof form + accents + material palette
 *  (massing), and the step-4 render prompt. Pure constants: the brief
 *  seed already hashes `style.character`, so every theme is its own
 *  deterministic run.
 * ------------------------------------------------------------------ */

export type Character = Brief['style']['character']

export type RoofStyle = 'flat-parapet' | 'flat-eave' | 'flat-band'
export type RailStyle = 'bar' | 'baluster' | 'glass'
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
  /** contemporary-villa massing vocabulary — present only for `modernist`.
   *  All flat-shaded white geometry (no textures / materials). */
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
  }
  materials: Record<GroupKey, Mat>
  renderPrompt: string
}

const GROUNDING =
  'Keep the massing, storey count, footprint and every opening position EXACTLY as the reference — change only material, light and context. No people, no text, no watermark.'

export const THEMES: Record<Character, ThemeDef> = {
  modernist: {
    id: 'modernist',
    label: 'Modernist',
    blurb: 'Stacked white volumes, a slim deep roof, a baffle-screen tower.',
    roof: { style: 'flat-band', eaveMm: 720, parapetMm: 0, bandMm: 210, thickMm: 170 },
    windows: { mullionMm: 3200, widthMm: 2400, minRoomSqm: 11, perFacade: 2, sillMm: 750, headMm: 2400, groupMm: 1150 },
    massing: { plinthProjMm: 150, balconyDepthMm: 1600, chajjaMm: 0, stringCourseMm: 70 },
    accents: { cladFacade: true, cladWidthMm: 1600, featureColumn: true, jaali: false, railStyle: 'glass' },
    modern: { cantileverMm: 1100, featureTower: true, baffleScreen: true, roofPergola: true },
    landscape: { hedgeMm: 600, shrubs: 4, terraceGarden: true, roofServices: true, boundaryMm: 1650 },
    materials: {
      shell: { color: '#ece7db', roughness: 0.82, env: 0.5 },
      glazing: { color: '#2f3e48', roughness: 0.14, metalness: 0.28, env: 1.7 },
      slabs: { color: '#d3c9b2', roughness: 0.92, env: 0.4 },
      roof: { color: '#f6f4ee', roughness: 0.62, env: 0.55 },
      stair: { color: '#d2c8ae', roughness: 0.9, env: 0.4 },
      partition: { color: '#e2d9c5', roughness: 0.92, env: 0.3 },
      // white study-model — the baffle screens / fins / entry pier read by form,
      // not by a contrasting material
      clad: { color: '#e4ddce', roughness: 0.72, env: 0.4 },
      feature: { color: '#cfc8ba', roughness: 0.8, env: 0.4 },
      metal: { color: '#24242a', roughness: 0.36, metalness: 0.9, env: 1.4 },
      garden: { color: '#6f8f4f', roughness: 0.97, env: 0.2 },
      paving: { color: '#c6bfae', roughness: 0.95, env: 0.35 },
      greenery: { color: '#5d7c40', roughness: 0.94, env: 0.25 },
    },
    renderPrompt:
      `Photorealistic architectural concept of a contemporary villa. Stacked crisp white plaster volumes, the upper floor cantilevering over a recessed carport, a slim deep flat roof oversailing with a sharp shadow line, a slender vertical stair tower clad in white baffle fins rising above the roofline, full-height vertical brise-soleil fins over the main glazing, floor-to-ceiling glass in disciplined bays, recessed balconies with frameless glass balustrades, a stone-clad entry pier, a slatted pergola with planting on the roof terrace, a stair mumty and water tank set back. Warm late-afternoon light, clipped lawn, a few shrubs. ${GROUNDING}`,
  },
  'warm-minimal': {
    id: 'warm-minimal',
    label: 'Warm minimal',
    blurb: 'Quiet planes, timber warmth, a thin oversailing roof.',
    roof: { style: 'flat-eave', eaveMm: 500, parapetMm: 120, bandMm: 0, thickMm: 150 },
    windows: { mullionMm: 3900, widthMm: 2400, minRoomSqm: 12, perFacade: 2, sillMm: 700, headMm: 2400, groupMm: 1300 },
    massing: { plinthProjMm: 110, balconyDepthMm: 1500, chajjaMm: 600, stringCourseMm: 0 },
    accents: { cladFacade: true, cladWidthMm: 2000, featureColumn: false, jaali: false, railStyle: 'baluster' },
    landscape: { hedgeMm: 450, shrubs: 3, terraceGarden: true, roofServices: true, boundaryMm: 1500 },
    materials: {
      shell: { color: '#e7ddc6', roughness: 0.86, env: 0.45 },
      glazing: { color: '#333b34', roughness: 0.16, metalness: 0.24, env: 1.6 },
      slabs: { color: '#d6cbb2', roughness: 0.92, env: 0.4 },
      roof: { color: '#ebe3d2', roughness: 0.72, env: 0.5 },
      stair: { color: '#cabfa2', roughness: 0.9, env: 0.4 },
      partition: { color: '#e3dac6', roughness: 0.92, env: 0.3 },
      clad: { color: '#a07f52', roughness: 0.52, env: 0.7 },
      feature: { color: '#54504a', roughness: 0.86, env: 0.4 },
      metal: { color: '#2b2b2c', roughness: 0.4, metalness: 0.85, env: 1.3 },
      garden: { color: '#7a9256', roughness: 0.97, env: 0.2 },
      paving: { color: '#d2c9b6', roughness: 0.95, env: 0.35 },
      greenery: { color: '#6c8850', roughness: 0.94, env: 0.25 },
    },
    renderPrompt:
      `Photorealistic architectural concept of a warm-minimalist Indian house. Quiet sand-plaster planes, one thin flat roof oversailing with a crisp shadow line, deep cantilevered chajja hoods over large timber-framed windows, a broad teak-batten screen wall, a stair mumty and water tank set back on the terrace. Soft late-afternoon light, restrained planting. ${GROUNDING}`,
  },
  'kerala-contemporary': {
    id: 'kerala-contemporary',
    label: 'Kerala contemporary',
    blurb: 'Stepped white roof bands, teak cladding, a stone entry pier.',
    roof: { style: 'flat-band', eaveMm: 260, parapetMm: 0, bandMm: 430, thickMm: 210 },
    windows: { mullionMm: 2900, widthMm: 2100, minRoomSqm: 11, perFacade: 2, sillMm: 700, headMm: 2500, groupMm: 1050 },
    massing: { plinthProjMm: 200, balconyDepthMm: 1600, chajjaMm: 520, stringCourseMm: 110 },
    accents: { cladFacade: true, cladWidthMm: 1900, featureColumn: true, jaali: true, railStyle: 'bar' },
    landscape: { hedgeMm: 600, shrubs: 5, terraceGarden: true, roofServices: true, boundaryMm: 1600 },
    materials: {
      shell: { color: '#f0eade', roughness: 0.85, env: 0.5 },
      glazing: { color: '#2c3b45', roughness: 0.13, metalness: 0.3, env: 1.8 },
      slabs: { color: '#ded3bc', roughness: 0.92, env: 0.4 },
      roof: { color: '#f8f6f1', roughness: 0.58, env: 0.6 },
      stair: { color: '#d0c4a6', roughness: 0.9, env: 0.4 },
      partition: { color: '#e8e0cc', roughness: 0.92, env: 0.3 },
      clad: { color: '#96683c', roughness: 0.48, env: 0.75 },
      feature: { color: '#33322f', roughness: 0.88, env: 0.35 },
      metal: { color: '#202024', roughness: 0.34, metalness: 0.92, env: 1.5 },
      garden: { color: '#6c9050', roughness: 0.97, env: 0.2 },
      paving: { color: '#c5bda8', roughness: 0.95, env: 0.35 },
      greenery: { color: '#587b3f', roughness: 0.94, env: 0.25 },
    },
    renderPrompt:
      `Photorealistic architectural concept of a contemporary Kerala house near Kozhikode. Stepped flat roofs each wrapped in a thick white fascia band, cream plaster walls with slim floor-line string courses and cantilevered chajja hoods over every window, two-storey vertical teak-batten cladding panels framed in white, a dark riven-stone pier beside a teak double door, a perforated timber jaali screen, wide teak-framed sliding windows, slim black steel balcony railings, a flat-roof car porch, a stair mumty and water tank on the terrace. Warm dusk light, clipped lawn with a few shrubs, coconut palms far behind a plain compound wall. ${GROUNDING}`,
  },
}

export const themeOf = (brief: Brief): ThemeDef => THEMES[brief.style.character]

/** step-4 view suffix appended to the per-theme prompt */
export const VIEW_PROMPT: Record<'front' | 'collage' | 'top' | 'interior', string> = {
  front: ' Straight-on front elevation, camera perpendicular to the entry facade, eye level, no lens distortion.',
  collage: ' A three-quarter aerial showing two facades and the stepped roof, morning light.',
  top: ' A top-down roof and site view, plan-like, showing the footprint and terraces.',
  interior:
    ' Treat the highlighted room on this floor plan as one photoreal furnished interior at eye level; keep the room shape, wall and window positions exactly.',
}
