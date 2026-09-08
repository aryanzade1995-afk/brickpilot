/* ------------------------------------------------------------------ *
 *  balconyLibrary — the catalogue of balcony / verandah types.
 *  `balconyResolver.ts` / `balconies.py` place them from real exterior
 *  room walls on upper floors; this library maps each type to depth,
 *  rail style, the room classes it suits and its characteristics.
 *  "Do not randomly attach balconies" — a genome picks ONE type and
 *  the resolver only realises it where a wall actually supports it.
 * ------------------------------------------------------------------ */

import type { BalconyType, Characteristic } from './architecturalVocabulary.ts'
import type { RoomClass } from '../types.ts'

export type BalconyEntry = {
  id: BalconyType
  label: string
  description: string
  depthMm: [number, number]
  rail: 'bar' | 'baluster' | 'glass'
  /** room classes that get this balcony on an upper floor */
  rooms: RoomClass[]
  maxPerFloor: number
  /** carved into the mass (true) vs. projecting (false) */
  recessed: boolean
  /** needs an upper storey */
  upperOnly: boolean
  characteristics: Characteristic[]
}

const B = (e: BalconyEntry): BalconyEntry => e

export const BALCONY_LIBRARY: Record<BalconyType, BalconyEntry> = {
  none: B({
    id: 'none',
    label: 'No balcony',
    description: 'The upper floor presents a clean face — no projecting slabs.',
    depthMm: [0, 0],
    rail: 'bar',
    rooms: [],
    maxPerFloor: 0,
    recessed: false,
    upperOnly: true,
    characteristics: ['minimal_detailing', 'monolithic'],
  }),
  cantilever: B({
    id: 'cantilever',
    label: 'Cantilever balcony',
    description: 'A slab projecting past the wall on exposed structure.',
    depthMm: [1400, 2000],
    rail: 'glass',
    rooms: ['master', 'bedroom', 'living'],
    maxPerFloor: 2,
    recessed: false,
    upperOnly: true,
    characteristics: ['cantilever', 'deep_shadows', 'strong_horizontal_lines'],
  }),
  recessed: B({
    id: 'recessed',
    label: 'Recessed balcony',
    description: 'A void carved into the volume — the rail sits behind the wall face.',
    depthMm: [1300, 1800],
    rail: 'bar',
    rooms: ['master', 'bedroom'],
    maxPerFloor: 2,
    recessed: true,
    upperOnly: true,
    characteristics: ['solid_void_play', 'deep_shadows', 'privacy_to_street'],
  }),
  corner: B({
    id: 'corner',
    label: 'Corner balcony',
    description: 'Wraps an external corner, open on two sides.',
    depthMm: [1500, 2100],
    rail: 'glass',
    rooms: ['master', 'living'],
    maxPerFloor: 1,
    recessed: false,
    upperOnly: true,
    characteristics: ['asymmetric_balance', 'solid_void_play', 'deep_shadows'],
  }),
  corner_cantilever: B({
    id: 'corner_cantilever',
    label: 'Corner cantilever',
    description: 'A corner balcony projecting past both walls with no visible support.',
    depthMm: [1600, 2200],
    rail: 'glass',
    rooms: ['master', 'living'],
    maxPerFloor: 1,
    recessed: false,
    upperOnly: true,
    characteristics: ['cantilever', 'floating_volume', 'asymmetric_balance', 'deep_shadows'],
  }),
  full_width: B({
    id: 'full_width',
    label: 'Full-width balcony',
    description: 'Runs the entire width of the upper front — a horizontal band.',
    depthMm: [1400, 1900],
    rail: 'bar',
    rooms: ['master', 'bedroom', 'living'],
    maxPerFloor: 1,
    recessed: false,
    upperOnly: true,
    characteristics: ['strong_horizontal_lines', 'deep_shadows'],
  }),
  partial_width: B({
    id: 'partial_width',
    label: 'Partial-width balcony',
    description: 'Serves one room only — a modest projecting slab.',
    depthMm: [1200, 1600],
    rail: 'bar',
    rooms: ['master', 'bedroom'],
    maxPerFloor: 2,
    recessed: false,
    upperOnly: true,
    characteristics: ['minimal_detailing'],
  }),
  juliet: B({
    id: 'juliet',
    label: 'Juliet balcony',
    description: 'A guardrail at a full-height opening — no usable slab.',
    depthMm: [120, 300],
    rail: 'glass',
    rooms: ['bedroom', 'study', 'stair'],
    maxPerFloor: 3,
    recessed: false,
    upperOnly: true,
    characteristics: ['minimal_detailing', 'privacy_to_street'],
  }),
  terrace_balcony: B({
    id: 'terrace_balcony',
    label: 'Terrace balcony',
    description: 'An upper-floor room opens onto the exposed roof of the storey below.',
    depthMm: [2400, 4000],
    rail: 'baluster',
    rooms: ['master', 'living', 'study'],
    maxPerFloor: 1,
    recessed: false,
    upperOnly: true,
    characteristics: ['roof_as_feature', 'climate_responsive', 'strong_horizontal_lines'],
  }),
  planted_balcony: B({
    id: 'planted_balcony',
    label: 'Planted balcony',
    description: 'A deep balcony with an integrated planter edge.',
    depthMm: [1600, 2200],
    rail: 'baluster',
    rooms: ['master', 'living'],
    maxPerFloor: 2,
    recessed: false,
    upperOnly: true,
    characteristics: ['climate_responsive', 'tropical_shading', 'deep_shadows'],
  }),
  continuous: B({
    id: 'continuous',
    label: 'Continuous balcony',
    description: 'One slab links several rooms along a facade.',
    depthMm: [1400, 1800],
    rail: 'bar',
    rooms: ['master', 'bedroom'],
    maxPerFloor: 1,
    recessed: false,
    upperOnly: true,
    characteristics: ['strong_horizontal_lines', 'sheltered_verandah'],
  }),
  wrap_verandah: B({
    id: 'wrap_verandah',
    label: 'Wrap verandah',
    description: 'A deep covered verandah on columns wrapping the ground (and sometimes upper) floor.',
    depthMm: [1900, 2800],
    rail: 'baluster',
    rooms: ['living', 'master', 'dining'],
    maxPerFloor: 1,
    recessed: false,
    upperOnly: false,
    characteristics: ['sheltered_verandah', 'tropical_shading', 'climate_responsive', 'deep_shadows'],
  }),
}

export function balconyEntry(id: BalconyType): BalconyEntry {
  return BALCONY_LIBRARY[id]
}
