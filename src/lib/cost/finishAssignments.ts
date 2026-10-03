import type { Design } from '../engine/types.ts'
import type { Brief } from '../model/brief.ts'
import { estimateBoq } from './boq.ts'
import { resolveSpecification, specsCatalogue } from './catalogue.ts'
import { fnv } from '../engine/massing/rng.ts'

/** Finishes are downstream of plan identity and architectural randomness. */
export function finishSignature(brief: Brief) {
  return `finishes-${fnv(JSON.stringify([brief.finish ?? 'mid', Object.entries(brief.specs?.overrides ?? {}).sort(([a], [b]) => a.localeCompare(b))])).toString(16)}`
}
export function createFinishAssignments(design: Design, brief: Brief = design.model.brief) {
  brief = { ...brief, finish: brief.finish ?? 'mid', specs: { overrides: brief.specs?.overrides ?? {} } }
  const cost = estimateBoq(design, brief)
  const houses = specsCatalogue.items.filter(i => i.level !== 'auto' && i.scope === 'house').map(item => {
    const option = resolveSpecification(brief, item.id)
    return { item: item.id, option: option.id, material: option.blenderMaterial }
  })
  const rooms = cost.quantities.rooms.map(room => ({
    id: room.id, sourceId: room.id.slice(room.id.indexOf(':') + 1), level: Number(room.id.split(':')[0]),
    finishes: specsCatalogue.items.filter(item => item.scope === 'perRoom' && cost.boq.some(l => l.item === item.id && l.roomId === room.id)).map(item => {
      const option = resolveSpecification(brief, item.id, brief.specs.overrides[`${item.id}@${room.id}`] === undefined ? room.id.slice(room.id.indexOf(':') + 1) : room.id)
      return { item: item.id, option: option.id, material: option.blenderMaterial }
    }),
  }))
  return { schemaVersion: 1 as const, signature: finishSignature(brief), houses, rooms }
}
