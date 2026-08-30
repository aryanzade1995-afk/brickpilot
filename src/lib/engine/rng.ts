import seedrandom from 'seedrandom'

export type Rng = {
  next: () => number
  int: (min: number, max: number) => number
  pick: <T>(arr: readonly T[]) => T
  chance: (p: number) => boolean
}

export function makeRng(seed: string): Rng {
  const r = seedrandom(seed)
  return {
    next: () => r(),
    int: (min, max) => Math.floor(min + r() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(r() * arr.length)],
    chance: (p) => r() < p,
  }
}
