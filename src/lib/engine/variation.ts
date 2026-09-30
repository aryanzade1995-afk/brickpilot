import type { Design, RoofSpec } from './types.ts'
import { deriveDesignDNA, type DesignDNA, type InspirationPreferences, type VariationLevel } from './designDna.ts'
import { validateVillaVariation } from './facade/grammar.ts'

export type DesignFingerprint = Pick<DesignDNA,
  'styleFamily' | 'facadeComposition' | 'entranceDesign' | 'roofDesign' | 'balconyDesign' |
  'featureElement' | 'secondaryFeature' | 'materialPalette' | 'shadingSystem' | 'windowTreatment'> & {
  roofProfile: DesignDNA['roofGeometry']['profile']
  roofRidge: DesignDNA['roofGeometry']['ridge']
  roofElement: DesignDNA['roofGeometry']['element']
}

export const fingerprint = (dna: DesignDNA): DesignFingerprint => ({
  styleFamily: dna.styleFamily, facadeComposition: dna.facadeComposition,
  entranceDesign: dna.entranceDesign, roofDesign: dna.roofDesign,
  balconyDesign: dna.balconyDesign, featureElement: dna.featureElement,
  secondaryFeature: dna.secondaryFeature, materialPalette: dna.materialPalette,
  shadingSystem: dna.shadingSystem, windowTreatment: dna.windowTreatment,
  roofProfile: dna.roofGeometry?.profile ?? 'slim',
  roofRidge: ['hip', 'gable', 'mono-slope', 'kerala-pitched'].includes(dna.roofDesign)
    ? dna.roofGeometry?.ridge ?? 'long' : 'long',
  roofElement: dna.roofGeometry?.element ?? 'portal',
})

const WEIGHTS: Record<keyof DesignFingerprint, number> = {
  styleFamily: 8, facadeComposition: 14, entranceDesign: 12, roofDesign: 11,
  featureElement: 10, secondaryFeature: 4, balconyDesign: 9,
  materialPalette: 5, shadingSystem: 4, windowTreatment: 3,
  roofProfile: 8, roofRidge: 4, roofElement: 8,
}

/** 0–100 architectural distance, independent of landscape/camera/lighting. */
export function noveltyScore(a: DesignFingerprint, b: DesignFingerprint): number {
  return (Object.keys(WEIGHTS) as (keyof DesignFingerprint)[])
    .reduce((score, key) => score + (a[key] === b[key] ? 0 : WEIGHTS[key]), 0)
}

export function designQuality(dna: DesignDNA): number {
  let score = 100
  if (dna.featureElement === dna.secondaryFeature) score -= 15
  if (dna.variationLevel === 'subtle' && dna.designPersonality === 'dramatic') score -= 5
  if (dna.styleFamily.includes('kerala') && dna.roofDesign === 'flat') score -= 15
  return score
}

/** Exterior variation is a new identity over the exact same plan objects. */
export function varyExterior(plan: Design, seed: number, level: VariationLevel = 'balanced',
  inspiration?: InspirationPreferences | null): Design {
  const generated = deriveDesignDNA(plan.model.seed.split('-')[0], seed,
    plan.model.brief.style.character, plan.massingType, level, plan.model.brief.style.personality, inspiration)
  const top = plan.floors.length - 1
  const baseRoof = plan.floors[top].roof
  const pitchedBase = ['hip', 'gable', 'mono-slope'].includes(baseRoof.kind)
  const roofDesign: DesignDNA['roofDesign'] = pitchedBase
    ? generated.roofDesign === 'gable' || generated.roofDesign === 'hip' || generated.roofDesign === 'kerala-pitched'
      ? generated.roofDesign
      : baseRoof.kind === 'mono-slope' ? 'mono-slope' : baseRoof.kind === 'gable' ? 'gable' : 'hip'
    : ['flat', 'floating-flat', 'parapet-flat', 'pergola-terrace'].includes(generated.roofDesign)
      ? generated.roofDesign : baseRoof.kind === 'flat-parapet' ? 'parapet-flat' : 'flat'
  const dna: DesignDNA = {
    ...generated,
    roofDesign,
    featureElement: pitchedBase && generated.featureElement === 'roof-pergola' ? 'deep-chajja' : generated.featureElement,
  }
  const kind: RoofSpec['kind'] = pitchedBase
    ? roofDesign === 'gable' ? 'gable' : roofDesign === 'hip' || roofDesign === 'kerala-pitched' ? 'hip' : baseRoof.kind
    : dna.roofDesign === 'parapet-flat' || dna.roofDesign === 'pergola-terrace' ? 'flat-parapet' : 'flat'
  const floors = plan.floors.map((floor, index) => index === top
    ? { ...floor, roof: { ...floor.roof, kind } } : floor)
  return { ...plan, id: `${plan.id}-exterior-${seed}`, dna, floors }
}

export function selectExteriorDirections(plan: Design, count = 4, level: VariationLevel = 'balanced',
  inspiration?: InspirationPreferences | null):
  { design: Design; novelty: number }[] {
  const initial = plan.model.brief.variation
  const candidates = Array.from({ length: 32 }, (_, i) => varyExterior(plan, initial + i * 977 + 1, level, inspiration))
    .filter((design) => designQuality(design.dna) >= 80 && validateVillaVariation(design).valid)
  const selected: Design[] = []
  while (selected.length < count && candidates.length) {
    const unusedElements = candidates.filter((candidate) =>
      selected.every((design) => design.dna.roofGeometry.element !== candidate.dna.roofGeometry.element))
    const pool = unusedElements.length ? unusedElements : candidates
    pool.sort((a, b) => {
      const score = (d: Design) => selected.length
        ? Math.min(...selected.map((s) => noveltyScore(fingerprint(d.dna), fingerprint(s.dna)))) * 100 +
          designQuality(d.dna)
        : designQuality(d.dna)
      return score(b) - score(a) || a.dna.seed - b.dna.seed
    })
    const next = pool[0]
    candidates.splice(candidates.indexOf(next), 1)
    if (selected.length && Math.min(...selected.map((s) => noveltyScore(fingerprint(next.dna), fingerprint(s.dna)))) < (level === 'subtle' ? 3 : 25))
      continue
    selected.push(next)
  }
  return selected.map((design) => ({
    design,
    novelty: selected.length === 1 ? 100 : Math.min(...selected.filter((s) => s !== design)
      .map((s) => noveltyScore(fingerprint(design.dna), fingerprint(s.dna)))),
  }))
}

/** Generate Again examines multiple valid candidates and prefers distance from recent designs. */
export function chooseNextExterior(plan: Design, recentSeeds: number[], level: VariationLevel = 'balanced',
  inspiration?: InspirationPreferences | null): Design {
  const anchor = (recentSeeds.at(-1) ?? plan.model.brief.variation) + 1
  const history = recentSeeds.map((seed) => fingerprint(varyExterior(plan, seed, level, inspiration).dna))
  const seen = new Set(history.map((print) => JSON.stringify(print)))
  const candidates = Array.from({ length: 32 }, (_, i) => varyExterior(plan, anchor + i * 977, level, inspiration))
    .filter((d) => validateVillaVariation(d).valid)
  const fresh = candidates.filter((d) => !seen.has(JSON.stringify(fingerprint(d.dna))))
  const previousElement = recentSeeds.length
    ? varyExterior(plan, recentSeeds.at(-1)!, level, inspiration).dna.roofGeometry.element : null
  const newElements = fresh.filter((d) => d.dna.roofGeometry.element !== previousElement)
  const pool = newElements.length ? newElements : fresh.length ? fresh : candidates
  pool.sort((a, b) => {
    const score = (d: Design) => history.length
      ? Math.min(...history.map((h) => noveltyScore(fingerprint(d.dna), h))) * 100 + designQuality(d.dna)
      : designQuality(d.dna)
    return score(b) - score(a) || a.dna.seed - b.dna.seed
  })
  return pool[0] ?? varyExterior(plan, anchor, level, inspiration)
}
