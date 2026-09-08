/* ------------------------------------------------------------------ *
 *  courtyardLibrary — courtyard types + parking integration +
 *  landscape strategies. The engine already carves a `courtyard` rect
 *  for the courtyard / u-shape figures; this library says what the
 *  court is FOR (light, pool, garden, entry) and what belongs with it.
 * ------------------------------------------------------------------ */

import type {
  Characteristic,
  CourtyardType,
  LandscapeStrategy,
  ParkingIntegration,
  PlanFigure,
} from './architecturalVocabulary.ts'

export type CourtyardEntry = {
  id: CourtyardType
  label: string
  description: string
  /** plan figures that can host it */
  figures: PlanFigure[]
  /** minimum short-side dimension for the court, mm */
  minDimMm: number
  /** the court is open to sky */
  openToSky: boolean
  characteristics: Characteristic[]
}

const C = (e: CourtyardEntry): CourtyardEntry => e

export const COURTYARD_LIBRARY: Record<CourtyardType, CourtyardEntry> = {
  none: C({ id: 'none', label: 'No courtyard', description: 'A solid footprint — no internal void.', figures: ['rectangular', 'square', 'l_shape', 't_shape', 'linear', 'split'], minDimMm: 0, openToSky: false, characteristics: [] }),
  central: C({
    id: 'central',
    label: 'Central courtyard',
    description: 'An open court at the heart of the plan — every wing looks onto it.',
    figures: ['courtyard', 'h_shape'],
    minDimMm: 3000,
    openToSky: true,
    characteristics: ['courtyard_focused', 'climate_responsive', 'privacy_to_street', 'sheltered_verandah'],
  }),
  side: C({
    id: 'side',
    label: 'Side courtyard',
    description: 'A court in the crook of an L or beside the main mass.',
    figures: ['l_shape', 't_shape', 'u_shape'],
    minDimMm: 2800,
    openToSky: true,
    characteristics: ['courtyard_focused', 'climate_responsive', 'solid_void_play'],
  }),
  rear: C({
    id: 'rear',
    label: 'Rear courtyard',
    description: 'A private court behind the house, off the living / master.',
    figures: ['rectangular', 'l_shape', 'u_shape', 't_shape'],
    minDimMm: 3000,
    openToSky: true,
    characteristics: ['privacy_to_street', 'climate_responsive', 'courtyard_focused'],
  }),
  entrance_courtyard: C({
    id: 'entrance_courtyard',
    label: 'Entrance courtyard',
    description: 'You arrive into a walled forecourt before reaching the door.',
    figures: ['l_shape', 'u_shape', 'courtyard', 't_shape'],
    minDimMm: 3200,
    openToSky: true,
    characteristics: ['courtyard_focused', 'privacy_to_street', 'deep_shadows'],
  }),
  pool_courtyard: C({
    id: 'pool_courtyard',
    label: 'Pool courtyard',
    description: 'The court holds a pool or water body — the social rooms wrap it.',
    figures: ['u_shape', 'l_shape', 'courtyard', 'h_shape'],
    minDimMm: 4500,
    openToSky: true,
    characteristics: ['courtyard_focused', 'climate_responsive', 'roof_as_feature'],
  }),
  garden_courtyard: C({
    id: 'garden_courtyard',
    label: 'Garden courtyard',
    description: 'A planted court — a tree, ground cover, a sitting edge.',
    figures: ['courtyard', 'u_shape', 'l_shape', 'h_shape'],
    minDimMm: 3000,
    openToSky: true,
    characteristics: ['courtyard_focused', 'climate_responsive'],
  }),
  double_height_courtyard: C({
    id: 'double_height_courtyard',
    label: 'Double-height courtyard',
    description: 'A tall internal court rising through both storeys, sometimes glazed over.',
    figures: ['courtyard', 'u_shape', 'h_shape'],
    minDimMm: 3200,
    openToSky: true,
    characteristics: ['courtyard_focused', 'transparent_ground', 'solid_void_play', 'deep_shadows'],
  }),
}

export type ParkingEntry = {
  id: ParkingIntegration
  label: string
  description: string
  /** minimum plot width to accommodate it, mm */
  minPlotWidthMm: number
  characteristics: Characteristic[]
}

const P = (e: ParkingEntry): ParkingEntry => e

export const PARKING_LIBRARY: Record<ParkingIntegration, ParkingEntry> = {
  none: P({ id: 'none', label: 'No covered parking', description: 'Street or open pad only.', minPlotWidthMm: 0, characteristics: [] }),
  open_pad: P({ id: 'open_pad', label: 'Open pad', description: 'A paved pad in the front setback, uncovered.', minPlotWidthMm: 7000, characteristics: [] }),
  integrated_front: P({ id: 'integrated_front', label: 'Integrated front', description: 'Cars tuck under the cantilevered / set-back upper floor at the front.', minPlotWidthMm: 9000, characteristics: ['cantilever', 'transparent_ground'] }),
  integrated_side: P({ id: 'integrated_side', label: 'Integrated side', description: 'Parking runs along a side setback under a lower wing.', minPlotWidthMm: 12000, characteristics: ['strong_horizontal_lines'] }),
  porte_cochere: P({ id: 'porte_cochere', label: 'Porte-cochère', description: 'A drive-through covered entry doubles as parking.', minPlotWidthMm: 13000, characteristics: ['sheltered_verandah', 'roof_as_feature'] }),
  stilt: P({ id: 'stilt', label: 'Stilt', description: 'The ground floor is an open stilted parking level.', minPlotWidthMm: 8000, characteristics: ['transparent_ground', 'heavy_base_light_top'] }),
  basement: P({ id: 'basement', label: 'Basement', description: 'Parking is below grade with a ramp.', minPlotWidthMm: 12000, characteristics: ['monolithic'] }),
}

export const LANDSCAPE_LIBRARY: Record<LandscapeStrategy, { label: string; needsCourt: boolean; needsPool: boolean; characteristics: Characteristic[] }> = {
  minimal: { label: 'Minimal', needsCourt: false, needsPool: false, characteristics: ['minimal_detailing'] },
  front_lawn: { label: 'Front lawn', needsCourt: false, needsPool: false, characteristics: [] },
  courtyard_garden: { label: 'Courtyard garden', needsCourt: true, needsPool: false, characteristics: ['courtyard_focused', 'climate_responsive'] },
  courtyard_pool: { label: 'Courtyard pool', needsCourt: true, needsPool: true, characteristics: ['courtyard_focused', 'climate_responsive'] },
  rear_pool: { label: 'Rear pool', needsCourt: false, needsPool: true, characteristics: ['privacy_to_street'] },
  wrap_deck: { label: 'Wrap deck', needsCourt: false, needsPool: false, characteristics: ['sheltered_verandah', 'tropical_shading'] },
  roof_garden: { label: 'Roof garden', needsCourt: false, needsPool: false, characteristics: ['roof_as_feature', 'climate_responsive'] },
  water_court: { label: 'Water court', needsCourt: true, needsPool: true, characteristics: ['courtyard_focused', 'roof_as_feature'] },
}

export function courtyardEntry(id: CourtyardType): CourtyardEntry {
  return COURTYARD_LIBRARY[id]
}
