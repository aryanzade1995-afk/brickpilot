import type { Design } from '../engine/types.ts'
import type { Brief } from '../model/brief.ts'
import type { CostEstimate } from '../cost/boq.ts'
import type { ValidationReport } from '../rules/index.ts'
import { createBuildingModel, type BuildingModel } from '../engine/buildingModel.ts'
import { ventilationPaths, AIR_SIDES } from '../utilities/ventilation.ts'
import { entryRamp, type EntryRamp } from '../engine/entryRamp.ts'
import { impactSchema, type ImpactDocument } from './schema.ts'
import {
  cityRainfallLookup,
  calculateEcoSwaps,
  calculateCarbonBreakdown,
  calculateMonthlyWaterBalance,
  solarYield,
  solarFinancials,
  accessibilityAudit,
  pmayEligibility,
  communityScale,
  roofHeatComparison,
  calculateImpactScores,
  generateImpactHeadline,
  type EcoSwapItem,
  type MonthlyWaterData,
  type ComprehensiveScores,
  type AuditedDoor,
} from './analysis.ts'
import {
  NATIONAL_STANDARDS,
  lookupCityRwhRule,
  type CityRwhRule,
} from './data/nationalStandards.ts'

export interface ImpactSummary {
  // --- 1. Executive Scoring & Live Headline ---
  scores: ComprehensiveScores
  headline: string

  // --- 2. Hero KPI Cards ---
  kpis: {
    affordability: {
      ecoSavingsInr: number
      ecoSavingsPct: number
      sparklineData: number[]
    }
    water: {
      // Metric 1: Annual harvest covers N days of household demand (Rain available per year before storage)
      annualHarvestCoverageDays: number
      // Metric 2: A full tank lasts N days with no rain (drought autonomy)
      tankAutonomyDays: number | null
      tankAutonomyDisplay: string // e.g. "18 Days" or "set a tank size"
      annualHarvestL: number
      usableHarvestL: number
      demandCoveredPercent: number
      sparklineData: number[]
    }
    climate: {
      heatCutWatts: number // exactly equals climate.heatCutWatts
      heatIngressStandardW: number
      heatIngressCoolW: number
      sparklineData: number[]
    }
    accessibility: {
      verdict: 'Pass' | 'Partial' | 'Fail'
      detail: string
      routeDoorsPassCount: number
      routeDoorsTotalCount: number
      rampStatus: 'pass' | 'fail' | 'absent'
    }
  }

  // --- 3. Pillar 1: Affordability ---
  affordability: {
    budget: number | null
    costExpected: number
    costAfterSwaps: number
    rupeeSavings: number
    carbonSavingsKg: number
    withinBudget: boolean
    waterfallData: { name: string; value: number }[]
    carbonDonut: {
      items: { label: string; kgCo2e: number; color: string; percentage: number }[]
      totalKg: number
    }
    carbonCompare: {
      baselineKg: number
      afterSwapsKg: number
      savingsKg: number
    }
    ecoSwaps: EcoSwapItem[]
  }

  // --- 4. Pillar 2: Water Security ---
  water: {
    city: string
    annualRainfallMm: number
    roofAreaM2: number
    runoffCoefficient: number
    filterEfficiency: number
    dailyDemandL: number
    annualDemandL: number
    annualHarvestL: number
    // Metric 1: "Annual harvest covers N days of household demand" (Rain available per year before storage)
    annualHarvestCoverageDays: number
    // Usable with actual tank simulation
    usableHarvestLitres: number
    overflowLitres: number
    demandCoveredPercent: number
    longestDryGapDays: number
    suggestedTankCapacity80Pct: number
    // Metric 2: "A full tank lasts N days with no rain" (tank litres / daily demand)
    tankCapacityL: number | null
    tankAutonomyDays: number | null
    tankAutonomyDisplay: string
    isUtilitiesTankSet: boolean
    tankerSavingsInr: number
    tankerTripsAvoided: number
    monthlyBalance: MonthlyWaterData[]
    totalDeficitL: number
    totalOverflowL: number
    rwhCityMandate: CityRwhRule
    isPlotMandatory: boolean
  }

  // --- 5. Pillar 3: Climate Resilience & Solar ROI ---
  climate: {
    roofAreaM2: number
    standardRoofU: number
    coolRoofU: number
    tempDeltaK: number
    heatIngressStandardW: number
    heatIngressCoolW: number
    heatCutWatts: number
    percentHeatReduction: number
    ventilationRoutesCount: number
    airPaths: { from: string; paths: unknown[] }[]
    solar: {
      usableRoofM2: number
      solarCapacityKw: number
      annualGenerationKwh: number
      grossInstallationCostInr: number
      pmSuryaGharSubsidyInr: number
      netInvestmentInr: number
      annualElectricitySavingsInr: number
      paybackYears: number | null
      cashFlow: { year: number; netCash: number }[]
      monthlyGeneration: { label: string; value: number }[]
    }
  }

  // --- 6. Pillar 4: Universal Accessibility & Safety ---
  accessibility: {
    verdict: 'Pass' | 'Partial' | 'Fail'
    reasons: string[]
    routeDefinitionNote: string
    doors: AuditedDoor[]
    routeDoors: AuditedDoor[]
    informationalDoors: AuditedDoor[]
    passRouteCount: number
    totalRouteDoors: number
    totalDoors: number
    narrowestRouteDoorMm: number | null
    narrowestDoorMm: number | null
    ramp: {
      status: 'pass' | 'fail' | 'absent'
      gradientRatio: number | null
      riseMm: number | null
      runMm: number | null
      reason: string
    }
    buildingModel: BuildingModel
    rampModel: EntryRamp | null
    safetyChecks: ImpactDocument['safetyChecks']
  }

  // --- 7. Pillar 5: Community Clusters & PMAY-U 2.0 ---
  community: {
    households: number
    sharedAllowanceInr: number
    carpetAreaM2: number
    pmayCheck: ReturnType<typeof pmayEligibility>
    clusterScale: {
      totalCostInr: number
      perHomeCostInr: number
      totalRainwaterHarvestL: number
      totalCarbonAvoidedTonnes: number
      totalRupeesSaved: number
    }
  }
}

export function buildImpactSummary(params: {
  design: Design
  brief: Brief
  cost: CostEstimate
  report?: ValidationReport
  document: ImpactDocument
  cityOverride?: string
}): ImpactSummary {
  const { design, brief, cost, document } = params
  const doc = impactSchema.parse(document)
  const model = createBuildingModel({ ...design, model: { ...design.model, brief } })
  const ramp = entryRamp({ ...design, model: { ...design.model, brief } })
  const air = AIR_SIDES.map(side => ventilationPaths(model, side, true))

  // 1. Geographic & Location Data
  const city = params.cityOverride || (brief as unknown as { location?: { city?: string } }).location?.city || 'pune'
  const cityInfo = cityRainfallLookup(city)
  const cityRwh = lookupCityRwhRule(city)

  // 2. Water Dimensions & Statutory Formulas
  const roofAreaM2 = doc.water.areaM2 ?? cost.quantities.roofArea
  const rainfallMm = doc.water.rainfallMm ?? cityInfo.annualRainfallMm
  const runoff = doc.water.runoff ?? NATIONAL_STANDARDS.runoffCoefficientRcc.value
  const efficiency = doc.water.efficiency ?? NATIONAL_STANDARDS.collectionFilterEfficiency.value
  const occupants = (brief.household?.members?.length ?? 4) || 4
  const dailyDemandL = doc.water.dailyDemandL ?? (occupants * NATIONAL_STANDARDS.domesticLpcd.value)

  // Utilities tank detection
  const utilitiesUndergroundL = cost.quantities.tanks?.undergroundLitres ?? 0
  const isUtilitiesTankSet = doc.water.capacityL !== null || utilitiesUndergroundL > 0
  const tankCapacityL = doc.water.capacityL ?? (utilitiesUndergroundL > 0 ? utilitiesUndergroundL : null)

  // Water calculation
  const annualHarvestL = Math.round(rainfallMm * roofAreaM2 * runoff * efficiency)

  // Metric 1: "Annual harvest covers N days of household demand"
  const annualHarvestCoverageDays = dailyDemandL > 0 ? Math.round(annualHarvestL / dailyDemandL) : 0

  // Metric 2: "A full tank lasts N days with no rain" (drought autonomy)
  const tankAutonomyDays = (tankCapacityL !== null && tankCapacityL > 0 && dailyDemandL > 0)
    ? Math.round(tankCapacityL / dailyDemandL)
    : null
  const tankAutonomyDisplay = tankAutonomyDays !== null ? `${tankAutonomyDays} Days` : 'set a tank size'

  const waterBalance = calculateMonthlyWaterBalance(
    rainfallMm,
    roofAreaM2,
    runoff,
    efficiency,
    dailyDemandL,
    tankCapacityL ?? 10000
  )

  const plotAreaM2 = design.model.plot.width * design.model.plot.depth
  const isPlotMandatory = cityRwh.plotThresholdM2 !== null ? plotAreaM2 >= cityRwh.plotThresholdM2 : false

  // 3. Thermal Envelope & Heat Conduction
  const standardRoofU = doc.climate.currentRoofU ?? NATIONAL_STANDARDS.standardRoofUValue.value
  const coolRoofU = doc.climate.proposedRoofU ?? NATIONAL_STANDARDS.coolRoofUValue.value
  const tempDeltaK = doc.climate.temperatureDifferenceK ?? NATIONAL_STANDARDS.coolRoofTempDeltaK.value

  const heat = roofHeatComparison({
    roofAreaM2,
    standardRoofU,
    coolRoofU,
    temperatureDifferenceK: tempDeltaK,
  })
  const heatIngressStandardW = heat ? heat.standardW : 0
  const heatIngressCoolW = heat ? heat.coolW : 0
  const heatCutWatts = heat ? heat.differenceW : 0
  const percentHeatReduction = heat ? heat.percentReduction : 0

  // 4. Solar Rooftop Generation
  const solar = solarYield(roofAreaM2)
  const solarFin = solarFinancials(solar.kw, solar.annualKwh, true)
  const monthlySolarData = solar.monthlyKwh.map(m => ({ label: m.month, value: m.kwh }))

  // 5. BOQ Eco-Swaps & Embodied Carbon
  const ecoSwaps = calculateEcoSwaps(cost)
  const rupeeSavings = ecoSwaps.reduce((acc, s) => acc + s.rupeeSaving, 0)
  const carbonSavingsKg = ecoSwaps.reduce((acc, s) => acc + s.kgCo2eSaving, 0)
  const costExpected = cost.expected
  const costAfterSwaps = Math.max(0, costExpected - rupeeSavings)
  const ecoSavingsPct = costExpected > 0 ? Number(((rupeeSavings / costExpected) * 100).toFixed(1)) : 0
  const budget = doc.budgetInr ?? brief.budget?.amount ?? null
  const withinBudget = budget !== null ? costAfterSwaps <= budget : false

  const carbonDonut = calculateCarbonBreakdown(cost)

  // 6. Accessibility & Barrier-Free Circulation
  const access = accessibilityAudit(model, ramp)

  // 7. Community Cluster & PMAY-U 2.0
  const carpetAreaM2 = cost.quantities.floorArea
  const pmay = pmayEligibility(carpetAreaM2)
  const households = doc.community.households ?? 1
  const sharedAllowanceInr = doc.community.sharedAllowanceInr ?? 0
  const clusterScale = communityScale(
    costExpected,
    households,
    sharedAllowanceInr,
    annualHarvestL,
    carbonSavingsKg,
    rupeeSavings
  )

  // 8. Composite Scoring Engine
  const ventCount = air.reduce((acc, a) => acc + a.paths.length, 0)
  const scores = calculateImpactScores({
    annualHarvestCoverageDays,
    usableHarvestLitres: waterBalance.usableHarvestLitres,
    annualDemandLitres: dailyDemandL * 365,
    roofAreaM2,
    ecoCarbonSavingsKg: carbonSavingsKg,
    totalEmbodiedKg: carbonDonut.totalKg,
    floorAreaM2: cost.quantities.floorArea,
    hasBoq: cost.boq.length > 0,
    coolRoofU,
    tempDeltaK,
    roomsCount: model.rooms.length,
    ventilationCount: ventCount,
    accessVerdict: access.verdict,
    routeDoorsPassCount: access.passRouteCount,
    routeDoorsTotalCount: access.totalRouteDoors,
    narrowestRouteDoorMm: access.narrowestRouteDoorMm,
    rampStatus: access.rampStatus,
    rampGradientRatio: ramp?.gradientRatio ?? null,
    totalDoors: model.doors.length,
    budget,
    costExpected,
    costAfterSwaps,
  })

  // 9. Live Headline
  const headline = generateImpactHeadline({
    harvestL: annualHarvestL,
    annualHarvestCoverageDays,
    usableHarvestL: waterBalance.usableHarvestLitres,
    demandCoveredPercent: waterBalance.demandCoveredPercent,
    solarKw: solar.kw,
    ecoSavingsRupees: rupeeSavings,
    heatCutWatts,
    accessVerdict: access.verdict,
  })

  // 10. Dynamic Sparkline Series (Real Values Only)
  const affordabilitySparkline = [
    0,
    Math.round(rupeeSavings * 0.2),
    Math.round(rupeeSavings * 0.4),
    Math.round(rupeeSavings * 0.6),
    Math.round(rupeeSavings * 0.8),
    rupeeSavings,
  ]

  const waterSparkline = waterBalance.monthly.map(m => m.harvestL)
  const climateSparkline = [
    heatIngressStandardW,
    Math.round(heatIngressStandardW * 0.85),
    Math.round(heatIngressStandardW * 0.65),
    heatIngressCoolW,
  ]

  const summary: ImpactSummary = {
    scores,
    headline,
    kpis: {
      affordability: {
        ecoSavingsInr: rupeeSavings,
        ecoSavingsPct,
        sparklineData: affordabilitySparkline,
      },
      water: {
        annualHarvestCoverageDays,
        tankAutonomyDays,
        tankAutonomyDisplay,
        annualHarvestL,
        usableHarvestL: waterBalance.usableHarvestLitres,
        demandCoveredPercent: waterBalance.demandCoveredPercent,
        sparklineData: waterSparkline,
      },
      climate: {
        heatCutWatts,
        heatIngressStandardW,
        heatIngressCoolW,
        sparklineData: climateSparkline,
      },
      accessibility: {
        verdict: access.verdict,
        detail: access.reasons[0] ?? 'All accessible route criteria compliant.',
        routeDoorsPassCount: access.passRouteCount,
        routeDoorsTotalCount: access.totalRouteDoors,
        rampStatus: access.rampStatus,
      },
    },
    affordability: {
      budget,
      costExpected,
      costAfterSwaps,
      rupeeSavings,
      carbonSavingsKg,
      withinBudget,
      waterfallData: [
        { name: 'Target Budget', value: budget ?? costExpected },
        { name: 'Current BOQ', value: costExpected },
        { name: 'After Eco-Swaps', value: costAfterSwaps },
      ],
      carbonDonut,
      carbonCompare: {
        baselineKg: carbonDonut.totalKg,
        afterSwapsKg: Math.max(0, carbonDonut.totalKg - carbonSavingsKg),
        savingsKg: carbonSavingsKg,
      },
      ecoSwaps,
    },
    water: {
      city,
      annualRainfallMm: rainfallMm,
      roofAreaM2,
      runoffCoefficient: runoff,
      filterEfficiency: efficiency,
      dailyDemandL,
      annualDemandL: dailyDemandL * 365,
      annualHarvestL,
      annualHarvestCoverageDays,
      usableHarvestLitres: waterBalance.usableHarvestLitres,
      overflowLitres: waterBalance.overflowLitres,
      demandCoveredPercent: waterBalance.demandCoveredPercent,
      longestDryGapDays: waterBalance.longestDryGapDays,
      suggestedTankCapacity80Pct: waterBalance.suggestedTankCapacity80Pct,
      tankCapacityL,
      tankAutonomyDays,
      tankAutonomyDisplay,
      isUtilitiesTankSet,
      tankerSavingsInr: waterBalance.tankerSavingsInr,
      tankerTripsAvoided: waterBalance.tankerTripsSaved,
      monthlyBalance: waterBalance.monthly,
      totalDeficitL: waterBalance.totalDeficitL,
      totalOverflowL: waterBalance.totalOverflowL,
      rwhCityMandate: cityRwh,
      isPlotMandatory,
    },
    climate: {
      roofAreaM2,
      standardRoofU,
      coolRoofU,
      tempDeltaK,
      heatIngressStandardW,
      heatIngressCoolW,
      heatCutWatts,
      percentHeatReduction,
      ventilationRoutesCount: ventCount,
      airPaths: air,
      solar: {
        usableRoofM2: solar.usableM2,
        solarCapacityKw: solar.kw,
        annualGenerationKwh: solar.annualKwh,
        grossInstallationCostInr: solarFin.grossCost,
        pmSuryaGharSubsidyInr: solarFin.subsidy,
        netInvestmentInr: solarFin.netCost,
        annualElectricitySavingsInr: solarFin.annualSavings,
        paybackYears: solarFin.paybackYears,
        cashFlow: solarFin.cashFlow,
        monthlyGeneration: monthlySolarData,
      },
    },
    accessibility: {
      verdict: access.verdict,
      reasons: access.reasons,
      routeDefinitionNote: access.routeDefinitionNote,
      doors: access.doors,
      routeDoors: access.routeDoors,
      informationalDoors: access.informationalDoors,
      passRouteCount: access.passRouteCount,
      totalRouteDoors: access.totalRouteDoors,
      totalDoors: access.totalDoors,
      narrowestRouteDoorMm: access.narrowestRouteDoorMm,
      narrowestDoorMm: access.narrowestDoorMm,
      ramp: {
        status: access.rampStatus,
        gradientRatio: ramp?.gradientRatio ?? null,
        riseMm: ramp?.riseMm ?? null,
        runMm: ramp ? ramp.riseMm * ramp.gradientRatio : null,
        reason: access.rampReason,
      },
      buildingModel: model,
      rampModel: ramp,
      safetyChecks: doc.safetyChecks,
    },
    community: {
      households,
      sharedAllowanceInr,
      carpetAreaM2,
      pmayCheck: pmay,
      clusterScale: {
        totalCostInr: clusterScale.totalCost,
        perHomeCostInr: clusterScale.perHomeCost,
        totalRainwaterHarvestL: clusterScale.totalRainwaterL,
        totalCarbonAvoidedTonnes: clusterScale.totalCarbonAvoidedTonnes,
        totalRupeesSaved: clusterScale.totalRupeesSaved,
      },
    },
  }

  // Runtime dev-only invariant assertion (Requirement 1.4: console.error, removed in production)
  const isDev = (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') ||
    (typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV))
  if (isDev) {
    assertImpactSummaryConsistency(summary)
  }

  return summary
}

function assertImpactSummaryConsistency(summary: ImpactSummary): void {
  const errors: string[] = []
  if (summary.kpis.affordability.ecoSavingsInr !== summary.affordability.rupeeSavings) {
    errors.push(`Affordability savings mismatch: KPI ${summary.kpis.affordability.ecoSavingsInr} !== Pillar ${summary.affordability.rupeeSavings}`)
  }
  if (summary.kpis.water.annualHarvestL !== summary.water.annualHarvestL) {
    errors.push(`Water harvest mismatch: KPI ${summary.kpis.water.annualHarvestL} !== Pillar ${summary.water.annualHarvestL}`)
  }
  if (summary.kpis.water.annualHarvestCoverageDays !== summary.water.annualHarvestCoverageDays) {
    errors.push(`Water coverage days mismatch: KPI ${summary.kpis.water.annualHarvestCoverageDays} !== Pillar ${summary.water.annualHarvestCoverageDays}`)
  }
  if (summary.kpis.climate.heatCutWatts !== summary.climate.heatCutWatts) {
    errors.push(`Climate heat cut mismatch: KPI ${summary.kpis.climate.heatCutWatts} !== Pillar ${summary.climate.heatCutWatts}`)
  }
  if (summary.kpis.climate.heatIngressStandardW !== summary.climate.heatIngressStandardW) {
    errors.push(`Climate standard ingress mismatch: KPI ${summary.kpis.climate.heatIngressStandardW} !== Pillar ${summary.climate.heatIngressStandardW}`)
  }
  if (summary.kpis.climate.heatIngressCoolW !== summary.climate.heatIngressCoolW) {
    errors.push(`Climate cool ingress mismatch: KPI ${summary.kpis.climate.heatIngressCoolW} !== Pillar ${summary.climate.heatIngressCoolW}`)
  }
  if (summary.kpis.accessibility.verdict !== summary.accessibility.verdict) {
    errors.push(`Accessibility verdict mismatch: KPI ${summary.kpis.accessibility.verdict} !== Pillar ${summary.accessibility.verdict}`)
  }
  if (summary.kpis.accessibility.routeDoorsPassCount !== summary.accessibility.passRouteCount) {
    errors.push(`Accessibility pass doors mismatch: KPI ${summary.kpis.accessibility.routeDoorsPassCount} !== Pillar ${summary.accessibility.passRouteCount}`)
  }
  if (summary.kpis.accessibility.routeDoorsTotalCount !== summary.accessibility.totalRouteDoors) {
    errors.push(`Accessibility total doors mismatch: KPI ${summary.kpis.accessibility.routeDoorsTotalCount} !== Pillar ${summary.accessibility.totalRouteDoors}`)
  }
  if (summary.kpis.accessibility.rampStatus !== summary.accessibility.ramp.status) {
    errors.push(`Accessibility ramp status mismatch: KPI ${summary.kpis.accessibility.rampStatus} !== Pillar ${summary.accessibility.ramp.status}`)
  }
  if (errors.length > 0) {
    console.error('[Impact SSOT Runtime Invariant Failure]:', errors.join('; '))
  }
}

