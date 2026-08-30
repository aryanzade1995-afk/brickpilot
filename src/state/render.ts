import { create } from 'zustand'

/* ------------------------------------------------------------------ *
 *  Step-4 render state. Ephemeral by construction — references and
 *  concept images are large PNGs and never touch persistence; the API
 *  key lives only in the proxy process.
 * ------------------------------------------------------------------ */

export type RefKey = 'front' | 'collage' | 'top' | 'interior'
export const REF_KEYS: RefKey[] = ['front', 'collage', 'top', 'interior']
export const REF_LABEL: Record<RefKey, string> = {
  front: 'Front',
  collage: 'Collage',
  top: 'Top',
  interior: 'Interior',
}

export type Phase = 'idle' | 'capturing' | 'ready' | 'rendering' | 'gallery'
export type Job = { status: 'pending' | 'running' | 'done' | 'error'; url?: string; error?: string }
export type Health = { configured: boolean; mock: boolean; reachable: boolean }

const freshJobs = (): Record<RefKey, Job> =>
  Object.fromEntries(REF_KEYS.map((k) => [k, { status: 'pending' as const }])) as Record<RefKey, Job>

type RenderState = {
  phase: Phase
  interiorRoomKey: string | null
  refs: Partial<Record<RefKey, string>>
  stale: boolean
  jobs: Record<RefKey, Job>
  health: Health | null
  error: string | null

  probeHealth: () => Promise<void>
  setInteriorRoom: (key: string) => void
  beginCapture: () => void
  setRef: (k: RefKey, dataUrl: string) => void
  captureFailed: (msg: string) => void
  runJobs: (promptFor: (k: RefKey) => string) => Promise<void>
  retry: (k: RefKey, promptFor: (k: RefKey) => string) => Promise<void>
  reset: () => void
}

async function callRender(imageBase64: string, prompt: string): Promise<string> {
  const res = await fetch('/api/render', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ imageBase64, mimeType: 'image/png', prompt }),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok && res.status !== 503) throw new Error(j?.error || `render failed (${res.status})`)
  if (!j?.imageBase64) throw new Error(j?.error || 'no image returned')
  return `data:${j.mimeType || 'image/png'};base64,${j.imageBase64}`
}

export const useRender = create<RenderState>((set, get) => ({
  phase: 'idle',
  interiorRoomKey: null,
  refs: {},
  stale: false,
  jobs: freshJobs(),
  health: null,
  error: null,

  probeHealth: async () => {
    try {
      const res = await fetch('/api/render/health')
      const j = await res.json()
      set({ health: { configured: !!j.configured, mock: !!j.mock, reachable: true } })
    } catch {
      set({ health: { configured: false, mock: false, reachable: false } })
    }
  },

  setInteriorRoom: (key) =>
    set((s) => ({
      interiorRoomKey: key,
      stale: s.phase === 'ready' || s.phase === 'gallery' ? true : s.stale,
    })),

  beginCapture: () => set({ phase: 'capturing', refs: {}, stale: false, error: null }),

  setRef: (k, dataUrl) =>
    set((s) => {
      const refs = { ...s.refs, [k]: dataUrl }
      const done = REF_KEYS.every((r) => refs[r])
      return { refs, phase: done ? 'ready' : s.phase }
    }),

  captureFailed: (msg) => set({ phase: 'idle', error: msg }),

  runJobs: async (promptFor) => {
    const { refs } = get()
    if (!REF_KEYS.every((k) => refs[k])) return
    set({ phase: 'rendering', jobs: freshJobs(), error: null })
    await Promise.allSettled(
      REF_KEYS.map(async (k) => {
        set((s) => ({ jobs: { ...s.jobs, [k]: { status: 'running' } } }))
        try {
          const url = await callRender(refs[k]!.split(',')[1], promptFor(k))
          set((s) => ({ jobs: { ...s.jobs, [k]: { status: 'done', url } } }))
        } catch (e) {
          set((s) => ({ jobs: { ...s.jobs, [k]: { status: 'error', error: String((e as Error).message) } } }))
        }
      }),
    )
    set({ phase: 'gallery' })
  },

  retry: async (k, promptFor) => {
    const { refs } = get()
    if (!refs[k]) return
    set((s) => ({ jobs: { ...s.jobs, [k]: { status: 'running' } } }))
    try {
      const url = await callRender(refs[k]!.split(',')[1], promptFor(k))
      set((s) => ({ jobs: { ...s.jobs, [k]: { status: 'done', url } } }))
    } catch (e) {
      set((s) => ({ jobs: { ...s.jobs, [k]: { status: 'error', error: String((e as Error).message) } } }))
    }
  },

  reset: () => set({ phase: 'idle', refs: {}, stale: false, jobs: freshJobs(), error: null }),
}))
