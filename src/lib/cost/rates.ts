/** Legacy reference helpers. Production BOQ reads measured quantities and data/pune.json. */
import type { Brief, Character } from '../model/brief.ts'
import type { PlateFamily } from '../engine/planner/types.ts'
import data from './data/legacy-rates.json' with { type: 'json' }
import policy from './data/pune.json' with { type: 'json' }
export const FINISH_RATE_PER_SQM = data.finish
export const INTERIOR_RATE_PER_SQM = data.interiors
export const INTERIOR_AREA_SHARE = data.interiorAreaShare
export const STOREY_FACTOR: Record<number, number> = data.storey
export const FAMILY_FACTOR: Record<PlateFamily, number> = data.family
export const STYLE_FACTOR = Object.fromEntries(Object.entries(data.style).map(([c, r]) =>
  [c, Math.min(data.styleLimits.high, Math.max(data.styleLimits.low, r / data.styleReference))])) as Record<Character, number>
export const LARGE_VILLA_FACTOR = data.largeVillaFactor
export const RATE_SPREAD = policy.uncertaintyPercent / 100
export function constructionRate(brief: Brief, family: PlateFamily = 'rectangular'): number {
  return data.finish.mid * (STOREY_FACTOR[brief.levels.storeys] ?? 1) * FAMILY_FACTOR[family] *
    STYLE_FACTOR[brief.style.character] * (brief.project.buildingType === 'large-villa' ? data.largeVillaFactor : 1)
}
