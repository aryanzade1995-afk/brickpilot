import { newDesignSeed } from '@/lib/newDesignSeed.ts'
import { selectAdaptiveVilla } from '@/lib/engine/fingerprint/AdaptiveVillaSearch.ts'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { compile, type CanonicalModel } from '@/lib/model/canonical.ts'
import { briefSchema, defaultBrief, geometryBrief, type Brief } from '@/lib/model/brief.ts'
import {
  generate,
  MASSING_TYPES,
  type Design,
  type MassingType,
} from '@/lib/engine/index.ts'
import { distinctDirectionPlans } from '@/lib/engine/generate.ts'
import { planFingerprint, type PlanFingerprint } from '@/lib/engine/planner/planFingerprint.ts'
import { applyBriefChoice } from '@/lib/engine/planner/fit.ts'
import { generateExisting } from '@/lib/engine/generateExisting.ts'
import type { ExistingStructure } from '@/lib/engine/planner/types.ts'
import { layoutSignature, type LayoutDoc } from '@/lib/plan/layout.ts'
import { extractLayout } from '@/lib/plan/layout.ts'
import { commit as commitLayout, replanNearby, type Notice, type OpResult } from '@/lib/plan/ops.ts'
import { parseLayout } from '@/lib/plan/parse.ts'
import { geometryCostKey } from '@/lib/cost/quantities.ts'
import { useFinishes } from '@/state/finishes.ts'
import { validate, type ValidationReport } from '@/lib/rules/index.ts'
import { estimateBoq, type CostEstimate } from '@/lib/cost/index.ts'
import { varyExterior } from '@/lib/engine/variation.ts'
import { parseInspirationPreferences, type InspirationPreferences } from '@/lib/engine/designDna.ts'
import type { BuildingModel } from '@/lib/engine/buildingModel.ts'
import { createVillaDesignDNA, type VillaDesignDNA } from '@/lib/engine/villaDesignDna.ts'
import type { MassingModel } from '@/lib/engine/massing/model.ts'
import type { ProceduralFacadeModel } from '@/lib/engine/facade/proceduralTypes.ts'
import { generateAlternativeDesign } from '@/lib/engine/generateAlternativeDesign.ts'
import { fingerprintRecord, parseFingerprintHistory, type ShapeFingerprintRecord, type VillaShapeFingerprint } from '@/lib/engine/fingerprint/VillaShapeFingerprint.ts'
import { DEFAULT_DIVERSITY_LIMITS, diversityLimits, formatFingerprintDebug,
  type FingerprintDebug, type VillaDiversityLimits } from '@/lib/engine/fingerprint/VillaDiversityGate.ts'

export type Result = {
  model: CanonicalModel
  design: Design
  report: ValidationReport
  buildingModel: BuildingModel | null
  villaDesignDNA: VillaDesignDNA | null
  massingModel: MassingModel | null
  facadeModel: ProceduralFacadeModel | null
  shapeFingerprint: VillaShapeFingerprint | null
  shapeStatus: 'accepted' | 'replay' | 'rejected' | 'invalid-plan'
  cost: CostEstimate
  generatedAt: number
}

/** the architecture the user locked in on the Directions screen — a concrete
 *  massing archetype plus the seed that produced it. Together with the brief it
 *  fully and deterministically defines the canonical design. */
export type PinnedDir = {
  planner?: 'ml' | 'baseline'
  planFamily?: MassingType
  recipe?: Design['planRecipe']
  massing: MassingType
  seed: number
  /** the plan seed of a direction explored with its own plan shape; absent =
   *  the brief's own plan (older pins, Generate again) */
  planSeed?: number
  inspiration?: InspirationPreferences | null
}

export type DirectionOption = {
  planFingerprint: PlanFingerprint
  massing: MassingType
  seed: number
  planSeed?: number
  label: string
  blurb: string
  novelty: number
  design: Design
  report: ValidationReport
  buildingModel: BuildingModel
  villaDesignDNA: VillaDesignDNA
  massingModel: MassingModel
  facadeModel: ProceduralFacadeModel
  shapeFingerprint: VillaShapeFingerprint
}

/** Read legacy `massing:seed` and newer pinned records with image preferences. */
export function parsePinned(v: unknown): PinnedDir | null {
  if (v && typeof v === 'object' && 'massing' in v && 'seed' in v) {
    const o = v as Record<string, unknown>
    if (typeof o.massing === 'string' && MASSING_TYPES.includes(o.massing as MassingType) &&
      typeof o.seed === 'number' && Number.isFinite(o.seed)) {
      const inspiration = parseInspirationPreferences(o.inspiration)
      const recipe=o.recipe as Record<string,unknown>|undefined
      const parsedRecipe=recipe && recipe.version==='resplan-ridge-retrieval-v1' && Number.isSafeInteger(recipe.seed) &&
        ['rectangular','stepped','l-shape','courtyard','twin-wing','u-wing','courtyard-ring','pavilion'].includes(String(recipe.family))
        ? {family:recipe.family,seed:recipe.seed,version:recipe.version} as Design['planRecipe'] : undefined
      return { massing: o.massing as MassingType, seed: o.seed,
        ...(parsedRecipe?{recipe:parsedRecipe}:{}),
        ...(o.planner === 'ml' || o.planner === 'baseline' ? {planner:o.planner} : {}),
        ...(typeof o.planFamily==='string' && MASSING_TYPES.includes(o.planFamily as MassingType) ? {planFamily:o.planFamily as MassingType} : {}),
        ...(Number.isSafeInteger(o.planSeed) ? { planSeed: o.planSeed as number } : {}),
        ...(inspiration ? { inspiration } : {}) }
    }
    return null
  }
  if (typeof v !== 'string') return null
  if (v.startsWith('{')) {
    try { return parsePinned(JSON.parse(v)) } catch { return null }
  }
  const [m, s] = v.split(':')
  const seed = Number(s)
  if (!MASSING_TYPES.includes(m as MassingType) || !Number.isFinite(seed)) return null
  return { massing: m as MassingType, seed }
}

export const serializePinned = (p: PinnedDir | null): string | null =>
  p ? p.inspiration || p.planSeed !== undefined || p.planner || p.planFamily || p.recipe ? JSON.stringify(p) : `${p.massing}:${p.seed}` : null

/** the 2D plan a pin stands on: a direction's own plan shape and seed, or the
 *  brief's plan (an older pin of another shape regenerates that shape) */
function pinnedPlan(model: CanonicalModel, pinned: PinnedDir): Design {
  const planner=pinned.planner??'baseline'
  if (pinned.planSeed !== undefined) return generate(model, { massing: pinned.planFamily??pinned.massing, seed: pinned.planSeed,planner,recipe:pinned.recipe })
  const plan = generate(model,{planner})
  return plan.massingType === pinned.massing ? plan : generate(model, { massing: pinned.massing,planner })
}

export type PlanOpOutcome = { ok: true; message: string; notes: Notice[]; layout: LayoutDoc | null; before: LayoutDoc | null } | { ok: false; reason: string }

let baseMemo: { key: string; plan: Design | null } | null = null
/** the plan a layout stands on; cached because every edit asks for it */
function basePlanOf(brief: Brief, pinned: PinnedDir | null, existing: { structure: ExistingStructure; seed: number } | null): Design | null {
  const model = compile(brief)
  const key = JSON.stringify([model.seed, pinned && [pinned.massing, pinned.seed, pinned.planSeed, pinned.planner, pinned.planFamily, pinned.recipe], existing])
  if (baseMemo?.key === key) return baseMemo.plan
  const plan = existing ? (generateExisting(model, existing.structure, existing.seed).design ?? null) : pinned ? pinnedPlan(model, pinned) : null
  baseMemo = { key, plan }
  return plan
}

type StudioState = {
  brief: Brief
  briefChoiceIssue: string | null
  selectedRoomId: string | null
  selectRoom: (id: string | null) => void
  directions: DirectionOption[] | null
  pinned: PinnedDir | null
  referencePreferences: InspirationPreferences | null
  recentExteriorSeeds: number[]
  recentVillaFingerprints: ShapeFingerprintRecord[]
  diversityLimits: VillaDiversityLimits
  shapeDebug: FingerprintDebug[]
  generationNotice: string | null
  setDiversityLimits: (limits: Partial<VillaDiversityLimits>) => void
  result: Result | null
  edit: (recipe: (b: Brief) => void) => void
  reset: () => void
  /** replace the working brief + pinned direction (loading a saved design) */
  loadSaved: (brief: Brief, pinned: PinnedDir | null, layout?: LayoutDoc | null, existing?: { structure: ExistingStructure; seed: number } | null) => void
  /** Existing Structure Mode: plan around a structure that is already built (null = the normal brief flow) */
  existing: { structure: ExistingStructure; seed: number } | null
  /** the room-by-room edits made to the pinned plan (null = the plan as generated) */
  layout: LayoutDoc | null
  /** the plan the layout edits stand on: the pinned plan, or the plan around the built structure */
  basePlan: () => Design | null
  /** run one edit; it is applied only if the whole plan, the 3D villa and every rule still hold */
  applyPlanOp: (run: (layout: LayoutDoc, plan: Design) => OpResult, opts?: { autoReplan?: boolean; dry?: boolean }) => PlanOpOutcome
  /** replace the layout wholesale (undo, redo, restore); null returns to the generated plan */
  setLayout: (layout: LayoutDoc | null) => PlanOpOutcome
  loadExisting: (brief: Brief, structure: ExistingStructure, seed: number) => void
  clearExisting: () => void
  setReferencePreferences: (preferences: InspirationPreferences | null) => void
  reroll: () => void
  /** re-roll the geometry of the pinned massing (or the brief seed) and rebuild */
  reseed: () => Result
  explore: () => DirectionOption[]
  /** the same directions, generated off the main thread; the store fills in when they are ready */
  exploreInBackground: () => Promise<void>
  pin: (dir: PinnedDir) => Result
  run: () => Result
}

function variationLevel(brief: Brief) {
  return brief.style.diversity === 'low' ? 'subtle' :
    brief.style.diversity === 'high' || brief.style.diversity === 'extreme' ? 'bold' : 'balanced'
}

function resultForPlan(design: Design): Result {
  return { model: design.model, design, report: validate(design), buildingModel: null, villaDesignDNA: null,
    massingModel: null, facadeModel: null, shapeFingerprint: null, shapeStatus: 'invalid-plan',
    cost: estimateBoq(design), generatedAt: Date.now() }
}

function exactResult(plan: Design, seed: number, inspiration: InspirationPreferences | null,
  shapeStatus: 'accepted' | 'replay' = 'replay'): Result {
  const design = varyExterior(plan, seed, variationLevel(plan.model.brief), inspiration)
  const architecture = generateAlternativeDesign(design, seed)
  return { ...resultForPlan(design), ...architecture, facadeModel: architecture.facadeGrammar, shapeStatus }
}

function generateDistinct(plan: Design, seed: number, inspiration: InspirationPreferences | null,
  history: ShapeFingerprintRecord[], limits: VillaDiversityLimits, references: ShapeFingerprintRecord[] = []) {
  return selectAdaptiveVilla(seed, history, (candidateSeed) => {
    const candidate = exactResult(plan, candidateSeed, inspiration, 'accepted')
    return { candidate, fingerprint: candidate.shapeFingerprint! }
  }, limits, references)
}

const exhaustedNotice = (attempts: number) =>
  `No additional valid architecture could be assembled after ${attempts} attempts. The current valid plan is preserved.`

function replayResult(plan: Design, seed: number, inspiration: InspirationPreferences | null) {
  try { return { result: exactResult(plan, seed, inspiration), debug: [] as FingerprintDebug[], notice: null } }
  catch (error) {
    const decision: FingerprintDebug = { seed, family: 'unknown', nearestPreviousSeed: null, similarityPercent: 0,
      accepted: false, code: 'INVALID_ARCHITECTURE', reason: error instanceof Error ? error.message : 'Architecture validation failed.' }
    console.debug(formatFingerprintDebug(decision))
    return { result: { ...resultForPlan(plan), shapeStatus: 'rejected' as const }, debug: [decision],
      notice: 'The saved villa does not pass the current architecture checks. The 2D plan is preserved. Choose a new direction.' }
  }
}

/** a persisted Existing Structure Mode structure, or null when it is missing or malformed */
function parseExisting(value: unknown): { structure: ExistingStructure; seed: number } | null {
  const v = value as { structure?: Partial<ExistingStructure>; seed?: unknown } | null
  const s = v?.structure
  const point = (p: unknown) => !!p && typeof (p as { x: unknown }).x === 'number' && typeof (p as { y: unknown }).y === 'number'
  if (!s || !Array.isArray(s.columns) || !Array.isArray(s.footings) || !Array.isArray(s.beams) || !Array.isArray(s.walls) || typeof s.storeysBuilt !== 'number') return null
  if (!s.columns.every((c) => point(c.at)) || !s.footings.every((f) => point(f.at)) || !s.beams.every((b) => point(b.a) && point(b.b))) return null
  return { structure: s as ExistingStructure, seed: Number.isSafeInteger(v?.seed) ? (v!.seed as number) : 1 }
}

function assemble(brief: Brief, pinned: PinnedDir | null, inspiration: InspirationPreferences | null,
  history: ShapeFingerprintRecord[], limits: VillaDiversityLimits, existing: { structure: ExistingStructure; seed: number } | null = null,
  layout: LayoutDoc | null = null) {
  const model = compile(brief)
  // Existing Structure Mode plans around what is built; otherwise the normal planner runs
  const fromStructure = existing ? generateExisting(model, existing.structure, existing.seed).design : null
  let plan = fromStructure ?? (pinned ? pinnedPlan(model, pinned) : generate(model))
  // the person's room edits stand on exactly the plan they were made on; any other plan ignores them
  let layoutUsed: LayoutDoc | null = null
  if (layout && layout.signature === layoutSignature(plan)) {
    const edited = commitLayout(plan, layout)
    if (edited.ok) { plan = edited.design; layoutUsed = layout }
  }
  if (!validate(plan).hardChecksPass) return { result: resultForPlan(plan), history, debug: [], notice: null, layout: layoutUsed }
  if (pinned) {
    // Loading/pinning/navigation is an exact replay, not another new candidate.
    return { ...replayResult(plan, pinned.seed, inspiration), history, layout: layoutUsed }
  }
  const selected = generateDistinct(plan, brief.variation + 1, inspiration, history, limits)
  return { result: selected.accepted?.candidate ?? { ...resultForPlan(plan), shapeStatus: 'rejected' as const },
    history: selected.history, debug: selected.debug, layout: layoutUsed,
    notice: selected.accepted ? (selected.debug.at(-1)?.reason.startsWith('Adaptive') ? selected.debug.at(-1)!.reason : null) : exhaustedNotice(selected.debug.length) }
}

type Setter = (fn: (s: StudioState) => void) => void

/** One plan edit, end to end: the edit, the nearby replan, the full rule check, then the rebuilt 3D villa. Nothing is kept unless all of it holds. */
function runPlanOp(get: () => StudioState, set: Setter, run: (layout: LayoutDoc, plan: Design) => OpResult,
  opts: { autoReplan?: boolean; clear?: boolean; dry?: boolean } = {}): PlanOpOutcome {
  const cur = get()
  const plan = basePlanOf(cur.brief, cur.pinned, cur.existing)
  if (!plan) return { ok: false, reason: 'Choose a direction first. There is no plan to edit yet.' }
  const before = cur.layout && cur.layout.signature === layoutSignature(plan) ? cur.layout : null
  const start = before ?? extractLayout(plan)
  const res = run(start, plan)
  if (!res.ok) return res
  let layout = res.layout
  let message = res.message
  let affected = res.affected
  if (opts.autoReplan) {
    const levels = [...new Set(layout.floors.map((f) => f.level))]
    const re = replanNearby(start, layout, plan, levels)
    layout = re.layout
    if (re.notes.length) message = `${message} ${re.notes.join(' ')}`
    // the rooms the replan changed count as affected too, so their sizes and floor rules are re-reported
    const was = new Map(start.floors.flatMap((f) => f.rooms.map((r) => [`${f.level}:${r.id}`, JSON.stringify(r.rect)] as const)))
    affected = [...affected, ...layout.floors.flatMap((f) => f.rooms.filter((r) => was.get(`${f.level}:${r.id}`) !== JSON.stringify(r.rect)).map((r) => r.id))]
  }
  const checked = commitLayout(plan, layout, start, affected)
  if (!checked.ok) return { ok: false, reason: checked.reason }
  const target = opts.clear ? null : layout
  const assembled = assemble(cur.brief, cur.pinned, cur.referencePreferences, cur.recentVillaFingerprints, cur.diversityLimits, cur.existing, target)
  if (assembled.result.shapeStatus === 'rejected' || assembled.result.shapeStatus === 'invalid-plan' || !assembled.result.report.hardChecksPass)
    return { ok: false, reason: 'The plan is valid, but the 3D villa could not be rebuilt for that arrangement. Try a smaller change.' }
  // a dry run only answers whether the edit would hold
  if (opts.dry) return { ok: true, message, notes: checked.notes, layout: target, before: cur.layout }
  const oldKey = cur.result ? geometryCostKey(cur.result.design) : null
  set((s) => {
    s.layout = target
    s.result = assembled.result
    s.recentVillaFingerprints = assembled.history
    s.shapeDebug = assembled.debug
    s.generationNotice = assembled.notice
  })
  // the finishes chosen for the old plan carry over to the edited one
  if (oldKey) {
    const key = geometryCostKey(assembled.result.design)
    const entries = useFinishes.getState().entries
    if (key !== oldKey && entries[oldKey] && !entries[key]) useFinishes.getState().setSelection(key, entries[oldKey])
  }
  return { ok: true, message, notes: checked.notes, layout: target, before: cur.layout }
}

export type DirectionsInput = Pick<StudioState, 'brief' | 'pinned' | 'referencePreferences' | 'recentVillaFingerprints' | 'diversityLimits'>
/** The four design directions for a brief. Pure: it runs on the main thread or in the directions worker. */
export function computeDirections(cur: DirectionsInput) {
    const model = compile(cur.brief)
    const plan = generate(model), dirs: DirectionOption[] = [], debug: FingerprintDebug[] = []
    let history = cur.recentVillaFingerprints, notice: string | null = null
    // every direction stands on its own plan shape, so the four houses differ
    // in form, not only in trim; a shape the plot cannot take falls back to
    // the brief's own plan
    const plans: { plan: Design; massing: MassingType; planSeed?: number }[] = distinctDirectionPlans(model)
    while (plans.length < 4) plans.push({ plan, massing: plan.massingType,planSeed:plan.planSeed })
    const option = (r: Result, index: number, novelty: number, source?: (typeof plans)[number]): DirectionOption => ({
      planFingerprint:planFingerprint(r.design),
      massing: source?.massing ?? r.design.massingType, seed: r.design.dna.seed,
      ...(source?.planSeed !== undefined ? { planSeed: source.planSeed } : {}),
      label: `Direction ${'ABCD'[index]} — ${r.shapeFingerprint!.massingFamily.replaceAll('_', ' ').toLowerCase()}`,
      blurb: `${r.shapeFingerprint!.heroFeature.replaceAll('_', ' ').toLowerCase()} · ${r.shapeFingerprint!.rooflineType.replaceAll('_', ' ').toLowerCase()}`,
      novelty, design: r.design, report: r.report, buildingModel: r.buildingModel!, villaDesignDNA: r.villaDesignDNA!,
      massingModel: r.massingModel!, facadeModel: r.facadeModel!, shapeFingerprint: r.shapeFingerprint! })
    if (cur.pinned) {
      const pinnedSource = { plan: pinnedPlan(model, cur.pinned), massing: cur.pinned.massing, planSeed: cur.pinned.planSeed }
      if (validate(pinnedSource.plan).hardChecksPass) {
        const replay = replayResult(pinnedSource.plan, cur.pinned.seed, cur.referencePreferences)
        if (replay.result.shapeFingerprint) {
          dirs.push(option(replay.result, 0, 0, pinnedSource))
          // the pinned plan takes the first slot; drop the same plan from the rest
          const same = plans.findIndex((p) => p.massing === pinnedSource.massing && p.planSeed === pinnedSource.planSeed)
          plans.splice(same >= 0 ? same : plans.length - 1, 1)
        } else debug.push(...replay.debug)
      }
    }
    if (validate(plan).hardChecksPass || plans.some((p) => p.planSeed !== undefined)) for (let i = dirs.length; i < 4; i++) {
      const source = plans[i - (4 - plans.length)] ?? plans.at(-1)!
      const usedFamilies = new Set(dirs.map((d) => d.facadeModel.architecturalFamily))
      const selection = generateDistinct(source.plan, cur.brief.variation + 1 + i * 977, cur.referencePreferences, history, cur.diversityLimits,
        dirs.map((d) => fingerprintRecord(d.shapeFingerprint)))
      // each direction leads with its own composition where one fits: when
      // the search lands on a family already shown, a few further seeds are
      // tried directly (one candidate each — cheap), else the first stands
      let swap: Result | null = null
      if (selection.accepted && usedFamilies.has(selection.accepted.candidate.facadeModel!.architecturalFamily)) {
        const building = selection.accepted.candidate.buildingModel!
        // the seed's family is known from its design record alone, so only
        // seeds that would lead with a new family are built in full
        const seeds = Array.from({ length: 24 }, (_, k) => cur.brief.variation + 1 + i * 977 + (k + 1) * 131)
          .filter((s) => !usedFamilies.has(createVillaDesignDNA(building, s, cur.brief.style.character).architecturalFamily))
        for (const s of seeds.slice(0, 3)) {
          try {
            const c = exactResult(source.plan, s, cur.referencePreferences, 'accepted')
            if (c.facadeModel && !usedFamilies.has(c.facadeModel.architecturalFamily)) { swap = c; break }
          } catch { /* an invalid candidate is simply skipped */ }
        }
      }
      debug.push(...selection.debug)
      if (!selection.accepted) { notice = exhaustedNotice(selection.debug.length); break }
      const r = swap ?? selection.accepted.candidate
      history = swap ? [...selection.history.slice(0, -1), fingerprintRecord(swap.shapeFingerprint!)] : selection.history
      if (selection.debug.at(-1)?.reason.startsWith('Adaptive')) notice = 'Valid directions are shown. Uniqueness was relaxed because the fixed rooms and site limit architectural variation.'
      dirs.push(option(r, i, 100 - selection.debug.at(-1)!.similarityPercent, source))
    }
  return { dirs, history, debug, notice }
}

export const useStudio = create<StudioState>()(
  persist(
    immer((set, get) => ({
      brief: defaultBrief(),
      briefChoiceIssue: null,
      selectedRoomId: null,
      selectRoom: (id) => set(s => { s.selectedRoomId = id }),
      directions: null,
      pinned: null,
      referencePreferences: null,
      recentExteriorSeeds: [],
      recentVillaFingerprints: [],
      diversityLimits: { ...DEFAULT_DIVERSITY_LIMITS },
      shapeDebug: [],
      generationNotice: null,
      result: null,
      existing: null,
      layout: null,
      basePlan: () => { const c = get(); return basePlanOf(c.brief, c.pinned, c.existing) },
      applyPlanOp: (run, opts) => runPlanOp(get, set, run, opts),
      setLayout: (layout) => runPlanOp(get, set, (_l, plan) => ({ ok: true, layout: layout ?? extractLayout(plan), notes: [], message: layout ? 'Plan restored.' : 'Back to the generated plan.', affected: [] }), { autoReplan: false, clear: layout === null }),
      loadExisting: (brief, structure, seed) => set((s) => {
        s.brief = brief; s.existing = { structure, seed }; s.pinned = null; s.directions = null; s.layout = null
        s.result = null; s.recentExteriorSeeds = []; s.generationNotice = null; s.shapeDebug = []; s.briefChoiceIssue = null
      }),
      clearExisting: () => set((s) => { if (s.existing) { s.existing = null; s.result = null; s.pinned = null; s.directions = null; s.layout = null } }),
      setDiversityLimits: (options) => {
        const limits = diversityLimits({ ...get().diversityLimits, ...options })
        set((s) => { s.diversityLimits = limits })
      },

      edit: (recipe) => {
        // Choices are never blocked: the Brief page shows how the brief fits and how to adjust it.
        const choice = { brief: applyBriefChoice(get().brief, recipe), reason: null as string | null }
        set((s) => {
          const geometryBefore = JSON.stringify(geometryBrief(s.brief))
          s.brief = choice.brief
          s.briefChoiceIssue = choice.reason
          // Finish/specification edits save in the brief without regenerating rooms or a villa.
          if (geometryBefore === JSON.stringify(geometryBrief(s.brief))) {
            if (s.result) s.result.cost = estimateBoq(s.result.design, s.brief)
            return
          }
          // Only geometry-relevant brief changes invalidate the generated plan.
          s.directions = null
          s.pinned = null
          s.layout = null
          s.recentExteriorSeeds = []
          s.result = null
          s.generationNotice = null
          s.shapeDebug = []
        })
      },

      reset: () =>
        set((s) => {
          s.existing = null
          s.layout = null
          s.brief = defaultBrief()
          s.briefChoiceIssue = null
          s.selectedRoomId = null
          s.directions = null
          s.pinned = null
          s.referencePreferences = null
          s.recentExteriorSeeds = []
          s.result = null
          s.generationNotice = null
          s.shapeDebug = []
        }),

      loadSaved: (brief, pinned, layout = null, existing = null) =>
        set((s) => {
          s.layout = layout
          s.existing = existing
          s.brief = briefSchema.parse(brief)
          s.briefChoiceIssue = null
          s.selectedRoomId = null
          s.pinned = pinned
          s.referencePreferences = parseInspirationPreferences(pinned?.inspiration)
          s.recentExteriorSeeds = pinned ? [pinned.seed] : []
          s.directions = null
          s.result = null
          s.generationNotice = null
          s.shapeDebug = []
        }),

      setReferencePreferences: (preferences) => set((s) => {
        s.referencePreferences = parseInspirationPreferences(preferences)
        s.directions = null
        s.pinned = null
        s.layout = null
        s.recentExteriorSeeds = []
        s.result = null
        s.generationNotice = null
        s.shapeDebug = []
      }),

      reroll: () => {
        const current = get()
        const brief = structuredClone(current.brief)
        brief.variation = newDesignSeed(brief.variation)
        const assembled = assemble(brief, null, current.referencePreferences, current.recentVillaFingerprints, current.diversityLimits)
        set((s) => {
          s.brief = brief
          s.layout = null
          s.pinned = assembled.result.shapeStatus === 'accepted'
            ? { massing: assembled.result.design.massingType, seed: assembled.result.design.dna.seed,
              planSeed:assembled.result.design.planSeed, planFamily:assembled.result.design.planFamily,
              recipe:assembled.result.design.planRecipe,
              planner:assembled.result.design.planProposal?'ml':'baseline', inspiration: current.referencePreferences } : null
          s.recentExteriorSeeds = []
          s.directions = null
          s.result = assembled.result
          s.recentVillaFingerprints = assembled.history
          s.shapeDebug = assembled.debug
          s.generationNotice = assembled.notice
        })
      },

      reseed: () => {
        const cur = get()
        const base = cur.result?.design ?? generate(compile(cur.brief))
        const selection = generateDistinct(base, newDesignSeed(cur.result?.design.dna.seed ?? cur.brief.variation),
          cur.referencePreferences, cur.recentVillaFingerprints, cur.diversityLimits,
          cur.result?.shapeFingerprint ? [fingerprintRecord(cur.result.shapeFingerprint)] : [])
        if (!selection.accepted) {
          set((s) => { s.shapeDebug = selection.debug; s.generationNotice = exhaustedNotice(selection.debug.length) })
          // Retain the displayed accepted villa after an exhausted retry search.
          return cur.result ?? { ...resultForPlan(base), shapeStatus: 'rejected' }
        }
        const result = selection.accepted.candidate
        // a new exterior on the same plan keeps that plan's own seed
        const pinned: PinnedDir = { massing: base.massingType, seed: result.design.dna.seed,
          planSeed:cur.pinned?.planSeed??base.planSeed,
          planner:cur.pinned?.planner??(base.planProposal?'ml':'baseline'),
          planFamily:cur.pinned?.planFamily??base.planFamily,
          recipe:cur.pinned?.recipe??base.planRecipe,
          inspiration: cur.referencePreferences }
        set((s) => {
          s.pinned = pinned
          s.recentExteriorSeeds = [...s.recentExteriorSeeds, pinned.seed].slice(-50)
          s.directions = null
          s.result = result
          s.recentVillaFingerprints = selection.history
          s.shapeDebug = selection.debug
          s.generationNotice = null
        })
        return result
      },

      explore: () => {
        const cur = get()
        if (cur.directions !== null) return cur.directions
        const { dirs, history, debug, notice } = computeDirections(cur)
        set((s) => {
          s.directions = dirs
          s.recentVillaFingerprints = history
          s.shapeDebug = debug
          s.generationNotice = notice
        })
        return dirs
      },

      exploreInBackground: async () => {
        const cur = get()
        if (cur.directions !== null) return
        const input: DirectionsInput = { brief: cur.brief, pinned: cur.pinned, referencePreferences: cur.referencePreferences,
          recentVillaFingerprints: cur.recentVillaFingerprints, diversityLimits: cur.diversityLimits }
        // the four houses are generated in a worker so the page stays responsive; without one, on the main thread
        const out = await import('./directionsWorkerClient.ts').then((m) => m.runDirections(input)).catch(() => computeDirections(input))
        const now = get()
        if (now.directions !== null || now.brief !== cur.brief || now.pinned !== cur.pinned) return
        set((s) => {
          s.directions = out.dirs
          s.recentVillaFingerprints = out.history
          s.shapeDebug = out.debug
          s.generationNotice = out.notice
        })
      },

      pin: (dir) => {
        const source=get().directions?.find(d=>d.massing===dir.massing&&d.seed===dir.seed&&d.planSeed===dir.planSeed)
        const pinned:PinnedDir = { ...dir, planFamily:dir.planFamily??source?.design.planFamily,
          recipe:dir.recipe??source?.design.planRecipe,
          planner:dir.planner??(source?.design.planProposal?'ml':'baseline'), inspiration: get().referencePreferences }
        const cur = get()
        const assembled = assemble(cur.brief, pinned, cur.referencePreferences, cur.recentVillaFingerprints, cur.diversityLimits, cur.existing, cur.layout)
        const result = assembled.result
        set((s) => {
          s.pinned = pinned
          s.layout = assembled.layout
          s.recentExteriorSeeds = [...s.recentExteriorSeeds, pinned.seed].slice(-50)
          s.result = result
          s.generationNotice = assembled.notice
          if (assembled.debug.length) s.shapeDebug = assembled.debug
        })
        return result
      },

      run: () => {
        const cur = get()
        if (cur.result) return cur.result
        const assembled = assemble(cur.brief, cur.pinned, cur.referencePreferences, cur.recentVillaFingerprints, cur.diversityLimits, cur.existing, cur.layout)
        set((s) => {
          s.layout = assembled.layout
          s.result = assembled.result
          s.recentVillaFingerprints = assembled.history
          s.shapeDebug = assembled.debug
          s.generationNotice = assembled.notice
          if (assembled.result.shapeStatus === 'accepted') s.pinned = { massing: assembled.result.design.massingType,
            seed: assembled.result.design.dna.seed,planSeed:assembled.result.design.planSeed,
            planFamily:assembled.result.design.planFamily,
            recipe:assembled.result.design.planRecipe,
            planner:assembled.result.design.planProposal?'ml':'baseline', inspiration: cur.referencePreferences }
        })
        return assembled.result
      },
    })),
    {
      name: 'brickpilot.studio',
      partialize: (s) => ({ brief: s.brief, pinned: s.pinned, existing: s.existing, layout: s.layout,
        referencePreferences: s.referencePreferences, recentExteriorSeeds: s.recentExteriorSeeds,
        recentVillaFingerprints: s.recentVillaFingerprints, diversityLimits: s.diversityLimits }),
      // re-parse the persisted brief through the schema on every rehydrate, so a
      // partial or stale payload is completed with defaults rather than
      // white-screening the app at compile(). Schema-repair, not versioning —
      // add `version` + `migrate` only for a real breaking change.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<{ brief: unknown; pinned: unknown; existing: unknown; layout: unknown;
          referencePreferences: unknown; recentExteriorSeeds: unknown; recentVillaFingerprints: unknown; diversityLimits: unknown }>
        const parsed = briefSchema.safeParse(p.brief)
        let limits = { ...DEFAULT_DIVERSITY_LIMITS }
        try { if (p.diversityLimits && typeof p.diversityLimits === 'object') limits = diversityLimits(p.diversityLimits as Partial<VillaDiversityLimits>) } catch { /* Repair stale configuration. */ }
        return {
          ...current,
          brief: parsed.success ? parsed.data : defaultBrief(),
          existing: parseExisting(p.existing),
          layout: parseLayout(p.layout),
          pinned: parsePinned(p.pinned),
          referencePreferences: parseInspirationPreferences(p.referencePreferences) ??
            parseInspirationPreferences(parsePinned(p.pinned)?.inspiration),
          recentExteriorSeeds: Array.isArray(p.recentExteriorSeeds)
            ? p.recentExteriorSeeds.filter((x): x is number => Number.isSafeInteger(x)).slice(-50) : [],
          recentVillaFingerprints: parseFingerprintHistory(p.recentVillaFingerprints, limits.recentLimit),
          diversityLimits: limits,
        }
      },
    },
  ),
)
