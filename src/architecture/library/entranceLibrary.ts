/* ------------------------------------------------------------------ *
 *  entranceLibrary — the catalogue of entrance treatments. Maps each
 *  type to canopy depth, double-height, porte-cochere, the entry door
 *  width band and the characteristics it imparts. `doors.py` +
 *  `facade.py` build the canopy / recess / portal.
 * ------------------------------------------------------------------ */

import type { Characteristic, EntrancePosition, EntranceType } from './architecturalVocabulary.ts'

export type EntranceEntry = {
  id: EntranceType
  label: string
  description: string
  /** projecting canopy depth, mm (0 = none / recessed) */
  canopyMm: [number, number]
  /** the entry reads as a two-storey volume */
  doubleHeight: boolean
  /** a drive-through covered entry — needs a bigger plot */
  porteCochere: boolean
  /** carved back behind the wall face */
  recessed: boolean
  entryWidthMm: [number, number]
  characteristics: Characteristic[]
}

const N = (e: EntranceEntry): EntranceEntry => e

export const ENTRANCE_LIBRARY: Record<EntranceType, EntranceEntry> = {
  centered: N({
    id: 'centered',
    label: 'Centered',
    description: 'A symmetrical door on the middle of the front face.',
    canopyMm: [600, 1000],
    doubleHeight: false,
    porteCochere: false,
    recessed: false,
    entryWidthMm: [1400, 1700],
    characteristics: ['symmetric_balance'],
  }),
  offset: N({
    id: 'offset',
    label: 'Offset',
    description: 'The door sits to one side, balancing an asymmetric composition.',
    canopyMm: [600, 1000],
    doubleHeight: false,
    porteCochere: false,
    recessed: false,
    entryWidthMm: [1400, 1800],
    characteristics: ['asymmetric_balance'],
  }),
  recessed: N({
    id: 'recessed',
    label: 'Recessed',
    description: 'The entry is pulled back into the mass, creating a sheltered threshold.',
    canopyMm: [0, 0],
    doubleHeight: false,
    porteCochere: false,
    recessed: true,
    entryWidthMm: [1500, 1900],
    characteristics: ['solid_void_play', 'deep_shadows'],
  }),
  projecting: N({
    id: 'projecting',
    label: 'Projecting',
    description: 'A porch volume steps forward from the facade.',
    canopyMm: [1400, 2200],
    doubleHeight: false,
    porteCochere: false,
    recessed: false,
    entryWidthMm: [1500, 1900],
    characteristics: ['solid_void_play', 'deep_shadows', 'sheltered_verandah'],
  }),
  double_height: N({
    id: 'double_height',
    label: 'Double-height',
    description: 'A two-storey glazed entry hall — the tallest space on the front.',
    canopyMm: [800, 1600],
    doubleHeight: true,
    porteCochere: false,
    recessed: true,
    entryWidthMm: [1700, 2200],
    characteristics: ['transparent_ground', 'solid_void_play', 'deep_shadows'],
  }),
  porch: N({
    id: 'porch',
    label: 'Porch',
    description: 'A covered open room in front of the door, on columns.',
    canopyMm: [2000, 3200],
    doubleHeight: false,
    porteCochere: false,
    recessed: false,
    entryWidthMm: [1500, 1900],
    characteristics: ['sheltered_verandah', 'deep_shadows', 'climate_responsive'],
  }),
  covered_courtyard_entry: N({
    id: 'covered_courtyard_entry',
    label: 'Covered courtyard entry',
    description: 'You pass through a roofed threshold into an open entry court.',
    canopyMm: [0, 0],
    doubleHeight: false,
    porteCochere: false,
    recessed: true,
    entryWidthMm: [1500, 1900],
    characteristics: ['courtyard_focused', 'privacy_to_street', 'deep_shadows'],
  }),
  side_entry: N({
    id: 'side_entry',
    label: 'Side entry',
    description: 'The door is on a side wall, off a path — the street face stays blank.',
    canopyMm: [600, 1200],
    doubleHeight: false,
    porteCochere: false,
    recessed: false,
    entryWidthMm: [1400, 1700],
    characteristics: ['privacy_to_street', 'asymmetric_balance'],
  }),
  framed: N({
    id: 'framed',
    label: 'Framed',
    description: 'A projecting portal frame — often stone or a contrasting material — surrounds the door.',
    canopyMm: [700, 1400],
    doubleHeight: false,
    porteCochere: false,
    recessed: true,
    entryWidthMm: [1500, 2000],
    characteristics: ['stone_as_feature', 'solid_void_play', 'deep_shadows'],
  }),
  porte_cochere: N({
    id: 'porte_cochere',
    label: 'Porte-cochère',
    description: 'A drive-through canopy you park a car under, in front of the door.',
    canopyMm: [3000, 5000],
    doubleHeight: true,
    porteCochere: true,
    recessed: false,
    entryWidthMm: [1900, 2600],
    characteristics: ['sheltered_verandah', 'deep_shadows', 'roof_as_feature'],
  }),
}

export function entranceEntry(id: EntranceType): EntranceEntry {
  return ENTRANCE_LIBRARY[id]
}

/** default entrance positions that read well with a given type */
export const ENTRANCE_TYPE_POSITIONS: Record<EntranceType, EntrancePosition[]> = {
  centered: ['center_front'],
  offset: ['left_front', 'right_front'],
  recessed: ['recessed_center', 'left_front', 'right_front'],
  projecting: ['center_front', 'left_front', 'right_front'],
  double_height: ['recessed_center', 'center_front', 'corner'],
  porch: ['center_front', 'left_front'],
  covered_courtyard_entry: ['courtyard', 'side'],
  side_entry: ['side', 'corner'],
  framed: ['center_front', 'left_front', 'right_front'],
  porte_cochere: ['center_front', 'left_front'],
}
