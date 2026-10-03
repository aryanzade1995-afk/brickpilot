import type { Brief } from '../model/brief.ts'
import type { Design, PlacedRoom } from '../engine/types.ts'
import { resolveSpecification } from './catalogue.ts'
import { defaultSelection, parseSelection, type CostSelection } from './specifications.ts'

const PRESET = { basic: 'simple', mid: 'standard', premium: 'refined' } as const
const FLOOR_GROUPS = ['floor-living', 'floor-bedrooms', 'floor-kitchen', 'floor-bathrooms', 'floor-other'] as const
function floorGroup(room: PlacedRoom) {
  const key = `${room.semanticId} ${room.id} ${room.name}`.toLowerCase()
  return /bath|ensuite|toilet/.test(key) ? 'floor-bathrooms' : /bed|master/.test(key) ? 'floor-bedrooms' :
    /kitchen/.test(key) ? 'floor-kitchen' : /living|dining/.test(key) ? 'floor-living' : 'floor-other'
}

/** Bridges the existing measured five-category BOQ. Other catalogue items need their own quantities. */
export function selectionFromBrief(brief: Brief, design: Design, legacySaved?: unknown, importLegacy = true): CostSelection {
  // Preserve pre-catalogue browser choices until the user next edits/saves them in the brief.
  if (importLegacy && legacySaved && !parseSelection(legacySaved).catalogue && brief.finish === 'mid' && !Object.keys(brief.specs.overrides).length) return parseSelection(legacySaved)
  const defaults = defaultSelection(PRESET[brief.finish]), allowances = legacySaved ? parseSelection(legacySaved) : defaults
  const choices = { floor: resolveSpecification(brief, 'floor-living').id,
    wall: resolveSpecification(brief, 'interior-paint').id, door: resolveSpecification(brief, 'internal-door').id,
    window: resolveSpecification(brief, 'windows').id, roof: resolveSpecification(brief, 'terrace-waterproofing').id }
  const roomFloors: Record<string, string> = {}
  for (const f of design.floors) for (const room of f.rooms.filter(r => !r.outdoor)) {
    const id = `${f.level}:${room.semanticId || room.id}`, option = resolveSpecification(brief, floorGroup(room), id)
    if (option.id !== choices.floor) roomFloors[id] = option.id
  }
  return parseSelection({ ...allowances, ...(!importLegacy || allowances.catalogue ? { catalogue: true } : {}), preset: defaults.preset, choices, roomFloors })
}

/** Save current finish choices in the project brief; numerical allowances remain a separate cost layer. */
export function writeSelectionToBrief(brief: Brief, design: Design, value: CostSelection) {
  const selection = parseSelection(value)
  brief.finish = selection.preset === 'simple' ? 'basic' : selection.preset === 'refined' ? 'premium' : 'mid'
  for (const key of Object.keys(brief.specs.overrides)) if (FLOOR_GROUPS.some(id => key.startsWith(`${id}@`))) delete brief.specs.overrides[key]
  for (const id of FLOOR_GROUPS) brief.specs.overrides[id] = selection.choices.floor
  Object.assign(brief.specs.overrides, { 'interior-paint': selection.choices.wall, 'internal-door': selection.choices.door,
    windows: selection.choices.window, 'terrace-waterproofing': selection.choices.roof })
  for (const f of design.floors) for (const room of f.rooms) {
    const id = `${f.level}:${room.semanticId || room.id}`, option = selection.roomFloors[id]
    if (option) brief.specs.overrides[`${floorGroup(room)}@${id}`] = option
  }
}
