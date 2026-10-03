import { specificationData } from './data/validated.ts'
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
