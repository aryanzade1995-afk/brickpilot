import { z } from 'zod'
import raw from './boq-rules.json' with { type: 'json' }
import { rateBook, specsCatalogue } from '../catalogue.ts'
import serviceItems from '../../finishes/service-items.json' with {type:'json'}
import {PLUMBING_SIZES} from '../plumbingCatalogue.ts'

const positive = z.number().positive().finite(), nonnegative = z.number().nonnegative().finite()
export const TRADES = ['Civil & structure', 'Flooring & tiling', 'Doors & windows', 'Plumbing & sanitary', 'Electrical', 'Painting', 'Waterproofing', 'Exterior & site', 'Extras'] as const
export type Trade = (typeof TRADES)[number]
export const boqRulesSchema = z.strictObject({
  version: z.string(), memoEntries: positive.int(), driverCount: positive.int(),
  recipes: z.array(z.strictObject({ item: z.string(), key: z.string(), label: z.string(), trade: z.enum(TRADES),
    from: z.enum(['items', 'steel', 'formwork', 'extra', 'room']), measure: z.enum(['NetVolume', 'NetSideArea', 'NetArea', 'Length', 'Count']),
    rateId: z.string().optional(), roomFloorSpec: z.boolean().optional(), note: z.string(),
  })),
  allowances: z.strictObject({ waterPipeMetresPerPoint: positive, drainPipeMetresPerPoint: positive, wireMetresPerPoint: positive,
    lightsPerPoint: positive.max(1), tankRateCapacityLitres: positive, kitchenRunRatio: positive.max(1), counterDepthM: positive,
    cabinetFaceHeightM: positive, canopyProjectionM: positive, claddingRatio: nonnegative.max(1), boardsPerFloor: positive.int(),
    earthingSets: positive.int(),
  }),
  fansByRoom: z.record(z.string(), nonnegative.int()),
  included: z.array(z.string()), excluded: z.array(z.string()), notes: z.array(z.string()),
  unpricedItems: z.record(z.string(), z.string()),
}).superRefine((v, ctx) => {
  for (const recipe of v.recipes) {
    if (!specsCatalogue.items.some(i => i.id === recipe.item)) ctx.addIssue({ code: 'custom', message: `Unknown BOQ specification ${recipe.item}` })
    if (recipe.rateId && !rateBook.items.some(i => i.id === recipe.rateId)) ctx.addIssue({ code: 'custom', message: `Unknown BOQ rate ${recipe.rateId}` })
  }
  for (const item of specsCatalogue.items) if (!v.recipes.some(r => r.item === item.id) && !v.unpricedItems[item.id])
    ctx.addIssue({ code: 'custom', message: `Missing BOQ scope decision for ${item.id}` })
})
export const boqRules = boqRulesSchema.parse({...raw,recipes:[...raw.recipes.map(r=>r.item==='water-tanks'?{...r,label:'Overhead water storage',note:'Overhead storage only, priced per configured capacity unit; underground storage is separate.'}:r),
  {item:'underground-water-tank',key:'undergroundTank',label:'Underground clean-water tank',trade:'Plumbing & sanitary',from:'extra',measure:'Count',note:'Capacity units of 1,000 L. Normal excavation, RCC shell, waterproofing and cover allowance; pump and difficult ground excluded.'},
  {item:'drain-tank',key:'drainTank',label:'Drain / septic tank',trade:'Plumbing & sanitary',from:'extra',measure:'Count',note:'One inspection chamber, or capacity units of 1,000 L for a selected sewage tank. Disposal field, pumping and approvals excluded.'}],
  unpricedItems:{...raw.unpricedItems,...Object.fromEntries(Object.keys(PLUMBING_SIZES).map(id=>[id,'Diameter selector; priced in the water and drain pipe schedule, without an additional charge.'])),...Object.fromEntries(serviceItems.map(i=>[i.id,i.note]))}})
