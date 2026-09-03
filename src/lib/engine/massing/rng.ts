/* Deterministic PRNG for the massing grammar. A seed + the brief string fully
 * determine the house, so a run is bit-for-bit reproducible. */

/** FNV-1a → uint32 */
export function fnv(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export type Rng = {
  /** float in [0, 1) */
  next: () => number
  /** float in [lo, hi) */
  range: (lo: number, hi: number) => number
  /** integer in [lo, hi] */
  int: (lo: number, hi: number) => number
  /** true with probability p */
  chance: (p: number) => boolean
  /** uniform pick */
  pick: <T>(xs: readonly T[]) => T
  /** weighted pick — weights need not sum to 1 */
  weighted: <T>(entries: readonly [T, number][]) => T
  /** -1 or +1 */
  sign: () => 1 | -1
}

export function makeRng(seed: number, salt = ''): Rng {
  let a = (fnv(`${seed}|${salt}`) ^ 0x9e3779b9) >>> 0
  const next = () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const range = (lo: number, hi: number) => lo + (hi - lo) * next()
  const int = (lo: number, hi: number) => Math.floor(lo + (hi - lo + 1) * next())
  const chance = (p: number) => next() < p
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]
  const weighted = <T>(entries: readonly [T, number][]): T => {
    const total = entries.reduce((s, [, w]) => s + Math.max(0, w), 0)
    let r = next() * total
    for (const [v, w] of entries) {
      r -= Math.max(0, w)
      if (r <= 0) return v
    }
    return entries[entries.length - 1][0]
  }
  const sign = () => (next() < 0.5 ? -1 : 1) as 1 | -1
  return { next, range, int, chance, pick, weighted, sign }
}
