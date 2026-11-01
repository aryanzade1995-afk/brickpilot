import type { Design } from '../engine/types.ts'
import type { Brief } from '../model/brief.ts'
import type { CostEstimate } from '../cost/boq.ts'
import { specsCatalogue, specificationRate } from '../cost/catalogue.ts'
import type { ValidationReport } from '../rules/index.ts'
import { createBuildingModel, type BuildingModel, type BuildingDoor } from '../engine/buildingModel.ts'
import { ventilationPaths, AIR_SIDES } from '../utilities/ventilation.ts'
import { entryRamp, type EntryRamp } from '../engine/entryRamp.ts'
import { rainfallYield, tankStep } from '../water/engineering.ts'
import { impactSchema, type ImpactDocument } from './schema.ts'
import cityRainfallRaw from './data/cityRainfall.json' with { type: 'json' }
import { NATIONAL_STANDARDS, EMBODIED_CARBON_DEFAULTS, lookupCityRwhRule } from './data/nationalStandards.ts'

export const IMPACT_SOURCES = [
  { label: 'BEE residential envelope guidance', url: 'https://www.beeindia.gov.in/show_content.php?lang=1&level=2&lid=328&ls_id=202', checked: '2026-10-28' },
  { label: 'Universal accessibility guidance', url: 'https://depwd.gov.in/en/document/harmonised-guidelines-standards-for-universal-accessibility-in-india-2021/', checked: '2026-10-28' },
  { label: 'Rainwater harvesting references', url: 'https://jsactr.mowr.gov.in/Public_Dash/KnowledgeCentre.aspx', checked: '2026-10-28' },
  { label: 'PM Surya Ghar: Muft Bijli Yojana', url: 'https://pmsuryaghar.gov.in', checked: '2026-10-31' },
  { label: 'PMAY Urban Housing Mission Guidelines', url: 'https://pmay-urban.gov.in', checked: '2026-10-31' },
]

export type ImpactCheck = { id: string; status: 'Review' | 'Not checked' | 'Recorded'; title: string; detail: string; href: string }

export function housingTopic(question: string) {
  const q = question.normalize('NFKC').toLowerCase()
  const topics = [
    ['affordability', /\bbudget\b|\bcosts?\b|afford|बजट|बजेट|खर्च|किंमत|कीमत|लागत|सस्ता/],
    ['water', /\bwater\b|\brain(?:fall)?\b|पानी|पाण|पाऊस|पावस|बारिश|वर्षा/],
    ['access', /\bramps?\b|\bstairs?\b|step.free|access|wheelchair|रैंप|रॅम्प|सुलभ|व्हील|प्रवेश/],
    ['climate', /\bair\b|\bheat\b|cool|climate|हवा|गर्मी|उष्ण|थंड|ठंड|वायुवीजन/],
    ['sustainability', /carbon|energy|material|कार्बन|ऊर्जा|साहित्य|सामग्री/],
    ['community', /ngo|community|household|समुदाय|कुटुंब|परिवार/],
    ['safety', /safe|drain|fire|electric|सुरक्ष|निचरा|नाली|आग|विद्युत|वीज/],
  ] as const
  return topics.find(([, pattern]) => pattern.test(q))?.[0] ?? null
}

export function cityRainfallLookup(cityName: string) {
  const norm = (cityName || '').trim().toLowerCase()
  const cities = (cityRainfallRaw as { cities: Record<string, { city: string; annualRainfallMm: number; monsoonMonths: string; verified: boolean; source: string }> }).cities
  const found = Object.values(cities).find(c =>
    c.city.toLowerCase() === norm || norm.includes(c.city.toLowerCase()) || c.city.toLowerCase().includes(norm)
  )
  return found ?? cities.rural ?? { city: cityName || 'Custom', annualRainfallMm: 800, monsoonMonths: 'June - September', verified: false, source: 'National rainfall assumption' }
}

export interface EcoSwapItem {
  lineId: string
  itemId: string
  label: string
  current: string
  currentOptionId: string
  alternative: string
  alternativeOptionId: string
  quantity: number
  unit: string
  rupeeSaving: number
  currentCarbonFactor: number
  altCarbonFactor: number
  kgCo2eSaving: number
  isLowerCarbon: boolean
  isAssumption: boolean
  group: string
  roomId?: string
  href: string
}

export function affordableAlternatives(cost: CostEstimate) {
  return calculateEcoSwaps(cost).map(s => ({
    lineId: s.lineId,
    label: s.label,
    current: s.current,
    alternative: s.alternative,
    quantity: s.quantity,
    unit: s.unit,
    difference: s.rupeeSaving,
    href: s.href,
  }))
}

export function calculateEcoSwaps(cost: CostEstimate): EcoSwapItem[] {
  const allowed = new Set(['floor-tiles', 'floor-stone', 'floor-wood', 'interior-paint', 'bathroom-floor', 'bathroom-wall', 'kitchen-counter', 'kitchen-cabinets', 'external-paint', 'wall-cladding', 'terrace-waterproofing'])
  
  const estimateCarbonFactor = (optionId: string, group: string): { factor: number; verified: boolean } => {
    const id = optionId.toLowerCase()
    if (/kota|stone|sandstone/.test(id)) return { factor: EMBODIED_CARBON_DEFAULTS['kota-stone'].factor, verified: false }
    if (/granite/.test(id)) return { factor: EMBODIED_CARBON_DEFAULTS.granite.factor, verified: false }
    if (/marble/.test(id)) return { factor: EMBODIED_CARBON_DEFAULTS.marble.factor, verified: false }
    if (/vitrified|ceramic|tile/.test(id)) return { factor: EMBODIED_CARBON_DEFAULTS['ceramic-tile'].factor, verified: false }
    if (/wood|timber/.test(id)) return { factor: EMBODIED_CARBON_DEFAULTS['wood-flooring'].factor, verified: false }
    if (/low-voc|lime|distemper/.test(id)) return { factor: EMBODIED_CARBON_DEFAULTS['low-voc-distemper'].factor, verified: false }
    if (/paint|emulsion/.test(id)) return { factor: EMBODIED_CARBON_DEFAULTS['acrylic-emulsion'].factor, verified: false }
    if (/cool-roof|reflective/.test(id)) return { factor: EMBODIED_CARBON_DEFAULTS['reflective-cool-roof'].factor, verified: false }
    if (/waterproof|bitumen/.test(id)) return { factor: EMBODIED_CARBON_DEFAULTS['standard-bitumen'].factor, verified: false }
    if (/fly-ash/.test(id)) return { factor: EMBODIED_CARBON_DEFAULTS['fly-ash-brick'].factor, verified: false }
    if (/brick|clay/.test(id)) return { factor: EMBODIED_CARBON_DEFAULTS['red-clay-brick'].factor, verified: false }
    
    // Group defaults
    if (group === 'flooring') return { factor: 16.0, verified: false }
    if (group === 'painting') return { factor: 3.5, verified: false }
    return { factor: 10.0, verified: false }
  }

  return cost.boq.flatMap(line => {
    if (!allowed.has(line.item) && !/^floor-/.test(line.item)) return []
    const item = specsCatalogue.items.find(i => i.id === line.item)
    if (!item || line.quantity <= 0) return []
    const current = line.specId.split('/')[1]
    const candidates = item.options.filter(o => o.id !== current && !/off|none/.test(o.id)).flatMap(o => {
      const rate = specificationRate(o.rateId)
      return rate.unit.replace('m2', 'm²').replace('m3', 'm³') === line.unit && rate.installed < line.rate
        ? [{ id: o.id, name: o.name, rate: rate.installed }]
        : []
    }).sort((a, b) => a.rate - b.rate)
    const best = candidates[0]
    if (!best) return []

    const currentCarbon = estimateCarbonFactor(current, item.group)
    const altCarbon = estimateCarbonFactor(best.id, item.group)
    const kgCo2eSaving = Math.max(0, (currentCarbon.factor - altCarbon.factor) * line.quantity)

    return [{
      lineId: line.id,
      itemId: item.id,
      label: line.label,
      current: line.specification,
      currentOptionId: current,
      alternative: best.name,
      alternativeOptionId: best.id,
      quantity: line.quantity,
      unit: line.unit,
      rupeeSaving: (line.rate - best.rate) * line.quantity,
      currentCarbonFactor: currentCarbon.factor,
      altCarbonFactor: altCarbon.factor,
      kgCo2eSaving: Number(kgCo2eSaving.toFixed(1)),
      isLowerCarbon: kgCo2eSaving > 0,
      isAssumption: !currentCarbon.verified || !altCarbon.verified,
      group: item.group,
      roomId: line.roomId,
      href: `/workspace/finishes?tab=specifications&section=${item.group}${line.roomId ? '&room=' + encodeURIComponent(line.roomId) : ''}`,
    }]
  }).sort((a, b) => b.rupeeSaving - a.rupeeSaving).slice(0, 8)
}

export function solarYield(roofAreaM2: number, usableFraction = 0.70) {
  const usableM2 = Math.max(0, roofAreaM2 * usableFraction)
  // ~10 m² per kWp, rounded to nearest 0.5 kW, minimum 1 kW, maximum 10 kW for residential
  const kw = Math.min(10, Math.max(1, Math.round((usableM2 / 10) * 2) / 2))
  const annualKwh = Math.round(kw * NATIONAL_STANDARDS.solarAnnualKwhPerKwp.value)
  
  // 12-month generation distribution based on typical Indian solar insolation profile
  const monthWeights = [0.08, 0.085, 0.095, 0.10, 0.105, 0.075, 0.065, 0.065, 0.075, 0.085, 0.085, 0.085]
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const monthlyKwh = monthWeights.map((w, i) => ({
    month: months[i],
    kwh: Math.round(annualKwh * w),
  }))

  return { usableM2, kw, annualKwh, monthlyKwh }
}

/**
 * PM Surya Ghar Central Financial Assistance (CFA) subsidy calculation:
 * - 30,000 INR per kW for first 2 kW
 * - 18,000 INR for the third kW
 * - Capped at 78,000 INR for 3 kW and above
 * Source: MNRE / pmsuryaghar.gov.in scheme guidelines.
 */
export function calculatePmSuryaGharSubsidy(kw: number): number {
  if (kw <= 0) return 0
  const rate1 = NATIONAL_STANDARDS.pmSuryaGhar.ratePerKwFirst2Kw
  const rate2 = NATIONAL_STANDARDS.pmSuryaGhar.ratePerKwThirdKw
  const maxCap = NATIONAL_STANDARDS.pmSuryaGhar.maxSubsidyCapInr

  if (kw <= 2) return Math.min(maxCap, Math.round(kw * rate1))
  if (kw < 3) return Math.min(maxCap, Math.round(2 * rate1 + (kw - 2) * rate2))
  return maxCap
}

export function solarFinancials(kw: number, annualKwh: number, hasSubsidy = true) {
  const grossCost = kw * NATIONAL_STANDARDS.solarTurnkeyCostPerKw.value
  const subsidy = hasSubsidy ? calculatePmSuryaGharSubsidy(kw) : 0
  const netCost = Math.max(0, grossCost - subsidy)
  const annualSavings = Math.round(annualKwh * NATIONAL_STANDARDS.electricityTariffInrPerKwh.value)
  const monthlySavings = Math.round(annualSavings / 12)
  const paybackYears = annualSavings > 0 ? Number((netCost / annualSavings).toFixed(1)) : null

  // 10-year cumulative cash flow series
  const cashFlow = Array.from({ length: 11 }, (_, year) => ({
    year,
    netCash: Math.round(-netCost + year * annualSavings),
  }))

  return { grossCost, subsidy, netCost, annualSavings, monthlySavings, paybackYears, cashFlow }
}

export interface AuditedDoor extends BuildingDoor {
  passes900mm: boolean
  isRouteDoor: boolean
  roleLabel: string
}

/**
 * Universal Accessibility Audit per DEPwD Harmonised Guidelines 2021:
 * - Audits accessible route only: entrance, living/hall, kitchen, accessible bedroom, accessible bathroom.
 * - Doors outside route (closets, store, utility) are informational.
 * - Verdict: Pass if all route doors >= 900mm AND compliant ramp (or step-free) exists; Partial if only one holds; Fail otherwise.
 */
export function accessibilityAudit(model: BuildingModel, ramp: EntryRamp | null) {
  const groundLevel = model.floors.length ? Math.min(...model.floors.map(f => f.level)) : 0
  const groundFloor = model.floors.find(f => f.level === groundLevel)
  const groundFloorId = groundFloor?.id ?? (model.floors[0]?.id ?? 'L0')

  const groundRooms = model.rooms.filter(r => r.floorId === groundFloorId)

  // Identify core accessible route destination rooms on ground floor
  const livingRooms = groundRooms.filter(r => /living|hall|family|lounge|drawing|foyer|spine/i.test(`${r.id} ${r.name} ${r.semanticId ?? ''}`))
  const kitchenRooms = groundRooms.filter(r => /kitchen|cook/i.test(`${r.id} ${r.name} ${r.semanticId ?? ''}`))
  const bedRooms = groundRooms.filter(r => !r.outdoor && /bed|master|guest/i.test(`${r.id} ${r.name} ${r.semanticId ?? ''}`))
  const bathRooms = groundRooms.filter(r => !r.outdoor && /bath|toilet|washroom|powder|wc/i.test(`${r.id} ${r.name} ${r.semanticId ?? ''}`))
  const circulationRooms = groundRooms.filter(r => r.zone === 'circulation' || /corridor|passage|lobby|entry/i.test(`${r.id} ${r.name} ${r.semanticId ?? ''}`))

  const routeRoomIds = new Set<string>()
  livingRooms.forEach(r => routeRoomIds.add(r.id))
  circulationRooms.forEach(r => routeRoomIds.add(r.id))
  if (kitchenRooms.length > 0) routeRoomIds.add(kitchenRooms[0].id)
  if (bedRooms.length > 0) routeRoomIds.add(bedRooms[0].id)
  if (bathRooms.length > 0) routeRoomIds.add(bathRooms[0].id)

  const isNonRouteRoom = (roomId: string | null) => {
    if (!roomId) return false
    const r = model.rooms.find(rm => rm.id === roomId)
    if (!r) return false
    return /closet|wardrobe|dress|store|utility|pantry|laundry|puja|balcony|terrace|deck/i.test(`${r.id} ${r.name} ${r.semanticId ?? ''}`)
  }

  const doors: AuditedDoor[] = model.doors.map(d => {
    const [r1, r2] = d.rooms || [null, null]
    const isGround = d.floorId === groundFloorId

    const isEntry = d.kind === 'entry' || (isGround && (r1 === null || r2 === null))
    const connectsToRoute = isGround && (
      (r1 !== null && routeRoomIds.has(r1)) || (r2 !== null && routeRoomIds.has(r2))
    )
    const connectsToExcluded = isNonRouteRoom(r1) || isNonRouteRoom(r2)

    // Route door if on ground floor, connecting entrance/living/kitchen/accessible bed/bath, without closet/store
    const isRouteDoor = isGround && (isEntry || connectsToRoute) && !connectsToExcluded
    const passes900mm = d.width >= NATIONAL_STANDARDS.accessibleDoorClearWidthMm.value

    let roleLabel = 'General Door'
    if (isEntry) roleLabel = 'Main Entrance (Route)'
    else if (connectsToExcluded) roleLabel = 'Closet / Utility (Informational)'
    else if (kitchenRooms.some(k => k.id === r1 || k.id === r2)) roleLabel = 'Kitchen (Route)'
    else if (bedRooms.some(b => b.id === r1 || b.id === r2)) roleLabel = 'Accessible Bedroom (Route)'
    else if (bathRooms.some(b => b.id === r1 || b.id === r2)) roleLabel = 'Accessible Bathroom (Route)'
    else if (livingRooms.some(l => l.id === r1 || l.id === r2)) roleLabel = 'Living Hall (Route)'

    return {
      ...d,
      passes900mm,
      isRouteDoor,
      roleLabel,
    }
  })

  const routeDoors = doors.filter(d => d.isRouteDoor)
  const informationalDoors = doors.filter(d => !d.isRouteDoor)
  const passRouteDoors = routeDoors.filter(d => d.passes900mm)
  const failRouteDoors = routeDoors.filter(d => !d.passes900mm)

  const routeDoorsPass = routeDoors.length > 0 && failRouteDoors.length === 0

  let rampStatus: 'pass' | 'fail' | 'absent' = 'absent'
  let rampReason = 'No entrance ramp configured.'
  if (ramp) {
    if (ramp.gradientRatio >= NATIONAL_STANDARDS.rampMaxGradientRatio.value) {
      rampStatus = 'pass'
      rampReason = `Step-free 1:${ramp.gradientRatio} ramp passes 1:12 standard.`
    } else {
      rampStatus = 'fail'
      rampReason = `Ramp slope 1:${ramp.gradientRatio} exceeds 1:12 maximum slope.`
    }
  }
  const rampPass = rampStatus === 'pass'

  // Verdict: Pass if all route doors >= 900mm AND compliant ramp exists; Partial if only one holds; Fail otherwise
  let verdict: 'Pass' | 'Partial' | 'Fail' = 'Fail'
  if (routeDoorsPass && rampPass) {
    verdict = 'Pass'
  } else if (routeDoorsPass || rampPass) {
    verdict = 'Partial'
  } else {
    verdict = 'Fail'
  }

  const reasons: string[] = []
  if (!routeDoorsPass) {
    if (routeDoors.length === 0) {
      reasons.push('No ground floor accessible route doors identified.')
    } else {
      reasons.push(`${failRouteDoors.length} of ${routeDoors.length} accessible route door(s) are narrower than 900 mm.`)
    }
  }
  if (!rampPass) {
    if (rampStatus === 'absent') reasons.push('Main entrance has no step-free accessible ramp.')
    else reasons.push('Entrance ramp slope is steeper than 1:12.')
  }
  if (verdict === 'Pass') {
    reasons.push('All accessible route doors ≥ 900 mm and 1:12 entrance ramp compliant.')
  }

  const narrowestRouteDoorMm = routeDoors.length ? Math.min(...routeDoors.map(d => d.width)) : null
  const narrowestDoorMm = doors.length ? Math.min(...doors.map(d => d.width)) : null

  return {
    verdict,
    reasons,
    routeDefinitionNote: 'Accessible route per DEPwD 2021: Entrance -> Living/Circulation -> Kitchen -> Accessible Bedroom -> Accessible Bathroom. Secondary doors (closet, utility, store) are informational.',
    doors,
    routeDoors,
    informationalDoors,
    passRouteCount: passRouteDoors.length,
    totalRouteDoors: routeDoors.length,
    totalDoors: doors.length,
    narrowestRouteDoorMm,
    narrowestDoorMm,
    rampStatus,
    rampReason,
    ramp,
  }
}

/**
 * PMAY-U 2.0 Statutory Check:
 * - Income bands: EWS up to 3 lakh, LIG 3-6 lakh, MIG 6-9 lakh/yr
 * - Carpet area ceilings: BLC/AHP 45 sqm, ARH 60 sqm, ISS 120 sqm; Minimum 30 sqm
 * Source: PMAY-U 2.0 FAQ, pmaymis.gov.in
 */
export function pmayEligibility(carpetAreaM2: number) {
  const cfg = NATIONAL_STANDARDS.pmayU2
  const minM2 = cfg.verticalCeilingsM2.minCarpetAreaM2
  const blcAhpCap = cfg.verticalCeilingsM2.blcAhpCeilingM2
  const arhCap = cfg.verticalCeilingsM2.arhCeilingM2
  const issCap = cfg.verticalCeilingsM2.issCeilingM2

  const eligibleVerticals: Array<'BLC' | 'AHP' | 'ARH' | 'ISS'> = []
  let statusText = ''
  let eligible = false

  if (carpetAreaM2 < minM2) {
    statusText = `Carpet area (${carpetAreaM2.toFixed(1)} m²) is below the ${minM2} m² statutory minimum under PMAY-U 2.0.`
  } else if (carpetAreaM2 <= blcAhpCap) {
    eligible = true
    eligibleVerticals.push('BLC', 'AHP', 'ARH', 'ISS')
    statusText = `Within the ${blcAhpCap} m² ceiling for BLC & AHP (and ${arhCap} m² ARH, ${issCap} m² ISS).`
  } else if (carpetAreaM2 <= arhCap) {
    eligible = true
    eligibleVerticals.push('ARH', 'ISS')
    statusText = `Within the ${arhCap} m² ceiling for ARH (and ${issCap} m² ISS); exceeds ${blcAhpCap} m² BLC/AHP.`
  } else if (carpetAreaM2 <= issCap) {
    eligible = true
    eligibleVerticals.push('ISS')
    statusText = `Within the ${issCap} m² ceiling for ISS (Interest Subsidy Scheme); exceeds ${arhCap} m² ARH.`
  } else {
    statusText = `Carpet area (${carpetAreaM2.toFixed(1)} m²) exceeds the ${issCap} m² maximum PMAY-U 2.0 ceiling for all verticals.`
  }

  return {
    carpetAreaM2,
    eligible,
    eligibleVerticals,
    badge: eligible ? `PMAY-U 2.0: ${eligibleVerticals.join('/')}` : 'Above PMAY-U 2.0 Cap',
    statusText,
    detail: statusText,
    legacyNote: cfg.legacyClssNote,
    incomeBands: cfg.incomeBands,
    verticalCeilings: cfg.verticalCeilingsM2,
    source: cfg.source,
    sourceUrl: cfg.sourceUrl,
    verifiedOn: cfg.verifiedOn,
    verified: cfg.verified,
  }
}

export function communityScale(
  unitCost: number,
  households: number,
  sharedAllowance: number,
  annualRainwaterLPerHome: number,
  carbonAvoidedKgPerHome: number,
  ecoSavingsPerHome: number
) {
  const totalCost = households * unitCost + sharedAllowance
  const perHomeCost = Math.round(totalCost / Math.max(1, households))
  const totalRainwaterL = households * annualRainwaterLPerHome
  const totalCarbonAvoidedTonnes = Number(((households * carbonAvoidedKgPerHome) / 1000).toFixed(1))
  const totalRupeesSaved = households * ecoSavingsPerHome

  return {
    totalCost,
    perHomeCost,
    totalRainwaterL,
    totalCarbonAvoidedTonnes,
    totalRupeesSaved,
  }
}

export function waterImpact(input: ImpactDocument['water'], geometryKey: string) {
  if (input.geometryKey && input.geometryKey !== geometryKey) return { state: 'Review roof inputs', litres: null, storage: null, days: null } as const
  if (input.rainfallMm === null || input.areaM2 === null || input.runoff === null || input.efficiency === null || !input.source.trim()) return { state: 'More information needed', litres: null, storage: null, days: null } as const
  const litres = rainfallYield(input.rainfallMm, input.areaM2, input.runoff, input.efficiency).collectedLitres
  const storage = input.capacityL === null || input.dailyDemandL === null ? null : tankStep(input.capacityL, 0, litres, input.dailyDemandL)
  return { state: 'Calculated scenario', litres, storage, days: input.capacityL !== null && input.dailyDemandL !== null && input.dailyDemandL > 0 ? input.capacityL / input.dailyDemandL : null } as const
}

export function carbonImpact(cost: CostEstimate, doc: ImpactDocument) {
  let low = 0, high = 0, covered = 0
  const excluded: string[] = [], boundaries = new Set<string>()
  for (const factor of doc.carbon) {
    const line = cost.boq.find(l => l.id === factor.lineId)
    if (!line || factor.specId !== line.specId || factor.unit !== line.unit || factor.geometryKey !== cost.quantities.geometryKey) { excluded.push(factor.lineId); continue }
    boundaries.add(factor.boundary.trim().toLowerCase())
    low += line.quantity * factor.low
    high += line.quantity * factor.high
    covered++
  }
  return { low: boundaries.size <= 1 ? low : null, high: boundaries.size <= 1 ? high : null, covered, excluded, totalLines: cost.boq.length, mixedBoundaries: boundaries.size > 1 }
}

export function roofHeatComparison(params: {
  roofAreaM2: number
  standardRoofU: number
  coolRoofU: number
  temperatureDifferenceK: number
}) {
  const { roofAreaM2, standardRoofU, coolRoofU, temperatureDifferenceK } = params
  if (roofAreaM2 <= 0) return null
  const standardW = Math.round(roofAreaM2 * standardRoofU * temperatureDifferenceK)
  const coolW = Math.round(roofAreaM2 * coolRoofU * temperatureDifferenceK)
  const differenceW = Math.max(0, standardW - coolW)
  const percentReduction = standardW > 0 ? Math.round((differenceW / standardW) * 100) : 0

  return {
    roofAreaM2,
    standardRoofU,
    coolRoofU,
    temperatureDifferenceK,
    standardW,
    coolW,
    differenceW,
    percentReduction,
  }
}

export function pilotImpact(doc: ImpactDocument) {
  const latest = new Map<string, ImpactDocument['pilots'][number]>()
  for (const row of doc.pilots) {
    const key = row.householdCode.trim().toLowerCase(), before = latest.get(key)
    if (!before || row.date >= before.date) latest.set(key, row)
  }
  const supported = [...latest.values()].filter(r => r.stage === 'supported' && r.evidence.trim())
  const costs = supported.filter(r => r.sameScope && r.baselineCostInr !== null && r.actualCostInr !== null)
  return {
    households: supported.length,
    planned: [...latest.values()].filter(r => r.stage === 'planned').length,
    costDifference: costs.reduce((n, r) => n + r.baselineCostInr! - r.actualCostInr!, 0),
    costRecords: costs.length,
    measuredWaterL: supported.reduce((n, r) => n + (r.measuredWaterL ?? 0), 0),
    waterRecords: supported.filter(r => r.measuredWaterL !== null).length,
    resilienceRecords: supported.filter(r => r.resilienceNote.trim()).length,
  }
}

export interface MonthlyWaterData {
  month: string
  days: number
  rainfallMm: number
  harvestL: number
  demandL: number
  tankLevelL: number
  overflowL: number
  deficitL: number
}

export function simulateMonthlyWaterInternal(
  annualRainfallMm: number,
  roofAreaM2: number,
  runoff: number,
  efficiency: number,
  dailyDemandL: number,
  tankCapacityL: number
) {
  const months = [
    { name: 'Jan', days: 31, weight: 0.005 },
    { name: 'Feb', days: 28, weight: 0.005 },
    { name: 'Mar', days: 31, weight: 0.010 },
    { name: 'Apr', days: 30, weight: 0.015 },
    { name: 'May', days: 31, weight: 0.035 },
    { name: 'Jun', days: 30, weight: 0.200 },
    { name: 'Jul', days: 31, weight: 0.320 },
    { name: 'Aug', days: 31, weight: 0.250 },
    { name: 'Sep', days: 30, weight: 0.120 },
    { name: 'Oct', days: 31, weight: 0.030 },
    { name: 'Nov', days: 30, weight: 0.005 },
    { name: 'Dec', days: 31, weight: 0.005 },
  ]

  let currentTank = 0
  let totalHarvestL = 0
  let totalDemandL = 0
  let totalOverflowL = 0
  let totalDeficitL = 0
  let usableHarvestLitres = 0

  const monthly: MonthlyWaterData[] = months.map(m => {
    const rainfallMm = Math.round(annualRainfallMm * m.weight * 10) / 10
    const harvestL = Math.round(rainfallYield(rainfallMm, roofAreaM2, runoff, efficiency).collectedLitres)
    const demandL = Math.round(dailyDemandL * m.days)

    const available = currentTank + harvestL
    let tankLevelL = 0
    let overflowL = 0
    let deficitL = 0
    let usableInMonth = 0

    if (available >= demandL) {
      usableInMonth = demandL
      const remaining = available - demandL
      if (remaining > tankCapacityL) {
        tankLevelL = tankCapacityL
        overflowL = remaining - tankCapacityL
      } else {
        tankLevelL = remaining
      }
    } else {
      usableInMonth = available
      deficitL = demandL - available
      tankLevelL = 0
    }

    currentTank = tankLevelL
    totalHarvestL += harvestL
    totalDemandL += demandL
    totalOverflowL += overflowL
    totalDeficitL += deficitL
    usableHarvestLitres += usableInMonth

    return {
      month: m.name,
      days: m.days,
      rainfallMm,
      harvestL,
      demandL,
      tankLevelL,
      overflowL,
      deficitL,
    }
  })

  // Longest consecutive dry gap days (days where tank was dry and demand went unmet)
  let currentDryStreak = 0
  let longestDryGapDays = 0
  for (const m of monthly) {
    if (m.deficitL > 0) {
      const daysWithWater = dailyDemandL > 0 ? Math.min(m.days, Math.floor((m.demandL - m.deficitL) / dailyDemandL)) : 0
      const dryDaysInMonth = m.days - daysWithWater
      currentDryStreak += dryDaysInMonth
      if (currentDryStreak > longestDryGapDays) {
        longestDryGapDays = currentDryStreak
      }
    } else {
      currentDryStreak = 0
    }
  }

  const demandCoveredPercent = totalDemandL > 0
    ? Number(((usableHarvestLitres / totalDemandL) * 100).toFixed(1))
    : 0

  return {
    monthly,
    totalHarvestL,
    totalDemandL,
    totalOverflowL,
    totalDeficitL,
    usableHarvestLitres,
    overflowLitres: totalOverflowL,
    demandCoveredPercent,
    longestDryGapDays,
  }
}

export function findTankCapacityFor80PctHarvest(
  annualRainfallMm: number,
  roofAreaM2: number,
  runoff = 0.85,
  efficiency = 0.80,
  dailyDemandL = 540
): number {
  if (roofAreaM2 <= 0 || annualRainfallMm <= 0) return 5000
  // Test capacities in steps of 500 L from 1,000 to 50,000 L
  for (let cap = 1000; cap <= 50000; cap += 500) {
    const sim = simulateMonthlyWaterInternal(annualRainfallMm, roofAreaM2, runoff, efficiency, dailyDemandL, cap)
    if (sim.totalHarvestL <= 0) return cap
    const capturedRatio = (sim.totalHarvestL - sim.totalOverflowL) / sim.totalHarvestL
    if (capturedRatio >= 0.80) {
      return cap
    }
  }
  return 50000
}

export function calculateMonthlyWaterBalance(
  annualRainfallMm: number,
  roofAreaM2: number,
  runoff = 0.85,
  efficiency = 0.80,
  dailyDemandL = 540,
  tankCapacityL = 10000
) {
  const sim = simulateMonthlyWaterInternal(
    annualRainfallMm,
    roofAreaM2,
    runoff,
    efficiency,
    dailyDemandL,
    tankCapacityL
  )

  const tankerRate = NATIONAL_STANDARDS.tankerRateInrPer5kL.value
  const tankerTripsSaved = Math.floor(sim.totalHarvestL / 5000)
  const tankerSavingsInr = tankerTripsSaved * tankerRate
  const annualHarvestCoverageDays = dailyDemandL > 0 ? Math.round(sim.totalHarvestL / dailyDemandL) : 0
  const suggestedTankCapacity80Pct = findTankCapacityFor80PctHarvest(
    annualRainfallMm,
    roofAreaM2,
    runoff,
    efficiency,
    dailyDemandL
  )

  return {
    ...sim,
    tankerTripsSaved,
    tankerSavingsInr,
    annualHarvestCoverageDays,
    suggestedTankCapacity80Pct,
  }
}

export interface SubScoreInfo {
  score: number | null
  status: 'scored' | 'needs input'
  weight: number
  name: string
  formula: string
  detail: string
  color: string
}

export interface ComprehensiveScores {
  composite: number | null
  compositeStatus: 'scored' | 'needs input'
  rating: string
  activeSubScoresCount: number
  totalSubScoresCount: number
  subScores: {
    water: SubScoreInfo
    carbon: SubScoreInfo
    comfort: SubScoreInfo
    access: SubScoreInfo
    affordability: SubScoreInfo
  }
}

export function calculateImpactScores(params: {
  annualHarvestCoverageDays: number
  usableHarvestLitres?: number
  annualDemandLitres?: number
  roofAreaM2: number
  ecoCarbonSavingsKg: number
  totalEmbodiedKg?: number
  floorAreaM2?: number
  hasBoq: boolean
  coolRoofU: number
  tempDeltaK?: number
  roomsCount?: number
  ventilationCount: number
  accessVerdict: 'Pass' | 'Partial' | 'Fail'
  routeDoorsPassCount?: number
  routeDoorsTotalCount?: number
  narrowestRouteDoorMm?: number | null
  rampStatus?: 'pass' | 'fail' | 'absent'
  rampGradientRatio?: number | null
  totalDoors: number
  budget: number | null
  costExpected?: number
  costAfterSwaps: number
}): ComprehensiveScores {
  const {
    annualHarvestCoverageDays,
    usableHarvestLitres,
    annualDemandLitres,
    roofAreaM2,
    ecoCarbonSavingsKg,
    totalEmbodiedKg,
    floorAreaM2,
    hasBoq,
    coolRoofU,
    tempDeltaK,
    roomsCount,
    ventilationCount,
    routeDoorsPassCount,
    routeDoorsTotalCount,
    narrowestRouteDoorMm,
    rampStatus,
    rampGradientRatio,
    totalDoors,
    budget,
    costAfterSwaps,
  } = params

  // 1. Water Sub-Score: Usable harvest as % of annual demand
  const annualDemand = annualDemandLitres && annualDemandLitres > 0 ? annualDemandLitres : 540 * 365
  const usableHarvest = usableHarvestLitres !== undefined ? usableHarvestLitres : annualHarvestCoverageDays * (annualDemand / 365)
  const water: SubScoreInfo = roofAreaM2 <= 0 || annualDemand <= 0
    ? {
        score: null,
        status: 'needs input',
        weight: 0,
        name: 'Water Security',
        formula: 'Usable Harvest / Annual Household Demand × 100',
        detail: 'Roof catchment area is 0 m² or demand is unconfigured.',
        color: '#0284c7',
      }
    : {
        score: Math.min(100, Math.max(0, Math.round((usableHarvest / annualDemand) * 100))),
        status: 'scored',
        weight: 20,
        name: 'Water Security',
        formula: 'Usable Harvest / Annual Household Demand × 100',
        detail: `${usableHarvest.toLocaleString()} L usable with tank (${Math.min(100, Math.round((usableHarvest / annualDemand) * 100))}% of annual demand).`,
        color: '#0284c7',
      }

  // 2. Carbon Sub-Score: Derived from embodied kgCO2e/m2 + % saving of applied vs baseline materials
  const floorArea = floorAreaM2 && floorAreaM2 > 0 ? floorAreaM2 : 0
  const totalEmbodied = totalEmbodiedKg && totalEmbodiedKg > 0 ? totalEmbodiedKg : 0
  const carbon: SubScoreInfo = (!hasBoq || floorArea <= 0 || totalEmbodied <= 0)
    ? {
        score: null,
        status: 'needs input',
        weight: 0,
        name: 'Carbon Reduction',
        formula: 'Intensity Score (10–50 pts) + Eco-Swap % Saving (up to 50 pts)',
        detail: 'Bill of quantities not available to compute embodied carbon baseline.',
        color: '#059669',
      }
    : (() => {
        const intensity = totalEmbodied / floorArea // kgCO2e/m2
        // Intensity curve: 200 kg/m2 -> 50 pts; 600 kg/m2 -> 10 pts
        const intensityScore = Math.max(10, Math.min(50, Math.round(50 - ((intensity - 200) / 400) * 40)))
        const savingPct = totalEmbodied > 0 ? (ecoCarbonSavingsKg / totalEmbodied) * 100 : 0
        // Eco-swap saving curve: 10% saving -> 50 pts
        const savingScore = Math.max(0, Math.min(50, Math.round((savingPct / 10) * 50)))
        const score = Math.min(100, Math.max(10, intensityScore + savingScore))
        return {
          score,
          status: 'scored' as const,
          weight: 20,
          name: 'Carbon Reduction',
          formula: 'Intensity Score (10–50 pts) + Eco-Swap % Saving (up to 50 pts)',
          detail: `${intensity.toFixed(1)} kgCO₂e/m² intensity (${intensityScore} pts) + ${savingPct.toFixed(1)}% eco-savings (${savingScore} pts).`,
          color: '#059669',
        }
      })()

  // 3. Passive Comfort Sub-Score: From heat-ingress W/m2 of roof + ventilation coverage ratio (paths / rooms)
  const rooms = roomsCount && roomsCount > 0 ? roomsCount : 1
  const deltaK = tempDeltaK && tempDeltaK > 0 ? tempDeltaK : 15
  const comfort: SubScoreInfo = roofAreaM2 <= 0 || rooms <= 0
    ? {
        score: null,
        status: 'needs input',
        weight: 0,
        name: 'Passive Comfort',
        formula: 'Heat Flux (5–35 W/m²: 50–5 pts) + Airflow Ratio (Paths/Rooms: up to 1.5 = 50 pts)',
        detail: 'Building envelope or rooms not configured.',
        color: '#f59e0b',
      }
    : (() => {
        const heatFluxWm2 = coolRoofU * deltaK // W/m2
        // 5 W/m2 -> 50 pts; 35 W/m2 -> 5 pts
        const heatScore = Math.max(5, Math.min(50, Math.round(50 - ((heatFluxWm2 - 5) / 30) * 45)))
        const ventRatio = ventilationCount / rooms
        // 1.5 airflow paths per room -> 50 pts
        const ventScore = Math.max(0, Math.min(50, Math.round((ventRatio / 1.5) * 50)))
        const score = Math.min(100, Math.max(5, heatScore + ventScore))
        return {
          score,
          status: 'scored' as const,
          weight: 20,
          name: 'Passive Comfort',
          formula: 'Heat Flux (5–35 W/m²: 50–5 pts) + Airflow Ratio (Paths/Rooms: up to 1.5 = 50 pts)',
          detail: `${heatFluxWm2.toFixed(1)} W/m² heat flux (${heatScore} pts) + ${ventRatio.toFixed(2)} paths/room (${ventScore} pts).`,
          color: '#f59e0b',
        }
      })()

  // 4. Universal Access Sub-Score: Share of route doors passing × ramp status × clear-width margin
  const totalRoute = routeDoorsTotalCount !== undefined ? routeDoorsTotalCount : (totalDoors > 0 ? Math.min(totalDoors, 10) : 0)
  const passRoute = routeDoorsPassCount !== undefined ? routeDoorsPassCount : Math.round(totalRoute * 0.7)
  const access: SubScoreInfo = totalRoute <= 0
    ? {
        score: null,
        status: 'needs input',
        weight: 0,
        name: 'Universal Access',
        formula: '(0.25 + 0.75 × Route Pass Rate) × Ramp Multiplier × (Min Route Door / 900mm)',
        detail: 'No accessible route doors identified.',
        color: '#8b5cf6',
      }
    : (() => {
        const passFraction = passRoute / totalRoute
        const rampMult = rampStatus === 'pass'
          ? 1.0
          : rampStatus === 'fail'
            ? Math.max(0.6, Math.min(0.9, (rampGradientRatio ?? 6) / 12))
            : 0.5
        const widthMargin = Math.min(1.0, Math.max(0.6, (narrowestRouteDoorMm ?? 700) / 900))
        const raw = (0.25 + 0.75 * passFraction) * rampMult * widthMargin * 100
        const score = Math.min(100, Math.max(5, Math.round(raw)))
        return {
          score,
          status: 'scored' as const,
          weight: 20,
          name: 'Universal Access',
          formula: '(0.25 + 0.75 × Route Pass Rate) × Ramp Multiplier × (Min Route Door / 900mm)',
          detail: `${passRoute}/${totalRoute} doors compliant (${Math.round(passFraction * 100)}%), ramp factor ${rampMult.toFixed(2)}, min door ${narrowestRouteDoorMm ?? 700}mm.`,
          color: '#8b5cf6',
        }
      })()

  // 5. Affordability Sub-Score: Continuous in (budget - expected) / budget
  const affordability: SubScoreInfo = (budget === null || budget === undefined || budget <= 0)
    ? {
        score: null,
        status: 'needs input',
        weight: 0,
        name: 'Budget & Value',
        formula: 'Surplus: 75 + (surplus/budget)×125 (cap 100); Deficit: max(5, 75 - (overage/budget)×70)',
        detail: 'Target budget not set in brief. Excluded from composite average.',
        color: '#10b981',
      }
    : (() => {
        const diff = budget - costAfterSwaps
        const x = diff / budget
        const score = diff >= 0
          ? Math.min(100, Math.round(75 + x * 125))
          : Math.max(5, Math.round(75 + x * 70))
        return {
          score,
          status: 'scored' as const,
          weight: 20,
          name: 'Budget & Value',
          formula: 'Surplus: 75 + (surplus/budget)×125 (cap 100); Deficit: max(5, 75 - (overage/budget)×70)',
          detail: diff >= 0
            ? `Within budget by ₹${new Intl.NumberFormat('en-IN').format(diff)} (+${(x * 100).toFixed(1)}% margin).`
            : `Exceeds budget by ₹${new Intl.NumberFormat('en-IN').format(Math.abs(diff))} (${(Math.abs(x) * 100).toFixed(1)}% overage).`,
          color: '#10b981',
        }
      })()

  const subScores = { water, carbon, comfort, access, affordability }
  const activeList = Object.values(subScores).filter(s => s.status === 'scored' && s.score !== null)
  const activeSubScoresCount = activeList.length
  const totalSubScoresCount = 5

  const equalWeight = activeSubScoresCount > 0 ? Number((100 / activeSubScoresCount).toFixed(1)) : 0
  Object.values(subScores).forEach(s => {
    s.weight = s.status === 'scored' ? equalWeight : 0
  })

  const composite = activeSubScoresCount > 0
    ? Math.round(activeList.reduce((acc, s) => acc + s.score!, 0) / activeSubScoresCount)
    : null
  const compositeStatus = composite !== null ? 'scored' : 'needs input'
  const rating = composite === null
    ? 'Needs Input'
    : composite >= 85
    ? 'Exemplary'
    : composite >= 70
    ? 'High Impact'
    : composite >= 50
    ? 'Moderate'
    : 'Needs Review'

  return {
    composite,
    compositeStatus,
    rating,
    activeSubScoresCount,
    totalSubScoresCount,
    subScores,
  }
}

export function generateImpactHeadline(params: {
  harvestL: number
  annualHarvestCoverageDays: number
  usableHarvestL?: number
  demandCoveredPercent?: number
  solarKw: number
  ecoSavingsRupees: number
  heatCutWatts: number
  accessVerdict: string
}): string {
  if (params.harvestL > 0 && params.annualHarvestCoverageDays > 0) {
    const formattedL = new Intl.NumberFormat('en-IN').format(params.harvestL)
    if (params.usableHarvestL !== undefined && params.demandCoveredPercent !== undefined && params.demandCoveredPercent > 0) {
      const formattedUsable = new Intl.NumberFormat('en-IN').format(params.usableHarvestL)
      return `Your roof can harvest ${formattedL} L of rainwater annually (${formattedUsable} L usable with your tank, covering ${params.demandCoveredPercent}% of demand).`
    }
    return `Your roof can harvest ${formattedL} L of rainwater annually, covering ${params.annualHarvestCoverageDays} days of household demand.`
  }
  if (params.solarKw > 0) {
    return `Your rooftop supports a ${params.solarKw} kW solar array with central PM Surya Ghar subsidy.`
  }
  if (params.ecoSavingsRupees > 0) {
    return `1-Click eco-swaps can save ₹${new Intl.NumberFormat('en-IN').format(params.ecoSavingsRupees)} while reducing embodied carbon.`
  }
  return 'Statutory architectural engineering for rainwater harvesting, solar generation, and barrier-free universal access.'
}

export function calculateCarbonBreakdown(cost: CostEstimate) {
  const groups: Record<string, { label: string; kgCo2e: number; color: string }> = {
    flooring: { label: 'Flooring', kgCo2e: 0, color: '#3b82f6' },
    masonry: { label: 'Masonry & Shell', kgCo2e: 0, color: '#ef4444' },
    roofing: { label: 'Roof & Slab', kgCo2e: 0, color: '#f59e0b' },
    openings: { label: 'Doors & Windows', kgCo2e: 0, color: '#10b981' },
    finishes: { label: 'Paints & Plaster', kgCo2e: 0, color: '#8b5cf6' },
    other: { label: 'Other Elements', kgCo2e: 0, color: '#6b7280' },
  }

  for (const line of cost.boq) {
    const item = line.item.toLowerCase()
    let group = 'other'
    let factor = 10.0

    if (/floor|tile|stone|granite|marble/.test(item)) {
      group = 'flooring'
      factor = EMBODIED_CARBON_DEFAULTS['ceramic-tile'].factor
    } else if (/wall|brick|block|masonry/.test(item)) {
      group = 'masonry'
      factor = EMBODIED_CARBON_DEFAULTS['red-clay-brick'].factor / 10
    } else if (/roof|terrace|slab|waterproof/.test(item)) {
      group = 'roofing'
      factor = EMBODIED_CARBON_DEFAULTS['standard-bitumen'].factor
    } else if (/door|window|shutter|frame/.test(item)) {
      group = 'openings'
      factor = EMBODIED_CARBON_DEFAULTS['flush-door'].factor
    } else if (/paint|distemper|plaster|emulsion/.test(item)) {
      group = 'finishes'
      factor = EMBODIED_CARBON_DEFAULTS['acrylic-emulsion'].factor
    }

    groups[group].kgCo2e += Math.round(line.quantity * factor)
  }

  const items = Object.values(groups).filter(g => g.kgCo2e > 0)
  const totalKg = items.reduce((acc, g) => acc + g.kgCo2e, 0)

  return {
    items: items.map(g => ({
      ...g,
      percentage: totalKg > 0 ? Math.round((g.kgCo2e / totalKg) * 100) : 0,
    })),
    totalKg,
  }
}

export function analyzeImpact(design: Design, brief: Brief, cost: CostEstimate, report: ValidationReport, document: ImpactDocument) {
  const doc = impactSchema.parse(document), model = createBuildingModel({ ...design, model: { ...design.model, brief } })
  const air = AIR_SIDES.map(side => ventilationPaths(model, side, true))
  const ramp = entryRamp({ ...design, model: { ...design.model, brief } })
  const checks: ImpactCheck[] = report.findings.filter(f => f.category !== 'vastu' && f.severity !== 'info').map((f, i) => ({ id: `plan:${i}`, status: 'Review', title: 'Plan review', detail: f.message, href: '/workspace/plan' }))
  checks.push(
    { id: 'air', status: air.some(a => !a.paths.length) ? 'Review' : 'Recorded', title: 'Natural ventilation', detail: 'Opening-to-opening paths are illustrative. Operability, weather, airflow rates and indoor temperatures need review.', href: '/workspace/utilities?view=air' },
    { id: 'drain', status: 'Not checked', title: 'Drainage and discharge', detail: 'Review the recorded drainage network, invert levels and approved outlet with a qualified professional.', href: '/workspace/utilities?service=drainage' },
    { id: 'electric', status: 'Not checked', title: 'Electrical safety', detail: 'Cable loading, wet-area protection, earthing and installed clearances need an electrical design review.', href: '/workspace/utilities' },
    { id: 'flood', status: 'Not checked', title: 'Flood and site levels', detail: 'A raised plinth alone does not establish flood safety. Obtain surveyed levels and local flood information.', href: '/workspace' },
    { id: 'access', status: 'Review', title: 'Step-free access', detail: ramp ? 'A proposed ramp is recorded. Verify landings, clear widths, gradients and site levels.' : 'A continuous step-free entrance has not been verified.', href: '/workspace' },
    { id: 'kitchen', status: 'Not checked', title: 'Kitchen safety', detail: 'Cooking ventilation, fuel installation, fire protection and appliance clearances require site verification.', href: '/workspace/utilities' },
  )
  const water = waterImpact(doc.water, cost.quantities.geometryKey)
  const carbon = carbonImpact(cost, doc)
  const budget = doc.budgetInr ?? brief.budget?.amount ?? null
  const current = doc.energy.currentMonthlyKwh, proposed = doc.energy.proposedMonthlyKwh
  
  const ecoSwaps = calculateEcoSwaps(cost)
  const totalEcoRupeeSavings = ecoSwaps.reduce((acc, s) => acc + s.rupeeSaving, 0)
  const totalEcoCarbonSavingsKg = ecoSwaps.reduce((acc, s) => acc + s.kgCo2eSaving, 0)
  const costAfterSwaps = Math.max(0, cost.expected - totalEcoRupeeSavings)

  const access = accessibilityAudit(model, ramp)
  const carpetAreaM2 = cost.quantities.floorArea
  const pmay = pmayEligibility(carpetAreaM2)
  const solar = solarYield(cost.quantities.roofArea)
  const solarFin = solarFinancials(solar.kw, solar.annualKwh, true)
  const solarFinNoSub = solarFinancials(solar.kw, solar.annualKwh, false)

  const city = (brief as unknown as { location?: { city?: string } }).location?.city || 'pune'
  const cityInfo = cityRainfallLookup(city)
  const cityRwh = lookupCityRwhRule(city)
  const rainfallMm = doc.water.rainfallMm ?? cityInfo.annualRainfallMm
  const roofAreaM2 = doc.water.areaM2 ?? cost.quantities.roofArea
  const runoff = doc.water.runoff ?? NATIONAL_STANDARDS.runoffCoefficientRcc.value
  const efficiency = doc.water.efficiency ?? NATIONAL_STANDARDS.collectionFilterEfficiency.value
  const dailyDemandL = doc.water.dailyDemandL ?? (((brief.household?.members?.length ?? 4) || 4) * NATIONAL_STANDARDS.domesticLpcd.value)
  const tankCapacityL = doc.water.capacityL ?? (cost.quantities.tanks?.undergroundLitres > 0 ? cost.quantities.tanks.undergroundLitres : null)

  const waterBalance = calculateMonthlyWaterBalance(rainfallMm, roofAreaM2, runoff, efficiency, dailyDemandL, tankCapacityL ?? 10000)
  const carbonBreakdown = calculateCarbonBreakdown(cost)

  const standardRoofU = doc.climate.currentRoofU ?? NATIONAL_STANDARDS.standardRoofUValue.value
  const coolRoofU = doc.climate.proposedRoofU ?? NATIONAL_STANDARDS.coolRoofUValue.value
  const tempDeltaK = doc.climate.temperatureDifferenceK ?? NATIONAL_STANDARDS.coolRoofTempDeltaK.value
  const heatComparison = roofHeatComparison({ roofAreaM2, standardRoofU, coolRoofU, temperatureDifferenceK: tempDeltaK })
  const ventCount = air.reduce((acc, a) => acc + a.paths.length, 0)

  const scores = calculateImpactScores({
    annualHarvestCoverageDays: waterBalance.annualHarvestCoverageDays,
    roofAreaM2,
    ecoCarbonSavingsKg: totalEcoCarbonSavingsKg,
    hasBoq: cost.boq.length > 0,
    coolRoofU,
    ventilationCount: ventCount,
    accessVerdict: access.verdict,
    totalDoors: model.doors.length,
    budget,
    costAfterSwaps,
  })

  const headline = generateImpactHeadline({
    harvestL: waterBalance.totalHarvestL,
    annualHarvestCoverageDays: waterBalance.annualHarvestCoverageDays,
    solarKw: solar.kw,
    ecoSavingsRupees: totalEcoRupeeSavings,
    heatCutWatts: heatComparison ? heatComparison.differenceW : 0,
    accessVerdict: access.verdict,
  })

  return {
    conceptEstimate: cost.expected,
    model,
    air,
    ramp,
    checks: [...checks.filter(c => !c.id.startsWith('plan:')), ...checks.filter(c => c.id.startsWith('plan:'))],
    water,
    carbon,
    heat: heatComparison,
    budget,
    budgetDifference: budget === null ? null : budget - cost.expected,
    alternatives: affordableAlternatives(cost),
    ecoSwaps,
    totalEcoRupeeSavings,
    totalEcoCarbonSavingsKg,
    access,
    carpetAreaM2,
    pmay,
    solar: { ...solar, financials: solarFin, financialsNoSubsidy: solarFinNoSub },
    waterBalance,
    carbonBreakdown,
    scores,
    headline,
    cityInfo,
    cityRwh,
    pilots: pilotImpact(doc),
    annualEnergyDifference: current !== null && proposed !== null && doc.energy.source.trim() ? (current - proposed) * 12 : null,
    narrowestDoorMm: model.doors.length ? Math.min(...model.doors.map(d => d.width)) : null,
    communityCost: cost.expected * doc.community.households + (doc.community.sharedAllowanceInr ?? 0),
  }
}
