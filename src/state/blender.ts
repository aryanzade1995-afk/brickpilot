import { finishSignature } from '@/lib/cost/finishAssignments.ts'
import { newDesignSeed } from '@/lib/newDesignSeed.ts'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Design } from '@/lib/engine/types.ts'
import { createBuildingModel } from '@/lib/engine/buildingModel.ts'
import { validate } from '@/lib/rules/index.ts'

export type BlenderResult = {
  seed: number; requestedSeed: number; planId: string; family: string; hero: string; roofline: string
  finishSignature?: string; quality: 'preview' | 'final'; warnings: string[]
  files: { blend: string; glb: string; hero: string; front: string; aerial: string }
}
type Job = { id: string; status: string; phase: string; progress?: number; seed?: number; expectedSeed?: number; attempt?: number; error?: string;
  result?: BlenderResult; debug: { seed: number; family: string; similarityPercent?: number; nearestPreviousSeed?: number | null; accepted: boolean; reason: string }[] }
/** A direction is a plan AND an exterior seed. Sharing rooms does not mean sharing a render. */
export const directionRenderKey = (planId: string, seed: number) => `${planId}:${seed}`
export type Preview = { status: 'queued' | 'generating' | 'rendering' | 'complete' | 'failed' | 'unavailable'; phase: string; progress?: number; jobId?: string; error?: string; planId: string; seed: number }
type State = {
  accepted: Record<string, BlenderResult>; job: Job | null; sourcePlanId: string | null; error: string | null
  directionRenders: Record<string, BlenderResult>
  selectionKey: string | null
  previews: Record<string, Preview>
  generate: (plan: Design, seed: number, quality?: 'preview' | 'final', exact?: boolean) => Promise<void>
  ensureForPlan: (plan: Design, preferredSeed?: number) => Promise<void>
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
        const expectedSeed = get().job!.expectedSeed
        const job = { ...await readResponse(await fetch(`/api/villas/${id}`)), expectedSeed }
        set({ job })
        if (job.status === 'failed') throw new Error(job.error || 'Generation failed')
        if (job.status === 'complete') {
          if (!job.result || job.result.planId !== get().sourcePlanId) throw new Error('Generated model belongs to a different source plan')
          if (expectedSeed !== undefined && job.result.seed !== expectedSeed)
            throw new Error('The backend returned another seed instead of your selected direction. Restart the backend with the current project code.')
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
        for (const [key, preview] of pending) {
          try {
            const job = await readResponse(await fetch(`/api/villas/${preview.jobId}`))
            if (job.status === 'complete' && job.result) {
              if (job.result.planId !== preview.planId || job.result.seed !== preview.seed)
                throw new Error('The render does not match this direction’s plan and seed')
              set({ directionRenders: { ...get().directionRenders, [key]: job.result } })
              setPreview(key, { ...preview, status: 'complete', phase: 'Ready' })
            } else if (job.status === 'failed') setPreview(key, { ...preview, status: 'failed', phase: 'Stopped', error: job.error || 'Generation failed' })
            else setPreview(key, { ...preview, status: job.status === 'rendering' ? 'rendering' : job.status === 'queued' ? 'queued' : 'generating', phase: job.phase, progress: job.progress })
          } catch (error) {
            setPreview(key, { ...preview, status: 'failed', phase: 'Stopped', error: error instanceof Error ? error.message : 'Could not load the render' })
          }
        }
        if (Object.values(get().previews).some(p => p.jobId && !['complete', 'failed'].includes(p.status)))
          await new Promise((resolve) => setTimeout(resolve, 3000))
      }
    } finally { previewPolling = false }
  }
  return { accepted: {}, directionRenders: {}, selectionKey: null, job: null, sourcePlanId: null, error: null, previews: {},
    resume: async () => { await Promise.all([poll(), pollPreviews()]) },
    previewDirections: async (items) => {
      const keyed = items.map(item => { const id = createBuildingModel(item.plan).planId
        return { ...item, id, key: directionRenderKey(id, item.seed) } })
      const wanted = [...new Map(keyed.map(item => [item.key, item])).values()]
        .filter(({ key }) => !get().directionRenders[key] && !get().previews[key])
      if (!wanted.length) { await pollPreviews(); return }
      for (const { id, key, seed } of wanted) setPreview(key, { planId: id, seed, status: 'queued', phase: 'Waiting for Blender' })
      let note = ''
      try {
        const response = await fetch('/api/villas/health')
        const health = response.ok ? await response.json() : { available: false, note: 'The generation service is not running.' }
        if (!health.available) note = health.note || 'Blender is unavailable on this computer.'
      } catch { note = 'The generation service is not running.' }
      for (const { id, key, plan, seed } of wanted) {
        if (note) { setPreview(key, { planId: id, seed, status: 'unavailable', phase: note }); continue }
        try {
          const job = await readResponse(await fetch('/api/villas', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ plan, seed, quality: 'preview', exact: true }) }))
          setPreview(key, { planId: id, seed, status: 'queued', phase: job.phase, jobId: job.id })
        } catch (error) {
          setPreview(key, { planId: id, seed, status: 'failed', phase: 'Stopped', error: error instanceof Error ? error.message : 'Could not start generation' })
        }
      }
      await pollPreviews()
    },
    ensureForPlan: async (plan, preferredSeed) => {
      const id = createBuildingModel(plan).planId
      const signature = finishSignature(plan.model.brief)
      const key = `${preferredSeed === undefined ? `${id}:auto` : directionRenderKey(id, preferredSeed)}:${signature}`
      if (get().accepted[id]?.finishSignature === signature && (preferredSeed === undefined || get().selectionKey === key)) return
      const cached = preferredSeed === undefined ? undefined : get().directionRenders[directionRenderKey(id, preferredSeed)]
      const exact = cached?.finishSignature === signature ? cached : undefined
      if (exact || preferredSeed !== undefined && get().accepted[id]?.seed === preferredSeed && get().accepted[id]?.finishSignature === signature) {
        set({ accepted: { ...get().accepted, [id]: exact ?? get().accepted[id] }, selectionKey: key, error: null })
        return
      }
      const preview = preferredSeed === undefined ? undefined : get().previews[directionRenderKey(id, preferredSeed)]
      if (preview && ['queued', 'generating', 'rendering'].includes(preview.status)) {
        await pollPreviews()
        return
      }
      // Navigation, React Strict Mode and view changes must not queue another villa.
      if (starting.has(id) || get().sourcePlanId === id && get().selectionKey === key && get().job || active(get().job)) return
      starting.add(id)
      try {
        if (!validate(plan).hardChecksPass) throw new Error('Fix the 2D plan checks before generating the 3D model.')
        const response = await fetch('/api/villas/health')
        if (!response.ok) throw new Error('The Blender generation service is unavailable. Start the project backend and try again.')
        const health = await response.json()
        if (!health.available) throw new Error(health.note || 'Blender is unavailable on this computer.')
        // Recheck after the asynchronous availability request: another view may have started it.
        const pending = preview
        const ready = exact
        if (ready) {
          set({ accepted: { ...get().accepted, [id]: ready }, selectionKey: key, error: null })
          return
        }
        if (!active(get().job) && !(pending && ['queued', 'generating', 'rendering'].includes(pending.status))) {
          set({ selectionKey: key })
          const existing = get().accepted[id]
          await get().generate(plan, preferredSeed ?? existing?.seed ?? newDesignSeed(plan.dna.seed), 'preview', preferredSeed !== undefined || Boolean(existing))
        }
      } catch (error) {
        if (!active(get().job)) set({ sourcePlanId: id, selectionKey: key, error: error instanceof Error ? error.message : 'Could not start Blender',
          job: { id: '', status: 'failed', phase: 'Generation unavailable', debug: [] } })
      } finally { starting.delete(id) }
    },
    generate: async (plan, seed, quality = 'preview', exact = false) => {
      if (polling || active(get().job)) return
      const sourcePlanId = createBuildingModel(plan).planId
      if (!validate(plan).hardChecksPass) { set({ sourcePlanId, error: 'Fix the 2D plan checks before generating the 3D model.' }); return }
      set({ error: null, sourcePlanId, job: { id: '', status: 'submitting', phase: 'Starting generation', debug: [] } })
      try {
        const job = await readResponse(await fetch('/api/villas', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ plan, seed, quality, ...(exact ? { exact: true } : {}) }) }))
        set({ job: { ...job, ...(exact ? { expectedSeed: seed } : {}) } }); await poll()
      } catch (error) { set({ error: error instanceof Error ? error.message : 'Could not start generation',
        job: get().job ? { ...get().job!, status: 'failed' } : null }) }
    },
  }
}, { name: 'brickpilot.blender-v1', partialize: (s) => ({ accepted: s.accepted, directionRenders: s.directionRenders,
  previews: s.previews, selectionKey: s.selectionKey, job: s.job, sourcePlanId: s.sourcePlanId }),
  merge: (persisted, current) => {
    const saved = persisted as Partial<State> | undefined
    const interrupted = saved?.job?.status === 'submitting' && !saved.job.id
    const previews = Object.fromEntries(Object.entries(saved?.previews ?? {}).filter(([key, p]) =>
      typeof p?.planId === 'string' && Number.isSafeInteger(p.seed) && key === directionRenderKey(p.planId, p.seed))
      .map(([key, p]): [string, Preview] => [key, !p.jobId && ['queued', 'generating', 'rendering'].includes(p.status)
        ? { ...p, status: 'failed', phase: 'Request interrupted', error: 'The preview request was interrupted before a job was created.' }
        : p]))
    return { ...current, previews, accepted: saved?.accepted ?? {}, directionRenders: saved?.directionRenders ?? {},
      selectionKey: saved?.selectionKey ?? null, sourcePlanId: saved?.sourcePlanId ?? null,
      job: interrupted ? { ...saved.job!, status: 'failed' } : saved?.job ?? null,
      error: interrupted ? 'Generation request was interrupted. Try again.' : null }
  },
}))
