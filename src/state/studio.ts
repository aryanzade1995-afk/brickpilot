import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { compile, type CanonicalModel } from '@/lib/model/canonical.ts'
import { briefSchema, defaultBrief, type Brief } from '@/lib/model/brief.ts'
import {
  generate,
  generateDirections,
  MASSING_TYPES,
  type Design,
  type MassingType,
} from '@/lib/engine/index.ts'
import { validate, type ValidationReport } from '@/lib/rules/index.ts'
import { estimateCost, type CostEstimate } from '@/lib/cost/index.ts'
import { chooseNextExterior, selectExteriorDirections, varyExterior } from '@/lib/engine/variation.ts'
import { parseInspirationPreferences, type InspirationPreferences } from '@/lib/engine/designDna.ts'

export type Result = {
  model: CanonicalModel
  design: Design
  report: ValidationReport
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

function assemble(brief: Brief, pinned: PinnedDir | null, inspiration: InspirationPreferences | null): Result {
  const model = compile(brief)
  const plan = generate(model)
  const level = brief.style.diversity === 'low' ? 'subtle' :
    brief.style.diversity === 'high' || brief.style.diversity === 'extreme' ? 'bold' : 'balanced'
  const design = pinned ? varyExterior(plan, pinned.seed, level, inspiration) :
    selectExteriorDirections(plan, 1, level, inspiration)[0]?.design ?? plan
  return {
    model,
    design,
    report: validate(design),
    cost: estimateCost(design),
    generatedAt: Date.now(),
  }
}

export const useStudio = create<StudioState>()(
  persist(
    immer((set, get) => ({
      brief: defaultBrief(),
      directions: null,
      pinned: null,
      referencePreferences: null,
      recentExteriorSeeds: [],
      result: null,

      edit: (recipe) =>
        set((s) => {
          recipe(s.brief)
          // any brief change invalidates generated geometry
          s.directions = null
          s.pinned = null
          s.recentExteriorSeeds = []
          s.result = null
        }),

      reset: () =>
        set((s) => {
          s.brief = defaultBrief()
          s.directions = null
          s.pinned = null
          s.referencePreferences = null
          s.recentExteriorSeeds = []
          s.result = null
        }),

      loadSaved: (brief, pinned) =>
        set((s) => {
          s.brief = brief
          s.pinned = pinned
          s.referencePreferences = parseInspirationPreferences(pinned?.inspiration)
          s.recentExteriorSeeds = pinned ? [pinned.seed] : []
          s.directions = null
          s.result = null
        }),

      setReferencePreferences: (preferences) => set((s) => {
        s.referencePreferences = parseInspirationPreferences(preferences)
        s.directions = null
        s.pinned = null
        s.recentExteriorSeeds = []
        s.result = null
      }),

      reroll: () => {
        const current = get()
        const brief = structuredClone(current.brief)
        brief.variation += 1
        const result = assemble(brief, null, current.referencePreferences)
        set((s) => {
          s.brief = brief
          s.pinned = null
          s.recentExteriorSeeds = []
          s.directions = null
          s.result = result
        })
      },

      reseed: () => {
        const cur = get()
        const base = cur.result?.design ?? generate(compile(cur.brief))
        const level = cur.brief.style.diversity === 'low' ? 'subtle' :
          cur.brief.style.diversity === 'high' || cur.brief.style.diversity === 'extreme' ? 'bold' : 'balanced'
        const next = chooseNextExterior(base, cur.recentExteriorSeeds, level, cur.referencePreferences)
        const pinned: PinnedDir = { massing: base.massingType, seed: next.dna.seed,
          inspiration: cur.referencePreferences }
        const brief: Brief = cur.brief
        const result = assemble(brief, pinned, cur.referencePreferences)
        set((s) => {
          s.pinned = pinned
          s.recentExteriorSeeds = [...s.recentExteriorSeeds, pinned.seed].slice(-50)
          s.directions = null
          s.result = result
        })
        return result
      },

      explore: () => {
        const model = compile(get().brief)
        const dirs: DirectionOption[] = generateDirections(model, get().referencePreferences).map((d) => ({
          massing: d.massing,
          seed: d.seed,
          label: d.label,
          blurb: d.blurb,
          novelty: d.novelty,
          design: d.design,
          report: validate(d.design),
        }))
        set((s) => {
          s.directions = dirs
        })
        return dirs
      },

      pin: (dir) => {
        const pinned = { ...dir, inspiration: get().referencePreferences }
        const result = assemble(get().brief, pinned, get().referencePreferences)
        set((s) => {
          s.pinned = pinned
          s.recentExteriorSeeds = [...s.recentExteriorSeeds, pinned.seed].slice(-50)
          s.result = result
        })
        return result
      },

      run: () => {
        const result = assemble(get().brief, get().pinned, get().referencePreferences)
        set((s) => {
          s.result = result
        })
        return result
      },
    })),
    {
      name: 'brickpilot.studio',
      partialize: (s) => ({ brief: s.brief, pinned: s.pinned,
        referencePreferences: s.referencePreferences, recentExteriorSeeds: s.recentExteriorSeeds }),
      // re-parse the persisted brief through the schema on every rehydrate, so a
      // partial or stale payload is completed with defaults rather than
      // white-screening the app at compile(). Schema-repair, not versioning —
      // add `version` + `migrate` only for a real breaking change.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<{ brief: unknown; pinned: unknown;
          referencePreferences: unknown; recentExteriorSeeds: unknown }>
        const parsed = briefSchema.safeParse(p.brief)
        return {
          ...current,
          brief: parsed.success ? parsed.data : defaultBrief(),
          pinned: parsePinned(p.pinned),
          referencePreferences: parseInspirationPreferences(p.referencePreferences) ??
            parseInspirationPreferences(parsePinned(p.pinned)?.inspiration),
          recentExteriorSeeds: Array.isArray(p.recentExteriorSeeds)
            ? p.recentExteriorSeeds.filter((x): x is number => Number.isSafeInteger(x)).slice(-50) : [],
        }
      },
    },
  ),
)
