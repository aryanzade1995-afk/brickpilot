import type { UtilityLayer } from './plan.ts'

export type ClashRule = {
  id: string; a: UtilityLayer; b: UtilityLayer; minDistMm: number
  severity: 'high' | 'medium' | 'low'; message: string; suggestion: string
  check?: 'proximity' | 'supply-order' | 'wet-zone' | 'wall' | 'exit' | 'coverage'
  aTypes?: string[]; bTypes?: string[]; subtypes?: string[]; wetAreaOnly?: boolean
  runsOnly?: boolean; allowSharedNetwork?: boolean
}

/** Concept coordination settings, NOT statutory or engineering clearances.
 * Distances are mm, never screen pixels. Extend this list to add a check.
 * Sprinkler/electrical is intentionally a fire/electrical pair (not fire/fire).
 * No default layer heights: unknown information stays unknown. */
export const CLASH_LAYER_ELEVATIONS_MM: Partial<Record<UtilityLayer, number>> = {}
export const CLASH_COLORS = { high: '#bc4141', medium: '#c47a2b', low: '#b49524' }
export const CLASH_RULES: ClashRule[] = [
  { id: 'supply-drain', a: 'water_supply', b: 'drainage', minDistMm: 30, severity: 'high', check: 'supply-order', message: 'Supply must run above drain', suggestion: 'Review supply and drain heights and separation with the plumbing designer.' },
  { id: 'wire-water', a: 'electrical', b: 'water_supply', minDistMm: 30, wetAreaOnly: true, severity: 'high', message: 'Wire near water pipe', suggestion: 'Review separation or a protected service crossing; do not move an outlet without electrical review.' },
  { id: 'wire-drain', a: 'electrical', b: 'drainage', minDistMm: 30, wetAreaOnly: true, severity: 'medium', message: 'Wire near drain', suggestion: 'Review wire and drain heights, separation and protection in the wet area.' },
  { id: 'hot-cold', a: 'water_supply', b: 'water_supply', subtypes: ['hot', 'cold'], minDistMm: 20, severity: 'low', message: 'Hot/cold too close', suggestion: 'Review separate pipe positions and insulation with the plumbing designer.' },
  { id: 'fire-power', a: 'fire_alarm', b: 'electrical', runsOnly: true, minDistMm: 15, severity: 'low', message: 'Fire cable near power cable', suggestion: 'Review cable separation and containment with the electrical and fire designers.' },
  { id: 'sprinkler-power', a: 'fire_alarm', b: 'electrical', aTypes: ['sprinkler'], minDistMm: 30, severity: 'medium', message: 'Sprinkler near electrical', suggestion: 'Review the sprinkler and electrical equipment positions together.' },
  { id: 'drain-crossing', a: 'drainage', b: 'drainage', runsOnly: true, minDistMm: 0, severity: 'high', message: 'Drain routes overlap', suggestion: 'Check whether this is an intended junction; otherwise review pipe levels or a sleeve.' },
  { id: 'power-crossing', a: 'electrical', b: 'electrical', runsOnly: true, allowSharedNetwork: true, minDistMm: 0, severity: 'medium', message: 'Electrical routes overlap', suggestion: 'Review circuit containment and crossing protection.' },
  { id: 'water-crossing', a: 'water_supply', b: 'water_supply', runsOnly: true, allowSharedNetwork: true, minDistMm: 0, severity: 'medium', message: 'Water routes overlap', suggestion: 'Check whether the connection is intentional or requires separate levels.' },
  { id: 'fire-crossing', a: 'fire_alarm', b: 'fire_alarm', runsOnly: true, allowSharedNetwork: true, minDistMm: 0, severity: 'low', message: 'Fire routes overlap', suggestion: 'Review the alarm-loop crossing and containment.' },
  { id: 'fire-drain', a: 'fire_alarm', b: 'drainage', runsOnly: true, minDistMm: 0, severity: 'medium', message: 'Fire cable and drain overlap', suggestion: 'Verify heights and protected separation at the crossing.' },
  { id: 'fire-water', a: 'fire_alarm', b: 'water_supply', runsOnly: true, minDistMm: 0, severity: 'medium', message: 'Fire cable and supply overlap', suggestion: 'Verify heights and protected separation at the crossing.' },
  { id: 'wet-electrical', a: 'electrical', b: 'water_supply', aTypes: ['socket', 'switch', 'db_panel'], bTypes: ['water_outlet'], minDistMm: 600, wetAreaOnly: true, severity: 'high', check: 'wet-zone', message: 'Electrical point near a wet fixture', suggestion: 'Have an electrician verify wet-area zoning, equipment protection and the fixture position.' },
  { id: 'service-wall', a: 'electrical', b: 'electrical', minDistMm: 0, severity: 'medium', check: 'wall', message: 'Service passes through a solid wall', suggestion: 'Review a sleeve or protected penetration at the marked wall. No route has been changed.' },
  { id: 'exit-wall', a: 'fire_alarm', b: 'fire_alarm', minDistMm: 0, severity: 'high', check: 'exit', message: 'Exit route needs review', suggestion: 'Review a continuous route through represented doors and the stair discharge for upper floors.' },
  { id: 'coverage', a: 'fire_alarm', b: 'fire_alarm', minDistMm: 0, severity: 'medium', check: 'coverage', message: 'Detector coverage needs review', suggestion: 'Review detector placement and room coverage with the fire designer; the displayed radii are concept assumptions.' },
]
