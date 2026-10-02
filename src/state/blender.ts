import { newDesignSeed } from '@/lib/newDesignSeed.ts'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Design } from '@/lib/engine/types.ts'
import { createBuildingModel } from '@/lib/engine/buildingModel.ts'
import { validate } from '@/lib/rules/index.ts'

export type BlenderResult = {
  seed: number; requestedSeed: number; planId: string; family: string; hero: string; roofline: string
  quality: 'preview' | 'final'; warnings: string[]
  files: { blend: string; glb: string; hero: string; front: string; aerial: string }
}
type Job = { id: string; status: string; phase: string; seed?: number; attempt?: number; error?: string;
  result?: BlenderResult; debug: { seed: number; family: string; similarityPercent?: number; nearestPreviousSeed?: number | null; accepted: boolean; reason: string }[] }
/** a Directions card's Blender render, keyed by the direction's plan id */
export type Preview = { status: 'queued' | 'generating' | 'rendering' | 'complete' | 'failed' | 'unavailable'; phase: string; jobId?: string; error?: string }
type State = {
  accepted: Record<string, BlenderResult>; job: Job | null; sourcePlanId: string | null; error: string | null
  previews: Record<string, Preview>
  generate: (plan: Design, seed: number, quality?: 'preview' | 'final') => Promise<void>
  ensureForPlan: (plan: Design) => Promise<void>
  /** render each direction exactly as shown (its own seed, no look-alike retries) */
  previewDirections: (items: { plan: Design; seed: number }[]) => Promise<void>
  resume: () => Promise<void>
}
let previewPolling = false
let polling = false
const starting = new Set<string>()
const active = (job: Job | null) => Boolean(job && !['complete', 'failed'].includes(job.status))
async function readResponse(response: Response) {
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Generation service is unavailable')
  return data as Job
}
export const useBlender = create<State>()(persist((set, get) => {
  const poll = async () => {
    if (polling || !get().job?.id) return
    polling = true
    try {
      while (get().job && !['complete', 'failed'].includes(get().job!.status)) {
        const id = get().job!.id
        const job = await readResponse(await fetch(`/api/villas/${id}`))
        set({ job })
        if (job.status === 'failed') throw new Error(job.error || 'Generation failed')
        if (job.status === 'complete') {
          if (!job.result || job.result.planId !== get().sourcePlanId) throw new Error('Generated model belongs to a different source plan')
          const result = job.result
          set({ accepted: { ...get().accepted, [result.planId]: result }, error: null })
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 2500))
      }
    } catch (error) { set({ error: error instanceof Error ? error.message : 'Could not load the generated design',
      job: get().job ? { ...get().job!, status: 'failed' } : null }) }
    finally { polling = false }
  }
  const setPreview = (id: string, preview: Preview) => set({ previews: { ...get().previews, [id]: preview } })
  const pollPreviews = async () => {
    if (previewPolling) return
    previewPolling = true
    try {
      for (;;) {
        const pending = Object.entries(get().previews).filter(([, p]) => p.jobId && !['complete', 'failed'].includes(p.status))
        if (!pending.length) break
        for (const [id, preview] of pending) {
          try {
            const job = await readResponse(await fetch(`/api/villas/${preview.jobId}`))
            if (job.status === 'complete' && job.result) {
              if (job.result.planId !== id) throw new Error('The render belongs to a different plan')
              // the pinned direction's 3D page reuses this exact villa
              set({ accepted: { ...get().accepted, [id]: job.result } })
              setPreview(id, { status: 'complete', phase: 'Ready', jobId: preview.jobId })
            } else if (job.status === 'failed') setPreview(id, { status: 'failed', phase: 'Stopped', jobId: preview.jobId, error: job.error || 'Generation failed' })
            else setPreview(id, { status: job.status === 'rendering' ? 'rendering' : job.status === 'queued' ? 'queued' : 'generating', phase: job.phase, jobId: preview.jobId })
          } catch (error) {
            setPreview(id, { status: 'failed', phase: 'Stopped', jobId: preview.jobId, error: error instanceof Error ? error.message : 'Could not load the render' })
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 3000))
      }
    } finally { previewPolling = false }
  }
  return { accepted: {}, job: null, sourcePlanId: null, error: null, previews: {},
    resume: poll,
    previewDirections: async (items) => {
      const wanted = items.map((item) => ({ ...item, id: createBuildingModel(item.plan).planId }))
        .filter(({ id }) => !get().accepted[id] && !get().previews[id])
      if (!wanted.length) return
      for (const { id } of wanted) setPreview(id, { status: 'queued', phase: 'Waiting for Blender' })
      let note = ''
      try {
        const response = await fetch('/api/villas/health')
        const health = response.ok ? await response.json() : { available: false, note: 'The generation service is not running.' }
        if (!health.available) note = health.note || 'Blender is unavailable on this computer.'
      } catch { note = 'The generation service is not running.' }
      for (const { id, plan, seed } of wanted) {
        if (note) { setPreview(id, { status: 'unavailable', phase: note }); continue }
        try {
          const job = await readResponse(await fetch('/api/villas', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ plan, seed, quality: 'preview', exact: true }) }))
          setPreview(id, { status: 'queued', phase: job.phase, jobId: job.id })
        } catch (error) {
          setPreview(id, { status: 'failed', phase: 'Stopped', error: error instanceof Error ? error.message : 'Could not start generation' })
        }
      }
      await pollPreviews()
    },
    ensureForPlan: async (plan) => {
      const id = createBuildingModel(plan).planId
      // Navigation, React Strict Mode and view changes must not queue another villa.
      if (starting.has(id) || get().accepted[id] || get().sourcePlanId === id && get().job || active(get().job)) return
      starting.add(id)
      try {
        if (!validate(plan).hardChecksPass) throw new Error('Fix the 2D plan checks before generating the 3D model.')
        const response = await fetch('/api/villas/health')
        if (!response.ok) throw new Error('The Blender generation service is unavailable. Start the project backend and try again.')
        const health = await response.json()
        if (!health.available) throw new Error(health.note || 'Blender is unavailable on this computer.')
        // Recheck after the asynchronous availability request: another view may have started it.
        if (!get().accepted[id] && !active(get().job) && !(get().sourcePlanId === id && get().job)) {
          await get().generate(plan, newDesignSeed(plan.dna.seed), 'preview')
        }
      } catch (error) {
        if (!active(get().job)) set({ sourcePlanId: id, error: error instanceof Error ? error.message : 'Could not start Blender',
          job: { id: '', status: 'failed', phase: 'Generation unavailable', debug: [] } })
      } finally { starting.delete(id) }
    },
    generate: async (plan, seed, quality = 'preview') => {
      if (polling || active(get().job)) return
      const sourcePlanId = createBuildingModel(plan).planId
      if (!validate(plan).hardChecksPass) { set({ sourcePlanId, error: 'Fix the 2D plan checks before generating the 3D model.' }); return }
      set({ error: null, sourcePlanId, job: { id: '', status: 'submitting', phase: 'Starting generation', debug: [] } })
      try {
        const job = await readResponse(await fetch('/api/villas', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ plan, seed, quality }) }))
        set({ job }); await poll()
      } catch (error) { set({ error: error instanceof Error ? error.message : 'Could not start generation',
        job: get().job ? { ...get().job!, status: 'failed' } : null }) }
    },
  }
}, { name: 'brickpilot.blender-v1', partialize: (s) => ({ accepted: s.accepted, job: s.job, sourcePlanId: s.sourcePlanId }),
  merge: (persisted, current) => {
    const saved = persisted as Partial<State> | undefined
    const interrupted = saved?.job?.status === 'submitting' && !saved.job.id
    return { ...current, previews: {}, accepted: saved?.accepted ?? {}, sourcePlanId: saved?.sourcePlanId ?? null,
      job: interrupted ? { ...saved.job!, status: 'failed' } : saved?.job ?? null,
      error: interrupted ? 'Generation request was interrupted. Try again.' : null }
  },
}))
