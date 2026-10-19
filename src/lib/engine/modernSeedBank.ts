import catalogue from './data/modern-seed-bank.json' with { type: 'json' }
import { makeRng } from './massing/rng.ts'

export const MODERN_SEED_CATALOGUE = catalogue
export const MODERN_SEEDS = catalogue.entries.map(entry => entry.seed)
const bank = new Set(MODERN_SEEDS)
export type ModernSeedUsage = { usedSeeds: number[]; cursor: number }

/** Never wrap into used catalogue entries. Beyond the bank, continue with fresh
 * numeric seeds; the production pipeline still validates their geometry. */
export function modernSeedSchedule(requested: number, usage: ModernSeedUsage, count = 32): number[] {
  if (!Number.isSafeInteger(requested) || !Number.isInteger(count) || count < 1 || count > 1000)
    throw new RangeError('A safe numeric seed and 1–1000 candidates are required')
  const used = new Set(usage.usedSeeds), result: number[] = []
  const add = (seed: number) => { if (!used.has(seed)) { result.push(seed); used.add(seed) } }
  if (bank.has(requested)) add(requested)
  const start = ((usage.cursor % MODERN_SEEDS.length) + MODERN_SEEDS.length) % MODERN_SEEDS.length
  for (let i = 0; i < MODERN_SEEDS.length && result.length < count; i++) add(MODERN_SEEDS[(start + i) % MODERN_SEEDS.length])
  const rng = makeRng(requested, 'modern-seed-bank-overflow-v1')
  while (result.length < count) {
    const seed = rng.int(0, 0xffffffff)
    if (!bank.has(seed)) add(seed)
  }
  return result.slice(0, count)
}

export function nextModernSeedCursor(seed: number, previous: number): number {
  const at = MODERN_SEEDS.indexOf(seed)
  return at < 0 ? previous : (at + 1) % MODERN_SEEDS.length
}
