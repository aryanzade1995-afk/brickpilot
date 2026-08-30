import type { MassKind } from './buildMassing.ts'
import type { GroupKey } from '@/lib/model/themes.ts'

/** which material group a massing primitive belongs to */
export type Group = GroupKey

export const GROUP_OF: Record<MassKind, Group> = {
  wall: 'shell',
  parapet: 'shell',
  column: 'shell',
  railing: 'shell',
  partition: 'partition',
  glass: 'glazing',
  slab: 'slabs',
  plinth: 'slabs',
  roof: 'roof',
  canopy: 'roof',
  stair: 'stair',
}

/** metres a wall / partition is cut down to in the cutaway (exploded) view */
export const CUTAWAY_WALL = 1.15
