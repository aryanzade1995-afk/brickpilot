import { create } from 'zustand'
import type { LayoutDoc } from '@/lib/plan/layout.ts'
import type { Notice, OpResult } from '@/lib/plan/ops.ts'
import type { Design } from '@/lib/engine/types.ts'
import { useStudio } from '@/state/studio.ts'
import { noteChange } from '@/state/projects.ts'

/* Undo / redo and the last outcome for the plan editor. The edits themselves live in the studio store. */

export type Feedback = { kind: 'ok' | 'error'; text: string; notes: Notice[] } | null

type PlanEditState = {
  past: (LayoutDoc | null)[]
  future: (LayoutDoc | null)[]
  /** after an edit, bring only the rooms beside the space it freed back into use */
  autoReplan: boolean
  feedback: Feedback
  setAutoReplan: (on: boolean) => void
  run: (run: (layout: LayoutDoc, plan: Design) => OpResult) => boolean
  /** a resize in `steps` steps of 0.1 m: when the whole change breaks a rule, the largest part of it that keeps the plan valid is applied */
  fit: (make: (step: number) => (layout: LayoutDoc, plan: Design) => OpResult, steps: number) => boolean
  undo: () => void
  redo: () => void
  resetToGenerated: () => void
  clearFeedback: () => void
  forget: () => void
}

export const usePlanEdit = create<PlanEditState>((set, get) => ({
  past: [],
  future: [],
  autoReplan: true,
  feedback: null,
  setAutoReplan: (on) => set({ autoReplan: on }),
  clearFeedback: () => set({ feedback: null }),
  forget: () => set({ past: [], future: [], feedback: null }),

  run: (run) => {
    const out = useStudio.getState().applyPlanOp(run, { autoReplan: get().autoReplan })
    if (!out.ok) { set({ feedback: { kind: 'error', text: out.reason, notes: [] } }); return false }
    noteChange(out.message)
    set((s) => ({ past: [...s.past, out.before].slice(-50), future: [], feedback: { kind: 'ok', text: out.message, notes: out.notes } }))
    return true
  },

  fit: (make, steps) => {
    const n = Math.max(1, Math.round(steps))
    const full = useStudio.getState().applyPlanOp(make(n), { autoReplan: get().autoReplan, dry: true })
    if (full.ok || n === 1) return get().run(make(n))
    // the largest step that still holds, tried from the top down (each try rebuilds the plan and the 3D villa;
    // a step the edit itself refuses costs nothing)
    let lo = 0
    for (let k = n - 1, tries = 0; k >= 1 && tries < 30; k--, tries++) {
      if (useStudio.getState().applyPlanOp(make(k), { autoReplan: get().autoReplan, dry: true }).ok) { lo = k; break }
    }
    if (!lo) { set({ feedback: { kind: 'error', text: full.reason, notes: [] } }); return false }
    const done = get().run(make(lo))
    if (done) set((s) => ({ feedback: s.feedback && { ...s.feedback, text: `${s.feedback.text} That is as far as the plan stays valid (${(lo / 10).toFixed(1)} of ${(n / 10).toFixed(1)} m): ${full.reason}` } }))
    return done
  },

  undo: () => {
    const { past } = get()
    if (!past.length) return
    const current = useStudio.getState().layout
    const prev = past[past.length - 1]
    const out = useStudio.getState().setLayout(prev)
    if (!out.ok) { set({ feedback: { kind: 'error', text: out.reason, notes: [] } }); return }
    noteChange('Undid a plan edit')
    set((s) => ({ past: s.past.slice(0, -1), future: [current, ...s.future], feedback: { kind: 'ok', text: 'Undone.', notes: [] } }))
  },

  redo: () => {
    const { future } = get()
    if (!future.length) return
    const current = useStudio.getState().layout
    const next = future[0]
    const out = useStudio.getState().setLayout(next)
    if (!out.ok) { set({ feedback: { kind: 'error', text: out.reason, notes: [] } }); return }
    noteChange('Redid a plan edit')
    set((s) => ({ past: [...s.past, current], future: s.future.slice(1), feedback: { kind: 'ok', text: 'Redone.', notes: [] } }))
  },

  resetToGenerated: () => {
    const current = useStudio.getState().layout
    if (!current) return
    const out = useStudio.getState().setLayout(null)
    if (!out.ok) { set({ feedback: { kind: 'error', text: out.reason, notes: [] } }); return }
    noteChange('Reset to the generated plan')
    set((s) => ({ past: [...s.past, current].slice(-50), future: [], feedback: { kind: 'ok', text: 'Back to the plan as it was generated.', notes: [] } }))
  },
}))
