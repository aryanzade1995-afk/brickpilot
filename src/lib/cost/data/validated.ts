import ratesRaw from './rates.json' with { type: 'json' }
import specsRaw from './specs-catalogue.json' with { type: 'json' }
import presetsRaw from './presets.json' with { type: 'json' }
import materialsRaw from '../../../../blender/assets/spec-materials.json' with { type: 'json' }
import finishesRaw from './finishes.json' with { type: 'json' }
import puneRaw from './pune.json' with { type: 'json' }
import legacyRaw from './legacy-rates.json' with { type: 'json' }
import { ratesSchema, specsCatalogueSchema, presetsSchema, materialRegistrySchema, finishesSchema, puneSchema, legacyRatesSchema } from './schemas.ts'

export function validateSpecificationData(r: unknown, s: unknown, p: unknown, m: unknown) {
  const rates = ratesSchema.parse(r), catalogue = specsCatalogueSchema.parse(s), presets = presetsSchema.parse(p), materials = materialRegistrySchema.parse(m)
  const errors: string[] = []
  for (const item of catalogue.items) for (const option of item.options) {
    if (!rates.items.some(r => r.id === option.rateId)) errors.push(`${item.id}/${option.id}: missing rate ${option.rateId}`)
    const material = materials.materials.find(m => m.id === option.blenderMaterial)
    if (!material) errors.push(`${item.id}/${option.id}: missing Blender material`)
    for (const photo of option.photos.filter(p => p.kind === 'closeup')) {
      if (photo.file !== material?.texture || photo.webFile !== material?.webFile || photo.sha256 !== material?.sha256 || photo.webSha256 !== material?.webSha256 || photo.source !== material?.source || photo.width !== material?.width || photo.height !== material?.height)
        errors.push(`${item.id}/${option.id}: close-up must share the exact Blender texture and provenance`)
    }
  }
  for (const preset of presets.presets) {
    for (const item of catalogue.items) if (!item.options.some(o => o.id === preset.options[item.id])) errors.push(`${preset.id}: missing or invalid option for ${item.id}`)
    for (const key of Object.keys(preset.options)) if (!catalogue.items.some(i => i.id === key)) errors.push(`${preset.id}: unknown item ${key}`)
  }
  if (errors.length) throw new Error(`Invalid specification references:\n${errors.join('\n')}`)
  return { rates, catalogue, presets, materials }
}
export const specificationData = validateSpecificationData(ratesRaw, specsRaw, presetsRaw, materialsRaw)
export const validatedFinishes = finishesSchema.parse(finishesRaw)
export const validatedPunePolicy = puneSchema.parse(puneRaw)
export const validatedLegacyRates = legacyRatesSchema.parse(legacyRaw)
