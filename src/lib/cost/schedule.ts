import { flooringProduct } from '../flooring/catalogue.ts'
import type { z } from 'zod'
import type { specificationRowSchema } from './deliverySchemas.ts'
import type { Brief } from '../model/brief.ts'
import type { CostEstimate } from './boq.ts'
import { specsCatalogue, specificationRate, resolveSpecification } from './catalogue.ts'

/** One measured-room entry per applicable finish, followed by house specifications. */
export function specificationSchedule(brief: Brief, cost: CostEstimate): SpecificationRow[] {
  const rows = specsCatalogue.items.filter(i => i.level !== 'auto').flatMap(item => {
    const lines = cost.boq.filter(l => l.item === item.id)
    const locations = item.scope === 'perRoom' ? cost.quantities.rooms.filter(r => lines.some(l => l.roomId === r.id)) : [null]
    return locations.map(room => {
      const own = lines.filter(l => !room || l.roomId === room.id)
      const current = resolveSpecification(brief, item.id, room && brief.specs.overrides[`${item.id}@${room.id}`] === undefined ? room.id.slice(room.id.indexOf(':') + 1) : room?.id)
      const option = item.options.find(o => o.id === own[0]?.specId.split('/')[1]) ?? current
      const photo = option.photos.find(p => p.kind === 'closeup')
      const product = flooringProduct(option.flooringProductId)
      const rate = specificationRate(option.rateId)
      return { id: `${item.id}${room ? `@${room.id}` : ''}`, item: item.id, group: item.group,
        label: item.label, where: room ? `${room.floor} · ${room.name}` : 'Whole home', roomId: room?.id,
        optionId: option.id, choice: option.name, material: option.blenderMaterial, facts: option.facts,
        quantity: own.length ? `${own.reduce((sum, l) => sum + l.qty, 0).toFixed(2)} ${own[0].unit}` : 'As specified',
        rate: rate.installed, unit: rate.unit, city: rate.city, date: rate.date,
        photo: photo?.webFile ?? null, photoSource: photo?.source ?? null, credit: photo?.credit ?? null,
        note: product ? `${item.note ?? ''} Supplier reference: ${product.manufacturer} · ${product.productName}. ${product.sourceUrl ?? 'Confirm with supplier'}. Product imagery omitted from exports pending rights clearance. Rates are provisional allowances.` : item.note }
    })
  })
  return rows.sort((a, b) => Number(!a.roomId) - Number(!b.roomId) || a.where.localeCompare(b.where) || a.group.localeCompare(b.group))
}
export type SpecificationRow = z.infer<typeof specificationRowSchema>
