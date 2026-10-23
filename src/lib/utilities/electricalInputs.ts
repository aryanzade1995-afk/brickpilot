import { z } from 'zod'
const text = z.string().max(500), n = z.number().finite(), positive = n.positive().max(1e9).nullable()
const factor = n.positive().max(1).nullable()
export const electricalLoadSchema = z.object({ watts: n.min(0).max(1e7).nullable(), basis: z.enum(['unknown', 'estimate', 'nameplate']), reference: text, kind: z.enum(['unknown', 'light', 'fan', 'socket', 'ac', 'geyser', 'cooking', 'pump', 'washing_machine', 'other']), dedicated: z.boolean() })
export const electricalCircuitSchema = z.object({
  phase: z.enum(['unknown', 'L1', 'L2', 'L3']), demandFactor: factor, demandReference: text, powerFactor: factor,
  conductor: z.enum(['unknown', 'copper', 'aluminium']), areaMm2: positive, insulation: text, installation: text, ambientC: n.min(-50).max(100).nullable(), grouping: positive,
  baseAmpacityA: positive, temperatureFactor: factor, groupingFactor: factor, otherFactor: factor, tableReference: text,
  voltageDropMvAm: positive, dropReference: text, upstreamDropPercent: n.min(0).max(100).nullable(),
  breakerA: positive, breakerType: z.enum(['unknown', 'MCB', 'RCBO']), curve: text, breakingCapacityKa: positive, conventionalTripA: positive,
  residualMa: positive, residualType: text, peAreaMm2: positive, peReference: text, shortCircuitReference: text,
  measuredLongestM: positive, lengthReference: text, routeReview: text,
})
export const electricalInputsSchema = z.object({
  version: z.literal(1), planSignature: text.default(''), city: text, supplier: text, supply: z.enum(['unknown', 'single-phase', 'three-phase']), voltageLn: positive, sanctionedKw: positive, prospectiveFaultKa: positive, supplyReference: text,
  nbcApplicabilityReference: text, earthingSystem: text, bondingReference: text,
  db: z.object({ ratingA: positive, incomerA: positive, residualMa: positive, ways: n.int().min(1).max(1000).nullable(), spareWays: n.int().min(0).max(1000).nullable(), accessReference: text, feederReference: text }),
  loads: z.record(z.string(), electricalLoadSchema), circuits: z.record(z.string(), electricalCircuitSchema),
  additionalLoads: z.array(z.object({ id: text.min(1), name: text.min(1), roomId: text.min(1), endpointId: text.nullable() }).merge(electricalLoadSchema)).max(200).refine(xs => new Set(xs.map(x => x.id)).size === xs.length),
  // Reviewed elevations only; illustrative mount heights are never evidence of clearance.
  serviceElevationsMm: z.record(z.string(), n.min(-1e6).max(1e6)), conceptClearanceMm: n.min(0).max(2000),
  wetReview: z.record(z.string(), text), placementReview: z.record(z.string(), text), junctionReview: z.record(z.string(), text),
  commissioning: z.record(z.string(), z.object({ result: z.enum(['not-tested', 'pass', 'fail']), reference: text })),
})
export type ElectricalInputs = z.infer<typeof electricalInputsSchema>
export type ElectricalCircuitInput = z.infer<typeof electricalCircuitSchema>
export type ElectricalLoadInput = z.infer<typeof electricalLoadSchema>
export function emptyCircuitInput(): ElectricalCircuitInput {
  return { phase: 'unknown', demandFactor: null, demandReference: '', powerFactor: null, conductor: 'unknown', areaMm2: null, insulation: '', installation: '', ambientC: null, grouping: null, baseAmpacityA: null, temperatureFactor: null, groupingFactor: null, otherFactor: null, tableReference: '', voltageDropMvAm: null, dropReference: '', upstreamDropPercent: null, breakerA: null, breakerType: 'unknown', curve: '', breakingCapacityKa: null, conventionalTripA: null, residualMa: null, residualType: '', peAreaMm2: null, peReference: '', shortCircuitReference: '', measuredLongestM: null, lengthReference: '', routeReview: '' }
}
export function emptyLoadInput(): ElectricalLoadInput { return { watts: null, basis: 'unknown', reference: '', kind: 'unknown', dedicated: false } }
export function defaultElectricalInputs(): ElectricalInputs {
  return { version: 1, planSignature: '', city: '', supplier: '', supply: 'unknown', voltageLn: null, sanctionedKw: null, prospectiveFaultKa: null, supplyReference: '', nbcApplicabilityReference: '', earthingSystem: '', bondingReference: '', db: { ratingA: null, incomerA: null, residualMa: null, ways: null, spareWays: null, accessReference: '', feederReference: '' }, loads: {}, circuits: {}, additionalLoads: [], serviceElevationsMm: {}, conceptClearanceMm: 300, wetReview: {}, placementReview: {}, junctionReview: {}, commissioning: {} }
}
