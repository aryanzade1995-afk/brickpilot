import { specificationData } from './data/validated.ts'
import type { Brief } from '../model/brief.ts'
export const { rates: rateBook, catalogue: specsCatalogue, presets: finishPresets, materials: specificationMaterials } = specificationData

/** Automatic items are not chooser controls, even in the advanced views. */
export function specificationChoices(level: 'main' | 'more' | 'technical') {
  return specsCatalogue.items.filter(i => i.level === level)
}
export function specificationRate(id: string) {
  const rate = rateBook.items.find(r => r.id === id)
  if (!rate) throw new Error(`Unknown specification rate: ${id}`)
  return { ...rate, installed: rate.material + rate.labour }
}

/** A retired/unknown saved option falls back; automatic items ignore overrides. */
export function resolveSpecification(brief: Pick<Brief, 'finish' | 'specs'>, itemId: string, roomId?: string) {
  const item = specsCatalogue.items.find(i => i.id === itemId)
  if (!item) throw new Error(`Unknown specification item: ${itemId}`)
  const preset = finishPresets.presets.find(p => p.id === brief.finish)!
  const override = item.level === 'auto' ? undefined :
    (item.scope === 'perRoom' && roomId ? brief.specs.overrides[`${item.id}@${roomId}`] : undefined) ?? brief.specs.overrides[item.id]
  return item.options.find(o => o.id === override) ?? item.options.find(o => o.id === preset.options[item.id])!
}
export function resolveSpecifications(brief: Pick<Brief, 'finish' | 'specs'>) {
  return Object.fromEntries(specsCatalogue.items.map(i => [i.id, resolveSpecification(brief, i.id)]))
}
