/** Randomness enters only at the user action; geometry remains seeded and replayable. */
export function newDesignSeed(previous?: number): number {
  const seed = globalThis.crypto.getRandomValues(new Uint32Array(1))[0]
  return seed === previous ? (seed + 1) >>> 0 : seed
}
