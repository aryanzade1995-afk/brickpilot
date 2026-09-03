import type { MassKind } from './buildMassing.ts'
import type { GroupKey } from '@/lib/model/themes.ts'

/** which material group a massing primitive belongs to */
export type Group = GroupKey

export const GROUP_OF: Record<MassKind, Group> = {
  wall: 'shell',
  parapet: 'shell',
  column: 'shell',
  mumty: 'shell',
  fence: 'shell',
  railing: 'metal',
  tank: 'metal',
  partition: 'partition',
  glass: 'glazing',
  slab: 'slabs',
  plinth: 'slabs',
  roof: 'roof',
  prism: 'roof',
  canopy: 'roof',
  shade: 'roof',
  band: 'roof',
  stair: 'stair',
  clad: 'clad',
  screen: 'clad',
  feature: 'feature',
  lawn: 'garden',
  paving: 'paving',
  planter: 'greenery',
  hedge: 'greenery',
}

/** primitives that stay fully visible in the cutaway / exploded view */
export const SITE_KINDS = new Set<MassKind>(['lawn', 'paving', 'planter', 'hedge', 'fence'])

/** metres a wall / partition is cut down to in the cutaway (exploded) view */
export const CUTAWAY_WALL = 1.4
