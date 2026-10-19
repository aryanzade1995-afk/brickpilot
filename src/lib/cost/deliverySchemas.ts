import { z } from 'zod'
import { solarEstimateSchema } from '../solar/estimate.ts'
import { TRADES } from './data/boqRules.ts'

const number = z.number().nonnegative().finite(), text = z.string().max(12000), texts = z.array(text).max(2000)
const band = z.object({ low: number, high: number }).refine(v => v.high >= v.low)
const trade = z.object({ trade: z.enum(TRADES), amount: number, share: number.max(1), material: number, labour: number })
export const sheetEstimateSchema = z.object({ solar: solarEstimateSchema.optional(), label: text, qualification: text, expected: number, total: band, ratePerSqft: number,
  rateVersion: text, tradeTotals: z.array(trade).length(TRADES.length), included: texts, excluded: texts, assumptions: texts, sources: texts })
export const specificationRowSchema = z.object({ id: text, item: text, group: text, label: text, where: text, roomId: text.optional(),
  optionId: text, choice: text, material: text, facts: z.array(text).max(4), quantity: text, rate: number, unit: text,
  city: text, date: z.iso.date(), photo: z.string().regex(/^public\/specs\/textures\/[a-z0-9_-]+\.jpg$/).nullable(),
  photoSource: z.string().regex(/^https:\/\/(polyhaven\.com|ambientcg\.com)\/a\/[a-zA-Z0-9_-]+$/).nullable(), credit: text.nullable(), note: text })
export const publicSheetSchema = z.strictObject({ schemaVersion: z.literal(1), projectName: z.string().min(1).max(250), createdAt: z.iso.datetime(),
  schedule: z.array(specificationRowSchema).min(1).max(4000), cost: sheetEstimateSchema }).superRefine((sheet, ctx) => {
    if (!sheet.cost.solar?.delivery) return
    const solar = sheet.cost.solar, rows = sheet.schedule.filter(r => r.id.startsWith('solar-pv:'))
    const panel = rows.find(r => r.id === 'solar-pv:panels')
    if (rows.some(r => !Number.isFinite(Number.parseFloat(r.quantity)) || Number.parseFloat(r.quantity) < 0) ||
      new Set(rows.map(r => r.id)).size !== rows.length || solar.status === 'applied' && (!panel || Number.parseFloat(panel.quantity) !== solar.panelCount ||
      Math.abs(rows.reduce((n, r) => n + Number.parseFloat(r.quantity) * r.rate, 0) - solar.grossInstallationCost) > .01) ||
      solar.status !== 'applied' && rows.length || solar.status === 'applied' && sheet.schedule.some(r => r.item === 'solar'))
      ctx.addIssue({ code: 'custom', message: 'Public solar specification schedule disagrees with the applied inventory or cost' })
  })

const ifc = z.object({ NetVolume: number, NetSideArea: number, NetArea: number, Length: number, Count: number })
const amounts = z.record(z.string(), number)
const floor = z.object({ level: z.number().int(), name: text, items: z.record(z.string(), ifc),
  members: z.array(z.object({ id: text, category: text, quantities: ifc, steelKg: number, formworkM2: number })), steelKg: amounts, formworkM2: amounts })
const selection = z.object({ preset: text, catalogue: z.literal(true).optional(), choices: z.object({ floor: text, wall: text, door: text, window: text, roof: text }),
  roomFloors: z.record(z.string(), text), includeGst: z.boolean(), overheadPercent: number.max(100), contingencyPercent: number.max(100), feePercent: number.max(100), gstPercent: number.max(100) })
const serviceTank=z.object({kind:z.enum(['water','chamber','septic','holding']),capacityLitres:number,lengthM:number.positive(),widthM:number.positive(),depthM:number.positive(),pricingUnits:number})
const plumbing=z.object({schemaVersion:z.literal(1),occupants:number,overheadLitres:number,underground:serviceTank.nullable(),drain:serviceTank.nullable(),
  runs:z.array(z.object({id:text,floor:z.number().int().nonnegative(),floorName:text,system:z.enum(['water','drain']),
    purpose:z.enum(['Water branches','Water riser','Waste branches','Soil / drain stack']),diameterMm:number.positive(),lengthM:number,points:number,sizeBasis:z.enum(['nominal','outside'])})).max(400),
  waterLengthM:number,drainLengthM:number,notes:texts})
export const savedCostSchema = sheetEstimateSchema.extend({ currency: z.literal('INR'), confidence: z.literal('C'), ratePerSqm: band,
  lines: z.array(z.object({ label: text, note: text, low: number, high: number, expected: number })), basis: text,
  selection, sanityNote: text.nullable(), defaultExpected: number,
  topCostDrivers: z.array(z.object({ item: text, label: text, amount: number, defaultAmount: number, difference: z.number().finite() })),
  procurement: z.object({ contractType: text, turnkey: number, material: number, labour: number, overhead: number, projectAddOns: number, total: number, note: text }),
  boq: z.array(z.object({ id: text, item: text, specId: text, rateId: text, group: z.enum(TRADES), label: text, specification: text,
    qty: number, quantity: number, unit: text, rate: number, amount: number, materialRate: number, labourRate: number,
    materialAmount: number, labourAmount: number, roomId: text.optional(), floor: z.number().int().optional(), note: text })).max(20000),
  quantities: z.object({ geometryKey: text, floorArea: number, groundArea: number, wallArea: number, paintArea: number, doorArea: number, windowArea: number,
    roofArea: number, pavingArea: number, lawnArea: number, poolArea: number, doorCount: number, windowCount: number,
    rooms: z.array(z.object({ id: text, floor: text, name: text, area: number })), assumptions: texts,
    structureSizing: z.json(), perFloor: z.array(floor), total: floor,
    concreteMaterials: z.object({ grade: text, cementBags: number.nullable(), sandM3: number.nullable(), aggregateM3: number.nullable() }),
    masonryMaterials: z.object({ type: text, Count: number }), tanks: z.object({ occupants: number, overheadLitres: number, undergroundLitres: number }),plumbing:plumbing.optional() }),
}).superRefine((cost, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message })
  if (cost.solar) {
    const solarLines = cost.boq.filter(l => l.id.startsWith('solar-pv:'))
    if (Math.abs(solarLines.reduce((n, l) => n + l.amount, 0) - cost.solar.grossInstallationCost) > .01) fail('Solar gross cost does not match itemized solar BOQ')
    if (cost.solar.status === 'applied') {
      if (cost.boq.some(l => l.item === 'solar' && l.amount > 0)) fail('Solar allowance is counted twice')
      const panels = solarLines.find(l => l.id === 'solar-pv:panels')
      if (!panels || panels.qty !== cost.solar.panelCount) fail('Solar panel inventory does not match BOQ')
    } else if (solarLines.length || cost.solar.panelCount || cost.solar.capacityKwp) fail('Unapplied solar cannot have installation quantities')
  }
  if (Math.abs(cost.lines.reduce((sum, l) => sum + l.expected, 0) - cost.expected) > .01) fail('Saved cost summary does not add up')
  for (const line of cost.boq) if (Math.abs(line.qty * line.rate - line.amount) > .01 || Math.abs(line.materialAmount + line.labourAmount - line.amount) > .01) fail('Saved BOQ line does not add up')
  for (const t of cost.tradeTotals) if (Math.abs(cost.boq.filter(l => l.group === t.trade).reduce((sum, l) => sum + l.amount, 0) - t.amount) > .01) fail('Saved trade total does not add up')
  const services=cost.quantities.plumbing
  if(services){
    for(const system of ['water','drain'] as const)if(Math.abs(services.runs.filter(r=>r.system===system).reduce((n,r)=>n+r.lengthM,0)-services[`${system}LengthM`])>.01)fail('Saved pipe length does not add up')
    for(const run of services.runs){
      const line=cost.boq.find(l=>l.id===`${run.system==='water'?'water-pipes':'drain-pipes'}:pipe:${run.id}`)
      if(!line||Math.abs(line.qty-run.lengthM)>.01)fail('Saved pipe schedule does not match the BOQ')
    }
    if(cost.quantities.tanks.undergroundLitres!==(services.underground?.capacityLitres??0))fail('Saved underground capacity does not match the storage schedule')
  }
})
export const costReplaySchema = z.object({ version: z.literal(1), geometryKey: z.string(), signature: z.string(), cost: savedCostSchema })
