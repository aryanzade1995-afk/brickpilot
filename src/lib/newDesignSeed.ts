import type { Character } from './model/brief.ts'
import { modernSeedSchedule, nextModernSeedCursor } from './engine/modernSeedBank.ts'

const KEY = 'formstead.modern-seeds-v1'
let memory: { usedSeeds: number[]; cursor: number } = { usedSeeds: [], cursor: 0 }
/** Randomness enters only at the user action; geometry remains seeded and replayable. */
export function newDesignSeed(previous?: number, character?: Character): number {
  const seed = globalThis.crypto.getRandomValues(new Uint32Array(1))[0]
  if (character === 'modern-box') {
    try {
      const saved = globalThis.localStorage?.getItem(KEY)
      if (saved) {
        const value = JSON.parse(saved)
        if (Array.isArray(value.usedSeeds) && value.usedSeeds.every(Number.isSafeInteger) && Number.isInteger(value.cursor) && value.cursor >= 0)
          memory = value
      }
    } catch { /* The server's durable usage record remains authoritative. */ }
    const usedSeeds = [...new Set([...memory.usedSeeds, ...(previous === undefined ? [] : [previous])])]
    const chosen = modernSeedSchedule(seed, { usedSeeds, cursor: memory.cursor }, 1)[0]
    memory = { usedSeeds: [...usedSeeds, chosen], cursor: nextModernSeedCursor(chosen, memory.cursor) }
    try { globalThis.localStorage?.setItem(KEY, JSON.stringify(memory)) } catch { /* Private browsing still uses server protection. */ }
    return chosen
  }
  return seed === previous ? (seed + 1) >>> 0 : seed
}
