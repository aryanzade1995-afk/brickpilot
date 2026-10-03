import { z } from 'zod'
import raw from './products.json' with { type: 'json' }

const id = z.string().regex(/^[a-z][a-z0-9-]*$/)
const hosts = ['orientbell.com', 'kajariaceramics.com', 'somanyceramics.com', 'nitco.in', 'simpolo.net', 'hrjohnson.com',
  'rakceramics.com', 'sleekworld.com', 'hafele.com', 'hettich.com', 'blum.com', 'greenply.com', 'centuryply.com',
  'godrej.com', 'dorsetindia.com', 'fenesta.com', 'aiswindows.com', 'tostemindia.com', 'saint-gobain.co.in',
  'drfixit.co.in', 'sika.com', 'fosroc.com', 'asianpaints.com', 'bergerpaints.com', 'nerolac.com', 'dulux.in',
  'jswpaints.in', 'q-railing.com', 'geapl.com', 'polyhaven.com', 'ambientcg.com']
const official = z.url().refine(url => {
  try { const parsed = new URL(url); return parsed.protocol === 'https:' && hosts.some(h => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`)) } catch { return false }
}, 'Use an official supplier or natural-texture library source')
const asset = z.string().refine(s => official.safeParse(s).success || /^(blender\/assets|public\/specs)\/[a-zA-Z0-9_./-]+$/.test(s) && !s.split('/').includes('..'), 'Invalid image path')
export const finishProductSchema = z.strictObject({
  id, name: z.string().min(1), category: id, subcategory: z.string().min(1), itemIds: z.array(id).min(1),
  brand: z.string().min(1), productName: z.string().min(1), material: z.string().min(1), style: z.string().min(1),
  finish: z.string().min(1), application: z.array(z.string()).min(1), suitableRooms: z.array(z.string()).min(1),
  specification: z.string().min(1), blenderMaterial: z.string().min(1),
  sourceUrl: official, sourceKind: z.enum(['product', 'collection', 'guidance', 'generic-texture']),
  rate: z.strictObject({ unit: z.enum(['m2', 'm', 'set', 'item']), material: z.number().nonnegative().finite(),
    labour: z.number().nonnegative().finite(), city: z.literal('Pune'), date: z.iso.date(),
    status: z.literal('provisional-allowance'), basis: z.enum(['measured', 'allowance', 'advisory']), note: z.string().min(1) }),
  facts: z.array(z.string().min(1).max(110)).max(4),
  image: z.strictObject({ brand: z.string(), productName: z.string(), sourceUrl: official,
    path: asset.nullable(), originalUrl: official.nullable(), kind: z.enum(['real-product-photo', 'generic-material-closeup', 'unavailable']),
    sourceStatus: z.enum(['source-and-visual-audited', 'unavailable']), licensingStatus: z.enum(['CC0-1.0', 'permission-required', 'not-applicable']),
    credit: z.string(), verifiedBy: z.string().nullable(), verifiedAt: z.iso.date().nullable(), productionReady: z.boolean(),
    note: z.string().min(1) }), thumbnail: asset.nullable(),
}).superRefine((p, ctx) => {
  const bad = (message: string) => ctx.addIssue({ code: 'custom', message })
  if (p.image.brand !== p.brand || p.image.productName !== p.productName || p.image.sourceUrl !== p.sourceUrl) bad('Image provenance must describe this specification')
  if (p.thumbnail !== p.image.path) bad('Thumbnail must use the audited asset')
  if (p.image.path) {
    if (!p.image.verifiedBy?.startsWith('asset-audit:') || !p.image.verifiedAt || p.image.sourceStatus !== 'source-and-visual-audited' || p.image.kind === 'unavailable' || p.image.licensingStatus === 'not-applicable') bad('Image requires a recorded source and visual audit')
    if (p.image.kind === 'generic-material-closeup' && (p.sourceKind !== 'generic-texture' || p.image.licensingStatus !== 'CC0-1.0')) bad('Generic material close-ups must use CC0 texture provenance')
    if (p.image.kind === 'real-product-photo' && p.sourceKind !== 'product') bad('Product photography requires the actual product page')
  } else if (p.image.kind !== 'unavailable' || p.image.sourceStatus !== 'unavailable' || p.image.productionReady) bad('Missing/uncertain imagery must be unavailable')
  if (p.image.productionReady && p.image.licensingStatus !== 'CC0-1.0') bad('Uncleared manufacturer images are not production-ready')
  if (p.rate.basis === 'advisory' && p.rate.material + p.rate.labour !== 0) bad('Unmeasured preferences cannot invent a price')
})
export const finishCatalogue = z.strictObject({ schemaVersion: z.literal(1), products: z.array(finishProductSchema).min(1) })
  .refine(v => new Set(v.products.map(p => p.id)).size === v.products.length, 'Duplicate specification product').parse(raw)
export type FinishProduct = z.infer<typeof finishProductSchema>
export const finishProducts = finishCatalogue.products
export const finishProduct = (id?: string) => finishProducts.find(p => p.id === id)
export type FinishFilters = Partial<Record<'search' | 'material' | 'style' | 'finish' | 'brand' | 'application' | 'room', string>>
export function filterFinishProducts(itemId: string, filters: FinishFilters = {}) {
  const query = filters.search?.trim().toLowerCase() ?? ''
  return finishProducts.filter(p => p.itemIds.includes(itemId) &&
    (!query || [p.name, p.productName, p.material, p.style, p.finish, p.brand, ...p.application].join(' ').toLowerCase().includes(query)) &&
    (!filters.material || p.material === filters.material) && (!filters.style || p.style === filters.style) &&
    (!filters.finish || p.finish === filters.finish) && (!filters.brand || p.brand === filters.brand) &&
    (!filters.application || p.application.includes(filters.application)) && (!filters.room || p.suitableRooms.includes(filters.room)))
}
export function finishFacets(itemId: string) {
  const products = filterFinishProducts(itemId)
  const values = (key: 'material' | 'style' | 'finish' | 'brand') => [...new Set(products.map(p => p[key]))].sort()
  return { material: values('material'), style: values('style'), finish: values('finish'), brand: values('brand'),
    application: [...new Set(products.flatMap(p => p.application))].sort(), room: [...new Set(products.flatMap(p => p.suitableRooms))].sort() }
}
/** Same deployed option/rate adapter as flooring; old presets and saved IDs retain their meaning. */
export function finishSpecificationOptions(itemId: string) {
  return filterFinishProducts(itemId).map(p => ({ id: p.id, name: p.name, rateId: `finish-catalog-${p.id}`,
    blenderMaterial: p.blenderMaterial, finishProductId: p.id, photos: [], tags: [p.material, p.style, p.finish, ...p.application], facts: p.facts }))
}
export function finishRates() {
  return finishProducts.map(p => ({ id: `finish-catalog-${p.id}`, unit: p.rate.unit, material: p.rate.material, labour: p.rate.labour,
    city: p.rate.city, date: p.rate.date, source: 'Maharashtra PWD SOR + market, approximate', verification: p.rate.status }))
}
