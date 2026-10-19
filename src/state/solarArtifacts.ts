import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { BlenderResult } from './blender.ts'
import type { SolarConfiguration } from '../lib/model/solar.ts'
import { solarVisualSignature } from '../lib/solar/renderContract.ts'

export type SolarArtifact = BlenderResult & { jobId: string; artifactScope: 'building-plus-solar'; baseJobId: string;
  buildingCacheKey: string; solarCacheKey: string; solarVisualSignature: string; roofSignature: string;
  panelCount: number; capacityKwp: number; files: BlenderResult['files'] & { solarLayout: string } }
type Job = { id: string; status: string; phase: string; error?: string; result?: SolarArtifact }
export function buildingJobId(building?: BlenderResult) {
  return building?.files.glb.match(/^\/api\/villas\/([a-f0-9-]{36})\/files\/[^/]+\.glb$/)?.[1] ?? null
}
export function solarArtifactKey(building: BlenderResult | undefined, solar: SolarConfiguration, quality: 'preview' | 'final' = 'preview') {
  return `${buildingJobId(building) ?? 'unavailable'}:${solarVisualSignature(solar)}:${quality}`
}
export function isCurrentSolarArtifact(artifact: SolarArtifact | undefined, building: BlenderResult | undefined, solar: SolarConfiguration) {
  return !!artifact && artifact.artifactScope === 'building-plus-solar' && artifact.baseJobId === buildingJobId(building) &&
    artifact.seed === building?.seed && artifact.planId === building.planId && artifact.finishSignature === building.finishSignature &&
    artifact.solarVisualSignature === solarVisualSignature(solar)
}
type State = { renders: Record<string, SolarArtifact>; jobs: Record<string, Job>;
  render: (building: BlenderResult, solar: SolarConfiguration, quality: 'preview' | 'final') => Promise<void>; resume: () => Promise<void> }
const polling = new Set<string>()
const read = async (response: Response): Promise<Job> => {
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Solar replay service unavailable')
  return data
}
export const useSolarArtifacts = create<State>()(persist((set, get) => {
  const save = (key: string, job: Job) => set(s => ({ jobs: { ...s.jobs, [key]: job } }))
  const poll = async (key: string) => {
    if (polling.has(key)) return
    polling.add(key)
    try {
      while (get().jobs[key]?.id && !['complete', 'failed'].includes(get().jobs[key].status)) {
        const job = await read(await fetch(`/api/villas/${get().jobs[key].id}`))
        if (job.status === 'complete') {
          if (!job.result || key !== `${job.result.baseJobId}:${job.result.solarVisualSignature}:${job.result.quality}`)
            throw new Error('Solar replay returned a different building or layout')
          // Store under its immutable key; an older completion cannot replace the current design.
          set(s => ({ renders: { ...s.renders, [key]: job.result! } }))
        }
        save(key, job)
        if (['complete', 'failed'].includes(job.status)) break
        await new Promise(resolve => setTimeout(resolve, 2500))
      }
    } catch (error) { save(key, { ...get().jobs[key], status: 'failed', phase: 'Solar replay stopped', error: error instanceof Error ? error.message : 'Solar replay failed' }) }
    finally { polling.delete(key) }
  }
  return { renders: {}, jobs: {},
    resume: async () => { await Promise.all(Object.keys(get().jobs).map(poll)) },
    render: async (building, solar, quality) => {
      const key = solarArtifactKey(building, solar, quality), baseJobId = buildingJobId(building)
      if (get().renders[key] || get().jobs[key] && !['complete', 'failed'].includes(get().jobs[key].status)) return
      save(key, { id: '', status: 'submitting', phase: 'Preparing accepted building replay' })
      try {
        if (!baseJobId) throw new Error('This accepted building has no replayable source job')
        const job = await read(await fetch('/api/villas/solar', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ baseJobId, solar, quality }) }))
        if (job.status === 'complete' && job.result) {
          if (!isCurrentSolarArtifact(job.result, building, solar)) throw new Error('Cached solar export belongs to another layout')
          set(s => ({ renders: { ...s.renders, [key]: job.result! } }))
        }
        save(key, job); await poll(key)
      } catch (error) { save(key, { id: '', status: 'failed', phase: 'Solar replay stopped', error: error instanceof Error ? error.message : 'Solar replay failed' }) }
    },
  }
}, { name: 'formstead.solar-artifacts-v1', partialize: s => ({ renders: s.renders, jobs: s.jobs }),
  merge: (persisted, current) => {
    const saved = persisted as Partial<State> | undefined
    return { ...current, renders: saved?.renders ?? {}, jobs: Object.fromEntries(Object.entries(saved?.jobs ?? {}).map(([key, job]) =>
      [key, !job.id && job.status === 'submitting' ? { ...job, status: 'failed', phase: 'Solar request interrupted; retry explicitly' } : job])) }
  },
}))
