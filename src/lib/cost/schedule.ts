import { paintColour } from '../finishes/paint.ts'
import { flooringProduct } from '../flooring/catalogue.ts'
import { finishProduct } from '../finishes/catalogue.ts'
import type { z } from 'zod'
import type { specificationRowSchema } from './deliverySchemas.ts'
import type { Brief } from '../model/brief.ts'
import type { CostEstimate } from './boq.ts'
import { specsCatalogue, specificationRate, resolveSpecification } from './catalogue.ts'
import { serviceRoomSource } from '../finishes/services.ts'

/** One measured-room entry per applicable finish, followed by house specifications. */
export function specificationSchedule(brief: Brief, cost: CostEstimate): SpecificationRow[] {
  const rows = specsCatalogue.items.filter(i => i.level !== 'auto').flatMap(item => {
    const lines = cost.boq.filter(l => l.item === item.id)
    const locationLines = serviceRoomSource[item.id] ? cost.boq.filter(l=>l.item===serviceRoomSource[item.id]) : lines
    const locations = item.scope === 'perRoom' ? cost.quantities.rooms.filter(r => locationLines.some(l => l.roomId === r.id)) : [null]
    return locations.map(room => {
      const own = lines.filter(l => !room || l.roomId === room.id)
      const current = resolveSpecification(brief, item.id, room && brief.specs.overrides[`${item.id}@${room.id}`] === undefined ? room.id.slice(room.id.indexOf(':') + 1) : room?.id)
      const option = item.options.find(o => o.id === own[0]?.specId.split('/')[1]) ?? current
      const photo = option.photos.find(p => p.kind === 'closeup')
      const product = flooringProduct(option.flooringProductId)
      const finish = finishProduct(option.finishProductId)
      const cleared = finish?.image.productionReady && finish.image.kind === 'generic-material-closeup' ? finish : undefined
      const rate = specificationRate(option.rateId)
      return { id: `${item.id}${room ? `@${room.id}` : ''}`, item: item.id, group: item.group,
        label: item.label, where: room ? `${room.floor} · ${room.name}` : 'Whole home', roomId: room?.id,
        optionId: option.id, choice: item.id === 'interior-paint' ? `${option.name} · ${paintColour(brief, room?.id).label} (${paintColour(brief, room?.id).hex})` : option.name, material: option.blenderMaterial, facts: option.facts,
        quantity: own.length ? `${own.reduce((sum, l) => sum + l.qty, 0).toFixed(2)} ${own[0].unit}` : 'As specified',
        rate: rate.installed, unit: rate.unit, city: rate.city, date: rate.date,
        photo: photo?.webFile ?? cleared?.thumbnail ?? null, photoSource: photo?.source ?? cleared?.sourceUrl ?? null, credit: photo?.credit ?? cleared?.image.credit ?? null,
        note: product ? `${item.note ?? ''} Supplier reference: ${product.manufacturer} · ${product.productName}. ${product.sourceUrl ?? 'Confirm with supplier'}. Product imagery omitted from exports pending rights clearance. Rates are provisional allowances.` :
          finish ? `${item.note} ${finish.specification} Source (${finish.sourceKind}): ${finish.brand} · ${finish.sourceUrl}. ${finish.image.note} ${finish.rate.note}` : item.note }
    })
  })
  return rows.sort((a, b) => Number(!a.roomId) - Number(!b.roomId) || a.where.localeCompare(b.where) || a.group.localeCompare(b.group))
}
export type SpecificationRow = z.infer<typeof specificationRowSchema>
