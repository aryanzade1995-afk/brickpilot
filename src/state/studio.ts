import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { compile, type CanonicalModel } from '@/lib/model/canonical.ts'
import { briefSchema, defaultBrief, type Brief } from '@/lib/model/brief.ts'
import { generate, generateDirections, type Design, type Strategy } from '@/lib/engine/index.ts'
import { validate, type ValidationReport } from '@/lib/rules/index.ts'
import { estimateCost, type CostEstimate } from '@/lib/cost/index.ts'

export type Result = {
  model: CanonicalModel
  design: Design
  report: ValidationReport
  cost: CostEstimate
  generatedAt: number
}

export type DirectionOption = {
  strategy: Strategy
  label: string
  blurb: string
  design: Design
  report: ValidationReport
}

type StudioState = {
  brief: Brief
  directions: DirectionOption[] | null
  pinned: Strategy | null
  result: Result | null
  edit: (recipe: (b: Brief) => void) => void
  reset: () => void
  reroll: () => void
  explore: () => DirectionOption[]
  pin: (strategy: Strategy) => Result
  run: () => Result
}

function assemble(brief: Brief, strategy: Strategy): Result {
  const model = compile(brief)
  const design = generate(model, strategy)
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

      reroll: () =>
        set((s) => {
          s.brief.variation += 1
          s.directions = null
        }),

      explore: () => {
        const model = compile(get().brief)
        const dirs: DirectionOption[] = generateDirections(model).map((d) => ({
          strategy: d.strategy,
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

      pin: (strategy) => {
        const result = assemble(get().brief, strategy)
        set((s) => {
          s.pinned = strategy
          s.result = result
        })
        return result
      },

      run: () => {
        const result = assemble(get().brief, get().pinned ?? 'orthogonal-core')
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
        const p = (persisted ?? {}) as Partial<{ brief: unknown; pinned: Strategy | null }>
        const parsed = briefSchema.safeParse(p.brief)
        return {
          ...current,
          brief: parsed.success ? parsed.data : defaultBrief(),
          pinned: p.pinned ?? null,
        }
      },
    },
  ),
)
