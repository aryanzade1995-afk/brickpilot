import type { Brief } from '../model/brief.ts'

export const HOUSE_IDEA_TYPES = ['villa', 'large-villa'] as const
export const HOUSE_IDEA_STYLES = ['modern-box', 'contemporary-indian', 'courtyard-indian'] as const
export const HOUSE_IDEA_LAYOUTS = ['auto', 'twin-wing', 'u-wing', 'courtyard-ring', 'pavilion'] as const
export const HOUSE_IDEA_COMPOSITIONS = ['auto', 'glazed-bay', 'staggered-wings', 'terraced-villa'] as const
export type HouseIdeaSelection = { type: string; style: string; layout: string; composition: string; storeys: number }
export const houseIdeaKey = (s: HouseIdeaSelection) => [s.type, s.style, s.composition, s.layout, `g${s.storeys}`].join('--')
export const houseIdeaSelection = (brief: Brief): HouseIdeaSelection => ({
  type: brief.project.buildingType, style: brief.style.character, layout: brief.style.massing ?? 'auto',
  composition: brief.style.character === 'modern-box' ? brief.style.composition ?? 'auto' : 'auto', storeys: brief.levels.storeys,
})
export const HOUSE_IDEA_COMBINATIONS: HouseIdeaSelection[] = HOUSE_IDEA_TYPES.flatMap(type =>
  HOUSE_IDEA_STYLES.flatMap(style => (style === 'modern-box' ? HOUSE_IDEA_COMPOSITIONS : ['auto']).flatMap(composition =>
    HOUSE_IDEA_LAYOUTS.flatMap(layout => [0, 1, 2, 3].map(storeys => ({ type, style, composition, layout, storeys }))))))
export type HouseIdeaImage = HouseIdeaSelection & { id: string; status: 'ready' | 'unavailable'; image?: string; renderDigest?: string; reason?: string; planId?: string; seed?: number; actualLayout?: string; plotMetres?: [number, number] }
export type HouseIdeaManifest = { schemaVersion: 1; source: 'Blender'; examplesOnly: true; entries: HouseIdeaImage[] }
