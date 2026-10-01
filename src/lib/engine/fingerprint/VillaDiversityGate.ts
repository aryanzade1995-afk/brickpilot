import { makeRng } from '../massing/rng.ts'
import { fingerprintRecord, parseFingerprintHistory, villaShapeSimilarity,
  type ShapeFingerprintRecord, type VillaShapeFingerprint } from './VillaShapeFingerprint.ts'

export type VillaDiversityLimits = {
  similarityThreshold: number; recentLimit: number; windowSize: number
  maxSameMassingFamily: number; maxSameHero: number; maxSameFacadeFamily: number; maxSameRoofline: number
  maxAttempts: number
}
export const DEFAULT_DIVERSITY_LIMITS: VillaDiversityLimits = {
  similarityThreshold: 0.75, recentLimit: 50, windowSize: 10,
  maxSameMassingFamily: 2, maxSameHero: 2, maxSameFacadeFamily: 2, maxSameRoofline: 3, maxAttempts: 32,
}
export type FingerprintDebug = {
  seed: number; family: string; nearestPreviousSeed: number | null; similarityPercent: number
  accepted: boolean; reason: string; code: 'ACCEPTED' | 'SIMILAR_SHAPE' | 'DIVERSITY_LIMIT' | 'INVALID_ARCHITECTURE'
}
export function diversityLimits(options: Partial<VillaDiversityLimits> = {}): VillaDiversityLimits {
  for (const key of Object.keys(options)) if (!Object.hasOwn(DEFAULT_DIVERSITY_LIMITS, key))
    throw new RangeError(`Unknown diversity limit: ${key}`)
  const limits = { ...DEFAULT_DIVERSITY_LIMITS, ...options }
  if (!Number.isFinite(limits.similarityThreshold) || limits.similarityThreshold < 0 || limits.similarityThreshold > 1)
    throw new RangeError('similarityThreshold must be in [0,1]')
  for (const [key, value] of Object.entries(limits)) if (key !== 'similarityThreshold' &&
    (!Number.isInteger(value) || value < 1 || value > 1000)) throw new RangeError(`${key} must be an integer from 1 to 1000`)
  if (limits.recentLimit < limits.windowSize) throw new RangeError('recentLimit must retain the entire diversity window')
  return limits
}

export function evaluateVillaFingerprint(fingerprint: VillaShapeFingerprint, recent: ShapeFingerprintRecord[],
  options: Partial<VillaDiversityLimits> = {}, references: ShapeFingerprintRecord[] = []): FingerprintDebug {
  const limits = diversityLimits(options)
  if (parseFingerprintHistory([fingerprint], 1).length !== 1) throw new Error('Invalid candidate shape fingerprint')
  const history = parseFingerprintHistory(recent, limits.recentLimit)
  const comparisons = [...history, ...parseFingerprintHistory(references, limits.recentLimit)]
  // Validate a candidate even when history is empty.
  villaShapeSimilarity(fingerprint, fingerprint)
  const nearest = comparisons.map((f) => ({ seed: f.seed, similarity: villaShapeSimilarity(fingerprint, f) }))
    .sort((a, b) => b.similarity - a.similarity || a.seed - b.seed)[0]
  const base = { seed: fingerprint.seed, family: fingerprint.massingFamily,
    nearestPreviousSeed: nearest?.seed ?? null, similarityPercent: Number(((nearest?.similarity ?? 0) * 100).toFixed(2)) }
  // The candidate becomes the tenth record. The oldest previous record drops
  // out before checking quotas, allowing families to return after their window.
  const window = limits.windowSize === 1 ? [] : history.slice(-(limits.windowSize - 1))
  const rules = [
    ['massingFamily', limits.maxSameMassingFamily], ['heroFeature', limits.maxSameHero],
    ['facadeFamily', limits.maxSameFacadeFamily], ['rooflineType', limits.maxSameRoofline],
  ] as const
  const exceeded = rules.flatMap(([key, max]) => {
    const counts = new Map<string, number>()
    for (const item of [...window, fingerprint]) counts.set(item[key], (counts.get(item[key]) ?? 0) + 1)
    return [...counts].filter(([, count]) => count > max).map(([value]) => ({ key, max, value }))
  })
  if (nearest && nearest.similarity > limits.similarityThreshold) return { ...base, accepted: false, code: 'SIMILAR_SHAPE',
    reason: `Shape similarity ${base.similarityPercent}% exceeds ${limits.similarityThreshold * 100}%${exceeded.length ? `; diversity limit: ${exceeded.map(({ key }) => key).join(', ')}` : ''}.` }
  if (exceeded.length) return { ...base, accepted: false, code: 'DIVERSITY_LIMIT',
    reason: exceeded.map(({ key, max, value }) => `${key}=${value} exceeds ${max} in the last ${limits.windowSize} villas`).join('; ') }
  return { ...base, accepted: true, code: 'ACCEPTED', reason: 'Shape and rolling diversity checks passed.' }
}

export function formatFingerprintDebug(debug: FingerprintDebug): string {
  return `[VillaShapeFingerprint] seed=${debug.seed} family=${debug.family} nearestPreviousSeed=${debug.nearestPreviousSeed ?? 'none'} similarity=${debug.similarityPercent.toFixed(2)}% ${debug.accepted ? 'ACCEPTED' : 'REJECTED'} reason=${debug.reason}`
}

export type DistinctVillaResult<T> = {
  accepted: { candidate: T; fingerprint: VillaShapeFingerprint } | null
  history: ShapeFingerprintRecord[]; debug: FingerprintDebug[]
}
/** No unseeded randomness, no relaxed fallback. Callers commit history only
 * after accepting the returned architecture. Replaying a saved seed is separate. */
export function selectDistinctVilla<T>(seed: number, recent: ShapeFingerprintRecord[],
  createCandidate: (seed: number) => { candidate: T; fingerprint: VillaShapeFingerprint },
  options: Partial<VillaDiversityLimits> = {}, onAttempt?: (debug: FingerprintDebug) => void,
  references: ShapeFingerprintRecord[] = []): DistinctVillaResult<T> {
  if (!Number.isSafeInteger(seed)) throw new RangeError('Villa seed must be a safe integer')
  const limits = diversityLimits(options), history = parseFingerprintHistory(recent, limits.recentLimit)
  const rng = makeRng(seed, 'villa-shape-retry-v1'), seen = new Set<number>(), debug: FingerprintDebug[] = []
  let nextSeed = seed
  for (let attempt = 0; attempt < limits.maxAttempts; attempt++) {
    seen.add(nextSeed)
    let item: ReturnType<typeof createCandidate> | null = null, decision: FingerprintDebug
    try {
      item = createCandidate(nextSeed)
      if (item.fingerprint.seed !== nextSeed) throw new Error('Candidate returned the wrong seed')
      decision = evaluateVillaFingerprint(item.fingerprint, history, limits, references)
    } catch (error) {
      decision = { seed: nextSeed, family: 'unknown', nearestPreviousSeed: null, similarityPercent: 0,
        accepted: false, code: 'INVALID_ARCHITECTURE', reason: error instanceof Error ? error.message : 'Architecture failed validation.' }
    }
    debug.push(decision); onAttempt?.(decision)
    if (decision.accepted && item) return { accepted: item,
      history: [...history, fingerprintRecord(item.fingerprint)].slice(-limits.recentLimit), debug }
    do { nextSeed = rng.int(0, 0xffffffff) } while (seen.has(nextSeed))
  }
  return { accepted: null, history, debug }
}
