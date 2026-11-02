import {create} from 'zustand'
export const useConceptProgress=create<{value:number;label:string;error?:string}>(()=>({value:0,label:'Preparing your brief',error:undefined}))
const pending=new Map<string,Promise<Result>>()
import type { computeDirections, DirectionsInput } from './studio.ts'

type Result = ReturnType<typeof computeDirections>

/** generate the directions in a worker; rejects with a retryable error if a worker cannot run */
export function runDirections(input: DirectionsInput): Promise<Result> {
  const key=JSON.stringify(input),existing=pending.get(key)
  if(existing)return existing
  useConceptProgress.setState({value:0,label:'Preparing your brief',error:undefined})
  const task=new Promise<Result>((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./directions.worker.ts', import.meta.url), { type: 'module' })
    } catch (error) { reject(error); return }
    // Some embedded browsers create a worker but never deliver its result.
    // Reject with a retryable error; never freeze navigation with synchronous work.
    const timeout = setTimeout(() => { done(); reject(new Error('Directions worker timed out.')) }, 180000)
    const done = () => { clearTimeout(timeout); worker.terminate() }
    worker.onmessage = (event: MessageEvent<{ ok: boolean; result?: Result; error?: string; progress?:number;label?:string }>) => {
      if(typeof event.data.progress==='number'){useConceptProgress.setState({value:event.data.progress,label:event.data.label??'Checking concepts'});return}
      done()
      if (event.data.ok && event.data.result) resolve(event.data.result)
      else reject(new Error(event.data.error ?? 'Directions could not be generated.'))
    }
    worker.onerror = (event) => { done(); reject(new Error(event.message || 'Directions worker failed.')) }
    // plain data only: the brief, the pinned choice and the recent-villa history
    worker.postMessage(JSON.parse(JSON.stringify(input)))
  }).finally(()=>pending.delete(key))
  pending.set(key,task)
  return task
}
