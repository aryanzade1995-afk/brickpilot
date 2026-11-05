import {create} from 'zustand'
import type {Design} from '@/lib/engine/types.ts'
export const useConceptProgress=create<{active:boolean;value:number;label:string;error?:string;plans:(Design|undefined)[];sourceBrief?:DirectionsInput['brief']}>(()=>({active:false,value:0,label:'Preparing your brief',plans:[],error:undefined}))
const pending=new Map<string,Promise<Result>>()
let activeRequest:{key:string;cancel:()=>void}|undefined
let currentRequestKey:string|undefined
import type { computeDirections, DirectionsInput } from './studio.ts'

type Result = ReturnType<typeof computeDirections>

/** generate the directions in a worker; rejects with a retryable error if a worker cannot run */
export function runDirections(input: DirectionsInput): Promise<Result> {
  const key=JSON.stringify(input),existing=pending.get(key)
  if(existing)return existing
  activeRequest?.cancel()
  activeRequest=undefined;currentRequestKey=key
  useConceptProgress.setState({active:true,value:0,label:'Preparing your brief',error:undefined,plans:[],sourceBrief:input.brief})
  const task=new Promise<Result>((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./directions.worker.ts', import.meta.url), { type: 'module' })
    } catch (error) { reject(error); return }
    // Some embedded browsers create a worker but never deliver its result.
    // Reject with a retryable error; never freeze navigation with synchronous work.
    const timeout = setTimeout(() => { done(); reject(new Error('Directions worker timed out.')) }, 180000)
    const done = () => { clearTimeout(timeout); worker.terminate() }
    activeRequest={key,cancel:()=>{done();reject(new Error('Directions superseded by a newer request.'))}}
    worker.onmessage = (event: MessageEvent<{ ok: boolean; result?: Result; error?: string; progress?:number;label?:string;plan?:Design;index?:number }>) => {
      if(currentRequestKey!==key)return
      if(event.data.plan&&Number.isSafeInteger(event.data.index)&&event.data.index!>=0&&event.data.index!<4){
        const plan=event.data.plan,index=event.data.index!
        useConceptProgress.setState(s=>{const plans=[...s.plans];plans[index]=plan;return{plans}});return
      }
      if(typeof event.data.progress==='number'){useConceptProgress.setState({value:event.data.progress,label:event.data.label??'Checking concepts'});return}
      done()
      if (event.data.ok && event.data.result) resolve(event.data.result)
      else reject(new Error(event.data.error ?? 'Directions could not be generated.'))
    }
    worker.onerror = (event) => { done(); reject(new Error(event.message || 'Directions worker failed.')) }
    // plain data only: the brief, the pinned choice and the recent-villa history
    worker.postMessage(JSON.parse(JSON.stringify(input)))
  }).finally(()=>{pending.delete(key);if(currentRequestKey===key){currentRequestKey=undefined;activeRequest=undefined;useConceptProgress.setState({active:false})}})
  pending.set(key,task)
  return task
}
