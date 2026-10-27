import { z } from 'zod'

const number = z.number().finite().nonnegative().max(1e12).nullable()
const fraction = z.number().finite().min(0).max(1).nullable()
const text = z.string().trim().max(1000)
export const impactSchema = z.object({
  version: z.literal(1),
  budgetInr: number,
  climate: z.object({areaM2:number,currentRoofU:number,proposedRoofU:number,temperatureDifferenceK:number,source:text}).default({areaM2:null,currentRoofU:null,proposedRoofU:null,temperatureDifferenceK:null,source:''}),
  water: z.object({ rainfallMm: number, areaM2: number, runoff: fraction, efficiency: fraction, capacityL: number, dailyDemandL: number, source: text, geometryKey: text }),
  energy: z.object({ currentMonthlyKwh: number, proposedMonthlyKwh: number, source: text }),
  carbon: z.array(z.object({ lineId: text.min(1), specId:text.min(1), unit: text.min(1), low: z.number().finite().nonnegative().max(1e9), high: z.number().finite().nonnegative().max(1e9), source: text.min(1), boundary: text.min(1), geometryKey: text.min(1) }).refine(v => v.high >= v.low, 'The high factor must be at least the low factor.')).max(100),
  community: z.object({ label: z.string().max(120), households: z.number().int().min(1).max(10000), sharedAllowanceInr: number }),
  pilots: z.array(z.object({ id: z.string().min(1).max(100), householdCode: z.string().trim().min(1).max(80), date: z.iso.date(), stage: z.enum(['planned','supported']), evidence: text, baselineCostInr: number, actualCostInr: number, sameScope: z.boolean(), measuredWaterL: number, resilienceNote: text })).max(500),
}).superRefine((v,ctx) => {
  for (const [key, ids] of [['carbon',v.carbon.map(r=>r.lineId)],['pilots',v.pilots.map(r=>r.id)]] as const)
    if(new Set(ids).size!==ids.length)ctx.addIssue({code:'custom',path:[key],message:'Duplicate record.'})
})
export type ImpactDocument = z.infer<typeof impactSchema>
export function emptyImpact():ImpactDocument { return impactSchema.parse({ version:1,budgetInr:null,water:{rainfallMm:null,areaM2:null,runoff:null,efficiency:null,capacityL:null,dailyDemandL:null,source:'',geometryKey:''},energy:{currentMonthlyKwh:null,proposedMonthlyKwh:null,source:''},carbon:[],community:{label:'',households:1,sharedAllowanceInr:null},pilots:[] }) }
export function parseImpact(value:unknown):ImpactDocument|null { const parsed=impactSchema.safeParse(value);return parsed.success?parsed.data:null }
