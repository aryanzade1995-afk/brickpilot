import { experienceOptions, experienceChoices, experienceRates } from '../../finishes/experiences.ts'
import ratesRaw from './rates.json' with { type: 'json' }
import specsRaw from './specs-catalogue.json' with { type: 'json' }
import presetsRaw from './presets.json' with { type: 'json' }
import materialsRaw from '../../../../blender/assets/spec-materials.json' with { type: 'json' }
import finishesRaw from './finishes.json' with { type: 'json' }
import puneRaw from './pune.json' with { type: 'json' }
import legacyRaw from './legacy-rates.json' with { type: 'json' }
import { ratesSchema, specsCatalogueSchema, presetsSchema, materialRegistrySchema, finishesSchema, puneSchema, legacyRatesSchema } from './schemas.ts'
import { flooringProducts, flooringRates, flooringSpecificationOptions } from '../../flooring/catalogue.ts'
import { finishProducts, finishRates, finishSpecificationOptions } from '../../finishes/catalogue.ts'
import serviceItems from '../../finishes/service-items.json' with { type: 'json' }

export function validateSpecificationData(r: unknown, s: unknown, p: unknown, m: unknown) {
  const rates = ratesSchema.parse(r), catalogue = specsCatalogueSchema.parse(s), presets = presetsSchema.parse(p), materials = materialRegistrySchema.parse(m)
  const errors: string[] = []
  for (const item of catalogue.items) for (const option of item.options) {
    if (!rates.items.some(r => r.id === option.rateId)) errors.push(`${item.id}/${option.id}: missing rate ${option.rateId}`)
    const material = materials.materials.find(m => m.id === option.blenderMaterial)
    if (!material) errors.push(`${item.id}/${option.id}: missing Blender material`)
    if (option.flooringProductId && !flooringProducts.some(p => p.id === option.flooringProductId && p.id === option.id && p.blenderMaterial === option.blenderMaterial && option.rateId === `floor-catalog-${p.id}`)) errors.push(`${item.id}/${option.id}: missing flooring product`)
    if (option.finishProductId) {
      const product = finishProducts.find(p => p.id === option.finishProductId)
      const rate = rates.items.find(r => r.id === option.rateId)
      if (!product || product.id !== option.id || !product.itemIds.includes(item.id) || product.category !== item.group || product.blenderMaterial !== option.blenderMaterial || option.rateId !== `finish-catalog-${product.id}`)
        errors.push(`${item.id}/${option.id}: missing or incompatible finish product`)
      if (product && (!rate || rate.unit !== product.rate.unit || rate.material !== product.rate.material || rate.labour !== product.rate.labour)) errors.push(`${item.id}/${option.id}: mismatched finish rate`)
      if (product?.image.kind === 'generic-material-closeup' && (product.image.path !== material?.webFile || product.sourceUrl !== material?.source)) errors.push(`${item.id}/${option.id}: natural-material photo must share the Blender texture`)
    }
    if (option.experienceOptionId && !experienceOptions.some(o => o.id === option.id && o.id === option.experienceOptionId && o.item === item.id && o.blenderMaterial === option.blenderMaterial && option.rateId === `experience-${o.id}`)) errors.push(`${item.id}/${option.id}: invalid experience reference`)
    if (option.experienceOptionId) {
      const product = experienceOptions.find(o => o.id === option.experienceOptionId), rate = rates.items.find(r => r.id === option.rateId)
      if (product && (!rate || rate.unit !== product.rate.unit || rate.material !== product.rate.material || rate.labour !== product.rate.labour)) errors.push(`${item.id}/${option.id}: mismatched experience rate`)
    }
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
export const specificationData = validateSpecificationData({ ...ratesRaw, items: [...ratesRaw.items, ...flooringRates(), ...finishRates(), ...experienceRates()] },
  { ...specsRaw, items: [...specsRaw.items,...serviceItems.map(({roomSource: _roomSource,...item})=>item)].map(i => ({ ...i,
    label: i.id==='sanitary'?'Toilets & sanitary allowance':i.id==='cp-fittings'?'Basin faucets & fittings allowance':i.id==='light-fittings'?'Ceiling lights & downlights':i.label,
    level: ['fans','light-fittings','switches','water-heater','terrace-waterproofing','bath-waterproofing'].includes(i.id)?'main':i.level,
    control: i.id === 'pool' ? 'dropdown' : i.control, options: [...i.options,
    ...(i.group === 'flooring' && i.level !== 'auto' ? flooringSpecificationOptions() : []), ...finishSpecificationOptions(i.id), ...experienceChoices(i.id)] })) },
  {...presetsRaw,presets:presetsRaw.presets.map(p=>({...p,options:{...p.options,...Object.fromEntries(serviceItems.map(i=>[i.id,finishSpecificationOptions(i.id)[0].id]))}}))}, materialsRaw)
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
