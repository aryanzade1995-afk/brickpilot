import { z } from 'zod'
import { fnv } from '../engine/massing/rng.ts'
import { solarAllocationPolicySchema, solarPlacementPolicySchema } from '../solar/policy.ts'
import { solarAssessmentInputsSchema, defaultSolarAssessmentInputs } from '../solar/assessmentInputs.ts'
import { governmentSupportInputsSchema } from '../solar/governmentSupportInputs.ts'

const finite = z.number().finite()
const positive = finite.positive()
const id = z.string().trim().min(1).max(160)
const azimuth = finite.min(0).lt(360)
const tilt = finite.min(0).max(90)
const nullable = <T extends z.ZodType>(schema: T) => schema.nullable().default(null)
const uniqueIds = (values: { id: string }[]) => new Set(values.map(value => value.id)).size === values.length

export const solarIntentionSchema = z.enum(['undecided', 'not-included', 'reserve-space', 'install-now'])
export const solarPanelSpecificationSchema = z.strictObject({
  schemaVersion: z.literal(1).default(1),
  id, name: z.string().trim().min(1).max(250),
  source: z.enum(['unknown', 'illustrative', 'manufacturer']).default('unknown'),
  revision: nullable(id),
  // Physical module dimensions, not its projected footprint on a tilted array.
  dimensionsMm: z.strictObject({ width: positive.max(10000), height: positive.max(10000), thickness: positive.max(1000) }),
  ratedPowerW: positive.max(10000),
})
export const solarRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('unknown') }),
  z.strictObject({ kind: z.literal('panel-count'), panelCount: z.number().int().min(1).max(10000) }),
  z.strictObject({ kind: z.literal('capacity'), capacityKwp: positive.max(10000) }),
])
export const solarReservedAreaSchema = z.strictObject({
  id, label: z.string().trim().max(250).default(''), roofSurfaceId: nullable(id),
  level: z.number().int().min(0).max(20),
  rectMm: z.strictObject({ x: finite, y: finite, w: positive, h: positive }),
})
export const solarInputsSchema = z.strictObject({
  panel: solarPanelSpecificationSchema.nullable().default(null),
  request: solarRequestSchema.prefault({ kind: 'unknown' }),
  monthlyConsumptionKwh: nullable(finite.min(0).max(1000000)),
  location: z.strictObject({
    latitudeDeg: nullable(finite.min(-90).max(90)), longitudeDeg: nullable(finite.min(-180).max(180)),
    stateCode: nullable(z.string().trim().min(1).max(20)), locality: nullable(z.string().trim().min(1).max(250)),
  }).prefault({}).refine(value => (value.latitudeDeg === null) === (value.longitudeDeg === null),
    'Provide both latitude and longitude, or leave both unknown'),
  // Bearing of plan-up relative to true north, clockwise. Never inferred from the road.
  orientation: z.strictObject({ planNorthBearingDeg: nullable(azimuth), preferredPanelAzimuthDeg: nullable(azimuth) }).prefault({}),
  mounting: z.enum(['unknown', 'low-tilt', 'raised-frame']).default('unknown'),
  reservedAreas: z.array(solarReservedAreaSchema).max(200).default([]).refine(uniqueIds, 'Reserved area IDs must be unique'),
  placement: z.strictObject({
    /** Local plan bearing; separate from the preferred true-geographic azimuth. */
    arrayRotationDeg: nullable(azimuth),
    mode: z.enum(['automatic', 'manual']).default('automatic'),
    moduleOrientation: z.enum(['auto', 'portrait', 'landscape']).default('auto'),
    tiltDeg: nullable(tilt), mountingHeightMm: nullable(finite.min(0).max(10000)),
    edgeClearanceMm: nullable(finite.min(0).max(100000)), rowGapMm: nullable(finite.min(0).max(100000)),
  }).prefault({}),
}).prefault({})

/** Contract for downstream placement, not a claim that a roof is safe or a layout verified. */
const legacySolarLayoutSchema = z.strictObject({
  schemaVersion: z.literal(1), roofSignature: id,
  coordinates: z.literal('plan-x-east-y-south-z-up'), units: z.literal('mm'),
  panels: z.array(z.strictObject({
    id, roofSurfaceId: id,
    positionMm: z.strictObject({ x: finite, y: finite, z: finite }),
    azimuthDeg: azimuth, tiltDeg: tilt,
  })).max(10000).refine(uniqueIds, 'Panel IDs must be unique'),
})
export const solarPanelPlacementSchema = z.strictObject({
  id, roofSurfaceId: id, roofComponentId: id, specificationKey: id,
  moduleOrientation: z.enum(['portrait', 'landscape']),
  dimensionsMm: z.strictObject({ width: positive, slopeLength: positive, thickness: positive }),
  ratedPowerW: positive,
  positionMm: z.strictObject({ x: finite, y: finite, z: finite }),
  baseElevationMm: finite, mountingHeightMm: finite.min(0), azimuthDeg: azimuth, tiltDeg: tilt,
})
export const solarLayoutV2Schema = z.strictObject({
  schemaVersion: z.literal(2), engineVersion: z.literal('solar-placement-v1'),
  roofSignature: id, allocationSignature: id, configurationSignature: id,
  coordinates: z.literal('plan-x-east-y-south-z-up'), units: z.literal('mm'),
  specification: solarPanelSpecificationSchema, specificationKey: id,
  allocationPolicy: solarAllocationPolicySchema, placementPolicy: solarPlacementPolicySchema,
  resolved: z.strictObject({ tiltDeg: tilt, mountingHeightMm: finite.min(0), arrayRotationDeg: azimuth,
    rowGapMm: finite.min(0), moduleGapMm: finite.min(0), assumptions: z.array(z.string().max(500)).max(30) }),
  validity: z.strictObject({ state: z.enum(['concept-valid', 'needs-review', 'invalid']), reasonCodes: z.array(id).max(100) }),
  panels: z.array(solarPanelPlacementSchema).max(10000).refine(uniqueIds, 'Panel IDs must be unique'),
})
export const solarLayoutSchema = z.discriminatedUnion('schemaVersion', [legacySolarLayoutSchema, solarLayoutV2Schema])
export type SolarLayout = z.infer<typeof solarLayoutSchema>
export type SolarLayoutV2 = z.infer<typeof solarLayoutV2Schema>
export type SolarPanelPlacement = z.infer<typeof solarPanelPlacementSchema>

const configurationBase = z.strictObject({
  schemaVersion: z.literal(1).default(1),
  intention: solarIntentionSchema.default('undecided'),
  inputs: solarInputsSchema,
  assessmentInputs: solarAssessmentInputsSchema,
  // Calculations remain separate from inputs; canonical v2 layouts are explicitly applied.
  calculated: z.strictObject({ configurationSignature: id, layout: solarLayoutSchema }).nullable().default(null),
}).prefault({})
type Configuration = z.infer<typeof configurationBase>

/** Stable across JSON key insertion order; arrays with IDs are sorted explicitly below. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`
  return JSON.stringify(value)
}
function signature(namespace: string, value: unknown): string {
  const text = canonical(value)
  return `${namespace}-${fnv(text).toString(16).padStart(8, '0')}${fnv(`${namespace}|${text}`).toString(16).padStart(8, '0')}`
}
/** Versioned content identity: an ID reused with other dimensions/wattage is another specification. */
export function solarPanelSpecificationKey(panel: z.input<typeof solarPanelSpecificationSchema>): string {
  return signature('pv-spec-v1', solarPanelSpecificationSchema.parse(panel))
}
export function solarConfigurationSignature(config: Pick<Configuration, 'schemaVersion' | 'intention' | 'inputs'>): string {
  return signature('solar-config-v1', { schemaVersion: config.schemaVersion, intention: config.intention,
    inputs: { ...config.inputs, reservedAreas: [...config.inputs.reservedAreas].sort((a, b) => a.id.localeCompare(b.id)) } })
}
export function solarLayoutSignature(layout: SolarLayout | null): string {
  return signature('solar-layout-v1', layout && { ...layout, panels: [...layout.panels].sort((a, b) => a.id.localeCompare(b.id)) })
}
export const solarConfigurationSchema = configurationBase.superRefine((config, ctx) => {
  if (!config.calculated) return
  if (config.calculated.configurationSignature !== solarConfigurationSignature(config))
    ctx.addIssue({ code: 'custom', path: ['calculated'], message: 'Solar calculation belongs to different inputs' })
  if (config.intention !== 'install-now' && config.calculated.layout.panels.length)
    ctx.addIssue({ code: 'custom', path: ['calculated'], message: 'Only an installation plan can contain panels' })
  if (config.calculated.layout.panels.length && !config.inputs.panel)
    ctx.addIssue({ code: 'custom', path: ['inputs', 'panel'], message: 'A panel specification is required for placed panels' })
  const layout = config.calculated.layout
  if (layout.schemaVersion === 2 && (layout.configurationSignature !== config.calculated.configurationSignature ||
    !config.inputs.panel || solarPanelSpecificationKey(config.inputs.panel) !== layout.specificationKey ||
    solarPanelSpecificationKey(layout.specification) !== layout.specificationKey))
    ctx.addIssue({ code: 'custom', path: ['calculated'], message: 'Solar layout specification or input identity does not match' })
})
export type SolarConfiguration = z.infer<typeof solarConfigurationSchema>
export type SolarInputs = z.infer<typeof solarInputsSchema>
export const defaultSolarConfiguration = (): SolarConfiguration => solarConfigurationSchema.parse({})
export const solarUpdateSchema = z.strictObject({ intention: solarIntentionSchema, inputs: solarInputsSchema })

export function solarSignature(config: SolarConfiguration): string {
  const original = signature('solar-v1', [solarConfigurationSignature(config), solarLayoutSignature(config.calculated?.layout ?? null)])
  const assessment = config.assessmentInputs ?? defaultSolarAssessmentInputs()
  return JSON.stringify(assessment) === JSON.stringify(defaultSolarAssessmentInputs()) ? original : signature('solar-assessment-v1', [original, assessment])
}

/** Bad optional solar data must not discard the household's building or its legacy allowance. */
export function recoverStoredSolar(value: unknown): SolarConfiguration {
  const parsed = solarConfigurationSchema.safeParse(value)
  if (parsed.success) return parsed.data
  if (value && typeof value === 'object' && 'assessmentInputs' in value && value.assessmentInputs && typeof value.assessmentInputs === 'object' &&
    'governmentSupport' in value.assessmentInputs && !governmentSupportInputsSchema.safeParse(value.assessmentInputs.governmentSupport).success) {
    return recoverStoredSolar({ ...value, assessmentInputs: { ...value.assessmentInputs, governmentSupport: governmentSupportInputsSchema.parse({}) } })
  }
  if (value && typeof value === 'object' && 'assessmentInputs' in value &&
    !solarAssessmentInputsSchema.safeParse(value.assessmentInputs).success) {
    // An optional assessment extension must not erase an otherwise valid saved PV layout.
    return recoverStoredSolar({ ...value, assessmentInputs: defaultSolarAssessmentInputs() })
  }
  if (value && typeof value === 'object' && (value as { schemaVersion?: unknown }).schemaVersion === 1) {
    // Stage-1 layouts lack a versioned panel and local array bearing. Migrate only
    // when the exact historical input signature matches; never bless changed inputs.
    const raw = value as Record<string, unknown>, oldCalculation = raw.calculated as { configurationSignature?: unknown; layout?: unknown } | null
    const normalized = configurationBase.safeParse({ ...raw, calculated: null })
    const oldLayout = legacySolarLayoutSchema.safeParse(oldCalculation?.layout)
    const rawInputs = raw.inputs as { panel?: Record<string, unknown> | null; placement?: Record<string, unknown> } | undefined
    if (normalized.success && oldLayout.success && oldCalculation &&
      (rawInputs?.panel && !('schemaVersion' in rawInputs.panel) || rawInputs?.placement && !('arrayRotationDeg' in rawInputs.placement))) {
      const current = normalized.data
      const { schemaVersion: _panelVersion, ...oldPanel } = current.inputs.panel ?? {}
      const { arrayRotationDeg: _rotation, ...oldPlacement } = current.inputs.placement
      const legacyInputs = { ...current.inputs,
        panel: current.inputs.panel && !rawInputs?.panel?.schemaVersion ? oldPanel : current.inputs.panel,
        placement: rawInputs?.placement && 'arrayRotationDeg' in rawInputs.placement ? current.inputs.placement : oldPlacement,
        reservedAreas: [...current.inputs.reservedAreas].sort((a, b) => a.id.localeCompare(b.id)) }
      const previousKey = signature('solar-config-v1', { schemaVersion: current.schemaVersion, intention: current.intention, inputs: legacyInputs })
      if (oldCalculation.configurationSignature === previousKey) {
        const migrated = solarConfigurationSchema.safeParse({ ...current, calculated: {
          configurationSignature: solarConfigurationSignature(current), layout: oldLayout.data } })
        if (migrated.success) return migrated.data
      }
    }
    const inputsOnly = solarConfigurationSchema.safeParse({ ...value, calculated: null })
    if (inputsOnly.success) return inputsOnly.data
  }
  return defaultSolarConfiguration()
}
