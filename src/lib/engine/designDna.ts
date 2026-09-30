import type { Character, DesignPersonality } from '../model/brief.ts'
import type { MassingType } from './massing/types.ts'
import { makeRng } from './massing/rng.ts'

export type VariationLevel = 'subtle' | 'balanced' | 'bold'
export type Composition = 'vertical-frame' | 'horizontal-stack' | 'floating-box' | 'tower-and-wing' |
  'central-entry' | 'asymmetric-entry' | 'layered-facade' | 'recessed-core' | 'split-volume' |
  'portal-frame' | 'courtyard-front' | 'double-height-focus' | 'corner-feature' |
  'stepped-composition' | 'interlocking-volumes' | 'frame-within-frame'
export type FeatureType = 'stone-tower' | 'timber-fins' | 'metal-fins' | 'deep-chajja' |
  'floating-slab' | 'jaali-panel' | 'planter-band' | 'roof-pergola'
export type StyleFamily = 'modern-indian' | 'contemporary-indian' | 'luxury-modern' | 'minimal-modern' |
  'tropical-modern' | 'modern-kerala' | 'kerala-contemporary' | 'courtyard-modern' |
  'resort-luxury' | 'neo-classical' | 'contemporary-classical' | 'urban-premium'
export type InspirationPreferences = Partial<Pick<DesignDNA,
  'styleFamily' | 'facadeComposition' | 'entranceDesign' | 'featureElement' | 'roofDesign' |
  'materialPalette' | 'windowTreatment' | 'balconyDesign' | 'landscapeMood'>>

export const PALETTE_MATERIALS: Record<DesignDNA['materialPalette'], string> = {
  'warm-stone': 'warm white plaster, dark grey stone, teak timber, black aluminium, clear glass',
  'lime-plaster': 'off-white lime plaster, warm timber, muted black metal, clear glass',
  earth: 'cream plaster, natural stone, warm timber, dark metal, clear glass',
  'travertine-bronze': 'off-white plaster, travertine, teak timber, bronze metal, clear glass',
  'charcoal-oak': 'white plaster, charcoal textured plaster, oak timber, black frames, grey stone',
  'kerala-laterite': 'warm white plaster, laterite stone, teak timber, terracotta roof tiles',
  'tropical-cream': 'cream plaster, natural timber, natural stone, deep green accents, dark metal',
  'classical-stone': 'warm stone, cream plaster, muted timber, dark metal, clear glass',
}

export type DesignDNA = {
  seed: number
  /** Seeded, exterior-only roof geometry. The plan and its openings are unchanged. */
  roofGeometry: {
    profile: 'slim' | 'deep-eave' | 'raised-edge'
    ridge: 'long' | 'cross'
    monoLowSide: 'first' | 'second'
    pitchBiasDeg: -3 | 0 | 3
    element: 'portal' | 'fins' | 'cornice' | 'screen'
  }
  styleFamily: StyleFamily
  variationLevel: VariationLevel
  designPersonality: DesignPersonality
  facadeComposition: Composition
  entranceDesign: 'vertical-portal' | 'horizontal-canopy' | 'stone-pier' | 'timber-screen' | 'recessed-entry' | 'floating-frame' | 'column-portico' | 'deep-shadow-entry'
  featureElement: FeatureType
  secondaryFeature: FeatureType
  balconyDesign: 'glass-floating' | 'recessed' | 'solid-parapet' | 'metal-rail' | 'timber-screened' | 'planter-balcony'
  roofDesign: 'flat' | 'floating-flat' | 'parapet-flat' | 'pergola-terrace' | 'hip' | 'gable' | 'mono-slope' | 'mixed-flat-pitched' | 'kerala-pitched'
  windowTreatment: 'flush-frame' | 'deep-reveal' | 'projecting-frame' | 'timber-surround' | 'stone-surround' | 'sunshade'
  shadingSystem: 'none' | 'vertical-fins' | 'horizontal-louvers' | 'deep-overhang' | 'jaali'
  materialPalette: 'warm-stone' | 'lime-plaster' | 'earth' | 'travertine-bronze' | 'charcoal-oak' | 'kerala-laterite' | 'tropical-cream' | 'classical-stone'
  landscapeMood: 'minimal' | 'formal' | 'natural' | 'lush-tropical' | 'courtyard'
  frameThicknessMm: number
  finSpacingMm: number
  overhangMm: number
  facade: 'layered' | 'framed' | 'screened' | 'terraced'
  rhythm: 'regular' | 'paired' | 'asymmetric'
  accentSide: 'left' | 'right'
  screenDensity: number
  frameDepthM: number
  palette: 'warm-stone' | 'lime-plaster' | 'earth'
}

/** Independent streams keep a pinned direction stable when new DNA traits are added. */
function unit(key: string): number {
  let hash = 2166136261
  for (const c of key) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619)
  hash = Math.imul(hash ^ (hash >>> 16), 2246822507)
  return (hash >>> 0) / 4294967296
}

type Weighted<T> = readonly [T, number][]
const preferred = <T>(options: Weighted<T>, value: T | undefined): Weighted<T> =>
  value === undefined ? options : options.map(([item, weight]) => [item, weight * (item === value ? 4 : 1)])
type Preset = {
  compositions: Weighted<Composition>
  entrances: Weighted<DesignDNA['entranceDesign']>
  features: Weighted<FeatureType>
  roofs: Weighted<DesignDNA['roofDesign']>
  palettes: Weighted<DesignDNA['materialPalette']>
}

const MODERN: Preset = {
  compositions: [['vertical-frame', 3], ['floating-box', 3], ['double-height-focus', 2], ['interlocking-volumes', 2], ['horizontal-stack', 1], ['portal-frame', 2]],
  entrances: [['vertical-portal', 3], ['floating-frame', 2], ['horizontal-canopy', 2], ['stone-pier', 1]],
  features: [['stone-tower', 2], ['timber-fins', 3], ['metal-fins', 2], ['floating-slab', 2], ['roof-pergola', 1]],
  roofs: [['flat', 3], ['floating-flat', 3], ['parapet-flat', 2], ['pergola-terrace', 2]],
  palettes: [['warm-stone', 3], ['travertine-bronze', 2], ['charcoal-oak', 2]],
}
const MINIMAL: Preset = {
  compositions: [['horizontal-stack', 4], ['recessed-core', 3], ['portal-frame', 2], ['frame-within-frame', 1]],
  entrances: [['recessed-entry', 3], ['horizontal-canopy', 3], ['vertical-portal', 1]],
  features: [['floating-slab', 3], ['deep-chajja', 3], ['timber-fins', 1]],
  roofs: [['flat', 3], ['parapet-flat', 3], ['floating-flat', 2]],
  palettes: [['lime-plaster', 3], ['warm-stone', 2], ['charcoal-oak', 1]],
}
const KERALA: Preset = {
  compositions: [['layered-facade', 3], ['courtyard-front', 2], ['central-entry', 2], ['stepped-composition', 2]],
  entrances: [['column-portico', 3], ['stone-pier', 2], ['deep-shadow-entry', 3], ['timber-screen', 1]],
  features: [['deep-chajja', 3], ['jaali-panel', 3], ['timber-fins', 2], ['planter-band', 1]],
  roofs: [['hip', 3], ['gable', 2], ['mixed-flat-pitched', 2], ['kerala-pitched', 3]],
  palettes: [['kerala-laterite', 4], ['earth', 2], ['warm-stone', 1]],
}
const TROPICAL: Preset = {
  compositions: [['layered-facade', 3], ['horizontal-stack', 2], ['courtyard-front', 2], ['stepped-composition', 2]],
  entrances: [['deep-shadow-entry', 3], ['timber-screen', 2], ['horizontal-canopy', 2]],
  features: [['planter-band', 3], ['timber-fins', 3], ['deep-chajja', 2], ['roof-pergola', 2]],
  roofs: [['floating-flat', 2], ['pergola-terrace', 3], ['mixed-flat-pitched', 1]],
  palettes: [['tropical-cream', 4], ['earth', 2], ['warm-stone', 1]],
}
const CLASSICAL: Preset = {
  compositions: [['central-entry', 4], ['portal-frame', 3], ['frame-within-frame', 2]],
  entrances: [['column-portico', 4], ['stone-pier', 2], ['recessed-entry', 1]],
  features: [['stone-tower', 2], ['deep-chajja', 2], ['planter-band', 1]],
  roofs: [['hip', 2], ['gable', 2], ['parapet-flat', 1]],
  palettes: [['classical-stone', 4], ['travertine-bronze', 1]],
}

export const STYLE_PRESETS: Record<StyleFamily, Preset> = {
  'modern-indian': MODERN, 'contemporary-indian': MODERN, 'luxury-modern': MODERN,
  'minimal-modern': MINIMAL, 'tropical-modern': TROPICAL, 'modern-kerala': KERALA,
  'kerala-contemporary': KERALA, 'courtyard-modern': TROPICAL, 'resort-luxury': TROPICAL,
  'neo-classical': CLASSICAL, 'contemporary-classical': CLASSICAL, 'urban-premium': MODERN,
}
const INSPIRATION_VALUES: Record<keyof InspirationPreferences, readonly string[]> = {
  styleFamily: Object.keys(STYLE_PRESETS),
  facadeComposition: Object.values(STYLE_PRESETS).flatMap((p) => p.compositions.map(([v]) => v)),
  entranceDesign: Object.values(STYLE_PRESETS).flatMap((p) => p.entrances.map(([v]) => v)),
  featureElement: Object.values(STYLE_PRESETS).flatMap((p) => p.features.map(([v]) => v)),
  roofDesign: Object.values(STYLE_PRESETS).flatMap((p) => p.roofs.map(([v]) => v)),
  materialPalette: Object.keys(PALETTE_MATERIALS),
  windowTreatment: ['flush-frame', 'deep-reveal', 'projecting-frame', 'timber-surround', 'stone-surround', 'sunshade'],
  balconyDesign: ['glass-floating', 'recessed', 'solid-parapet', 'metal-rail', 'timber-screened', 'planter-balcony'],
  landscapeMood: ['minimal', 'formal', 'natural', 'lush-tropical', 'courtyard'],
}

/** Accept only known architectural vocabulary from a vision model or saved state. */
export function parseInspirationPreferences(value: unknown): InspirationPreferences | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const parsed: Record<string, string> = {}
  for (const [key, allowed] of Object.entries(INSPIRATION_VALUES))
    if (typeof source[key] === 'string' && allowed.includes(source[key])) parsed[key] = source[key]
  return Object.keys(parsed).length ? parsed as InspirationPreferences : null
}
const FAMILY: Record<Character, StyleFamily> = {
  'modern-indian': 'modern-indian', 'contemporary-indian': 'contemporary-indian',
  'modern-kerala': 'modern-kerala', 'kerala-contemporary': 'kerala-contemporary',
  'luxury-indian': 'luxury-modern', 'tropical-indian': 'tropical-modern',
  'minimal-indian': 'minimal-modern', 'courtyard-indian': 'courtyard-modern',
  'resort-luxury': 'resort-luxury', 'neo-classical': 'neo-classical',
  'contemporary-classical': 'contemporary-classical', 'urban-premium': 'urban-premium',
}

export function deriveDesignDNA(briefKey: string, seed: number, character: Character, _massing: MassingType,
  variationLevel: VariationLevel = 'balanced', personality: DesignPersonality = 'balanced',
  inspiration?: InspirationPreferences | null): DesignDNA {
  const key = `${briefKey}:${seed}:${character}`
  const rng = makeRng(seed, `${key}:dna`)
  // Subtle keeps the major architectural language tied to the plan. Only
  // finish, window treatment and measured detailing respond to a new seed.
  const majorRng = variationLevel === 'subtle'
    ? makeRng(0, `${briefKey}:${character}:subtle`)
    : rng
  const base = inspiration?.styleFamily ?? FAMILY[character]
  const pool: StyleFamily[] = base.includes('kerala')
    ? ['modern-kerala', 'kerala-contemporary', 'tropical-modern']
    : ['modern-indian', 'luxury-modern', 'minimal-modern', 'tropical-modern', 'urban-premium']
  const styleFamily = !inspiration?.styleFamily && variationLevel === 'bold' && rng.chance(0.45) ? rng.pick(pool) : base
  const preset = STYLE_PRESETS[styleFamily]
  const boost = (c: Composition) => personality === 'minimal'
    ? ['horizontal-stack', 'recessed-core', 'portal-frame'].includes(c) ? 2.5 : 0.6
    : personality === 'bold' || personality === 'dramatic'
      ? ['tower-and-wing', 'double-height-focus', 'floating-box', 'interlocking-volumes'].includes(c) ? 2.2 : 0.8
      : personality === 'elegant' || personality === 'luxurious'
        ? ['central-entry', 'vertical-frame', 'frame-within-frame'].includes(c) ? 1.8 : 1
        : 1
  const facadeComposition = majorRng.weighted(preferred(preset.compositions.map(([c, w]) => [c, w * boost(c)]), inspiration?.facadeComposition))
  const entranceDesign = majorRng.weighted(preferred(preset.entrances, inspiration?.entranceDesign))
  const featureElement = majorRng.weighted(preferred(preset.features, inspiration?.featureElement))
  const secondaryFeature = preset.features.find(([f]) => f !== featureElement)?.[0] ?? featureElement
  const materialPalette = rng.weighted(preferred(preset.palettes, inspiration?.materialPalette))
  const roofDesign = featureElement === 'roof-pergola' ? 'pergola-terrace' : majorRng.weighted(preferred(preset.roofs, inspiration?.roofDesign))
  const roofKey = variationLevel === 'subtle' ? `${briefKey}:${character}:subtle-roof` : `${key}:roof`
  const profile = (['slim', 'deep-eave', 'raised-edge'] as const)[Math.floor(unit(`${roofKey}:profile`) * 3)]
  const ridge = unit(`${roofKey}:ridge`) < 0.5 ? 'long' : 'cross'
  const monoLowSide = unit(`${roofKey}:mono`) < 0.5 ? 'first' : 'second'
  const pitchBiasDeg = ([-3, 0, 3] as const)[Math.floor(unit(`${roofKey}:pitch`) * 3)]
  const element = (['portal', 'fins', 'cornice', 'screen'] as const)[Math.floor(unit(`${roofKey}:element`) * 4)]
  const facade: DesignDNA['facade'] = ['vertical-frame', 'portal-frame', 'frame-within-frame', 'double-height-focus'].includes(facadeComposition)
    ? 'framed' : ['horizontal-stack', 'layered-facade', 'stepped-composition'].includes(facadeComposition)
      ? 'layered' : featureElement.includes('fins') || featureElement === 'jaali-panel' ? 'screened' : 'terraced'
  return {
    seed,
    roofGeometry: { profile, ridge, monoLowSide, pitchBiasDeg, element },
    styleFamily, variationLevel, facadeComposition, entranceDesign, featureElement, secondaryFeature,
    designPersonality: personality,
    balconyDesign: majorRng.weighted(preferred([
      ['glass-floating', 1], ['recessed', 1], ['solid-parapet', 1], ['metal-rail', 1],
      ['timber-screened', 1], ['planter-balcony', 1],
    ] as Weighted<DesignDNA['balconyDesign']>, inspiration?.balconyDesign)),
    roofDesign,
    windowTreatment: rng.weighted(preferred([
      ['flush-frame', 1], ['deep-reveal', 1], ['projecting-frame', 1],
      ['timber-surround', 1], ['stone-surround', 1], ['sunshade', 1],
    ] as Weighted<DesignDNA['windowTreatment']>, inspiration?.windowTreatment)),
    shadingSystem: featureElement === 'timber-fins' || featureElement === 'metal-fins' ? 'vertical-fins' :
      featureElement === 'jaali-panel' ? 'jaali' : featureElement === 'deep-chajja' ? 'deep-overhang' : 'none',
    materialPalette,
    landscapeMood: inspiration?.landscapeMood ?? (styleFamily.includes('tropical') || styleFamily === 'resort-luxury'
      ? 'lush-tropical' : styleFamily.includes('classical') ? 'formal' : styleFamily === 'courtyard-modern' ? 'courtyard' : 'natural'),
    frameThicknessMm: rng.int(200, 400), finSpacingMm: rng.int(180, 350), overhangMm: rng.int(450, 900),
    facade, rhythm: rng.pick(['regular', 'paired', 'asymmetric'] as const), accentSide: rng.pick(['left', 'right'] as const),
    screenDensity: rng.int(4, 8), frameDepthM: 0.22 + Math.round(unit(`${key}:depth`) * 20) / 100,
    palette: materialPalette === 'kerala-laterite' || materialPalette === 'tropical-cream' ? 'earth' :
      materialPalette === 'lime-plaster' ? 'lime-plaster' : 'warm-stone',
  }
}
