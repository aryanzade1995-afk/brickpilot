/* ------------------------------------------------------------------ *
 *  fingerprint — the architectural signature used for deduplication
 *  and the diversity metric (§9, §18).
 *
 *  Two designs are "the same" if their massing + floor strategy +
 *  roof + entrance + balcony + facade + courtyard read alike — NOT if
 *  they merely share a plot size, colour or window count. The
 *  fingerprint captures exactly those axes; `fingerprintSimilarity()`
 *  scores a pair 0..1 and `areTooSimilar()` is the dedup gate.
 * ------------------------------------------------------------------ */

import type { ArchitecturalFingerprint, DesignGenome } from '../types.ts'

/** FNV-1a → 12 lowercase hex chars — stable, dependency-free */
export function stableHash(s: string): string {
  let h = 0x811c9dc5 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  // mix a second round for a longer digest
  let h2 = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0
  h2 = Math.imul(h2 ^ (h2 >>> 13), 0x297a2d39) >>> 0
  return (h.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 12)
}

export function architecturalFingerprint(g: DesignGenome, floors: number): ArchitecturalFingerprint {
  const massing = `${g.massingComposition}_${g.planFigure}`
  const floorsAxis = `${floors}f_${g.upperFloorStrategy}`
  const roof = g.roof
  const entrance = `${g.entrance}_${g.doubleHeightEntrance ? 'dh' : 'sh'}`
  const balcony = `${g.balcony}_${g.balconyPosition}`
  const facade = `${g.facadeComposition}_${g.screen}_${g.materialPalette}`
  const courtyard = g.courtyard
  const hash = stableHash([massing, floorsAxis, roof, entrance, balcony, facade, courtyard].join('|'))
  return { massing, floors: floorsAxis, roof, entrance, balcony, facade, courtyard, hash }
}

/* ---- similarity ------------------------------------------------- */

/** per-axis weights — massing + floor strategy dominate the reading */
const AXIS_WEIGHT: Record<keyof Omit<ArchitecturalFingerprint, 'hash'>, number> = {
  massing: 0.3,
  floors: 0.16,
  roof: 0.16,
  entrance: 0.1,
  balcony: 0.12,
  facade: 0.12,
  courtyard: 0.04,
}

/** compare two `a_b_c` axis strings token-wise → 0..1 */
function axisScore(a: string, b: string): number {
  if (a === b) return 1
  const ta = a.split('_')
  const tb = b.split('_')
  const n = Math.max(ta.length, tb.length)
  let same = 0
  for (let i = 0; i < n; i++) if (ta[i] && ta[i] === tb[i]) same++
  return same / n
}

/** 0 (totally different) .. 1 (identical architecture) */
export function fingerprintSimilarity(a: ArchitecturalFingerprint, b: ArchitecturalFingerprint): number {
  if (a.hash === b.hash) return 1
  let s = 0
  for (const axis of Object.keys(AXIS_WEIGHT) as (keyof typeof AXIS_WEIGHT)[]) {
    s += AXIS_WEIGHT[axis] * axisScore(a[axis], b[axis])
  }
  return +s.toFixed(4)
}

/** the dedup gate — default 0.86 means "near-identical massing + roof + facade" */
export function areTooSimilar(a: ArchitecturalFingerprint, b: ArchitecturalFingerprint, threshold = 0.86): boolean {
  return fingerprintSimilarity(a, b) >= threshold
}

/** count of substantially-distinct fingerprints in a set (§18: target ≥40/50) */
export function distinctCount(fps: ArchitecturalFingerprint[], threshold = 0.86): number {
  const kept: ArchitecturalFingerprint[] = []
  for (const fp of fps) {
    if (!kept.some((k) => areTooSimilar(k, fp, threshold))) kept.push(fp)
  }
  return kept.length
}

/** the mean pairwise similarity of a set — lower is more varied */
export function meanPairwiseSimilarity(fps: ArchitecturalFingerprint[]): number {
  if (fps.length < 2) return 0
  let sum = 0
  let pairs = 0
  for (let i = 0; i < fps.length; i++) {
    for (let j = i + 1; j < fps.length; j++) {
      sum += fingerprintSimilarity(fps[i], fps[j])
      pairs++
    }
  }
  return +(sum / pairs).toFixed(4)
}
