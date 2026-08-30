import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { compile, type CanonicalModel } from '@/lib/model/canonical.ts'
import { defaultBrief, type Brief } from '@/lib/model/brief.ts'
import { generate, type Design } from '@/lib/engine/index.ts'
import { validate, type ValidationReport } from '@/lib/rules/index.ts'
import { estimateCost, type CostEstimate } from '@/lib/cost/index.ts'

export type Result = {
  model: CanonicalModel
  design: Design
  report: ValidationReport
  cost: CostEstimate
  generatedAt: number
}

type StudioState = {
  brief: Brief
  result: Result | null
  edit: (recipe: (b: Brief) => void) => void
  reset: () => void
  reroll: () => void
  run: () => Result
}

export const useStudio = create<StudioState>()(
  persist(
    immer((set, get) => ({
      brief: defaultBrief(),
      result: null,

      edit: (recipe) =>
        set((s) => {
          recipe(s.brief)
        }),

      reset: () =>
        set((s) => {
          s.brief = defaultBrief()
          s.result = null
        }),

      reroll: () =>
        set((s) => {
          s.brief.variation += 1
        }),

      run: () => {
        const model = compile(get().brief)
        const design = generate(model)
        const report = validate(design)
        const cost = estimateCost(design)
        const result: Result = { model, design, report, cost, generatedAt: Date.now() }
        set((s) => {
          s.result = result
        })
        return result
      },
    })),
    {
      name: 'brickpilot.studio',
      partialize: (s) => ({ brief: s.brief }),
    },
  ),
)
