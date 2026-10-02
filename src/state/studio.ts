import { newDesignSeed } from '@/lib/newDesignSeed.ts'
import { selectAdaptiveVilla } from '@/lib/engine/fingerprint/AdaptiveVillaSearch.ts'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { compile, type CanonicalModel } from '@/lib/model/canonical.ts'
import { briefSchema, defaultBrief, type Brief } from '@/lib/model/brief.ts'
import {
  generate,
  MASSING_TYPES,
  type Design,
  type MassingType,
} from '@/lib/engine/index.ts'
import { validate, type ValidationReport } from '@/lib/rules/index.ts'
import { estimateCost, type CostEstimate } from '@/lib/cost/index.ts'
import { varyExterior } from '@/lib/engine/variation.ts'
import { parseInspirationPreferences, type InspirationPreferences } from '@/lib/engine/designDna.ts'
import type { BuildingModel } from '@/lib/engine/buildingModel.ts'
import type { VillaDesignDNA } from '@/lib/engine/villaDesignDna.ts'
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
  massing: MassingType
  seed: number
  inspiration?: InspirationPreferences | null
}

export type DirectionOption = {
  massing: MassingType
  seed: number
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
      return { massing: o.massing as MassingType, seed: o.seed,
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
  p ? p.inspiration ? JSON.stringify(p) : `${p.massing}:${p.seed}` : null

type StudioState = {
  brief: Brief
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
    cost: estimateCost(design), generatedAt: Date.now() }
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

function assemble(brief: Brief, pinned: PinnedDir | null, inspiration: InspirationPreferences | null,
  history: ShapeFingerprintRecord[], limits: VillaDiversityLimits) {
  const plan = generate(compile(brief))
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
      directions: null,
      pinned: null,
      referencePreferences: null,
      recentExteriorSeeds: [],
      recentVillaFingerprints: [],
      diversityLimits: { ...DEFAULT_DIVERSITY_LIMITS },
      shapeDebug: [],
      generationNotice: null,
      result: null,
      setDiversityLimits: (options) => {
        const limits = diversityLimits({ ...get().diversityLimits, ...options })
        set((s) => { s.diversityLimits = limits })
      },

      edit: (recipe) =>
        set((s) => {
          recipe(s.brief)
          // any brief change invalidates generated geometry
          s.directions = null
          s.pinned = null
          s.recentExteriorSeeds = []
          s.result = null
          s.generationNotice = null
          s.shapeDebug = []
        }),

      reset: () =>
        set((s) => {
          s.brief = defaultBrief()
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
            ? { massing: assembled.result.design.massingType, seed: assembled.result.design.dna.seed, inspiration: current.referencePreferences } : null
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
        const pinned: PinnedDir = { massing: base.massingType, seed: result.design.dna.seed,
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
        const plan = generate(compile(cur.brief)), dirs: DirectionOption[] = [], debug: FingerprintDebug[] = []
        let history = cur.recentVillaFingerprints, notice: string | null = null
        const option = (r: Result, index: number, novelty: number): DirectionOption => ({
          massing: r.design.massingType, seed: r.design.dna.seed,
          label: `Direction ${'ABCD'[index]} — ${r.shapeFingerprint!.massingFamily.replaceAll('_', ' ').toLowerCase()}`,
          blurb: `${r.shapeFingerprint!.heroFeature.replaceAll('_', ' ').toLowerCase()} · ${r.shapeFingerprint!.rooflineType.replaceAll('_', ' ').toLowerCase()}`,
          novelty, design: r.design, report: r.report, buildingModel: r.buildingModel!, villaDesignDNA: r.villaDesignDNA!,
          massingModel: r.massingModel!, facadeModel: r.facadeModel!, shapeFingerprint: r.shapeFingerprint! })
        if (validate(plan).hardChecksPass && cur.pinned) {
          const replay = replayResult(plan, cur.pinned.seed, cur.referencePreferences)
          if (replay.result.shapeFingerprint) dirs.push(option(replay.result, 0, 0))
          else debug.push(...replay.debug)
        }
        if (validate(plan).hardChecksPass) for (let i = dirs.length; i < 4; i++) {
          const selection = generateDistinct(plan, cur.brief.variation + 1 + i * 977, cur.referencePreferences, history, cur.diversityLimits,
            dirs.map((d) => fingerprintRecord(d.shapeFingerprint)))
          debug.push(...selection.debug)
          if (!selection.accepted) { notice = exhaustedNotice(selection.debug.length); break }
          const r = selection.accepted.candidate
          history = selection.history
          if (selection.debug.at(-1)?.reason.startsWith('Adaptive')) notice = 'Valid directions are shown. Uniqueness was relaxed because the fixed rooms and site limit architectural variation.'
          dirs.push(option(r, i, 100 - selection.debug.at(-1)!.similarityPercent))
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
        const pinned = { ...dir, inspiration: get().referencePreferences }
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
        const assembled = assemble(cur.brief, cur.pinned, cur.referencePreferences, cur.recentVillaFingerprints, cur.diversityLimits)
        set((s) => {
          s.result = assembled.result
          s.recentVillaFingerprints = assembled.history
          s.shapeDebug = assembled.debug
          s.generationNotice = assembled.notice
          if (assembled.result.shapeStatus === 'accepted') s.pinned = { massing: assembled.result.design.massingType,
            seed: assembled.result.design.dna.seed, inspiration: cur.referencePreferences }
        })
        return assembled.result
      },
    })),
    {
      name: 'brickpilot.studio',
      partialize: (s) => ({ brief: s.brief, pinned: s.pinned,
        referencePreferences: s.referencePreferences, recentExteriorSeeds: s.recentExteriorSeeds,
        recentVillaFingerprints: s.recentVillaFingerprints, diversityLimits: s.diversityLimits }),
      // re-parse the persisted brief through the schema on every rehydrate, so a
      // partial or stale payload is completed with defaults rather than
      // white-screening the app at compile(). Schema-repair, not versioning —
      // add `version` + `migrate` only for a real breaking change.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<{ brief: unknown; pinned: unknown;
          referencePreferences: unknown; recentExteriorSeeds: unknown; recentVillaFingerprints: unknown; diversityLimits: unknown }>
        const parsed = briefSchema.safeParse(p.brief)
        let limits = { ...DEFAULT_DIVERSITY_LIMITS }
        try { if (p.diversityLimits && typeof p.diversityLimits === 'object') limits = diversityLimits(p.diversityLimits as Partial<VillaDiversityLimits>) } catch { /* Repair stale configuration. */ }
        return {
          ...current,
          brief: parsed.success ? parsed.data : defaultBrief(),
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
