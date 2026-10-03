import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { parseSelection, type CostSelection } from '../lib/cost/specifications.ts'

type State = { entries: Record<string, CostSelection>; setSelection: (key: string, selection: unknown) => void
  lastMeasured: string | null; quantitiesUpdated: boolean; noteQuantities: (signature: string) => void }
/** Legacy controls and numerical allowances only. Specifications persist in the Brief. */
export const useFinishes = create<State>()(persist((set, get) => ({
  entries: {},
  lastMeasured: null, quantitiesUpdated: false,
  noteQuantities: signature => {
    const before = get().lastMeasured
    if (signature !== before) set({ lastMeasured: signature, quantitiesUpdated: before !== null })
  },
  setSelection: (key, selection) => set({ entries: { ...get().entries, [key]: parseSelection(selection) } }),
}), { name: 'formstead.finishes-v1', partialize: s => ({ entries: s.entries, lastMeasured: s.lastMeasured, quantitiesUpdated: s.quantitiesUpdated }),
  merge: (saved, current) => ({ ...current, lastMeasured: typeof (saved as Partial<State>)?.lastMeasured === 'string' ? (saved as State).lastMeasured : null,
    quantitiesUpdated: (saved as Partial<State>)?.quantitiesUpdated === true, entries: Object.fromEntries(Object.entries(
    (saved as Partial<State> | undefined)?.entries ?? {}).map(([key, value]) => [key, parseSelection(value)])) }),
}))
