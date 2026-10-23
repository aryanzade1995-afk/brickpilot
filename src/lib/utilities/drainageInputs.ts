import { z } from 'zod'

const finite = z.number().finite().min(-1e6).max(1e6)
const point = z.object({ x: finite, y: finite })
const rect = z.object({ x: finite, y: finite, w: finite.positive(), h: finite.positive() })
const text = z.string().max(500)
export const drainageFixtureKinds = ['toilet', 'washbasin', 'shower', 'bathtub', 'kitchen_sink', 'washing_machine', 'floor_drain', 'unknown_sink'] as const
export type DrainageFixtureKind = typeof drainageFixtureKinds[number]
export const drainageInputsSchema = z.object({
  version: z.literal(1), city: text, authority: z.enum(['unknown', 'PMC', 'PCMC', 'PMRDA', 'other']), localReviewReference: text,
  // One survey datum for all invert and floor levels; null is unknown, never zero.
  datum: text, floorElevationMm: finite.nullable(), groundElevationMm: finite.nullable(),
  outlet: z.object({ kind: z.enum(['unknown', 'sewer', 'septic', 'treatment']), position: point.nullable(), invertMm: finite.nullable(), approvalReference: text }),
  inspectionChamber: point.nullable(),
  fixtures: z.array(z.object({ id: text.min(1), roomId: text.min(1), kind: z.enum(drainageFixtureKinds), position: point })).max(200).refine(v => new Set(v.map(x => x.id)).size === v.length, 'Duplicate proposed fixture IDs.'),
  fixtureChoices: z.record(z.string(), z.object({ ruleKey: text, invertMm: finite.nullable(), trapConfirmed: z.boolean() })),
  pipes: z.record(z.string(), z.object({ gradientRatio: z.number().finite().positive().max(10000).nullable(), inletInvertMm: finite.nullable(), outletInvertMm: finite.nullable(), diameterMm: z.number().finite().positive().max(2000).nullable() })),
  // Reviewed sleeves/penetrations only. An ordinary doorway is NOT permission.
  penetrations: z.array(z.object({ id: text.min(1), rect, reference: text.min(1), minElevationMm: finite, maxElevationMm: finite }).refine(x => x.maxElevationMm >= x.minElevationMm)).max(200),
  reserved: z.array(z.object({ id: text.min(1), rect })).max(200),
  stackBases: z.record(z.string(), z.object({ position: point, invertMm: finite.nullable() })),
  ventTerminals: z.record(z.string(), z.object({ elevationMm: finite.nullable(), diameterMm: z.number().finite().positive().nullable(), reference: text })),
  maintenanceConfirmed: z.array(text).max(1000), junctionsConfirmed: z.array(text).max(1000),
  serviceLevels: z.record(z.string(), finite),
  conceptClearanceMm: z.number().finite().min(0).max(1000),
  visible: z.object({ soil: z.boolean(), waste: z.boolean(), vent: z.boolean(), stormwater: z.boolean(), building_drain: z.boolean() }),
})
export type DrainageInputs = z.infer<typeof drainageInputsSchema>
export function defaultDrainageInputs(): DrainageInputs {
  return { version: 1, city: '', authority: 'unknown', localReviewReference: '', datum: '', floorElevationMm: null, groundElevationMm: null,
    outlet: { kind: 'unknown', position: null, invertMm: null, approvalReference: '' }, inspectionChamber: null,
    fixtures: [], fixtureChoices: {}, pipes: {}, penetrations: [], reserved: [], stackBases: {}, ventTerminals: {},
    maintenanceConfirmed: [], junctionsConfirmed: [], serviceLevels: {}, conceptClearanceMm: 0,
    visible: { soil: true, waste: true, vent: true, stormwater: true, building_drain: true } }
}
