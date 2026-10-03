import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { parseSelection, type CostSelection } from '../lib/cost/specifications.ts'

type State = { entries: Record<string, CostSelection>; setSelection: (key: string, selection: unknown) => void }
/** Separate from Studio: these choices have no path into the brief or planner. */
export const useFinishes = create<State>()(persist((set, get) => ({
  entries: {},
  setSelection: (key, selection) => set({ entries: { ...get().entries, [key]: parseSelection(selection) } }),
}), { name: 'formstead.finishes-v1', partialize: s => ({ entries: s.entries }),
  merge: (saved, current) => ({ ...current, entries: Object.fromEntries(Object.entries(
    (saved as Partial<State> | undefined)?.entries ?? {}).map(([key, value]) => [key, parseSelection(value)])) }),
}))
