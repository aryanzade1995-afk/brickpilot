import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { parseImpact, type ImpactDocument } from '../lib/impact/schema.ts'

/** Project snapshots own persistence and restore. This companion document never
 * participates in Brief, seed, architectural caches or finish/cost quantities. */
type State = {
  document: ImpactDocument | null
  error: string | null
  update: (value: unknown) => boolean
  restore: (value: unknown) => void
  clear: () => void
}

let storageError: string | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null

const PRIMARY_KEY = 'brickpilot.social-impact.v1'
const LEGACY_KEY = 'formstead.social-impact.v1'

const storage = createJSONStorage<{ document: ImpactDocument | null }>(() => ({
  getItem: key => {
    try {
      if (!globalThis.localStorage) return null
      // Check legacy first for existing tests & backward migration, then primary
      const legacy = globalThis.localStorage.getItem(LEGACY_KEY)
      if (legacy) return legacy
      return globalThis.localStorage.getItem(PRIMARY_KEY) ?? globalThis.localStorage.getItem(key) ?? null
    } catch {
      return null
    }
  },
  setItem: (_key, value) => {
    try {
      if (!globalThis.localStorage) throw new Error('Unavailable')
      // Immediate test write so storage exceptions (e.g. quota/blocked) surface synchronously
      globalThis.localStorage.setItem('__bp_test__', '1')
      globalThis.localStorage.removeItem('__bp_test__')
      storageError = null

      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        try {
          globalThis.localStorage?.setItem(PRIMARY_KEY, value)
          globalThis.localStorage?.setItem(LEGACY_KEY, value)
        } catch {
          storageError = 'Device storage is unavailable. Impact inputs remain in memory; download a copy.'
        }
      }, 300)
    } catch {
      storageError = 'Device storage is unavailable. Impact inputs remain in memory; download a copy.'
    }
  },
  removeItem: _key => {
    if (debounceTimer) clearTimeout(debounceTimer)
    try {
      globalThis.localStorage?.removeItem(PRIMARY_KEY)
      globalThis.localStorage?.removeItem(LEGACY_KEY)
    } catch {
      /* Retain in-memory state. */
    }
  },
}))

export const useSocialImpact = create<State>()(
  persist(
    set => ({
      document: null,
      error: null,
      update: value => {
        const document = parseImpact(value)
        if (!document) {
          set({ error: 'Check the entered values before saving.' })
          return false
        }
        set({ document, error: null })
        if (storageError) {
          set({ error: storageError })
          return false
        }
        return true
      },
      restore: value =>
        set({
          document: parseImpact(value),
          error:
            value != null && !parseImpact(value)
              ? 'Saved impact inputs could not be restored. The house is unchanged.'
              : null,
        }),
      clear: () => set({ document: null, error: null }),
    }),
    {
      name: PRIMARY_KEY,
      storage,
      partialize: s => ({ document: s.document }),
      merge: (saved, current) => ({
        ...current,
        document: parseImpact((saved as { document?: unknown })?.document),
      }),
    },
  ),
)
