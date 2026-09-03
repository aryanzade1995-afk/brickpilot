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
}

export type DirectionOption = {
  massing: MassingType
  seed: number
  label: string
  blurb: string
  design: Design
  report: ValidationReport
}

/** parse a `"massing:seed"` string (the Supabase `pinned` column) */
export function parsePinned(v: unknown): PinnedDir | null {
  if (v && typeof v === 'object' && 'massing' in v && 'seed' in v) {
    const o = v as Record<string, unknown>
    if (typeof o.massing === 'string' && MASSING_TYPES.includes(o.massing as MassingType) && typeof o.seed === 'number')
      return { massing: o.massing as MassingType, seed: o.seed }
    return null
  }
  if (typeof v !== 'string') return null
  const [m, s] = v.split(':')
  const seed = Number(s)
  if (!MASSING_TYPES.includes(m as MassingType) || !Number.isFinite(seed)) return null
  return { massing: m as MassingType, seed }
}

export const serializePinned = (p: PinnedDir | null): string | null =>
  p ? `${p.massing}:${p.seed}` : null

type StudioState = {
  brief: Brief
  directions: DirectionOption[] | null
  pinned: PinnedDir | null
  result: Result | null
  edit: (recipe: (b: Brief) => void) => void
  reset: () => void
  /** replace the working brief + pinned direction (loading a saved design) */
  loadSaved: (brief: Brief, pinned: PinnedDir | null) => void
  reroll: () => void
  /** re-roll the geometry of the pinned massing (or the brief seed) and rebuild */
  reseed: () => Result
  explore: () => DirectionOption[]
  pin: (dir: PinnedDir) => Result
  run: () => Result
}

function assemble(brief: Brief, pinned: PinnedDir | null): Result {
  const model = compile(brief)
  const design = generate(
    model,
    pinned ? { massing: pinned.massing, seed: pinned.seed } : {},
  )
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
      result: null,

      edit: (recipe) =>
        set((s) => {
          recipe(s.brief)
          // any brief change invalidates generated geometry
          s.directions = null
          s.result = null
        }),

      reset: () =>
        set((s) => {
          s.brief = defaultBrief()
          s.directions = null
          s.pinned = null
          s.result = null
        }),

      loadSaved: (brief, pinned) =>
        set((s) => {
          s.brief = brief
          s.pinned = pinned
          s.directions = null
          s.result = null
        }),

      reroll: () =>
        set((s) => {
          s.brief.variation += 1
          s.directions = null
        }),

      reseed: () => {
        const next = Math.floor(Math.random() * 100000)
        const cur = get()
        const pinned: PinnedDir | null = cur.pinned
          ? { massing: cur.pinned.massing, seed: next }
          : null
        const brief: Brief = pinned ? cur.brief : { ...cur.brief, variation: next }
        const result = assemble(brief, pinned)
        set((s) => {
          if (pinned) s.pinned = pinned
          else s.brief.variation = next
          s.directions = null
          s.result = result
        })
        return result
      },

      explore: () => {
        const model = compile(get().brief)
        const dirs: DirectionOption[] = generateDirections(model).map((d) => ({
          massing: d.massing,
          seed: d.seed,
          label: d.label,
          blurb: d.blurb,
          design: d.design,
          report: validate(d.design),
        }))
        set((s) => {
          s.directions = dirs
        })
        return dirs
      },

      pin: (dir) => {
        const result = assemble(get().brief, dir)
        set((s) => {
          s.pinned = dir
          s.result = result
        })
        return result
      },

      run: () => {
        const result = assemble(get().brief, get().pinned)
        set((s) => {
          s.result = result
        })
        return result
      },
    })),
    {
      name: 'brickpilot.studio',
      partialize: (s) => ({ brief: s.brief, pinned: s.pinned }),
      // re-parse the persisted brief through the schema on every rehydrate, so a
      // partial or stale payload is completed with defaults rather than
      // white-screening the app at compile(). Schema-repair, not versioning —
      // add `version` + `migrate` only for a real breaking change.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<{ brief: unknown; pinned: unknown }>
        const parsed = briefSchema.safeParse(p.brief)
        return {
          ...current,
          brief: parsed.success ? parsed.data : defaultBrief(),
          pinned: parsePinned(p.pinned),
        }
      },
    },
  ),
)
