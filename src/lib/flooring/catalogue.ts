import { z } from 'zod'
import raw from './products.json' with { type: 'json' }

const official = z.url().refine(url => ['www.orientbell.com', 'server.orientbell.com', 'images.orientbell.com', 'www.nitco.in',
  'www.kajariaceramics.com', 'www.somanyceramics.com', 'www.simpolo.net', 'www.hrjohnson.com', 'www.rakceramics.com', 'polyhaven.com'].includes(new URL(url).hostname), 'Use an official manufacturer source')
export const flooringProductSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/), name: z.string().min(1), manufacturer: z.string().min(1), productName: z.string().min(1),
  materialType: z.string().min(1), look: z.string().min(1), finish: z.string().min(1), color: z.string().min(1),
  availableSizes: z.array(z.string()).min(1), suitableRooms: z.array(z.string()).min(1), indoorOutdoor: z.enum(['indoor', 'outdoor', 'both']),
  slipResistance: z.string().min(1), sourceUrl: official.nullable(), thumbnail: official.nullable(), blenderMaterial: z.string().min(1), previewNote: z.string(),
  price: z.object({ material: z.number().nonnegative(), labour: z.number().nonnegative(), unit: z.literal('m2'), currency: z.literal('INR'),
    city: z.literal('Pune'), date: z.iso.date(), status: z.literal('provisional-allowance'), note: z.string() }),
  image: z.object({ manufacturer: z.string(), productName: z.string(), sourceUrl: official.nullable(), url: official.nullable(),
    imageType: z.enum(['product-swatch', 'unavailable']), sourceStatus: z.enum(['source-verified', 'unavailable']),
    licensingStatus: z.enum(['permission-required', 'cleared', 'not-applicable']), verifiedAt: z.iso.date().nullable(),
    verifiedBy: z.string().nullable(), productionReady: z.boolean() }),
}).superRefine((p, ctx) => {
  const bad = (message: string) => ctx.addIssue({ code: 'custom', message })
  if (p.image.url && (p.image.sourceStatus !== 'source-verified' || p.image.licensingStatus === 'not-applicable' || !p.image.sourceUrl || !p.image.verifiedBy || !p.image.verifiedAt || p.image.imageType === 'unavailable')) bad('Product images need audited provenance')
  if (p.image.manufacturer !== p.manufacturer || p.image.productName !== p.productName || p.image.sourceUrl !== p.sourceUrl) bad('Image must describe this product')
  if (p.thumbnail !== p.image.url) bad('Thumbnail must reference the audited swatch')
  if (p.image.productionReady && p.image.licensingStatus !== 'cleared') bad('Uncleared assets are not production-ready')
  if (!p.image.url && p.image.sourceStatus !== 'unavailable') bad('Missing imagery must be marked unavailable')
})
export const flooringCatalogue = z.object({ schemaVersion: z.literal(1), products: z.array(flooringProductSchema).min(1) })
  .refine(v => new Set(v.products.map(p => p.id)).size === v.products.length, 'Duplicate flooring product').parse(raw)
export type FlooringProduct = z.infer<typeof flooringProductSchema>
export const flooringProducts = flooringCatalogue.products
export const flooringProduct = (id?: string) => flooringProducts.find(p => p.id === id)
export type FlooringFilters = Partial<Record<'search' | 'material' | 'look' | 'finish' | 'manufacturer' | 'room', string>>
export function filterFlooringProducts(filters: FlooringFilters) {
  const query = filters.search?.trim().toLowerCase() ?? ''
  return flooringProducts.filter(p => (!query || [p.name, p.productName, p.manufacturer, p.materialType, p.look, p.color].join(' ').toLowerCase().includes(query)) &&
    (!filters.material || p.materialType === filters.material) && (!filters.look || p.look === filters.look) &&
    (!filters.finish || p.finish === filters.finish) && (!filters.manufacturer || p.manufacturer === filters.manufacturer) &&
    (!filters.room || p.suitableRooms.includes(filters.room)))
}
export const flooringFacets = {
  material: [...new Set(flooringProducts.map(p => p.materialType))].sort(), look: [...new Set(flooringProducts.map(p => p.look))].sort(),
  finish: [...new Set(flooringProducts.map(p => p.finish))].sort(), manufacturer: [...new Set(flooringProducts.map(p => p.manufacturer))].sort(),
  room: [...new Set(flooringProducts.flatMap(p => p.suitableRooms))].sort(),
}

/** Append through the existing specification/rate pipeline; legacy IDs and presets stay valid. */
export function flooringSpecificationOptions() {
  return flooringProducts.map(p => ({ id: p.id, name: p.name, rateId: `floor-catalog-${p.id}`, blenderMaterial: p.blenderMaterial,
    flooringProductId: p.id, photos: [], tags: [p.materialType, p.look, p.finish, ...p.suitableRooms],
    facts: [`Material: ${p.materialType}; look: ${p.look}.`, `Maintenance: ${p.materialType.startsWith('Natural') ? 'seal and use stone-safe cleaners' : 'follow the supplier cleaning guide'}.`,
      'Slip: request a tested wet-slip rating before purchase.', `Suits: ${p.suitableRooms.join(', ')}.`].map(s => s.slice(0, 110)) }))
}
export function flooringRates() {
  return flooringProducts.map(p => ({ id: `floor-catalog-${p.id}`, unit: p.price.unit, material: p.price.material, labour: p.price.labour,
    city: p.price.city, date: p.price.date, source: 'Maharashtra PWD SOR + market, approximate', verification: p.price.status }))
}
