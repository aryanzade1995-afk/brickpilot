import { z } from 'zod'

const nonnegative = z.number().finite().min(0), fraction = nonnegative.max(1)
export const waterPointSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])
export const WATER_KINDS = ['catchment', 'gutter', 'downpipe', 'first_flush', 'filter', 'tank', 'overflow', 'recharge', 'outlet'] as const
export const valueBasisSchema = z.enum(['unknown', 'user-provided', 'measured', 'estimated', 'calculated'])
export const componentSchema = z.object({
  id: z.string().min(1).max(120), name: z.string().min(1).max(120), kind: z.enum(WATER_KINDS),
  // Accepted GLB coordinates: X=plan X, Y=elevation, Z=-plan Y; metres.
  positionM: waterPointSchema.nullable(), positionBasis: valueBasisSchema.default('unknown'), capacityLps: nonnegative.nullable(), capacityBasis: z.string().max(500),
  diversionLitres: nonnegative.nullable(), efficiency: fraction.nullable(),
  tankCapacityLitres: nonnegative.nullable(), initialStorageLitres: nonnegative.nullable(),
  destinationApproved: z.boolean().nullable(),
})
export const catchmentSchema = z.object({
  id: z.string().min(1), componentId: z.string().min(1), surfaceId: z.string().nullable(),
  areaM2: nonnegative.nullable(), areaBasis: valueBasisSchema, runoffCoefficient: fraction.nullable(),
  collectionEfficiency: fraction.nullable(), note: z.string().max(1000),
})
export const waterScenarioSchema = z.object({
  id: z.string().min(1), name: z.string().min(1).max(120), basis: z.enum(['user-provided', 'measured', 'estimated']), source: z.string().max(500),
  // One chronological daily step. eventStart explicitly resets first-flush diversion.
  days: z.array(z.object({ date: z.iso.date(), rainfallMm: nonnegative.nullable(), eventStart: z.boolean() })).min(1).max(3660),
}).refine(s => s.days.every((d,i) => i === 0 || Date.parse(d.date)-Date.parse(s.days[i-1].date)===86400000), 'Dates must be consecutive daily steps; add explicit dry days between rain events')
export const sensorSchema = z.object({
  id: z.string().min(1), componentId: z.string().nullable(), type: z.enum(['tank_level', 'flow', 'rainfall']),
  unit: z.enum(['%', 'L/s', 'mm']), value: z.number().nullable(), recordedAt: z.string().nullable(),
  online: z.boolean(), staleAfterMinutes: z.number().finite().positive(), source: z.string().min(1).max(200),
})
export const waterConfigSchema = z.object({
  version: z.literal(1), sourcePlanId: z.string(), roofSignature: z.string(),
  simple: z.object({version:z.literal(1),rainwater:z.boolean(),tankLitres:z.string().refine(v=>Number.isInteger(Number(v))&&Number(v)>=500&&Number(v)<=5000&&Number(v)%100===0,'Choose 500–5,000 litres in steps of 100'),roofDiameterScale:z.number().finite().min(.5).max(1).optional(),roofHeightScale:z.number().finite().min(.5).max(1.5).optional(),purpose:z.enum(['garden','cleaning']),rainfallMm:nonnegative.nullable()}).optional(),
  designStorm: z.object({intensityMmH: nonnegative.nullable(), source: z.string().max(1000)}).default({intensityMmH:null,source:''}),
  catchments: z.array(catchmentSchema).max(100), components: z.array(componentSchema).max(300),
  connections: z.array(z.object({ id: z.string().min(1), from: z.string(), to: z.string(), kind: z.enum(['collection', 'overflow']),
    diameterMm: z.number().finite().positive().nullable().optional(), material: z.string().max(120).nullable().optional(),
    viaM: z.array(waterPointSchema).max(100), routingBasis: z.literal('concept-user-route') })).max(600),
  demands: z.array(z.object({ tankId: z.string(), dailyLitres: nonnegative.nullable(), basis: valueBasisSchema })).max(50),
  scenarios: z.array(waterScenarioSchema).max(30), sensors: z.array(sensorSchema).max(100),
  assumptions: z.array(z.string().max(1000)).max(50),
}).superRefine((v,ctx) => {
  for (const key of ['catchments','components','connections','scenarios','sensors'] as const)
    if (new Set(v[key].map(x=>x.id)).size !== v[key].length) ctx.addIssue({code:'custom',path:[key],message:'IDs must be unique'})
})
export type WaterConfig = z.infer<typeof waterConfigSchema>
export type WaterComponent = z.infer<typeof componentSchema>
export type WaterScenario = z.infer<typeof waterScenarioSchema>
export type WaterSensor = z.infer<typeof sensorSchema>
export type WaterPoint = z.infer<typeof waterPointSchema>
export function parseWaterConfig(value: unknown): WaterConfig | null { const p=waterConfigSchema.safeParse(value); return p.success?p.data:null }
export function emptyWaterConfig(sourcePlanId: string, roofSignature: string): WaterConfig {
  return {version:1,sourcePlanId,roofSignature,designStorm:{intensityMmH:null,source:''},catchments:[],components:[],connections:[],demands:[],scenarios:[],sensors:[],assumptions:[
    'Daily water balance: collected inflow arrives before daily demand. Within-day peaks are not resolved.',
    'No evaporation, leakage or treatment consumption is assumed beyond explicit collection, first-flush and filter losses.',
    'Rainwater is non-potable unless a qualified treatment design establishes otherwise. Recharge routing is not groundwater recharge.',
    'Connection lines are user-defined concept routes, not structural penetration or drainage approvals.',
  ]}
}
/** Normalize schema field order and defaults before comparing editable inputs
 * with parsed simulation inputs. Object spread order is not a design change. */
export const waterSignature = (config: WaterConfig) => {
  const parsed=waterConfigSchema.safeParse(config)
  return parsed.success?JSON.stringify({...parsed.data,sensors:[]}):`invalid:${JSON.stringify(config)}`
}
