import { defaultBrief, type Brief } from '@/lib/model/brief.ts'
import { compile } from '@/lib/model/canonical.ts'
import { generate } from '@/lib/engine/generate.ts'
import { estimateBoq, type CostEstimate } from '@/lib/cost/boq.ts'
import { validate, type ValidationReport } from '@/lib/rules/index.ts'
import { createBuildingModel } from '@/lib/engine/buildingModel.ts'
import { emptyImpact, type ImpactDocument } from '@/lib/impact/schema.ts'
import type { Result } from '@/state/studio.ts'

export interface SampleProjectData {
  brief: Brief
  result: Result
  cost: CostEstimate
  report: ValidationReport
  document: ImpactDocument
}

let cachedSample: SampleProjectData | null = null

export function getSampleProjectData(): SampleProjectData {
  if (cachedSample) return cachedSample

  const brief = defaultBrief()
  brief.project.name = 'Pune Eco-Villa (Green Pilot)'
  brief.site.plotWidth = 20
  brief.site.plotDepth = 25
  brief.spaces.occupants = 4
  brief.entry.ramp = true

  const model = compile(brief)
  const design = generate(model, { seed: 41 })
  const report = validate(design)
  const cost = estimateBoq(design, brief)
  const targetBudget = Math.round(cost.expected * 1.05)
  brief.budget = { amount: targetBudget }
  const buildingModel = createBuildingModel(design)

  const result: Result = {
    model,
    design,
    report,
    buildingModel,
    villaDesignDNA: null,
    massingModel: null,
    facadeModel: null,
    shapeFingerprint: null,
    shapeStatus: 'accepted',
    cost,
    generatedAt: Date.now(),
  }

  const document = emptyImpact()
  document.budgetInr = targetBudget
  document.water = {
    ...document.water,
    capacityL: 10000,
    rainfallMm: 750,
    areaM2: Math.round(cost.quantities.roofArea || 140),
    runoff: 0.85,
    efficiency: 0.80,
    dailyDemandL: 540,
    source: 'Pune Municipal Met Data',
    geometryKey: 'pune-sample',
  }
  document.climate = {
    areaM2: Math.round(cost.quantities.roofArea || 140),
    currentRoofU: 2.33,
    proposedRoofU: 0.58,
    temperatureDifferenceK: 15,
    source: 'Eco-Niwas Samhita Baseline',
  }
  document.energy = {
    currentMonthlyKwh: 350,
    proposedMonthlyKwh: 90,
    source: 'PM Surya Ghar 5kW Rooftop Simulation',
  }

  cachedSample = {
    brief,
    result,
    cost,
    report,
    document,
  }

  return cachedSample
}
