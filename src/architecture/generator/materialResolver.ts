/* ------------------------------------------------------------------ *
 *  materialResolver — the 9 render slots (wall / base / trim / roof /
 *  frame / accent / glass / floor / ground) as {color, roughness,
 *  metalness}. The seed may swap up to `material.seededSwaps` slots to
 *  a declared variant, so material combinations vary without ever
 *  becoming "same villa, different colour".
 * ------------------------------------------------------------------ */

import type { Rng } from '../../lib/engine/shape/rng.ts'
import type { DesignGenome, MaterialSpec, StyleGrammar } from '../types.ts'

type Slot = keyof MaterialSpec

/** the genome's material palette → hint colours for the base + accent slots */
const PALETTE_TINT: Record<string, { base?: string; accent?: string }> = {
  white_minimal: { base: '#d8d2c4', accent: '#54504a' },
  white_stone: { base: '#8f8677', accent: '#6f6553' },
  stone_white_wood: { base: '#3a3936', accent: '#8a5c34' },
  plaster_stone_base: { base: '#33322f', accent: '#7a5230' },
  concrete_wood: { base: '#8d8a83', accent: '#7c5a38' },
  laterite_white: { base: '#8a5a3c', accent: '#96683c' },
  travertine_granite: { base: '#3f3e3a', accent: '#8f7a5c' },
  brick_white: { base: '#9c5236', accent: '#8a3f2c' },
  earth_timber: { base: '#c0b49c', accent: '#7c5a38' },
}

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

export function resolveMaterials(grammar: StyleGrammar, rng: Rng, genome: DesignGenome): MaterialSpec {
  const m = grammar.material
  const tint = PALETTE_TINT[genome.materialPalette] ?? {}
  const color: Record<Slot, string> = {
    wall: m.wall,
    base: tint.base ?? m.base,
    trim: m.trim,
    roof: m.roof,
    frame: m.frame,
    accent: tint.accent ?? m.accent,
    glass: m.glassTint,
    floor: '#c9bfa8',
    ground: genome.landscape.includes('pool') || genome.landscape.includes('water') ? '#6f9bb0' : '#8fa564',
  }

  // seeded swaps — the palette-tinted slots are already committed, so only swap the rest
  const committed = new Set<Slot>([...(tint.base ? ['base' as Slot] : []), ...(tint.accent ? ['accent' as Slot] : [])])
  const swappable: Slot[] = (['wall', 'base', 'roof', 'accent'] as Slot[]).filter(
    (s) => !committed.has(s) && (m.variants?.[s as 'wall'] ?? []).length,
  )
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
