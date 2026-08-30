import type { Brief } from './brief.ts'

/* ------------------------------------------------------------------ *
 *  Design character — a real constraint, not a label. It drives the
 *  window rhythm (engine), the roof form + material palette (massing),
 *  and the step-4 render prompt. Pure constants: the brief seed already
 *  hashes `style.character`, so every theme is its own deterministic run.
 * ------------------------------------------------------------------ */

export type Character = Brief['style']['character']

export type RoofStyle = 'flat-parapet' | 'flat-eave' | 'hipped-tile'
export type GroupKey = 'shell' | 'glazing' | 'slabs' | 'roof' | 'stair' | 'partition'
type Mat = { color: string; roughness: number; metalness?: number }

export type ThemeDef = {
  id: Character
  label: string
  blurb: string
  roof: {
    style: RoofStyle
    /** horizontal projection of the roof past the wall face, mm (0 for a parapet) */
    eaveMm: number
    /** parapet upstand height, mm (0 for eave / hipped) */
    parapetMm: number
    /** hipped only — roof pitch in degrees */
    pitchDeg: number
    /** hipped only — cap on the ridge rise, mm */
    ridgeCapMm: number
    /** deck / fascia thickness, mm */
    thickMm: number
  }
  windows: {
    mullionMm: number
    widthMm: number
    /** habitable rooms smaller than this get no massing window */
    minRoomSqm: number
    sillMm: number
    headMm: number
  }
  massing: { plinthProjMm: number; balconyDepthMm: number }
  materials: Record<GroupKey, Mat>
  renderPrompt: string
}

const GROUNDING =
  'Keep the massing, storey count, footprint and every opening position EXACTLY as the reference — change only material, light and context. No people, no text, no watermark.'

export const THEMES: Record<Character, ThemeDef> = {
  modernist: {
    id: 'modernist',
    label: 'Modernist',
    blurb: 'Clear structural rhythm, strong horizontals, disciplined openings.',
    roof: { style: 'flat-parapet', eaveMm: 0, parapetMm: 500, pitchDeg: 0, ridgeCapMm: 0, thickMm: 220 },
    windows: { mullionMm: 3000, widthMm: 1350, minRoomSqm: 8, sillMm: 850, headMm: 2200 },
    massing: { plinthProjMm: 160, balconyDepthMm: 1500 },
    materials: {
      shell: { color: '#e8e0cf', roughness: 0.82 },
      glazing: { color: '#181c1f', roughness: 0.32 },
      slabs: { color: '#d6ccb5', roughness: 0.9 },
      roof: { color: '#cfc5ac', roughness: 0.9 },
      stair: { color: '#d2c8ae', roughness: 0.9 },
      partition: { color: '#e2d9c5', roughness: 0.92 },
    },
    renderPrompt:
      `Photorealistic architectural concept of a modernist Indian villa. Crisp flat roof with a slim parapet, deep horizontal shadow reveals, tall glazing on a disciplined structural grid, off-white board-formed concrete and lime render. Hard mid-morning sun, spare landscaping. ${GROUNDING}`,
  },
  'warm-minimal': {
    id: 'warm-minimal',
    label: 'Warm minimal',
    blurb: 'Quiet planes, timber warmth, restrained detailing.',
    roof: { style: 'flat-eave', eaveMm: 450, parapetMm: 120, pitchDeg: 0, ridgeCapMm: 0, thickMm: 150 },
    windows: { mullionMm: 3600, widthMm: 1800, minRoomSqm: 10, sillMm: 700, headMm: 2350 },
    massing: { plinthProjMm: 110, balconyDepthMm: 1500 },
    materials: {
      shell: { color: '#e6dcc4', roughness: 0.9 },
      glazing: { color: '#22201b', roughness: 0.3, metalness: 0.08 },
      slabs: { color: '#d8cdb4', roughness: 0.9 },
      roof: { color: '#b7a689', roughness: 0.68 },
      stair: { color: '#cabfa2', roughness: 0.9 },
      partition: { color: '#e3dac6', roughness: 0.92 },
    },
    renderPrompt:
      `Photorealistic architectural concept of a warm-minimalist Indian house. Quiet unbroken lime-plaster planes in a soft sand tone, one thin flat roof slab oversailing to cast a crisp eave shadow line, a few large teak-framed windows, timber soffit and screen. Soft late-afternoon light, restrained planting. ${GROUNDING}`,
  },
  'kerala-contemporary': {
    id: 'kerala-contemporary',
    label: 'Kerala contemporary',
    blurb: 'Regional roof cues and rain protection with clean planning.',
    roof: { style: 'hipped-tile', eaveMm: 550, parapetMm: 0, pitchDeg: 28, ridgeCapMm: 2600, thickMm: 170 },
    windows: { mullionMm: 2600, widthMm: 1100, minRoomSqm: 8, sillMm: 650, headMm: 2450 },
    massing: { plinthProjMm: 220, balconyDepthMm: 1600 },
    materials: {
      shell: { color: '#efe7d6', roughness: 0.9 },
      glazing: { color: '#171009', roughness: 0.4 },
      slabs: { color: '#dfd4bd', roughness: 0.9 },
      roof: { color: '#8a4a2e', roughness: 0.66 },
      stair: { color: '#d0c4a6', roughness: 0.9 },
      partition: { color: '#e8e0cc', roughness: 0.92 },
    },
    renderPrompt:
      `Photorealistic architectural concept of a contemporary Kerala house. Steep hipped clay-tile roofs with wide overhanging eaves and exposed rafter tails, white plaster walls over a laterite base course, tall louvered timber shutters, a wrapped verandah. Humid diffuse light, coconut palms and tropical greenery. ${GROUNDING}`,
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
