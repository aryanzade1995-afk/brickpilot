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
export type RailStyle = 'bar' | 'baluster'
export type GroupKey =
  | 'shell'
  | 'glazing'
  | 'slabs'
  | 'roof'
  | 'stair'
  | 'partition'
  | 'clad'
  | 'feature'
  | 'garden'
  | 'paving'
  | 'greenery'
type Mat = { color: string; roughness: number; metalness?: number }

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
  massing: { plinthProjMm: number; balconyDepthMm: number }
  accents: {
    /** a vertical timber-batten cladding strip on the entry facade */
    cladFacade: boolean
    cladWidthMm: number
    /** a dark full-height feature pier beside the entry */
    featureColumn: boolean
    railStyle: RailStyle
  }
  /** site & garden treatment */
  landscape: {
    /** front / side hedge height, mm (0 = none) */
    hedgeMm: number
    /** small shrubs dotted near the entry */
    shrubs: number
    /** planter boxes on the stepped roof terraces */
    terraceGarden: boolean
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
    blurb: 'Crisp white roof lines, strong horizontals, disciplined openings.',
    roof: { style: 'flat-band', eaveMm: 200, parapetMm: 0, bandMm: 340, thickMm: 200 },
    windows: { mullionMm: 3200, widthMm: 2100, minRoomSqm: 11, perFacade: 2, sillMm: 850, headMm: 2300, groupMm: 1700 },
    massing: { plinthProjMm: 150, balconyDepthMm: 1500 },
    accents: { cladFacade: true, cladWidthMm: 1600, featureColumn: true, railStyle: 'bar' },
    landscape: { hedgeMm: 600, shrubs: 4, terraceGarden: true, boundaryMm: 1650 },
    materials: {
      shell: { color: '#e9e3d6', roughness: 0.85 },
      glazing: { color: '#1c2024', roughness: 0.28, metalness: 0.1 },
      slabs: { color: '#d6ccb5', roughness: 0.9 },
      roof: { color: '#f4f2ec', roughness: 0.7 },
      stair: { color: '#d2c8ae', roughness: 0.9 },
      partition: { color: '#e2d9c5', roughness: 0.92 },
      clad: { color: '#8c7350', roughness: 0.7 },
      feature: { color: '#46433f', roughness: 0.8 },
      garden: { color: '#8f9c73', roughness: 0.96 },
      paving: { color: '#cac4b4', roughness: 0.95 },
      greenery: { color: '#6d7c53', roughness: 0.95 },
    },
    renderPrompt:
      `Photorealistic architectural concept of a modernist Indian villa. Stepped flat roofs each edged with a bold white fascia band, off-white plaster walls, a vertical timber-batten feature panel and a dark stone pier by the entry, wide teak-framed sliding windows, slim black balcony railings. Warm evening light, clipped lawn. ${GROUNDING}`,
  },
  'warm-minimal': {
    id: 'warm-minimal',
    label: 'Warm minimal',
    blurb: 'Quiet planes, timber warmth, a thin oversailing roof.',
    roof: { style: 'flat-eave', eaveMm: 500, parapetMm: 120, bandMm: 0, thickMm: 150 },
    windows: { mullionMm: 3900, widthMm: 2400, minRoomSqm: 12, perFacade: 2, sillMm: 700, headMm: 2400, groupMm: 1900 },
    massing: { plinthProjMm: 110, balconyDepthMm: 1500 },
    accents: { cladFacade: true, cladWidthMm: 2000, featureColumn: false, railStyle: 'baluster' },
    landscape: { hedgeMm: 450, shrubs: 3, terraceGarden: true, boundaryMm: 1500 },
    materials: {
      shell: { color: '#e6dcc4', roughness: 0.9 },
      glazing: { color: '#22201b', roughness: 0.3, metalness: 0.08 },
      slabs: { color: '#d8cdb4', roughness: 0.9 },
      roof: { color: '#e9e1d0', roughness: 0.78 },
      stair: { color: '#cabfa2', roughness: 0.9 },
      partition: { color: '#e3dac6', roughness: 0.92 },
      clad: { color: '#a3855c', roughness: 0.72 },
      feature: { color: '#57534d', roughness: 0.82 },
      garden: { color: '#97a06d', roughness: 0.96 },
      paving: { color: '#d6cdbb', roughness: 0.95 },
      greenery: { color: '#78855a', roughness: 0.95 },
    },
    renderPrompt:
      `Photorealistic architectural concept of a warm-minimalist Indian house. Quiet sand-plaster planes, one thin flat roof oversailing with a crisp shadow line, a broad teak-batten screen wall, few large timber-framed windows. Soft late-afternoon light, restrained planting. ${GROUNDING}`,
  },
  'kerala-contemporary': {
    id: 'kerala-contemporary',
    label: 'Kerala contemporary',
    blurb: 'Stepped white roof bands, teak cladding, a stone entry pier.',
    roof: { style: 'flat-band', eaveMm: 260, parapetMm: 0, bandMm: 430, thickMm: 210 },
    windows: { mullionMm: 2900, widthMm: 2000, minRoomSqm: 11, perFacade: 2, sillMm: 700, headMm: 2500, groupMm: 1500 },
    massing: { plinthProjMm: 200, balconyDepthMm: 1600 },
    accents: { cladFacade: true, cladWidthMm: 1900, featureColumn: true, railStyle: 'bar' },
    landscape: { hedgeMm: 600, shrubs: 5, terraceGarden: true, boundaryMm: 1600 },
    materials: {
      shell: { color: '#efe9dd', roughness: 0.88 },
      glazing: { color: '#20252a', roughness: 0.34, metalness: 0.1 },
      slabs: { color: '#dfd4bd', roughness: 0.9 },
      roof: { color: '#f6f4ef', roughness: 0.68 },
      stair: { color: '#d0c4a6', roughness: 0.9 },
      partition: { color: '#e8e0cc', roughness: 0.92 },
      clad: { color: '#9a6a3d', roughness: 0.68 },
      feature: { color: '#3b3936', roughness: 0.8 },
      garden: { color: '#6f9252', roughness: 0.96 },
      paving: { color: '#c8c0ac', roughness: 0.95 },
      greenery: { color: '#5c7d42', roughness: 0.95 },
    },
    renderPrompt:
      `Photorealistic architectural concept of a contemporary Kerala house near Kozhikode. Stepped flat roofs each wrapped in a thick white fascia band, cream plaster walls, two-storey vertical teak-batten cladding panels framed in white, a dark riven-stone pier beside a teak double door, a perforated CNC screen, wide teak-framed sliding windows, slim black steel balcony railings, a flat-roof car porch. Warm dusk light, clipped lawn with a few shrubs, coconut palms far behind a plain compound wall. ${GROUNDING}`,
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
