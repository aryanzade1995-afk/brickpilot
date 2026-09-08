/* ------------------------------------------------------------------ *
 *  facadeLibrary — facade compositions + screen elements + material
 *  palettes, as data. `facadeResolver.ts` / `facade.py` emit the
 *  concrete elements; this library says which compositions and screens
 *  belong together and what each imparts.
 * ------------------------------------------------------------------ */

import type {
  Characteristic,
  FacadeComposition,
  FacadeMaterial,
  MaterialPalette,
  ScreenElement,
} from './architecturalVocabulary.ts'

export type FacadeCompositionEntry = {
  id: FacadeComposition
  label: string
  description: string
  /** layers of material the facade reads as (1 = flat plane, 3+ = deep) */
  depth: 1 | 2 | 3
  /** screens that suit this composition */
  screens: ScreenElement[]
  characteristics: Characteristic[]
}

const FC = (e: FacadeCompositionEntry): FacadeCompositionEntry => e

export const FACADE_COMPOSITION_LIBRARY: Record<FacadeComposition, FacadeCompositionEntry> = {
  flat_plane: FC({
    id: 'flat_plane',
    label: 'Flat plane',
    description: 'One material, one plane — openings are punched cleanly.',
    depth: 1,
    screens: ['none', 'vertical_fins'],
    characteristics: ['minimal_detailing', 'monolithic'],
  }),
  solid_void: FC({
    id: 'solid_void',
    label: 'Solid / void',
    description: 'A solid mass with large voids cut for terraces and glazing.',
    depth: 2,
    screens: ['none', 'vertical_fins', 'louvers'],
    characteristics: ['solid_void_play', 'deep_shadows'],
  }),
  layered_solid_void: FC({
    id: 'layered_solid_void',
    label: 'Layered solid / void',
    description: 'Overlapping planes at different depths — screen, glass, solid, in front of each other.',
    depth: 3,
    screens: ['vertical_fins', 'wood_screen', 'jaali', 'perforated_screen'],
    characteristics: ['layered_facade', 'solid_void_play', 'deep_shadows', 'asymmetric_balance'],
  }),
  framed: FC({
    id: 'framed',
    label: 'Framed',
    description: 'A projecting frame or portal holds a recessed, more glazed inner face.',
    depth: 2,
    screens: ['none', 'wood_screen', 'louvers'],
    characteristics: ['solid_void_play', 'deep_shadows', 'roof_as_feature'],
  }),
  stacked_bands: FC({
    id: 'stacked_bands',
    label: 'Stacked bands',
    description: 'Horizontal bands — plinth, sill band, floor line, fascia — stack up the wall.',
    depth: 2,
    screens: ['none', 'louvers', 'wood_screen'],
    characteristics: ['strong_horizontal_lines', 'heavy_base_light_top', 'climate_responsive'],
  }),
  stone_volume: FC({
    id: 'stone_volume',
    label: 'Stone volume',
    description: 'One volume is entirely stone-clad and reads as monolithic against plaster.',
    depth: 2,
    screens: ['none', 'vertical_fins'],
    characteristics: ['stone_as_feature', 'monolithic', 'solid_void_play', 'deep_shadows'],
  }),
  glass_box: FC({
    id: 'glass_box',
    label: 'Glass box',
    description: 'A fully glazed volume, usually the living pavilion, framed in slim metal.',
    depth: 1,
    screens: ['none', 'vertical_fins', 'louvers'],
    characteristics: ['transparent_ground', 'lightweight'],
  }),
  mixed_material: FC({
    id: 'mixed_material',
    label: 'Mixed material',
    description: 'Three or more materials — plaster, stone, wood, metal — each on its own volume.',
    depth: 3,
    screens: ['vertical_fins', 'wood_screen', 'jaali', 'louvers'],
    characteristics: ['layered_facade', 'asymmetric_balance', 'stone_as_feature'],
  }),
}

export type ScreenEntry = {
  id: ScreenElement
  label: string
  /** depth of the shading element off the wall face, mm */
  depthMm: [number, number]
  /** where it typically goes */
  where: ('street_wall' | 'entry' | 'stair' | 'court' | 'verandah' | 'wide_glazing')[]
  characteristics: Characteristic[]
}

const SC = (e: ScreenEntry): ScreenEntry => e

export const SCREEN_LIBRARY: Record<ScreenElement, ScreenEntry> = {
  none: SC({ id: 'none', label: 'None', depthMm: [0, 0], where: [], characteristics: [] }),
  vertical_fins: SC({
    id: 'vertical_fins',
    label: 'Vertical fins',
    depthMm: [220, 420],
    where: ['wide_glazing', 'street_wall'],
    characteristics: ['strong_vertical_lines', 'deep_shadows', 'screen_as_feature', 'climate_responsive'],
  }),
  horizontal_fins: SC({
    id: 'horizontal_fins',
    label: 'Horizontal fins',
    depthMm: [200, 380],
    where: ['wide_glazing'],
    characteristics: ['strong_horizontal_lines', 'deep_shadows', 'climate_responsive'],
  }),
  jaali: SC({
    id: 'jaali',
    label: 'Jaali screen',
    depthMm: [90, 200],
    where: ['street_wall', 'stair', 'court', 'entry'],
    characteristics: ['screen_as_feature', 'privacy_to_street', 'deep_shadows', 'climate_responsive'],
  }),
  perforated_screen: SC({
    id: 'perforated_screen',
    label: 'Perforated screen',
    depthMm: [60, 150],
    where: ['street_wall', 'stair'],
    characteristics: ['screen_as_feature', 'privacy_to_street', 'lightweight'],
  }),
  louvers: SC({
    id: 'louvers',
    label: 'Louvers',
    depthMm: [120, 260],
    where: ['wide_glazing', 'verandah', 'stair'],
    characteristics: ['deep_shadows', 'tropical_shading', 'climate_responsive'],
  }),
  wood_screen: SC({
    id: 'wood_screen',
    label: 'Wood screen',
    depthMm: [100, 240],
    where: ['entry', 'stair', 'street_wall', 'verandah'],
    characteristics: ['screen_as_feature', 'privacy_to_street', 'deep_shadows'],
  }),
  pergola_screen: SC({
    id: 'pergola_screen',
    label: 'Pergola screen',
    depthMm: [900, 1800],
    where: ['verandah', 'court'],
    characteristics: ['sheltered_verandah', 'tropical_shading', 'deep_shadows'],
  }),
}

/** the physical materials behind a named palette */
export const PALETTE_MATERIALS: Record<MaterialPalette, FacadeMaterial[]> = {
  white_minimal: ['white_plaster', 'glass'],
  white_stone: ['white_plaster', 'natural_stone', 'glass'],
  stone_white_wood: ['white_plaster', 'natural_stone', 'wood', 'glass'],
  plaster_stone_base: ['off_white_plaster', 'dark_stone', 'glass'],
  concrete_wood: ['exposed_concrete', 'wood', 'glass'],
  laterite_white: ['white_plaster', 'laterite', 'teak_batten', 'glass'],
  travertine_granite: ['travertine', 'granite', 'glass', 'metal_panel'],
  brick_white: ['white_plaster', 'brick', 'glass'],
  earth_timber: ['sand_plaster', 'wood', 'natural_stone', 'glass'],
}

export function facadeCompositionEntry(id: FacadeComposition): FacadeCompositionEntry {
  return FACADE_COMPOSITION_LIBRARY[id]
}
export function screenEntry(id: ScreenElement): ScreenEntry {
  return SCREEN_LIBRARY[id]
}
