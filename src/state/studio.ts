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
  loadSaved: (brief: Brief, pinned: PinnedDir | null) => void
  /** Existing Structure Mode: plan around a structure that is already built (null = the normal brief flow) */
  existing: { structure: ExistingStructure; seed: number } | null
  loadExisting: (brief: Brief, structure: ExistingStructure, seed: number) => void
  clearExisting: () => void
  setReferencePreferences: (preferences: InspirationPreferences | null) => void
  reroll: () => void
  /** re-roll the geometry of the pinned massing (or the brief seed) and rebuild */
  reseed: () => Result
  explore: () => DirectionOption[]
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
  history: ShapeFingerprintRecord[], limits: VillaDiversityLimits, existing: { structure: ExistingStructure; seed: number } | null = null) {
  const model = compile(brief)
  // Existing Structure Mode plans around what is built; otherwise the normal planner runs
  const fromStructure = existing ? generateExisting(model, existing.structure, existing.seed).design : null
  const plan = fromStructure ?? (pinned ? pinnedPlan(model, pinned) : generate(model))
  if (!validate(plan).hardChecksPass) return { result: resultForPlan(plan), history, debug: [], notice: null }
  if (pinned) {
    // Loading/pinning/navigation is an exact replay, not another new candidate.
    return { ...replayResult(plan, pinned.seed, inspiration), history }
  }
  const selected = generateDistinct(plan, brief.variation + 1, inspiration, history, limits)
  return { result: selected.accepted?.candidate ?? { ...resultForPlan(plan), shapeStatus: 'rejected' as const },
    history: selected.history, debug: selected.debug,
    notice: selected.accepted ? (selected.debug.at(-1)?.reason.startsWith('Adaptive') ? selected.debug.at(-1)!.reason : null) : exhaustedNotice(selected.debug.length) }
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
      loadExisting: (brief, structure, seed) => set((s) => {
        s.brief = brief; s.existing = { structure, seed }; s.pinned = null; s.directions = null
        s.result = null; s.recentExteriorSeeds = []; s.generationNotice = null; s.shapeDebug = []; s.briefChoiceIssue = null
      }),
      clearExisting: () => set((s) => { if (s.existing) { s.existing = null; s.result = null; s.pinned = null; s.directions = null } }),
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
          s.recentExteriorSeeds = []
          s.result = null
          s.generationNotice = null
          s.shapeDebug = []
        })
      },

      reset: () =>
        set((s) => {
          s.existing = null
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

      loadSaved: (brief, pinned) =>
        set((s) => {
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
        set((s) => {
          s.directions = dirs
          s.recentVillaFingerprints = history
          s.shapeDebug = debug
          s.generationNotice = notice
        })
        return dirs
      },

      pin: (dir) => {
        const source=get().directions?.find(d=>d.massing===dir.massing&&d.seed===dir.seed&&d.planSeed===dir.planSeed)
        const pinned:PinnedDir = { ...dir, planFamily:dir.planFamily??source?.design.planFamily,
          recipe:dir.recipe??source?.design.planRecipe,
          planner:dir.planner??(source?.design.planProposal?'ml':'baseline'), inspiration: get().referencePreferences }
        const cur = get()
        const assembled = assemble(cur.brief, pinned, cur.referencePreferences, cur.recentVillaFingerprints, cur.diversityLimits)
        const result = assembled.result
        set((s) => {
          s.pinned = pinned
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
        const assembled = assemble(cur.brief, cur.pinned, cur.referencePreferences, cur.recentVillaFingerprints, cur.diversityLimits, cur.existing)
        set((s) => {
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
      partialize: (s) => ({ brief: s.brief, pinned: s.pinned, existing: s.existing,
        referencePreferences: s.referencePreferences, recentExteriorSeeds: s.recentExteriorSeeds,
        recentVillaFingerprints: s.recentVillaFingerprints, diversityLimits: s.diversityLimits }),
      // re-parse the persisted brief through the schema on every rehydrate, so a
      // partial or stale payload is completed with defaults rather than
      // white-screening the app at compile(). Schema-repair, not versioning —
      // add `version` + `migrate` only for a real breaking change.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<{ brief: unknown; pinned: unknown; existing: unknown;
          referencePreferences: unknown; recentExteriorSeeds: unknown; recentVillaFingerprints: unknown; diversityLimits: unknown }>
        const parsed = briefSchema.safeParse(p.brief)
        let limits = { ...DEFAULT_DIVERSITY_LIMITS }
        try { if (p.diversityLimits && typeof p.diversityLimits === 'object') limits = diversityLimits(p.diversityLimits as Partial<VillaDiversityLimits>) } catch { /* Repair stale configuration. */ }
        return {
          ...current,
          brief: parsed.success ? parsed.data : defaultBrief(),
          existing: parseExisting(p.existing),
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
