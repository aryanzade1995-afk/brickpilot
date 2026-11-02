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
  roofRevision?:string; geometryRevision?: string
  files: { blend: string; glb: string; hero: string; front: string; aerial: string }
}
type Job = { heroPreview?:string; id: string; status: string; phase: string; progress?: number; seed?: number; expectedSeed?: number; attempt?: number; error?: string;
  result?: BlenderResult; debug: { seed: number; family: string; similarityPercent?: number; nearestPreviousSeed?: number | null; accepted: boolean; reason: string }[] }
/** A direction is a plan AND an exterior seed. Sharing rooms does not mean sharing a render. */
export const directionRenderKey = (planId: string, seed: number) => `${planId}:${seed}`
export type Preview = { heroPreview?:string; status: 'queued' | 'generating' | 'rendering' | 'complete' | 'failed' | 'unavailable'; phase: string; progress?: number; jobId?: string; error?: string; planId: string; seed: number }
type State = {
  accepted: Record<string, BlenderResult>; job: Job | null; sourcePlanId: string | null; error: string | null
  directionRenders: Record<string, BlenderResult>
  selectionKey: string | null
  previews: Record<string, Preview>
  /** Carry a card's existing render/job into the pinned workspace without submitting a job. */
  selectDirection: (plan: Design, seed: number) => void
  generate: (plan: Design, seed: number, quality?: 'preview' | 'final', exact?: boolean) => Promise<void>
  ensureForPlan: (plan: Design, preferredSeed?: number) => Promise<void>
  /** render each direction exactly as shown (its own seed, no look-alike retries) */
  previewDirections: (items: { plan: Design; seed: number }[], retryFailed?: boolean) => Promise<void>
  resume: () => Promise<void>
}
let previewPolling = false
const checkedCompleted=new Set<string>()
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
          checkedCompleted.add(id)
          const result = job.result
          const previewKey=directionRenderKey(result.planId,result.seed)
          if(get().previews[previewKey])setPreview(previewKey,{...get().previews[previewKey],status:'complete',phase:'Ready',jobId:id,error:undefined})
          set({ accepted: { ...get().accepted, [result.planId]: result }, error: null,
            ...(expectedSeed !== undefined || get().previews[previewKey] ? { directionRenders: { ...get().directionRenders,
              [directionRenderKey(result.planId, result.seed)]: result } } : {}) })
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 2500))
      }
    } catch (error) { set({ error: error instanceof Error ? error.message : 'Could not load the generated design',
      job: get().job ? { ...get().job!, status: 'failed' } : null }) }
    finally { polling = false }
  }
  const setPreview = (id:string,preview:Preview) => {
    const previous=get().previews[id]
    if(previous&&JSON.stringify(previous)===JSON.stringify(preview))return
    set({previews:{...get().previews,[id]:preview}})
  }
  const pollPreviews = async () => {
    if (previewPolling) return
    previewPolling = true
    const failures=new Map<string,number>()
    try {
      for (;;) {
        const pending = Object.entries(get().previews).filter(([, p]) => p.jobId && !['complete', 'failed'].includes(p.status))
        if (!pending.length) break
        await Promise.all(pending.map(async ([key,preview]) => {
          try {
            const job = await readResponse(await fetch(`/api/villas/${preview.jobId}`,{signal:AbortSignal.timeout(10000)}))
            if(get().previews[key]?.jobId!==preview.jobId)return
            failures.delete(key)
            if (job.status === 'complete' && job.result) {
              if (job.result.planId !== preview.planId || job.result.seed !== preview.seed)
                throw new Error('The render does not match this direction’s plan and seed')
              const selected = get().selectionKey === `${key}:${job.result.finishSignature}`
              set({ directionRenders: { ...get().directionRenders, [key]: job.result },
                ...(selected ? {accepted:{...get().accepted,[preview.planId]:job.result},error:null} : {}) })
              setPreview(key, { ...preview, status: 'complete', phase: 'Ready' })
            } else if (job.status === 'failed') setPreview(key, { ...preview, status: 'failed', phase: 'Stopped', error: job.error || 'Generation failed' })
            else setPreview(key, { ...preview, status: job.status === 'rendering' ? 'rendering' : job.status === 'queued' ? 'queued' : 'generating', phase: job.phase, progress: job.progress, heroPreview:job.heroPreview })
          } catch (error) {
            const attempts=(failures.get(key)??0)+1;failures.set(key,attempts)
            const message=error instanceof Error?error.message:'Could not load the render'
            if(attempts>=3||message.includes('does not match'))setPreview(key,{...preview,status:'failed',phase:'Stopped',error:message})
            else setPreview(key,{...preview,phase:'Reconnecting to the render service…'})
          }
        }))
        if (Object.values(get().previews).some(p => p.jobId && !['complete', 'failed'].includes(p.status)))
          await new Promise((resolve) => setTimeout(resolve, 3000))
      }
    } finally { previewPolling = false }
  }
  return { accepted: {}, directionRenders: {}, selectionKey: null, job: null, sourcePlanId: null, error: null, previews: {},
    selectDirection: (plan, seed) => {
      const id=createBuildingModel(plan).planId,signature=finishSignature(plan.model.brief)
      const key=directionRenderKey(id,seed)
      const accepted=get().accepted[id],cached=get().directionRenders[key]
      const ready=accepted?.seed===seed&&accepted.finishSignature===signature?accepted:
        cached?.finishSignature===signature?cached:undefined
      set({selectionKey:`${key}:${signature}`,error:null,...(!active(get().job)?{sourcePlanId:id}:{}),
        ...(ready?{accepted:{...get().accepted,[id]:ready}}:{})})
    },
    resume: async () => {
      const savedJob=get().job
      if(savedJob?.id&&savedJob.status==='complete'&&!checkedCompleted.has(savedJob.id)){
        checkedCompleted.add(savedJob.id)
        try{
          const fresh=await readResponse(await fetch(`/api/villas/${savedJob.id}`))
          if(fresh.status==='complete'&&get().job?.id===savedJob.id)
            set({job:{...fresh,status:'queued',expectedSeed:savedJob.expectedSeed}})
        }catch{/* Keep the accepted model usable offline. */}
      }
      // A repaired/replayed job may finish after this browser saved its failure.
      // Refresh status only: navigation must never submit another render.
      const stopped=get().job
      if(stopped?.id&&stopped.status==='failed'){
        try{
          const fresh=await readResponse(await fetch(`/api/villas/${stopped.id}`))
          if(fresh.status!=='failed'&&get().job?.id===stopped.id)
            set({job:{...fresh,status:fresh.status==='complete'?'queued':fresh.status,expectedSeed:stopped.expectedSeed},error:null})
        }catch{/* Preserve the previous failure when the service is unavailable. */}
      }
      for(const [key,preview] of Object.entries(get().previews)){
        if(preview.status!=='failed'||!preview.jobId||preview.planId!==get().sourcePlanId)continue
        try{
          const fresh=await readResponse(await fetch(`/api/villas/${preview.jobId}`))
          if(fresh.status!=='failed'&&get().previews[key]?.jobId===preview.jobId)
            setPreview(key,{...preview,status:'queued',phase:fresh.phase,error:undefined})
        }catch{/* A later explicit retry remains available. */}
      }
      await Promise.all([poll(),pollPreviews()])
    },
    previewDirections: async (items,retryFailed=false) => {
      const keyed = items.map(item => { const id = createBuildingModel(item.plan).planId
        return { ...item, id, key: directionRenderKey(id, item.seed) } })
      // Reconcile saved failures with completed server-side recovery, without
      // creating jobs on navigation. Only an explicit retry may resubmit.
      for(const {key} of keyed){
        const preview=get().previews[key]
        if(preview?.status!=='failed'||!preview.jobId)continue
        try{
          const fresh=await readResponse(await fetch(`/api/villas/${preview.jobId}`))
          if(fresh.status!=='failed'&&get().previews[key]?.jobId===preview.jobId)
            setPreview(key,{...preview,status:'queued',phase:fresh.phase,error:undefined})
        }catch{/* Retain the failure and its explicit retry control. */}
      }
      const wanted = [...new Map(keyed.map(item => [item.key, item])).values()]
        .filter(({ key }) => !get().directionRenders[key] && (!get().previews[key] || retryFailed && ['failed','unavailable'].includes(get().previews[key].status)))
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
            body: JSON.stringify({ plan, seed, quality: 'preview', exact: true, directionPreview:true }) }))
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
      const accepted = get().accepted[id]
      // A refreshed render of this exact seed supersedes an older direction
      // thumbnail (including renderer fixes and a higher-quality render).
      const exact = preferredSeed !== undefined && accepted?.seed === preferredSeed && accepted.finishSignature === signature
        ? accepted : cached?.finishSignature === signature ? cached : undefined
      if (exact || preferredSeed !== undefined && get().accepted[id]?.seed === preferredSeed && get().accepted[id]?.finishSignature === signature) {
        set({ accepted: { ...get().accepted, [id]: exact ?? get().accepted[id] }, selectionKey: key, error: null })
        return
      }
      const preview = preferredSeed === undefined ? undefined : get().previews[directionRenderKey(id, preferredSeed)]
      if (preview && ['queued', 'generating', 'rendering'].includes(preview.status)) {
        await pollPreviews()
        return
      }
      if(preview&&(preview.jobId||preview.status==='unavailable')&&['failed','unavailable'].includes(preview.status)){
        if (preview.phase?.includes('Set BLENDER_BIN') || preview.error?.includes('Set BLENDER_BIN')) {
          set({ error: null })
        } else {
          if(active(get().job))return
          // Navigation must never retry a direction or replace it with a new job.
          // The existing Generate button is the explicit retry action.
          set({sourcePlanId:id,selectionKey:key,error:preview.error||preview.phase,
            job:{id:preview.jobId??'',status:'failed',phase:preview.phase,debug:[]}})
          return
        }
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
          await get().generate(plan, preferredSeed ?? existing?.seed ?? newDesignSeed(plan.dna.seed, plan.model.brief.style.character), 'preview', preferredSeed !== undefined || Boolean(existing))
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
