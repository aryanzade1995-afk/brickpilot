import type { CanonicalModel } from '../model/canonical.ts'
import { validate } from '../rules/index.ts'
import { generate, generateOne } from './generate.ts'
import { applyMeasuredPlan } from '../existing/survey.ts'
import { validateExisting } from '../existing/validate.ts'
import { preferenceScore } from './score.ts'
import type { Design } from './types.ts'
import type { ExistingStructure } from './planner/types.ts'
import { structureGrid } from './planner/existing.ts'

/** Plans tried per structure; each differs by seed (mirror, orientation, room order). */
export const EXISTING_ATTEMPTS = 24

export type ExistingResult = {
  design: Design
  /** the plan passes every mandatory rule */
  valid: boolean
  tried: number
  passing: number
  /** why no plan was produced, when `design` is null-like */
  reason?: string
}

/** Best valid plan around the locked structure: deterministic, same input and seed give the same plan. */
export function generateExisting(model: CanonicalModel, structure: ExistingStructure, seed = 1): ExistingResult | { design: null; valid: false; tried: number; passing: 0; reason: string } {
  if(structure.measuredPlan) {
    const design=applyMeasuredPlan(generate(model),structure)
    const valid=validate(design,{checkFacade:false}).hardChecksPass&&validateExisting(design).ok
    return {design,valid,tried:1,passing:valid?1:0}
  }
  const grid = structureGrid(structure)
  if (!grid) return { design: null, valid: false, tried: 0, passing: 0, reason: 'The structure needs at least two columns or footings that do not line up in both directions.' }
  const briefKey = model.seed.split('-')[0]
  let best: { design: Design; score: number } | null = null
  let fallback: { design: Design; errors: number } | null = null
  let passing = 0, tried = 0
  const seen = new Set<string>()
  for (let attempt = 0; attempt < EXISTING_ATTEMPTS; attempt++) {
    tried++
    const design = generateOne(model, 'rectangular', seed + attempt * 31, briefKey, false, false, structure)
    if (!design) continue
    const report = validate(design, { checkFacade: false })
    // a LOCKED column cannot be moved: standing inside a room is reported on the plan, not a reason to reject it
    const lockedIds = new Set(design.floors.flatMap((f) => (f.columns ?? []).filter((c) => c.state === 'LOCKED').map((c) => c.id)))
    const blocking = report.findings.filter((f) => f.severity === 'error' && !(f.code === 'COLUMN_NOT_IN_WALL' && [...lockedIds].some((id) => f.message.startsWith(id))))
    const existingReport=validateExisting(design)
    const acceptable = blocking.length === 0 && existingReport.ok
    if (acceptable) report.hardChecksPass = true
    const key = design.floors.map((f) => f.rooms.map((r) => `${r.id}${r.rect.x},${r.rect.y},${r.rect.w},${r.rect.h}`).join(';')).join('|')
    if (acceptable) {
      if (seen.has(key)) continue
      seen.add(key); passing++
      const score = preferenceScore(design).total
      if (!best || score > best.score) best = { design, score }
    } else if (!fallback || blocking.length+existingReport.errors < fallback.errors) fallback = { design, errors: blocking.length+existingReport.errors }
  }
  if (best) return { design: best.design, valid: true, tried, passing }
  if (fallback) return { design: fallback.design, valid: false, tried, passing: 0, reason: 'No layout around this structure passes every rule; the closest one is shown with its conflicts.' }
  return { design: null, valid: false, tried, passing: 0, reason: 'The rooms you asked for do not fit this structure. Reduce the programme or confirm the structure measurements.' }
}
