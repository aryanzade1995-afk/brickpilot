import type { Zone } from '../model/canonical.ts'
import type { RoomKind } from '../engine/planner/types.ts'

/* ------------------------------------------------------------------ *
 *  The eight editable room types (plus the two the optimizer can leave
 *  behind) and the constraints each one carries: minimum size,
 *  ventilation, doors / windows, plumbing and which floor suits it.
 *  A room stores a copy of its constraints, so a saved design keeps
 *  the rules it was edited under.
 * ------------------------------------------------------------------ */

export type RoomType = 'bedroom' | 'living' | 'kitchen' | 'washroom' | 'puja' | 'dining' | 'study' | 'store' | 'open' | 'vacant'

/** what a person can add from the toolbar */
export const ADDABLE_TYPES: RoomType[] = ['bedroom', 'living', 'kitchen', 'washroom', 'puja', 'dining', 'study', 'store']

export type Ventilation = 'window' | 'ventilator' | 'none'
export type FloorRule = 'any' | 'ground' | 'upper'

export type RoomConstraints = {
  minSqm: number
  targetSqm: number
  maxSqm: number
  /** shortest clear side, mm */
  minWidthMm: number
  /** how air and light arrive: a proper window, a small ventilator, or nothing */
  ventilation: Ventilation
  /** how many doors the room needs (never fewer than one for an enclosed room) */
  doors: number
  windows: 'required' | 'optional' | 'none'
  plumbing: boolean
  /** a hard rule is reported as an error, a soft one as a note */
  floor: FloorRule
  floorHard: boolean
}

export type TypeSpec = RoomConstraints & {
  type: RoomType
  label: string
  plural: string
  kind: RoomKind
  zone: Zone
  /** prefix for the programme id of a room added of this type */
  idPrefix: string
  /** the id of the first one, when the planner already uses a fixed id for it */
  singleId?: string
  note: string
}

export const TYPE_SPEC: Record<RoomType, TypeSpec> = {
  bedroom: { type: 'bedroom', label: 'Bedroom', plural: 'Bedrooms', kind: 'bed', zone: 'private', idPrefix: 'bed',
    minSqm: 9, targetSqm: 12.5, maxSqm: 19, minWidthMm: 2700, ventilation: 'window', doors: 1, windows: 'required', plumbing: false, floor: 'any', floorHard: false,
    note: 'Needs a window on an outside wall and a door from circulation. 9 m² at least.' },
  living: { type: 'living', label: 'Living', plural: 'Living rooms', kind: 'lounge', zone: 'social', idPrefix: 'familyLounge', singleId: 'living',
    minSqm: 12, targetSqm: 20, maxSqm: 34, minWidthMm: 3000, ventilation: 'window', doors: 1, windows: 'required', plumbing: false, floor: 'any', floorHard: false,
    note: 'A large, well-lit room opening to the hall.' },
  kitchen: { type: 'kitchen', label: 'Kitchen', plural: 'Kitchens', kind: 'kitchen', zone: 'service', idPrefix: 'kitchen', singleId: 'kitchen',
    minSqm: 7, targetSqm: 11, maxSqm: 18, minWidthMm: 2400, ventilation: 'window', doors: 1, windows: 'required', plumbing: true, floor: 'ground', floorHard: false,
    note: 'Needs plumbing, an outside wall for the chimney and window, and sits best on the ground floor beside dining.' },
  washroom: { type: 'washroom', label: 'Washroom', plural: 'Washrooms', kind: 'bath', zone: 'service', idPrefix: 'sharedBath',
    minSqm: 2.8, targetSqm: 4.5, maxSqm: 7, minWidthMm: 1500, ventilation: 'ventilator', doors: 1, windows: 'required', plumbing: true, floor: 'any', floorHard: false,
    note: 'Needs plumbing and a ventilator on an outside wall. Stacks best over another wet room.' },
  puja: { type: 'puja', label: 'Puja', plural: 'Puja rooms', kind: 'pooja', zone: 'sacred', idPrefix: 'pooja', singleId: 'pooja',
    minSqm: 1.5, targetSqm: 3.5, maxSqm: 7, minWidthMm: 1200, ventilation: 'none', doors: 1, windows: 'optional', plumbing: false, floor: 'ground', floorHard: false,
    note: 'A quiet corner, best on the ground floor and away from the kitchen and washrooms.' },
  dining: { type: 'dining', label: 'Dining', plural: 'Dining rooms', kind: 'dining', zone: 'social', idPrefix: 'dining', singleId: 'dining',
    minSqm: 9, targetSqm: 14, maxSqm: 22, minWidthMm: 2700, ventilation: 'window', doors: 1, windows: 'required', plumbing: false, floor: 'ground', floorHard: false,
    note: 'Sits beside the kitchen and the living room.' },
  study: { type: 'study', label: 'Study', plural: 'Studies', kind: 'study', zone: 'work', idPrefix: 'study',
    minSqm: 6, targetSqm: 10, maxSqm: 16, minWidthMm: 2400, ventilation: 'window', doors: 1, windows: 'required', plumbing: false, floor: 'any', floorHard: false,
    note: 'A quiet room with daylight.' },
  store: { type: 'store', label: 'Store', plural: 'Stores', kind: 'utility', zone: 'service', idPrefix: 'store',
    minSqm: 2, targetSqm: 4, maxSqm: 10, minWidthMm: 1200, ventilation: 'none', doors: 1, windows: 'optional', plumbing: false, floor: 'any', floorHard: false,
    note: 'Storage. A window is optional; one door is enough.' },
  open: { type: 'open', label: 'Open space', plural: 'Open spaces', kind: 'lounge', zone: 'circulation', idPrefix: 'openArea',
    minSqm: 4, targetSqm: 10, maxSqm: 40, minWidthMm: 1500, ventilation: 'none', doors: 1, windows: 'optional', plumbing: false, floor: 'any', floorHard: false,
    note: 'An open, unwalled-off area: a sit-out, reading nook or extra circulation.' },
  vacant: { type: 'vacant', label: 'Vacant', plural: 'Vacant spaces', kind: 'lounge', zone: 'circulation', idPrefix: 'vacant',
    minSqm: 0, targetSqm: 0, maxSqm: 999, minWidthMm: 0, ventilation: 'none', doors: 1, windows: 'optional', plumbing: false, floor: 'any', floorHard: false,
    note: 'Space with no use yet. It stays enclosed and can be filled later.' },
}

export const constraintsOf = (type: RoomType): RoomConstraints => {
  const { type: _t, label: _l, plural: _p, kind: _k, zone: _z, idPrefix: _i, singleId: _s, note: _n, ...c } = TYPE_SPEC[type]
  void _t; void _l; void _p; void _k; void _z; void _i; void _s; void _n
  return c
}

/** the editor type of a planner room, from its kind (a utility becomes a store) */
export function typeOfKind(kind: RoomKind, id: string): RoomType | 'fixed' {
  switch (kind) {
    case 'bed': return 'bedroom'
    case 'living': case 'livingDining': case 'lounge': return id.startsWith('openArea') ? 'open' : id.startsWith('vacant') ? 'vacant' : 'living'
    case 'dining': return 'dining'
    case 'kitchen': return 'kitchen'
    case 'bath': case 'ensuite': return 'washroom'
    case 'pooja': return 'puja'
    case 'study': return 'study'
    case 'utility': return 'store'
    default: return 'fixed'
  }
}

/** rooms that make up the building's structure of circulation and are never moved, resized or deleted */
export const FIXED_KINDS: RoomKind[] = ['foyer', 'stair', 'lift', 'corridor', 'lobby']
