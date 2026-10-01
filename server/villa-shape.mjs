import { evaluateVillaFingerprint } from '../src/lib/engine/fingerprint/VillaDiversityGate.ts'

export const REALIZED_WEIGHTS = { front: .15, side: .15, roof: .25, roofFront: .225, roofSide: .225 }
export function validRealizedShape(value) {
  return [1, 2, 3].includes(value?.schemaVersion) && value.grid === 32 && Number.isSafeInteger(value.seed) &&
    typeof value.planId === 'string' && Object.keys(REALIZED_WEIGHTS).every((key) =>
      Array.isArray(value.parts?.[key]) && value.parts[key].length === 1024 &&
      value.parts[key].every((n) => n === 0 || n === 1))
}
export function realizedSimilarity(a, b) {
  if (!validRealizedShape(a) || !validRealizedShape(b)) throw new Error('Invalid evaluated Blender geometry fingerprint')
  if (a.schemaVersion !== b.schemaVersion) throw new Error('Incompatible geometry sampling frames')
  // Comparisons from different source plans use their own fixed normalized frames.
  // The roof and envelope carry most weight; unchanged occupied rooms do not
  // drown out large differences in the permitted exterior composition.
  let score = 0
  for (const [key, weight] of Object.entries(REALIZED_WEIGHTS)) {
    let overlap = 0, union = 0
    for (let i = 0; i < 1024; i++) { overlap += Math.min(a.parts[key][i], b.parts[key][i]); union += Math.max(a.parts[key][i], b.parts[key][i]) }
    score += weight * (union ? overlap / union : 1)
  }
  return score
}
export function evaluateRealizedVilla(payload, geometry, history, threshold = .75) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new RangeError('Similarity threshold must be in [0,1]')
  if (!validRealizedShape(geometry) || geometry.planId !== payload.buildingModel.planId || geometry.seed !== payload.villaDesignDNA.seed)
    throw new Error('Blender geometry does not match the requested plan and seed')
  const quota = evaluateVillaFingerprint(payload.shapeFingerprint, history.map((h) => h.fingerprint), { similarityThreshold: 1 })
  const nearest = history.filter((h) => h.geometry.schemaVersion === geometry.schemaVersion)
    .map((h) => ({ seed: h.geometry.seed, similarity: realizedSimilarity(geometry, h.geometry) }))
    .sort((a, b) => b.similarity - a.similarity || a.seed - b.seed)[0]
  const base = { ...quota, nearestPreviousSeed: nearest?.seed ?? null, similarityPercent: Number(((nearest?.similarity ?? 0) * 100).toFixed(2)) }
  if (nearest && nearest.similarity > threshold) return { ...base, accepted: false, code: 'SIMILAR_SHAPE',
    reason: `Evaluated mesh shape is ${base.similarityPercent}% similar; limit is ${threshold * 100}%.` }
  return quota.accepted ? { ...base, reason: 'Evaluated mesh similarity and rolling diversity checks passed.' } : base
}
