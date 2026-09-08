/* ------------------------------------------------------------------ *
 *  compatibilityRules — which architectural decisions may co-occur.
 *
 *  A DesignGenome is a set of independent picks (massing, roof,
 *  entrance, balcony, facade, glazing, courtyard…). Left unchecked, a
 *  seeded pick can produce nonsense — a Kerala tiled hip roof with a
 *  cantilevered floating upper volume, a jaali screen on a full glass
 *  box, a porte-cochere on a 6 m plot. These rules encode the hard
 *  incompatibilities and the soft affinities, and `repairGenome()`
 *  uses them to pull an invalid genome back to something buildable.
 *
 *  Rules are DATA, not code branches, so they can be inspected,
 *  serialised to the dataset (`compatibility.json`) and extended.
 * ------------------------------------------------------------------ */

import type { MassingComposition, PlanFigure } from './architecturalVocabulary.ts'

/** a forbidden pair: `{a}` on field A must never appear with `{b}` on field B */
export type Incompatibility = {
  a: [string, string] // [field, term]
  b: [string, string]
  reason: string
}

/** a preferred pair — nudges the seeded pick, never forces it */
export type Affinity = {
  a: [string, string]
  b: [string, string]
  weight: number // multiplier applied to b's pick weight when a is set
  note: string
}

/* ================================================================== *
 *  HARD INCOMPATIBILITIES
 * ================================================================== */

export const INCOMPATIBILITIES: Incompatibility[] = [
  /* ---- sloped / tiled roofs vs. modern volumetric play ---- */
  {
    a: ['roof', 'kerala_tiled_hip'],
    b: ['massingComposition', 'cantilevered_volumes'],
    reason: 'a tiled hip roof cannot sit over a cantilevered volume',
  },
  {
    a: ['roof', 'kerala_tiled_hip'],
    b: ['massingComposition', 'floating_upper_volume'],
    reason: 'tiled hip roofs read as grounded, not floating',
  },
  {
    a: ['roof', 'kerala_tiled_hip'],
    b: ['upperFloorStrategy', 'full_cantilever'],
    reason: 'pitched-roof mass is not cantilevered a full bay',
  },
  {
    a: ['roof', 'butterfly'],
    b: ['screen', 'jaali'],
    reason: 'a butterfly roof + jaali is not a coherent language',
  },
  /* ---- glass box vs. heavy screening / stone ---- */
  {
    a: ['facadeComposition', 'glass_box'],
    b: ['screen', 'jaali'],
    reason: 'a glass box is not clad in a masonry jaali',
  },
  {
    a: ['facadeComposition', 'glass_box'],
    b: ['glazing', 'minimal'],
    reason: 'a glass box cannot have minimal glazing',
  },
  {
    a: ['facadeComposition', 'stone_volume'],
    b: ['glazing', 'full_glass'],
    reason: 'a stone volume reads solid, not fully glazed',
  },
  /* ---- courtyard vs. plan figure ---- */
  {
    a: ['courtyard', 'central'],
    b: ['planFigure', 'linear'],
    reason: 'a linear bar has no room for a central court',
  },
  {
    a: ['courtyard', 'central'],
    b: ['planFigure', 'l_shape'],
    reason: 'an L cannot enclose a central court — use a side court',
  },
  {
    a: ['courtyard', 'double_height_courtyard'],
    b: ['planFigure', 'rectangular'],
    reason: 'a double-height court needs an enclosing figure (U / courtyard / H)',
  },
  /* ---- minimal glazing vs. panoramic window strategy ---- */
  {
    a: ['glazing', 'minimal'],
    b: ['windowStrategy', 'controlled_panoramic'],
    reason: 'panoramic glazing is not "minimal"',
  },
  {
    a: ['glazing', 'minimal'],
    b: ['windowStrategy', 'floor_to_ceiling'],
    reason: 'floor-to-ceiling glazing is not "minimal"',
  },
]

/* ================================================================== *
 *  SOFT AFFINITIES  — seeded picks lean this way
 * ================================================================== */

export const AFFINITIES: Affinity[] = [
  {
    a: ['massingComposition', 'cantilevered_volumes'],
    b: ['roof', 'floating_slab'],
    weight: 2.2,
    note: 'a cantilever wants a thin floating roof to match',
  },
  {
    a: ['massingComposition', 'offset_volumes'],
    b: ['facadeComposition', 'layered_solid_void'],
    weight: 1.8,
    note: 'offset boxes read best as layered solid/void',
  },
  {
    a: ['roof', 'kerala_tiled_hip'],
    b: ['facadeComposition', 'stacked_bands'],
    weight: 1.6,
    note: 'tiled hips pair with banded plaster + verandah',
  },
  {
    a: ['courtyard', 'central'],
    b: ['planFigure', 'courtyard'],
    weight: 3.0,
    note: 'a central court needs the courtyard figure',
  },
  {
    a: ['courtyard', 'side'],
    b: ['planFigure', 'l_shape'],
    weight: 2.0,
    note: 'a side court is the L-figure move',
  },
  {
    a: ['entrance', 'porte_cochere'],
    b: ['glazing', 'expansive'],
    weight: 1.5,
    note: 'a porte-cochere signals a larger, more glazed villa',
  },
  {
    a: ['facadeComposition', 'glass_box'],
    b: ['glazing', 'expansive'],
    weight: 2.5,
    note: 'a glass box is expansively glazed',
  },
  {
    a: ['screen', 'vertical_fins'],
    b: ['glazing', 'controlled_large'],
    weight: 1.8,
    note: 'fins exist to temper large glazing',
  },
]

/* ================================================================== *
 *  PLAN-FIGURE ⇄ MASSING feasibility (structural, not stylistic)
 * ================================================================== */

/**
 * Structural feasibility only — most compositions work on most figures; this
 * lists what is genuinely impossible, so a figure's allowed set is
 * "everything MINUS its forbidden compositions".
 */
const FIGURE_FORBIDS: Record<PlanFigure, MassingComposition[]> = {
  rectangular: ['courtyard_ring', 'pavilion_cluster'],
  square: ['courtyard_ring', 'pavilion_cluster', 'linear_bar'],
  l_shape: ['courtyard_ring', 'linear_bar'],
  t_shape: ['courtyard_ring', 'linear_bar', 'pavilion_cluster'],
  u_shape: ['linear_bar', 'central_core'],
  h_shape: ['linear_bar', 'central_core', 'single_volume'],
  courtyard: ['linear_bar', 'single_volume', 'cantilevered_volumes', 'floating_upper_volume'],
  linear: ['courtyard_ring', 'pavilion_cluster', 'central_core', 'side_wing'],
  pavilion: ['courtyard_ring', 'central_core', 'linear_bar'],
  split: ['courtyard_ring', 'linear_bar', 'central_core'],
}

const ALL_MASSING: MassingComposition[] = [
  'single_volume',
  'stacked_volumes',
  'offset_volumes',
  'split_volumes',
  'stepped_volumes',
  'interlocking_volumes',
  'cantilevered_volumes',
  'floating_upper_volume',
  'central_core',
  'side_wing',
  'courtyard_ring',
  'pavilion_cluster',
  'linear_bar',
]

export const FIGURE_ALLOWS_MASSING: Record<PlanFigure, MassingComposition[]> = Object.fromEntries(
  (Object.keys(FIGURE_FORBIDS) as PlanFigure[]).map((fig) => [
    fig,
    ALL_MASSING.filter((m) => !FIGURE_FORBIDS[fig].includes(m)),
  ]),
) as Record<PlanFigure, MassingComposition[]>

/* ================================================================== *
 *  QUERY HELPERS
 * ================================================================== */

/** collect every hard incompatibility a `[field,term]` pick participates in */
export function conflictsFor(field: string, term: string): Incompatibility[] {
  return INCOMPATIBILITIES.filter(
    (r) =>
      (r.a[0] === field && r.a[1] === term) || (r.b[0] === field && r.b[1] === term),
  )
}

/** given a partial genome (field → term), is this new pick allowed? */
export function isPickAllowed(current: Record<string, string>, field: string, term: string): { ok: boolean; reason?: string } {
  for (const rule of INCOMPATIBILITIES) {
    const [af, at] = rule.a
    const [bf, bt] = rule.b
    if (af === field && at === term && current[bf] === bt) return { ok: false, reason: rule.reason }
    if (bf === field && bt === term && current[af] === at) return { ok: false, reason: rule.reason }
  }
  return { ok: true }
}

/** weight multiplier for picking `[field,term]` given what's already chosen */
export function affinityWeight(current: Record<string, string>, field: string, term: string): number {
  let w = 1
  for (const aff of AFFINITIES) {
    const [af, at] = aff.a
    const [bf, bt] = aff.b
    if (bf === field && bt === term && current[af] === at) w *= aff.weight
    if (af === field && at === term && current[bf] === bt) w *= aff.weight
  }
  return w
}

export function figureAllowsMassing(figure: PlanFigure, massing: MassingComposition): boolean {
  return FIGURE_ALLOWS_MASSING[figure].includes(massing)
}

/* ---- serialisable snapshot for the dataset -------------------------- */

export type CompatibilitySnapshot = {
  incompatibilities: Incompatibility[]
  affinities: Affinity[]
  figureAllowsMassing: Record<PlanFigure, MassingComposition[]>
}

export function compatibilitySnapshot(): CompatibilitySnapshot {
  return { incompatibilities: INCOMPATIBILITIES, affinities: AFFINITIES, figureAllowsMassing: FIGURE_ALLOWS_MASSING }
}
