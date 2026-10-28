import { paintColour } from '../finishes/paint.ts'
import { flooringProduct } from '../flooring/catalogue.ts'
import { finishProduct } from '../finishes/catalogue.ts'
import type { z } from 'zod'
import type { specificationRowSchema } from './deliverySchemas.ts'
import type { Brief } from '../model/brief.ts'
import type { CostEstimate } from './boq.ts'
import { specsCatalogue, resolveSpecification } from './catalogue.ts'
import { serviceRoomSource } from '../finishes/services.ts'
import { optionPhotos, usableFinishImage } from '../finishes/optionImage.ts'
import {PLUMBING_SIZES} from './plumbingCatalogue.ts'

import { createPricingResolver } from './pricingContext.ts'
import type { PricingContext } from './research/types.ts'

/** One measured-room entry per applicable finish, followed by house specifications. */
export function specificationSchedule(brief: Brief, cost: CostEstimate, pricingContext?: PricingContext | null): SpecificationRow[] {
  const resolver = createPricingResolver(pricingContext)
  const rows = specsCatalogue.items.filter(i => i.level !== 'auto' && !Object.hasOwn(PLUMBING_SIZES,i.id)).flatMap(item => {
    if (item.id === 'solar' && cost.solar && cost.solar.status !== 'legacy-allowance') return []
    const lines = cost.boq.filter(l => l.item === item.id)
    if(item.id==='water-pipes'||item.id==='drain-pipes')return lines.map(line=>{
      const option=resolveSpecification(brief,item.id),rate=resolver.getRate(line.rateId)
      return {id:line.id,item:item.id,group:item.group,label:line.label,where:cost.quantities.perFloor.find(f=>f.level===line.floor)?.name??'Whole home',roomId:undefined,
        optionId:option.id,choice:line.specification,material:option.blenderMaterial,facts:option.facts,quantity:`${line.qty.toFixed(2)} ${line.unit}`,
        rate:line.rate,unit:rate.unit,city:rate.city,date:rate.date,photo:null,photoSource:null,credit:null,note:line.note}
    })
    const locationLines = serviceRoomSource[item.id] ? cost.boq.filter(l=>l.item===serviceRoomSource[item.id]) : lines
    const locations = item.scope === 'perRoom' ? cost.quantities.rooms.filter(r => locationLines.some(l => l.roomId === r.id)) : [null]
    return locations.map(room => {
      const own = lines.filter(l => !room || l.roomId === room.id)
      const current = resolveSpecification(brief, item.id, room && brief.specs.overrides[`${item.id}@${room.id}`] === undefined ? room.id.slice(room.id.indexOf(':') + 1) : room?.id)
      const option = item.options.find(o => o.id === own[0]?.specId.split('/')[1]) ?? current
      const photo = optionPhotos(option).find(p => p.kind === 'closeup')
      const product = flooringProduct(option.flooringProductId)
      const finish = finishProduct(option.finishProductId)
      const cleared = finish?.image.productionReady && finish.image.kind === 'generic-material-closeup' && finish.thumbnail && usableFinishImage(finish.thumbnail) ? finish : undefined
      const rate = resolver.getRate(option.rateId)
      const researchNote = rate.source === 'researched' || rate.source === 'manual' ? ` [${rate.provenance}]` : ''
      return { id: `${item.id}${room ? `@${room.id}` : ''}`, item: item.id, group: item.group,
        label: item.label, where: room ? `${room.floor} · ${room.name}` : 'Whole home', roomId: room?.id,
        optionId: option.id, choice: item.id === 'interior-paint' ? `${option.name} · ${paintColour(brief, room?.id).label} (${paintColour(brief, room?.id).hex})` :
          ['water-tanks','underground-water-tank','drain-tank'].includes(item.id)&&own[0]?own[0].specification:option.name, material: option.blenderMaterial, facts: option.facts,
        quantity: own.length ? `${own.reduce((sum, l) => sum + l.qty, 0).toFixed(2)} ${own[0].unit}` : 'As specified',
        rate: rate.installed, unit: rate.unit, city: rate.city, date: rate.date,
        photo: photo?.webFile ?? cleared?.thumbnail ?? null, photoSource: photo?.source ?? cleared?.sourceUrl ?? null, credit: photo?.credit ?? cleared?.image.credit ?? null,
        note: (product ? `${item.note ?? ''} Supplier reference: ${product.manufacturer} · ${product.productName}. ${product.sourceUrl ?? 'Confirm with supplier'}. Product imagery omitted from exports pending rights clearance. Rates are provisional allowances.` :
          finish ? `${item.note} ${finish.specification} Source (${finish.sourceKind}): ${finish.brand} · ${finish.sourceUrl}. ${finish.image.note} ${finish.rate.note}` : item.note) + researchNote }
    })
  })
  const solarRows: SpecificationRow[] = cost.boq.filter(l => l.id.startsWith('solar-pv:')).map(line => ({
    id: line.id, item: line.item, group: line.group, label: line.label, where: 'Whole home · rooftop solar',
    optionId: line.specId, choice: line.specification, material: 'Concept photovoltaic system', facts: ['Applied canonical layout', 'No subsidy deducted'],
    quantity: `${line.qty} ${line.unit}`, rate: line.rate, unit: line.unit, city: 'Pune; internal concept allowance, confirm project location', date: '2026-10-19',
    photo: null, photoSource: null, credit: null, note: line.note,
  }))
  return [...rows, ...solarRows].sort((a, b) => Number(!a.roomId) - Number(!b.roomId) || a.where.localeCompare(b.where) || a.group.localeCompare(b.group))
}
export type SpecificationRow = z.infer<typeof specificationRowSchema>
