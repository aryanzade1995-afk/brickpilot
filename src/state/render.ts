import { buildingEdgeMap } from '@/lib/render/edgeMap.ts'
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
export type Job = { status: 'pending' | 'running' | 'done' | 'error'; url?: string; error?: string; provider?: string; mock?: boolean; note?: string }
export type Health = { configured: boolean; mock: boolean; reachable: boolean; provider?: string; note?: string }

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
  inspiration: string | null

  probeHealth: () => Promise<void>
  setInteriorRoom: (key: string) => void
  setInspiration: (dataUrl: string | null) => void
  beginCapture: () => void
  setRef: (k: RefKey, dataUrl: string) => void
  captureFailed: (msg: string) => void
  runJobs: (promptFor: (k: RefKey) => string) => Promise<void>
  retry: (k: RefKey, promptFor: (k: RefKey) => string) => Promise<void>
  reset: () => void
}

async function callRender(imageBase64: string, prompt: string, inspiration: string | null): Promise<Pick<Job, 'url' | 'provider' | 'mock' | 'note'>> {
  const edgeBase64 = await buildingEdgeMap(imageBase64)
  let seed = 2166136261
  for (const char of prompt) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0
  const res = await fetch('/api/render', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ imageBase64, edgeBase64, seed, mimeType: 'image/png', prompt,
      inspirationBase64: inspiration?.split(',')[1], inspirationMimeType: inspiration?.match(/^data:([^;]+);/)?.[1] }),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(j?.error || `render failed (${res.status})`)
  if (!j?.imageBase64) throw new Error(j?.error || 'no image returned')
  return {url:`data:${j.mimeType || 'image/png'};base64,${j.imageBase64}`,provider:j.provider || j.meta?.provider || 'unknown',mock:!!j.mock,note:j.meta?.note || j.note}
}

export const useRender = create<RenderState>((set, get) => ({
  phase: 'idle',
  interiorRoomKey: null,
  refs: {},
  stale: false,
  jobs: freshJobs(),
  health: null,
  error: null,
  inspiration: null,

  probeHealth: async () => {
    try {
      const res = await fetch('/api/render/health')
      const j = await res.json()
      set({ health: { configured: !!j.configured, mock: !!j.mock, reachable: !!j.reachable, provider:j.provider, note:j.note } })
    } catch {
      set({ health: { configured: false, mock: false, reachable: false } })
    }
  },

  setInteriorRoom: (key) =>
    set((s) => ({
      interiorRoomKey: key,
      stale: s.phase === 'ready' || s.phase === 'gallery' ? true : s.stale,
    })),

  setInspiration: (dataUrl) => set((s) => ({ inspiration: dataUrl, jobs: freshJobs(),
    phase: REF_KEYS.every((k) => s.refs[k]) ? 'ready' : 'idle' })),

  beginCapture: () => set({ phase: 'capturing', refs: {}, stale: false, error: null }),

  setRef: (k, dataUrl) =>
    set((s) => {
      const refs = { ...s.refs, [k]: dataUrl }
      const done = REF_KEYS.every((r) => refs[r])
      return { refs, phase: done ? 'ready' : s.phase }
    }),

  captureFailed: (msg) => set({ phase: 'idle', error: msg }),

  runJobs: async (promptFor) => {
    const { refs, inspiration } = get()
    if (!REF_KEYS.every((k) => refs[k])) return
    set({ phase: 'rendering', jobs: freshJobs(), error: null })
    // The local bridge is session based: queue concepts rather than burst four image jobs.
    for (const k of REF_KEYS) {
        set((s) => ({ jobs: { ...s.jobs, [k]: { status: 'running' } } }))
        try {
          const rendered = await callRender(refs[k]!.split(',')[1], promptFor(k), k === 'interior' ? null : inspiration)
          set((s) => ({ jobs: { ...s.jobs, [k]: { status: 'done', ...rendered } } }))
        } catch (e) {
          set((s) => ({ jobs: { ...s.jobs, [k]: { status: 'error', error: String((e as Error).message) } } }))
        }
    }
    set({ phase: 'gallery' })
  },

  retry: async (k, promptFor) => {
    const { refs, inspiration } = get()
    if (!refs[k]) return
    set((s) => ({ jobs: { ...s.jobs, [k]: { status: 'running' } } }))
    try {
      const rendered = await callRender(refs[k]!.split(',')[1], promptFor(k), k === 'interior' ? null : inspiration)
      set((s) => ({ jobs: { ...s.jobs, [k]: { status: 'done', ...rendered } } }))
    } catch (e) {
      set((s) => ({ jobs: { ...s.jobs, [k]: { status: 'error', error: String((e as Error).message) } } }))
    }
  },

  reset: () => set({ phase: 'idle', refs: {}, stale: false, jobs: freshJobs(), error: null }),
}))
