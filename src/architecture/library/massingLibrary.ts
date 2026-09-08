/* ------------------------------------------------------------------ *
 *  massingLibrary — the catalogue of volumetric compositions.
 *
 *  Each entry describes ONE way to compose the storey volumes: the
 *  plan figures it reads well on, how much plot slack and how many
 *  floors it needs, the geometric parameter ranges the resolver
 *  samples (offset / cantilever / split-gap / volume count) and the
 *  architectural characteristics it imparts.
 *
 *  `resolveGenome()` consults this to (a) filter compositions that
 *  cannot be built on the given plot + floor count and (b) sample the
 *  magnitudes. `massingResolver.ts` reads the same params so the
 *  geometry matches the genome.
 * ------------------------------------------------------------------ */

import type {
  Characteristic,
  CompositionBalance,
  Emphasis,
  MassingComposition,
  PlanFigure,
} from './architecturalVocabulary.ts'

export type MassingEntry = {
  id: MassingComposition
  label: string
  description: string
  /** minimum storey count for the composition to be meaningful */
  minFloors: number
  /** plot slack (buildable minus ground footprint) needed on the freer axis, mm */
  minSlackMm: number
  /** plan figures this composition suits */
  figures: PlanFigure[]
  params: {
    volumeCount: [number, number]
    storeyOffsetMm?: [number, number]
    cantileverMm?: [number, number]
    splitGapMm?: [number, number]
  }
  balance: CompositionBalance
  horizontalEmphasis: Emphasis
  verticalEmphasis: Emphasis
  /** the volumetric strategy the engine's massingResolver should run */
  engineStrategy: 'stacked' | 'offset_volumes' | 'stepped' | 'cantilever' | 'split_mass' | 'linear'
  characteristics: Characteristic[]
}

const E = (e: MassingEntry): MassingEntry => e

export const MASSING_LIBRARY: Record<MassingComposition, MassingEntry> = {
  single_volume: E({
    id: 'single_volume',
    label: 'Single volume',
    description: 'One clean prism — the whole house is one box.',
    minFloors: 1,
    minSlackMm: 0,
    figures: ['rectangular', 'square', 'linear'],
    params: { volumeCount: [1, 1] },
    balance: 'symmetric',
    horizontalEmphasis: 'medium',
    verticalEmphasis: 'low',
    engineStrategy: 'stacked',
    characteristics: ['monolithic', 'minimal_detailing'],
  }),
  stacked_volumes: E({
    id: 'stacked_volumes',
    label: 'Stacked volumes',
    description: 'Storeys sit plumb; the reading comes from string courses and material bands.',
    minFloors: 2,
    minSlackMm: 0,
    figures: ['rectangular', 'square', 'l_shape', 't_shape', 'linear'],
    params: { volumeCount: [2, 3], storeyOffsetMm: [0, 400] },
    balance: 'near_symmetric',
    horizontalEmphasis: 'strong',
    verticalEmphasis: 'low',
    engineStrategy: 'stacked',
    characteristics: ['strong_horizontal_lines', 'heavy_base_light_top'],
  }),
  offset_volumes: E({
    id: 'offset_volumes',
    label: 'Offset volumes',
    description: 'The upper storey shifts in plan so the boxes read as separate, overlapping masses.',
    minFloors: 2,
    minSlackMm: 900,
    figures: ['rectangular', 'square', 'l_shape', 't_shape', 'split'],
    params: { volumeCount: [2, 3], storeyOffsetMm: [900, 2400] },
    balance: 'asymmetric',
    horizontalEmphasis: 'strong',
    verticalEmphasis: 'medium',
    engineStrategy: 'offset_volumes',
    characteristics: ['asymmetric_balance', 'layered_facade', 'solid_void_play', 'deep_shadows'],
  }),
  split_volumes: E({
    id: 'split_volumes',
    label: 'Split volumes',
    description: 'Two distinct masses joined by a recessed glazed link.',
    minFloors: 1,
    minSlackMm: 1200,
    figures: ['l_shape', 't_shape', 'u_shape', 'h_shape', 'split', 'pavilion'],
    params: { volumeCount: [2, 3], splitGapMm: [1800, 3600] },
    balance: 'asymmetric',
    horizontalEmphasis: 'strong',
    verticalEmphasis: 'medium',
    engineStrategy: 'split_mass',
    characteristics: ['solid_void_play', 'asymmetric_balance', 'transparent_ground'],
  }),
  stepped_volumes: E({
    id: 'stepped_volumes',
    label: 'Stepped volumes',
    description: 'Each storey steps back from the one below, giving usable terraces.',
    minFloors: 2,
    minSlackMm: 1400,
    figures: ['rectangular', 'square', 'l_shape', 'linear'],
    params: { volumeCount: [2, 3], storeyOffsetMm: [800, 1800] },
    balance: 'asymmetric',
    horizontalEmphasis: 'strong',
    verticalEmphasis: 'low',
    engineStrategy: 'stepped',
    characteristics: ['strong_horizontal_lines', 'roof_as_feature', 'climate_responsive'],
  }),
  interlocking_volumes: E({
    id: 'interlocking_volumes',
    label: 'Interlocking volumes',
    description: 'Masses that penetrate one another — a box pushed through a plane.',
    minFloors: 2,
    minSlackMm: 1000,
    figures: ['l_shape', 't_shape', 'square', 'split', 'pavilion'],
    params: { volumeCount: [2, 3], storeyOffsetMm: [700, 1800], cantileverMm: [0, 900] },
    balance: 'dynamic_asymmetric',
    horizontalEmphasis: 'medium',
    verticalEmphasis: 'medium',
    engineStrategy: 'offset_volumes',
    characteristics: ['solid_void_play', 'asymmetric_balance', 'deep_shadows'],
  }),
  cantilevered_volumes: E({
    id: 'cantilevered_volumes',
    label: 'Cantilevered volumes',
    description: 'An upper volume projects past the storey below on exposed structure.',
    minFloors: 2,
    minSlackMm: 0,
    figures: ['rectangular', 'square', 'l_shape', 'split'],
    params: { volumeCount: [2, 3], cantileverMm: [800, 1800], storeyOffsetMm: [0, 900] },
    balance: 'dynamic_asymmetric',
    horizontalEmphasis: 'strong',
    verticalEmphasis: 'medium',
    engineStrategy: 'cantilever',
    characteristics: ['cantilever', 'floating_volume', 'deep_shadows', 'lightweight'],
  }),
  floating_upper_volume: E({
    id: 'floating_upper_volume',
    label: 'Floating upper volume',
    description: 'A recessed, glazed or dark ground floor makes the upper box appear to float.',
    minFloors: 2,
    minSlackMm: 600,
    figures: ['rectangular', 'square', 'l_shape'],
    params: { volumeCount: [2, 2], cantileverMm: [600, 1400], storeyOffsetMm: [0, 600] },
    balance: 'near_symmetric',
    horizontalEmphasis: 'strong',
    verticalEmphasis: 'low',
    engineStrategy: 'cantilever',
    characteristics: ['floating_volume', 'transparent_ground', 'heavy_base_light_top', 'deep_shadows'],
  }),
  central_core: E({
    id: 'central_core',
    label: 'Central core',
    description: 'A solid service / stair core anchors lighter wrapped living space.',
    minFloors: 1,
    minSlackMm: 0,
    figures: ['square', 'rectangular', 't_shape'],
    params: { volumeCount: [1, 2] },
    balance: 'symmetric',
    horizontalEmphasis: 'medium',
    verticalEmphasis: 'medium',
    engineStrategy: 'stacked',
    characteristics: ['symmetric_balance', 'transparent_ground'],
  }),
  side_wing: E({
    id: 'side_wing',
    label: 'Side-wing composition',
    description: 'A main mass with a lower subordinate wing (bedrooms, garage, guest).',
    minFloors: 1,
    minSlackMm: 900,
    figures: ['l_shape', 't_shape', 'u_shape', 'h_shape', 'courtyard'],
    params: { volumeCount: [2, 3], storeyOffsetMm: [0, 1000] },
    balance: 'asymmetric',
    horizontalEmphasis: 'strong',
    verticalEmphasis: 'low',
    engineStrategy: 'split_mass',
    characteristics: ['asymmetric_balance', 'strong_horizontal_lines', 'sheltered_verandah'],
  }),
  courtyard_ring: E({
    id: 'courtyard_ring',
    label: 'Courtyard ring',
    description: 'Wings wrap an open court; circulation runs around the void.',
    minFloors: 1,
    minSlackMm: 0,
    figures: ['courtyard', 'u_shape', 'h_shape'],
    params: { volumeCount: [2, 4] },
    balance: 'near_symmetric',
    horizontalEmphasis: 'strong',
    verticalEmphasis: 'low',
    engineStrategy: 'stacked',
    characteristics: ['courtyard_focused', 'climate_responsive', 'privacy_to_street', 'sheltered_verandah'],
  }),
  pavilion_cluster: E({
    id: 'pavilion_cluster',
    label: 'Pavilion cluster',
    description: 'Discrete pavilions linked by decks or covered walks.',
    minFloors: 1,
    minSlackMm: 1800,
    figures: ['courtyard', 'u_shape', 'pavilion', 'split'],
    params: { volumeCount: [2, 4], splitGapMm: [2000, 4000] },
    balance: 'dynamic_asymmetric',
    horizontalEmphasis: 'strong',
    verticalEmphasis: 'none',
    engineStrategy: 'split_mass',
    characteristics: ['courtyard_focused', 'tropical_shading', 'lightweight', 'sheltered_verandah'],
  }),
  linear_bar: E({
    id: 'linear_bar',
    label: 'Linear bar',
    description: 'One long, thin, single-loaded bar — every room gets a through-breeze.',
    minFloors: 1,
    minSlackMm: 0,
    figures: ['linear', 'rectangular'],
    params: { volumeCount: [1, 2] },
    balance: 'near_symmetric',
    horizontalEmphasis: 'strong',
    verticalEmphasis: 'none',
    engineStrategy: 'linear',
    characteristics: ['strong_horizontal_lines', 'climate_responsive', 'tropical_shading'],
  }),
}

export function massingEntry(id: MassingComposition): MassingEntry {
  return MASSING_LIBRARY[id]
}

/** compositions feasible for a floor count + plot slack (mm on the freer axis) */
export function feasibleMassing(floors: number, slackMm: number): MassingComposition[] {
  return (Object.keys(MASSING_LIBRARY) as MassingComposition[]).filter((k) => {
    const m = MASSING_LIBRARY[k]
    return floors >= m.minFloors && slackMm >= m.minSlackMm
  })
}
