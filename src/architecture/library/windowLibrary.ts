/* ------------------------------------------------------------------ *
 *  windowLibrary — glazing strategies + per-room opening rules.
 *
 *  This is the DATA behind "windows must be room-aware" (§17):
 *    room class → base window count / size band / kind / privacy
 *  `windowGenerator.ts` already resolves openings room-by-room; this
 *  library gives the genome's `glazing` + `windowStrategy` picks a
 *  concrete effect (a ratio ceiling + a sill/height bias + a kind).
 * ------------------------------------------------------------------ */

import type { Characteristic, GlazingRatio, WindowStrategy } from './architecturalVocabulary.ts'
import type { RoomClass, WindowSpec } from '../types.ts'

export type GlazingEntry = {
  id: GlazingRatio
  label: string
  /** window area ÷ exterior wall area ceiling for the whole design */
  wallRatioCeiling: number
  /** multiplier on each room's preferred window count */
  countBias: number
  characteristics: Characteristic[]
}

const G = (e: GlazingEntry): GlazingEntry => e

export const GLAZING_LIBRARY: Record<GlazingRatio, GlazingEntry> = {
  minimal: G({ id: 'minimal', label: 'Minimal', wallRatioCeiling: 0.24, countBias: 0.7, characteristics: ['privacy_to_street', 'monolithic', 'minimal_detailing'] }),
  modest: G({ id: 'modest', label: 'Modest', wallRatioCeiling: 0.32, countBias: 0.9, characteristics: ['climate_responsive', 'privacy_to_street'] }),
  controlled_large: G({ id: 'controlled_large', label: 'Controlled large', wallRatioCeiling: 0.42, countBias: 1.0, characteristics: ['solid_void_play', 'deep_shadows'] }),
  expansive: G({ id: 'expansive', label: 'Expansive', wallRatioCeiling: 0.54, countBias: 1.15, characteristics: ['transparent_ground', 'solid_void_play'] }),
  full_glass: G({ id: 'full_glass', label: 'Full glass', wallRatioCeiling: 0.68, countBias: 1.3, characteristics: ['transparent_ground', 'lightweight'] }),
}

export type WindowStrategyEntry = {
  id: WindowStrategy
  label: string
  description: string
  /** the WindowSpec.kind the generator should prefer for social rooms */
  socialKind: WindowSpec['kind']
  /** sill bias, mm (added to the room rule's sill) */
  sillBiasMm: number
  cornerGlazing: boolean
  characteristics: Characteristic[]
}

const WS = (e: WindowStrategyEntry): WindowStrategyEntry => e

export const WINDOW_STRATEGY_LIBRARY: Record<WindowStrategy, WindowStrategyEntry> = {
  punched: WS({ id: 'punched', label: 'Punched', description: 'Discrete openings in a solid wall.', socialKind: 'standard', sillBiasMm: 0, cornerGlazing: false, characteristics: ['solid_void_play', 'privacy_to_street'] }),
  horizontal_ribbon: WS({ id: 'horizontal_ribbon', label: 'Horizontal ribbon', description: 'A continuous band of glazing.', socialKind: 'strip', sillBiasMm: 100, cornerGlazing: false, characteristics: ['strong_horizontal_lines', 'lightweight'] }),
  vertical_slit: WS({ id: 'vertical_slit', label: 'Vertical slit', description: 'Tall narrow openings — stair, bathroom, accent.', socialKind: 'standard', sillBiasMm: -200, cornerGlazing: false, characteristics: ['strong_vertical_lines', 'privacy_to_street'] }),
  floor_to_ceiling: WS({ id: 'floor_to_ceiling', label: 'Floor to ceiling', description: 'Full-height glass to the social rooms.', socialKind: 'picture', sillBiasMm: -450, cornerGlazing: false, characteristics: ['transparent_ground', 'solid_void_play'] }),
  corner_glazing: WS({ id: 'corner_glazing', label: 'Corner glazing', description: 'Glass turns an external corner with no mullion.', socialKind: 'picture', sillBiasMm: -300, cornerGlazing: true, characteristics: ['transparent_ground', 'lightweight', 'asymmetric_balance'] }),
  recessed: WS({ id: 'recessed', label: 'Recessed', description: 'Openings set deep in the wall for shade.', socialKind: 'standard', sillBiasMm: 0, cornerGlazing: false, characteristics: ['deep_shadows', 'climate_responsive'] }),
  screened: WS({ id: 'screened', label: 'Screened', description: 'Glazing sits behind a fixed screen or louvers.', socialKind: 'standard', sillBiasMm: 0, cornerGlazing: false, characteristics: ['screen_as_feature', 'deep_shadows', 'privacy_to_street'] }),
  clerestory: WS({ id: 'clerestory', label: 'Clerestory', description: 'High strip windows bring light without a view in.', socialKind: 'clerestory', sillBiasMm: 900, cornerGlazing: false, characteristics: ['privacy_to_street', 'climate_responsive'] }),
  controlled_panoramic: WS({ id: 'controlled_panoramic', label: 'Controlled panoramic', description: 'One large framed pane per social room, to the best view.', socialKind: 'picture', sillBiasMm: -250, cornerGlazing: false, characteristics: ['solid_void_play', 'transparent_ground'] }),
}

/** per-room-class base opening rule (count / privacy) — §17 targets */
export const ROOM_OPENING_RULE: Partial<Record<RoomClass, { min: number; preferred: number; max: number; privacy: boolean }>> = {
  living: { min: 1, preferred: 2, max: 3, privacy: false },
  dining: { min: 1, preferred: 1, max: 2, privacy: false },
  kitchen: { min: 1, preferred: 1, max: 1, privacy: false },
  bedroom: { min: 1, preferred: 1, max: 2, privacy: false },
  master: { min: 1, preferred: 2, max: 2, privacy: false },
  bathroom: { min: 0, preferred: 1, max: 1, privacy: true },
  study: { min: 1, preferred: 1, max: 2, privacy: false },
  utility: { min: 0, preferred: 1, max: 1, privacy: true },
  pooja: { min: 0, preferred: 0, max: 1, privacy: false },
  stair: { min: 0, preferred: 0, max: 1, privacy: false },
}

export function glazingEntry(id: GlazingRatio): GlazingEntry {
  return GLAZING_LIBRARY[id]
}
export function windowStrategyEntry(id: WindowStrategy): WindowStrategyEntry {
  return WINDOW_STRATEGY_LIBRARY[id]
}
