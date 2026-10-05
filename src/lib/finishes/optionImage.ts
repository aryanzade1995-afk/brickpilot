import type { SpecItem, SpecOption } from '../cost/workspace.ts'
import { flooringProduct } from '../flooring/catalogue.ts'
import { finishProduct } from './catalogue.ts'
import cachedImages from './imageAssets.json' with { type: 'json' }

const url = (path: string) => path.startsWith('https:') || path.startsWith('/') ? path : `/${path.replace(/^public\//, '')}`
const cached = (path: string) => {
  const entry = (cachedImages as Record<string, {path: string | null}>)[path]
  return entry ? entry.path ? url(entry.path) : undefined : url(path)
}
/** Photographic references for the window and glass allowances (made for Formstead, not a supplier's product). */
const GLAZING_PHOTOS: Record<string, string> = {
  'windows-aluminium': '/specs/products/window-aluminium.jpg', 'windows-upvc': '/specs/products/window-upvc.jpg',
  'windows-thermal': '/specs/products/window-thermal.jpg', 'glass-clear': '/specs/products/glass-clear.jpg',
  'glass-toughened': '/specs/products/glass-toughened.jpg', 'glass-double': '/specs/products/glass-double.jpg',
}
/** One image source for cards, specification sheets and the colour-faithful 3D surface. */
export function optionImage(option: SpecOption) {
  const floor = flooringProduct(option.flooringProductId), finish = finishProduct(option.finishProductId)
  if (floor) { const src = floor.thumbnail && cached(floor.thumbnail); return src ? { src, surface: true } : undefined }
  if (finish) { const src = finish.image.path && cached(finish.image.path); return src ? { src, surface: finish.image.projection === 'surface' || finish.image.kind === 'generic-material-closeup' } : undefined }
  // the general window and glass allowances are shown as glass and windows, never the frame-metal sample
  const glazing = GLAZING_PHOTOS[option.rateId]
  if (glazing) return { src: glazing, surface: false }
  const photo = option.photos.find(p => p.kind === 'closeup') ?? option.photos.find(p => p.kind === 'installed')
  // These legacy glazing allowances carry a frame-metal sample, not an image of glass.
  const frameSample = ['Clear safety glass allowance', 'Toughened glass', 'Double glazing'].includes(option.name)
  return photo ? { src: url(photo.webFile ?? photo.file), surface: photo.kind === 'closeup' && !frameSample } : undefined
}
export const servicePhotoGroups = new Set(['waterproofing','painting','plumbing-sanitary','electrical'])
export const photoRequiredGroups = new Set(['flooring', 'wall-tiles-cladding', 'kitchen', 'doors', 'windows-glass-grills', 'railings-gates',...servicePhotoGroups])
/** Keep saved legacy IDs in the cost engine, but offer only photographed choices in these sections. */
export function photographedOptions(item: Pick<SpecItem, 'group' | 'options'>) {
  // Legacy service allowances use concrete/metal/plaster proxies, not photographs of a product.
  // Preserve their cost IDs for saved projects, but do not offer them as photographed products.
  return photoRequiredGroups.has(item.group) ? item.options.filter(o => !!optionImage(o) && (!servicePhotoGroups.has(item.group)||!!finishProduct(o.finishProductId)?.preview)) : item.options
}
