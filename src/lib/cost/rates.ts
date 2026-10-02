import type { Brief, Character, Finish } from '../model/brief.ts'
import type { PlateFamily } from '../engine/planner/types.ts'

/* ------------------------------------------------------------------ *
 *  Concept cost rates. APPROXIMATE — Pune, 2026, built-up area.
 *  They must be checked with a local contractor before they are used
 *  for anything but a feasibility conversation.
 * ------------------------------------------------------------------ */

/** INR per m² of built-up area by finish level (≈ ₹1,800 / 2,230 / 3,070 per sq ft) */
export const FINISH_RATE_PER_SQM: Record<Finish, number> = { basic: 19500, mid: 24000, premium: 33000 }

/** INR per m² for interiors (modular kitchen, wardrobes, false ceiling, lighting),
 *  applied to 80% of built-up area — the carpet-ish share that gets fitted out */
export const INTERIOR_RATE_PER_SQM: Record<Finish, number> = { basic: 7000, mid: 12000, premium: 20000 }
export const INTERIOR_AREA_SHARE = 0.8

/** taller houses need heavier frames, scaffolding and hoisting */
export const STOREY_FACTOR: Record<number, number> = { 0: 1.0, 1: 1.0, 2: 1.04, 3: 1.08 }

/** more external wall and corners per m² as the plate gets less compact */
export const FAMILY_FACTOR: Record<PlateFamily, number> = { rectangular: 1.0, stepped: 1.03, 'l-shape': 1.04, courtyard: 1.06, 'twin-wing': 1.08 }

/** reference ₹/m² by design character — used only to derive a small style modifier */
const STYLE_BASE_RATE: Record<Character, number> = {
  'modern-indian': 22000,
  'contemporary-indian': 21500,
  'modern-kerala': 20500,
  'kerala-contemporary': 20500,
  'luxury-indian': 29000,
  'tropical-indian': 22500,
  'minimal-indian': 19500,
  'courtyard-indian': 21000,
  'resort-luxury': 28500,
  'neo-classical': 24500,
  'contemporary-classical': 25500,
  'urban-premium': 25500,
  // the default style is the reference: its factor is exactly 1
  'modern-box': 22000,
}

/** style is a modifier on the finish rate, never the rate itself */
export const STYLE_FACTOR: Record<Character, number> = Object.fromEntries(
  Object.entries(STYLE_BASE_RATE).map(([c, r]) => [c, Math.min(1.3, Math.max(0.9, r / 22000))]),
) as Record<Character, number>

/** a large villa carries longer spans, more glazing and deeper overhangs */
export const LARGE_VILLA_FACTOR = 1.08

/** ± spread of the concept band around the expected rate */
export const RATE_SPREAD = 0.14

/** expected construction rate, INR per m² built-up, before externals / fees */
export function constructionRate(brief: Brief, family: PlateFamily = 'rectangular'): number {
  return FINISH_RATE_PER_SQM.mid *
    (STOREY_FACTOR[brief.levels.storeys] ?? 1) *
    FAMILY_FACTOR[family] *
    STYLE_FACTOR[brief.style.character] *
    (brief.project.buildingType === 'large-villa' ? LARGE_VILLA_FACTOR : 1)
}
