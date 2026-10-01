import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Design } from '@/lib/engine/types.ts'
import { createBuildingModel } from '@/lib/engine/buildingModel.ts'

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
  resume: () => Promise<void>
}
let polling = false
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
    generate: async (plan, seed, quality = 'preview') => {
      if (polling || (get().job && !['complete', 'failed'].includes(get().job!.status))) return
      const sourcePlanId = createBuildingModel(plan).planId
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
