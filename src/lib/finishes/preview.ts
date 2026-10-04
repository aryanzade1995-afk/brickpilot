import { finishProduct } from './catalogue.ts'
import { specificationMaterials } from '../cost/catalogue.ts'
import type { SpecItem, SpecOption } from '../cost/workspace.ts'

export type PreviewKind = 'floor' | 'wall' | 'door' | 'window' | 'railing' | 'gate' | 'kitchen' | 'ceiling' | 'roof' | 'sanitary' | 'fittings' | 'landscape' | 'pool' | 'system'
/** Semantic preview only: no manufactured photograph is treated as a repeatable texture. */
export function finishPreview(item: Pick<SpecItem, 'id' | 'group'>, option: SpecOption) {
  const kind: PreviewKind = item.id === 'sanitary' ? 'sanitary' : item.id === 'cp-fittings' ? 'fittings' : item.id === 'landscaping' ? 'landscape' : item.id === 'pool' ? 'pool' : item.group === 'windows-glass-grills' ? 'window' : item.group === 'doors' ? 'door' :
    item.group === 'flooring' ? 'floor' : item.group === 'railings-gates' ? (item.id.includes('gate') ? 'gate' : 'railing') :
    item.group === 'kitchen' ? 'kitchen' : item.group === 'false-ceiling' ? 'ceiling' : item.group === 'roof-exterior' ? 'roof' :
    ['wall-tiles-cladding', 'painting', 'plaster'].includes(item.group) ? 'wall' : 'system'
  const product = finishProduct(option.finishProductId)
  const text = `${option.name} ${product?.finish ?? ''} ${product?.material ?? ''} ${product?.style ?? ''}`.toLowerCase()
  const material = specificationMaterials.materials.find(m => m.id === option.blenderMaterial)!
  const wood = /wood|teak|walnut|timber|veneer/.test(text)
  const metal = /aluminium|aluminum|steel|metal|iron/.test(text)
  const color = /black|dark|charcoal|walnut/.test(text) ? '#343638' : /wood|teak|timber|veneer/.test(text) ? '#a27750' :
    /sand|beige|cream|ivory/.test(text) ? '#cdbb9e' : /grey|gray|concrete|slate/.test(text) ? '#90928e' : '#e4e1da'
  const exactFamily = /travertine/.test(text) ? material.id === 'travertine' : /sandstone/.test(text) ? material.id === 'sandstone' : /granite/.test(text) ? material.id === 'granite_paving' : /marble|statuario|calacatta|onyx|terrazzo|mosaic|pattern|acrylic|laminate|pvc|upvc/.test(text) ? false : true
  const allowedSurface = exactFamily && (wood ? material.surface === 'wood' :
    kind === 'floor' || kind === 'wall' || kind === 'kitchen' ? !metal && material.surface !== 'metal' : false)
  // Many catalogue products intentionally have only approximate material proxies.
  // Metal / glazing never receive plaster or stone images even if legacy mappings use them.
  const texture = allowedSurface ? `/${material.webFile.replace(/^public\//, '')}` : undefined
  return { kind, color, texture, metallic: metal ? .7 : 0, roughness: /polish|gloss|lacquer/.test(text) ? .2 : .65,
    glass: /glass|glazing|window/.test(text) || kind === 'window', bars: /grill|jali|bar/.test(text),
    sliding: /sliding/.test(text), double: /double/.test(text), fixed: /fixed/.test(text), slim: /slim/.test(text),
    caption: kind === 'system' ? 'Specification only · no physical appearance to preview.' :
      texture ? 'Visualisation · representative material texture, not an exact supplier product.' : 'Visualisation · indicative form and finish; confirm a physical product sample.' }
}
