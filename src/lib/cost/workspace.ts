import { PAINT_COLOUR, colourValue } from '../finishes/paint.ts'
import { z } from 'zod'
import type { Brief } from '../model/brief.ts'
import type { CostEstimate, BoqLine } from './boq.ts'
import { specsCatalogue, resolveSpecification, finishPresets } from './catalogue.ts'
import suggestionsRaw from './data/suggestions.json' with { type: 'json' }
import samplesRaw from './data/samples.json' with { type: 'json' }
import { photoSchema } from './data/schemas.ts'
import { fnv } from '../engine/massing/rng.ts'
import { serviceRoomSource } from '../finishes/services.ts'

export type SpecItem = typeof specsCatalogue.items[number]
export type SpecOption = SpecItem['options'][number]
export const samples = z.strictObject({ samples: z.array(z.strictObject({ materialId: z.string(), texture: z.string(), photo: photoSchema })) }).parse(samplesRaw).samples
const suggestions = z.strictObject({ rules: z.array(z.strictObject({ condition: z.enum(['senior', 'children', 'hot']), items: z.array(z.string()), option: z.string(), reason: z.string() })) }).parse(suggestionsRaw).rules
for (const rule of suggestions) for (const id of rule.items) if (!specsCatalogue.items.find(i => i.id === id)?.options.some(o => o.id === rule.option)) throw new Error(`Unknown suggestion ${id}/${rule.option}`)
export const assetUrl = (file: string) => `/${file.replace(/^public\//, '')}`
export const defaultSpec = (brief: Brief, item: string) => finishPresets.presets.find(p => p.id === brief.finish)!.options[item]
export const roomSemantic = (id: string) => id.slice(id.indexOf(':') + 1)
export function effectiveSpec(brief: Brief, item: string, room?: string) {
  return resolveSpecification(brief, item, room && brief.specs.overrides[`${item}@${room}`] === undefined ? roomSemantic(room) : room)
}
export function itemLines(cost: CostEstimate, item: SpecItem, room?: string): BoqLine[] {
  return cost.boq.filter(l => l.item === item.id && (!room || item.scope === 'house' || l.roomId === room))
}
export function applicableRooms(cost: CostEstimate, item: SpecItem) {
  const source = serviceRoomSource[item.id]
  const ids = new Set((source ? cost.boq.filter(l=>l.item===source) : itemLines(cost, item)).map(l => l.roomId).filter(Boolean))
  return cost.quantities.rooms.filter(r => ids.has(r.id))
}
export function changeCount(brief: Brief) {
  return Object.entries(brief.specs.overrides).filter(([key, value]) => {
    if (key === PAINT_COLOUR || key.startsWith(`${PAINT_COLOUR}@`)) return colourValue(value).value === value
    const [id, room] = key.split('@'), item = specsCatalogue.items.find(i => i.id === id)
    if (!item || item.level === 'auto' || !item.options.some(o => o.id === value)) return false
    return value !== (room ? brief.specs.overrides[id] ?? defaultSpec(brief, id) : defaultSpec(brief, id))
  }).length
}
/** Explicit selected rooms only; selecting all writes a house default for future rooms too. */
export function applySpecification(brief: Brief, cost: CostEstimate, item: SpecItem, option: string, rooms: string[] = []): Brief {
  if (item.level === 'auto' || !item.options.some(o => o.id === option)) return brief
  const next = { ...brief, specs: { overrides: { ...brief.specs.overrides } } }, values = next.specs.overrides
  const applicable = applicableRooms(cost, item).map(r => r.id)
  if (item.scope === 'house' || !applicable.length || applicable.every(id => rooms.includes(id))) {
    for (const key of Object.keys(values)) if (key === item.id || key.startsWith(`${item.id}@`)) delete values[key]
    if (option !== defaultSpec(brief, item.id)) values[item.id] = option
  } else {
    for (const id of rooms.filter(id => applicable.includes(id))) {
      delete values[`${item.id}@${roomSemantic(id)}`]
      if (option === (values[item.id] ?? defaultSpec(brief, item.id))) delete values[`${item.id}@${id}`]
      else values[`${item.id}@${id}`] = option
    }
  }
  return next
}
export function undoSpecification(brief: Brief, cost: CostEstimate, item: SpecItem, room?: string) {
  if (item.id === 'interior-paint') {
    const clean = { ...brief, specs: { ...brief.specs, overrides: { ...brief.specs.overrides } } }
    for (const key of Object.keys(clean.specs.overrides)) if (key === PAINT_COLOUR && !room || key.startsWith(`${PAINT_COLOUR}@`) && (!room || key === `${PAINT_COLOUR}@${room}` || key === `${PAINT_COLOUR}@${roomSemantic(room)}`)) delete clean.specs.overrides[key]
    brief = clean
  }
  if (room && item.scope === 'perRoom') return applySpecification(brief, cost, item, defaultSpec(brief, item.id), [room])
  const next = { ...brief, specs: { overrides: { ...brief.specs.overrides } } }
  for (const key of Object.keys(next.specs.overrides)) if (key === item.id || key.startsWith(`${item.id}@`)) delete next.specs.overrides[key]
  return next
}
export function itemChanged(brief: Brief, cost: CostEstimate, item: SpecItem, room?: string) {
  const rooms = room ? [room] : applicableRooms(cost, item).map(r => r.id)
  if (item.id === 'interior-paint' && Object.keys(brief.specs.overrides).some(k => k === PAINT_COLOUR || k.startsWith(`${PAINT_COLOUR}@`) && (!room || k === `${PAINT_COLOUR}@${room}` || k === `${PAINT_COLOUR}@${roomSemantic(room)}`))) return true
  return item.scope === 'perRoom' && rooms.length ? rooms.some(id => effectiveSpec(brief, item.id, id).id !== defaultSpec(brief, item.id)) : effectiveSpec(brief, item.id).id !== defaultSpec(brief, item.id)
}
export function suggestionFor(brief: Brief, item: string) {
  return suggestions.find(r => r.items.includes(item) && (r.condition === 'senior' ? brief.household.members.some(m => m.role === 'senior') :
    r.condition === 'children' ? brief.household.members.some(m => ['child', 'teen', 'infant'].includes(m.role)) : brief.site.climate === 'hot'))
}
export function quantityLabel(lines: BoqLine[]) {
  const units = new Map<string, number>()
  for (const l of lines) units.set(l.unit, (units.get(l.unit) ?? 0) + l.qty)
  return [...units].map(([unit, qty]) => `${qty.toFixed(1)} ${unit}`).join(' · ') || 'As specified'
}
export function quantitySignature(cost: CostEstimate) {
  const value = JSON.stringify({ key: cost.quantities.geometryKey, floors: cost.quantities.perFloor, tanks: cost.quantities.tanks })
  return `${fnv(value)}:${fnv(`measured|${value}`)}`
}
export const COST_TABS = ['Specifications', 'Quantities', 'Estimate', 'Assumptions'] as const
export const costTabId = (label: string) => label.toLowerCase()
