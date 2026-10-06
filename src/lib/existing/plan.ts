import { briefSchema, type Brief } from '../model/brief.ts'
import { compile } from '../model/canonical.ts'
import { generateExisting } from '../engine/generateExisting.ts'
import { validate, type ValidationReport } from '../rules/index.ts'
import type { Design } from '../engine/types.ts'
import type { Answers } from './types.ts'
import type { AsBuilt } from './asBuilt.ts'
import { validateExisting, type ExistingReport } from './validate.ts'

/** The brief the planner works from, built only from what the user told us about the plot and the rooms. */
export function briefFromAnswers(a: Answers): Brief {
  return briefSchema.parse({
    project: { name: 'My existing structure' },
    site: { plotWidth: a.plotWidthM, plotDepth: a.plotDepthM, facing:a.roadSide,roadEdges:[a.roadSide] },
    levels: { storeys: Math.max(0, Math.min(3, a.storeysWanted - 1)), ...(a.floorHeightM ? {floorToFloor:a.floorHeightM}: {}) },
    rooms: {
      bedroomsWithBath: a.bedroomsWithBath, bedroomsNoBath: a.bedroomsNoBath, sharedBaths: a.sharedBaths, studies: a.studies,
      priorities: { coveredParking: a.parking, coveredVerandah: false, utility: a.utility, pooja: a.pooja, courtyard: false, garden: true, compoundWall: false },
    },
  })
}

export type ExistingPlan =
  | { ok: true; design: Design; brief: Brief; rules: ValidationReport; existing: ExistingReport; valid: boolean; passing: number; tried: number }
  | { ok: false; reason: string; brief: Brief }

/** Site Image -> As-Built Model -> Locked constraints -> valid flexible 2D plan. */
export function planAroundStructure(asBuilt: AsBuilt, answers: Answers, seed = 1): ExistingPlan {
  const brief = briefFromAnswers(answers)
  const model = compile(brief)
  const result = generateExisting(model, asBuilt.structure, seed)
  if (!result.design) return { ok: false, reason: result.reason ?? 'No layout fits this structure.', brief }
  const rules = validate(result.design, { checkFacade: false })
  const existing = validateExisting(result.design)
  // a locked column standing inside a room is reported (warning) but does not reject the plan
  const lockedIds = new Set(result.design.floors.flatMap((f) => (f.columns ?? []).filter((c) => c.state === 'LOCKED').map((c) => c.id)))
  const blocking = rules.findings.filter((f) => f.severity === 'error' && !(f.code === 'COLUMN_NOT_IN_WALL' && [...lockedIds].some((id) => f.message.startsWith(id))))
  const valid = blocking.length === 0 && existing.ok
  return { ok: true, design: result.design, brief, rules, existing, valid, passing: result.passing, tried: result.tried }
}
