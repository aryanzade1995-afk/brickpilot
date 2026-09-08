/* ------------------------------------------------------------------ *
 *  materialResolver — the 9 render slots (wall / base / trim / roof /
 *  frame / accent / glass / floor / ground) as {color, roughness,
 *  metalness}. The seed may swap up to `material.seededSwaps` slots to
 *  a declared variant, so material combinations vary without ever
 *  becoming "same villa, different colour".
 * ------------------------------------------------------------------ */

import type { Rng } from '../../lib/engine/shape/rng.ts'
import type { MaterialSpec, StyleGrammar } from '../types.ts'

type Slot = keyof MaterialSpec

const FINISH: Record<Slot, { roughness: number; metalness: number }> = {
  wall: { roughness: 0.84, metalness: 0 },
  base: { roughness: 0.86, metalness: 0.02 },
  trim: { roughness: 0.62, metalness: 0 },
  roof: { roughness: 0.7, metalness: 0.04 },
  frame: { roughness: 0.36, metalness: 0.85 },
  accent: { roughness: 0.5, metalness: 0.04 },
  glass: { roughness: 0.08, metalness: 0.1 },
  floor: { roughness: 0.5, metalness: 0.02 },
  ground: { roughness: 0.96, metalness: 0 },
}

export function resolveMaterials(grammar: StyleGrammar, rng: Rng): MaterialSpec {
  const m = grammar.material
  const color: Record<Slot, string> = {
    wall: m.wall,
    base: m.base,
    trim: m.trim,
    roof: m.roof,
    frame: m.frame,
    accent: m.accent,
    glass: m.glassTint,
    floor: '#c9bfa8',
    ground: '#8fa564',
  }

  // seeded swaps
  const swappable: Slot[] = (['wall', 'base', 'roof', 'accent'] as Slot[]).filter((s) => (m.variants?.[s as 'wall'] ?? []).length)
  const n = Math.min(m.seededSwaps, swappable.length)
  const shuffled = [...swappable].sort(() => rng.next() - 0.5)
  for (let i = 0; i < n; i++) {
    const slot = shuffled[i]
    const opts = m.variants?.[slot as 'wall'] ?? []
    if (opts.length) color[slot] = rng.pick(opts)
  }

  const spec = {} as MaterialSpec
  for (const slot of Object.keys(color) as Slot[]) {
    spec[slot] = { color: color[slot], roughness: FINISH[slot].roughness, metalness: FINISH[slot].metalness }
  }
  return spec
}
