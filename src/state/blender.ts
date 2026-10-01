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
type State = {
  accepted: Record<string, BlenderResult>; job: Job | null; sourcePlanId: string | null; error: string | null
  generate: (plan: Design, seed: number, quality?: 'preview' | 'final') => Promise<void>
  ensureForPlan: (plan: Design) => Promise<void>
  resume: () => Promise<void>
}
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
  return { accepted: {}, job: null, sourcePlanId: null, error: null,
    resume: poll,
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
          await get().generate(plan, plan.dna.seed, 'preview')
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
    return { ...current, accepted: saved?.accepted ?? {}, sourcePlanId: saved?.sourcePlanId ?? null,
      job: interrupted ? { ...saved.job!, status: 'failed' } : saved?.job ?? null,
      error: interrupted ? 'Generation request was interrupted. Try again.' : null }
  },
}))
