import ratesRaw from './rates.json' with { type: 'json' }
import specsRaw from './specs-catalogue.json' with { type: 'json' }
import presetsRaw from './presets.json' with { type: 'json' }
import materialsRaw from '../../../../blender/assets/spec-materials.json' with { type: 'json' }
import finishesRaw from './finishes.json' with { type: 'json' }
import puneRaw from './pune.json' with { type: 'json' }
import legacyRaw from './legacy-rates.json' with { type: 'json' }
import { ratesSchema, specsCatalogueSchema, presetsSchema, materialRegistrySchema, finishesSchema, puneSchema, legacyRatesSchema } from './schemas.ts'
import { flooringProducts, flooringRates, flooringSpecificationOptions } from '../../flooring/catalogue.ts'

export function validateSpecificationData(r: unknown, s: unknown, p: unknown, m: unknown) {
  const rates = ratesSchema.parse(r), catalogue = specsCatalogueSchema.parse(s), presets = presetsSchema.parse(p), materials = materialRegistrySchema.parse(m)
  const errors: string[] = []
  for (const item of catalogue.items) for (const option of item.options) {
    if (!rates.items.some(r => r.id === option.rateId)) errors.push(`${item.id}/${option.id}: missing rate ${option.rateId}`)
    const material = materials.materials.find(m => m.id === option.blenderMaterial)
    if (!material) errors.push(`${item.id}/${option.id}: missing Blender material`)
    if (option.flooringProductId && !flooringProducts.some(p => p.id === option.flooringProductId && p.id === option.id && p.blenderMaterial === option.blenderMaterial && option.rateId === `floor-catalog-${p.id}`)) errors.push(`${item.id}/${option.id}: missing flooring product`)
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
export const specificationData = validateSpecificationData({ ...ratesRaw, items: [...ratesRaw.items, ...flooringRates()] },
  { ...specsRaw, items: specsRaw.items.map(i => i.group === 'flooring' && i.level !== 'auto' ? { ...i, options: [...i.options, ...flooringSpecificationOptions()] } : i) }, presetsRaw, materialsRaw)
const installedRate = (id: string) => {
  const rate = specificationData.rates.items.find(r => r.id === id)
  if (!rate) throw new Error(`Missing deployed BOQ rate ${id}`)
  return rate.material + rate.labour
}
const finishAdapter: Record<string, string> = {floor:'floor-living',wall:'interior-paint',door:'internal-door',window:'windows',roof:'terrace-waterproofing'}
const compatibleFinishes = finishesSchema.parse(finishesRaw)
export const validatedFinishes = { ...compatibleFinishes, categories: compatibleFinishes.categories.map(c => ({ ...c,
  options: c.options.map(o => ({ ...o, rate: installedRate(`${finishAdapter[c.id]}-${o.id}`) })) })) }
const compatibilityPolicy = puneSchema.parse(puneRaw)
const settings = specificationData.rates.settings
/** New rates.json owns current settings; old JSON retains its scope/measurement adapter. */
export const validatedPunePolicy = { ...compatibilityPolicy, city: settings.city, date: settings.date,
  version: `pune-concept-${settings.date}`, status: specificationData.rates.status,
  sources: [...specificationData.rates.sources, ...compatibilityPolicy.sources], uncertaintyPercent: settings.uncertaintyPct,
  rates: { structure: installedRate('boq-structure'), masonry: installedRate('boq-masonry'), plaster: installedRate('boq-plaster'),
    electrical: installedRate('boq-electrical'), plumbing: installedRate('boq-plumbing'), paving: installedRate('boq-paving'),
    lawn: installedRate('boq-lawn'), pool: installedRate('boq-pool') },
  defaults: { ...compatibilityPolicy.defaults, overheadPercent: settings.overheadPct, contingencyPercent: settings.contingencyPct,
    feePercent: settings.feePct, gstPercent: settings.gstPct, includeGst: settings.includeGst } }
export const validatedLegacyRates = legacyRatesSchema.parse(legacyRaw)
