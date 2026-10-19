import { z } from 'zod'
import type { Brief } from '../model/brief.ts'
import type { Design } from '../engine/types.ts'
import type { BoqLine } from '../cost/boq.ts'
import { defaultSolarConfiguration } from '../model/solar.ts'
import { defaultSolarAssessmentInputs } from './assessmentInputs.ts'
import { buildSolarRoofModel, type SolarRoofArchitecture } from './roofModel.ts'
import { reviewSolarLayout, solarLayoutTotals } from './placement.ts'
import type { SolarLayoutV2, SolarConfiguration } from '../model/solar.ts'
import { planAzimuthToTrue } from './coordinates.ts'

export const SOLAR_RATE_VERSION = 'formstead-solar-concept-v1 · 2026-10-19'
export const SOLAR_RATE_SOURCE = 'Formstead internal concept allowances; Pune, Maharashtra; 2026-10-19. Not a supplier quotation, government schedule or verified market rate. Obtain a local itemized quotation.'
export const SOLAR_SCHEME_URL = 'https://pmsuryaghar.gov.in/'
export const SOLAR_MODEL_SOURCE = 'https://research-hub.nlr.gov/en/publications/weather-corrected-performance-ratio/'
export const SOLAR_BACKUP_SOURCE = 'https://www.sma.de/en/home/solar-system-power-outage'
const texts = z.array(z.string().max(12000)).max(200)
const nonnegative = z.number().finite().nonnegative()
export const solarEstimateSchema = z.object({
  schemaVersion: z.literal(1), status: z.enum(['not-included', 'undecided', 'reservation-only', 'needs-review', 'applied', 'legacy-allowance']),
  panelCount: nonnegative.int(), capacityKwp: nonnegative, grossInstallationCost: nonnegative, legacyAllowanceCost: nonnegative,
  objective: z.enum(['unknown', 'bill-savings', 'outage-backup', 'both']),
  backup: z.enum(['not-requested', 'pending']),
  inverter: z.object({ state: z.enum(['pending', 'incompatible', 'concept-compatible']), reasons: texts }),
  energy: z.object({ state: z.enum(['insufficient-information', 'preliminary-range', 'not-applicable']),
    annualKwh: z.object({ low: nonnegative, high: nonnegative }).nullable(), annualConsumptionKwh: nonnegative.nullable(), reasons: texts, basis: texts }),
  notes: texts, inclusions: texts, exclusions: texts, sources: texts,
  assistance: z.object({ status: z.literal('unverified'), deductedInr: z.literal(0), url: z.literal(SOLAR_SCHEME_URL) }),
})
export type SolarEstimate = z.infer<typeof solarEstimateSchema>
/** A full current Result may be supplied without importing the studio into the cost library. */
export type SolarCostContext = {
  buildingModel?: SolarRoofArchitecture['buildingModel'] | null
  massingModel?: SolarRoofArchitecture['massingModel'] | null
  facadeModel?: SolarRoofArchitecture['facadeGrammar'] | null
  villaDesignDNA?: SolarRoofArchitecture['villaDesignDNA'] | null
}
export function solarCostArchitecture(result?: SolarCostContext): SolarRoofArchitecture | undefined {
  return result?.buildingModel && result.massingModel && result.facadeModel && result.villaDesignDNA ? {
    buildingModel: result.buildingModel, massingModel: result.massingModel, facadeGrammar: result.facadeModel, villaDesignDNA: result.villaDesignDNA,
  } : undefined
}

export function assessInverter(layout: SolarLayoutV2, solar: SolarConfiguration): SolarEstimate['inverter'] {
  const e = solar.assessmentInputs.electrical
  if (Object.values(e).some(v => v === null || v === '' || v === 'unknown')) return { state: 'pending', reasons: ['Module and inverter datasheets, stringing, temperature bounds and supply phase are required to check compatibility.'] }
  const n = (key: keyof typeof e) => e[key] as number
  const series = n('modulesPerString'), parallel = n('parallelStrings'), totals = solarLayoutTotals(layout)
  const reasons: string[] = []
  if (e.panelSpecificationKey !== layout.specificationKey) reasons.push('Module electrical data does not match the applied versioned panel specification.')
  if (series * parallel !== totals.panelCount) reasons.push('Stringing must account for every applied panel exactly once.')
  if (e.supplyPhase !== e.inverterPhase) reasons.push('Inverter and supply phases do not match.')
  if (new Set(layout.panels.map(p => `${p.azimuthDeg}:${p.tiltDeg}`)).size > 1) reasons.push('Mixed array orientations require a multi-MPPT electrical design, which is not supported here.')
  const vocCold = series * n('moduleVocV') * (1 + n('vocCoefficientPctPerC') / 100 * (n('minimumCellC') - 25))
  const vmpHot = series * n('moduleVmpV') * (1 + n('vmpCoefficientPctPerC') / 100 * (n('maximumCellC') - 25))
  const vmpCold = series * n('moduleVmpV') * (1 + n('vmpCoefficientPctPerC') / 100 * (n('minimumCellC') - 25))
  if (n('moduleVmpV') >= n('moduleVocV') || n('moduleImpA') >= n('moduleIscA') || n('inverterMpptMinV') > n('inverterMpptMaxV')) reasons.push('Electrical datasheet values are inconsistent.')
  if (Math.abs(n('moduleVmpV') * n('moduleImpA') - totals.ratedPowerW) / totals.ratedPowerW > .05) reasons.push('Module Vmp × Imp must agree with the versioned module wattage within the 5% concept tolerance.')
  if (vocCold >= n('inverterMaxVocV')) reasons.push('Cold string open-circuit voltage exceeds the inverter limit.')
  if (vmpHot < n('inverterMpptMinV') || vmpCold > n('inverterMpptMaxV') || vmpHot < n('inverterStartV')) reasons.push('String voltages fall outside the inverter operating/start window.')
  if (parallel * n('moduleImpA') > n('inverterMaxInputA') || parallel * n('moduleIscA') > n('inverterMaxShortCircuitA')) reasons.push('Parallel string current exceeds the inverter input limit.')
  if (totals.capacityKwp > n('inverterMaxDcKwp') || totals.capacityKwp / n('inverterAcKw') > 1.5 || totals.capacityKwp / n('inverterAcKw') < .8) reasons.push('DC capacity or concept DC/AC sizing is outside the supported envelope (0.8–1.5).')
  return { state: reasons.length ? 'incompatible' : 'concept-compatible', reasons: reasons.length ? reasons : ['Single inverter / single-MPPT concept checks passed against user-provided datasheets. Installer must verify string protection, derating, grid approval and structural/electrical design.'] }
}

export function estimateSolarEnergy(layout: SolarLayoutV2 | null, solar: SolarConfiguration): SolarEstimate['energy'] {
  const energy: SolarEstimate['energy'] = { state: 'insufficient-information', annualKwh: null,
    annualConsumptionKwh: solar.inputs.monthlyConsumptionKwh === null ? null : 12 * solar.inputs.monthlyConsumptionKwh,
    reasons: [], basis: [] }
  if (!layout) { energy.reasons.push('An applied valid solar layout is required.'); return energy }
  const e = solar.assessmentInputs.energy, loc = solar.inputs.location, north = solar.inputs.orientation.planNorthBearingDeg
  if (loc.latitudeDeg === null || loc.longitudeDeg === null || north === null) energy.reasons.push('Provide location coordinates and a true-north bearing; road direction is not geographic south.')
  if (Object.values(e).some(v => v === null || v === '')) energy.reasons.push('Provide sourced plane-of-array irradiation, non-shading performance and shading ranges, reference period and weather assumptions.')
  const first = layout.panels[0]
  if (!first || new Set(layout.panels.map(p => `${p.azimuthDeg}:${p.tiltDeg}`)).size !== 1) energy.reasons.push('A separate irradiation basis for each array orientation is required; mixed orientations are not supported by this model.')
  const bearing = first ? planAzimuthToTrue(first.azimuthDeg, north) : null
  const angleDifference = bearing === null || e.trueAzimuthDeg === null ? Infinity : Math.abs(((bearing - e.trueAzimuthDeg + 540) % 360) - 180)
  if (e.latitudeDeg !== loc.latitudeDeg || e.longitudeDeg !== loc.longitudeDeg || angleDifference > .1 || !first || e.tiltDeg === null || Math.abs(e.tiltDeg - first.tiltDeg) > .1)
    energy.reasons.push('The resource basis must match the current location, true array azimuth and tilt.')
  if (energy.reasons.length) return energy
  const capacity = solarLayoutTotals(layout).capacityKwp
  energy.state = 'preliminary-range'
  energy.annualKwh = { low: Math.floor(capacity * e.annualPoaLowKwhM2! * e.nonShadingPrLow! * (1 - e.shadingLossHigh!) / 10) * 10,
    high: Math.ceil(capacity * e.annualPoaHighKwhM2! * e.nonShadingPrHigh! * (1 - e.shadingLossLow!) / 10) * 10 }
  energy.basis = [
    'Annual AC energy = applied DC kWp × annual plane-of-array irradiation (kWh/m²) / reference irradiance (1 kW/m²) × non-shading performance factor × (1 − shading loss). Conservative scenario bounds, rounded outward to 10 kWh; not a statistical confidence interval.',
    `POA ${e.annualPoaLowKwhM2}–${e.annualPoaHighKwhM2} kWh/m²/year; non-shading factor ${e.nonShadingPrLow}–${e.nonShadingPrHigh}; shading loss ${e.shadingLossLow}–${e.shadingLossHigh}. Do not include shading twice in the performance factor.`,
    `${loc.latitudeDeg}, ${loc.longitudeDeg}; true azimuth ${bearing}°; tilt ${first.tiltDeg}°. Period: ${e.referencePeriod}. Weather basis: ${e.weatherBasis}. Resource: ${e.sourceUrl}`,
    'No hourly dispatch, export, self-consumption, tariff, savings or payback model. Optional annual consumption is 12 × user-supplied monthly kWh; a rupee bill is not kWh.',
    'Assumes the grid is available with no export-limit curtailment or inverter downtime. Grid outages and battery/backup dispatch are not modelled; actual delivered energy can be lower.',
  ]
  return energy
}

export function solarCostSchedule(design: Design, brief: Brief, context?: SolarCostContext): { summary: SolarEstimate; lines: BoqLine[]; useLegacy: boolean } {
  const solar = brief.solar ?? defaultSolarConfiguration(), assessment = solar.assessmentInputs ?? defaultSolarAssessmentInputs()
  const normalized = { ...solar, assessmentInputs: assessment }
  const legacy = brief.specs.overrides.solar === 'on' && solar.intention === 'undecided' && assessment.legacyAllowance === 'preserve'
  const summary: SolarEstimate = { schemaVersion: 1,
    status: legacy ? 'legacy-allowance' : solar.intention === 'reserve-space' ? 'reservation-only' : solar.intention === 'install-now' ? 'needs-review' : solar.intention,
    panelCount: 0, capacityKwp: 0, grossInstallationCost: 0, legacyAllowanceCost: legacy ? 250000 : 0,
    objective: assessment.objective, backup: ['both', 'outage-backup'].includes(assessment.objective) ? 'pending' : 'not-requested',
    inverter: { state: 'pending', reasons: [] }, energy: estimateSolarEnergy(null, normalized),
    notes: [], inclusions: [], exclusions: [], sources: [], assistance: { status: 'unverified', deductedInr: 0, url: SOLAR_SCHEME_URL } }
  const lines: BoqLine[] = []
  if (summary.backup === 'pending') summary.notes.push('Backup configuration pending. Ordinary grid-connected PV shuts down during a grid outage. Hybrid inverter, battery, transfer/isolation equipment and critical-load design are not implemented or priced; the current estimate cannot meet the backup goal.')
  summary.notes.push('Government assistance is unverified and deducted by INR 0. Check eligibility, approved equipment, vendor, DISCOM process and current assistance on the official PM Surya Ghar portal. No eligibility or payment is promised.')
  if (legacy) summary.notes.push('Historical INR 250,000 solar allowance retained explicitly. It is a provisional legacy allowance, not an installed system or panel inventory. Configuring an applied valid system replaces it.')
  if (solar.intention !== 'install-now') { summary.energy.state = 'not-applicable'; return { summary, lines, useLegacy: solar.intention === 'undecided' && assessment.legacyAllowance === 'preserve' } }
  const layout = solar.calculated?.layout, architecture = solarCostArchitecture(context)
  if (!architecture || layout?.schemaVersion !== 2 || layout.validity.state !== 'concept-valid') {
    summary.notes.push('No installation quantities: apply a valid layout against the current accepted roof. Missing or stale layouts never fall back to the legacy allowance.')
    return { summary, lines, useLegacy: false }
  }
  try {
    const roof = buildSolarRoofModel(design, { architecture, inputs: solar.inputs, policy: layout.allocationPolicy })
    const validity = reviewSolarLayout(layout, normalized, roof)
    if (validity.state !== 'concept-valid' || !layout.panels.length) { summary.notes.push(`Saved layout needs review: ${validity.reasonCodes.join(', ') || 'no panels'}. No installation quantities included.`); return { summary, lines, useLegacy: false } }
  } catch { summary.notes.push('The current roof cannot be validated. Installation quantities are excluded.'); return { summary, lines, useLegacy: false } }
  const totals = solarLayoutTotals(layout)
  Object.assign(summary, { panelCount: totals.panelCount, capacityKwp: totals.capacityKwp, status: 'applied' })
  summary.inverter = assessInverter(layout, normalized)
  summary.energy = estimateSolarEnergy(layout, normalized)
  const add = (id: string, label: string, specification: string, qty: number, unit: string, materialRate: number, labourRate = 0) => lines.push({
    id: `solar-pv:${id}`, item: `solar-pv-${id}`, specId: `solar/${id}/v1`, rateId: `solar-concept-v1/${id}`, group: 'Electrical', label, specification,
    qty, quantity: qty, unit, rate: materialRate + labourRate, amount: qty * (materialRate + labourRate), materialRate, labourRate,
    materialAmount: qty * materialRate, labourAmount: qty * labourRate, note: SOLAR_RATE_SOURCE,
  })
  const kwp = summary.capacityKwp, count = summary.panelCount, e = assessment.electrical
  add('panels', 'PV modules', `${layout.specification.name} · ${layout.specification.ratedPowerW} W · ${layout.specificationKey}`, count, 'panel', layout.specification.ratedPowerW * 19)
  // Incomplete or incompatible electrical specifications retain a labelled allowance, never a fictitious compatible product.
  const compatible = summary.inverter.state === 'concept-compatible'
  add('inverter', compatible ? 'Grid-connected inverter · concept compatible' : 'Grid-connected inverter allowance · compatibility pending',
    compatible ? `${e.inverterName} · ${e.inverterAcKw} kW AC · ${e.inverterSource}` : 'Sizing allowance only; datasheets, stringing and supply compatibility must be resolved before procurement.', 1, compatible ? 'inverter' : 'allowance', compatible ? Math.max(16000, e.inverterAcKw! * 7500) : Math.max(16000, kwp * 7500))
  add('mounting', 'PV mounting and supports allowance', `${solar.inputs.mounting === 'raised-frame' ? 'Raised frame' : solar.inputs.mounting === 'low-tilt' ? 'Low tilt' : 'Mounting choice pending'}; structural/wind design and waterproofing review required`, count, 'panel', solar.inputs.mounting === 'raised-frame' ? 3500 : 2200)
  add('wiring', 'Solar DC/AC wiring and conduit allowance', 'Routes, lengths, conductor sizes and voltage drop pending site design; not measured cable lengths.', kwp, 'kWp allowance', 2400)
  add('protection', 'Solar isolation, surge and circuit protection allowance', 'One dedicated PV protection package; final ratings and devices pending electrical design.', 1, 'allowance', 7000)
  add('earthing', 'Dedicated solar earthing and bonding allowance', 'PV-specific provision separate from base house earthing; electrode count, resistance and lightning design pending survey.', 1, 'allowance', 6000)
  add('labour', 'Solar installation labour', 'Module, frame, cable and inverter installation; no battery or major civil works.', kwp, 'kWp', 0, 3500)
  add('commissioning', 'Testing, commissioning and transport allowance', 'Concept provision; DISCOM/net-meter authority fees, approvals and meter upgrades excluded.', 1, 'allowance', 2000, 2500)
  summary.grossInstallationCost = lines.reduce((sum, line) => sum + line.amount, 0)
  summary.inclusions = ['Applied panel inventory, inverter allowance or concept-compatible selection, mounting, dedicated solar wiring/protection/earthing, installation labour, testing and transport allowances.']
  summary.exclusions = ['Solar taxes pending an itemized quotation and applicable tax basis; no solar GST provision added.', 'Battery, hybrid/backup system, backup hours, critical-load circuits, roof strengthening, major civil work, utility/net-meter fees and upgrades, maintenance/replacement costs.']
  summary.notes.push('Gross solar installation cost is the direct pre-tax solar BOQ subtotal, before shared project overhead, contingency and fees. No subsidy deducted. Internal concept rates are provisional; validate with a local installer. Base house electrical scope remains separate.',
    'The 3D shadow preview is decorative only and is not a validated shading or energy analysis.')
  summary.sources = [SOLAR_RATE_SOURCE, `Energy model basis: ${SOLAR_MODEL_SOURCE}`, `Grid outage limitation: ${SOLAR_BACKUP_SOURCE}`, ...[e.moduleSource, e.inverterSource, assessment.energy.sourceUrl].filter((v): v is string => !!v)]
  return { summary, lines, useLegacy: false }
}
