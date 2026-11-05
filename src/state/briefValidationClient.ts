import type {BriefValidation,ValidationMessage,ValidationRequest} from './briefValidationTypes.ts'

type Transport=Pick<Worker,'postMessage'|'terminate'|'onmessage'|'onerror'>
type Update={key:string;result?:BriefValidation;error?:string}
type Listener=(update:Update)=>void
type Job={request:ValidationRequest;listeners:Set<Listener>;last?:Update;start?:ReturnType<typeof setTimeout>;deadline?:ReturnType<typeof setTimeout>;release?:ReturnType<typeof setTimeout>}
type Lane={worker?:Transport;job?:Job;idle?:ReturnType<typeof setTimeout>}

/** Warm planner modules/caches. New edits cancel obsolete work; optional shape
 * searches have a separate lane so they cannot block the availability result. */
export function createBriefValidationClient(createWorker:()=>Transport,options:{debounceMs?:number;timeoutMs?:number;idleMs?:number}={}){
 const cache=new Map<string,BriefValidation>(),lanes:Record<'fit'|'shapes',Lane>={fit:{},shapes:{}}
 const stop=(lane:Lane)=>{
  clearTimeout(lane.idle)
  if(lane.job){clearTimeout(lane.job.start);clearTimeout(lane.job.deadline);clearTimeout(lane.job.release)}
  lane.worker?.terminate();lane.worker=undefined;lane.job=undefined
 }
 const remember=(key:string,result:BriefValidation)=>{
  if(cache.size>=64&&!cache.has(key))cache.delete(cache.keys().next().value!)
  cache.set(key,result)
 }
 const finish=(lane:Lane,job:Job)=>{
  clearTimeout(job.deadline);clearTimeout(job.release);lane.job=undefined
  lane.idle=setTimeout(()=>stop(lane),options.idleMs??120000)
 }
 const fail=(lane:Lane,job:Job,message:string)=>{
  const result=job.last?.result?.fit?{...job.last.result,suggestionsChecking:false,suggestionsError:message}:undefined
  const update:Update={key:job.request.key,...(result?{result}:{error:message})}
  if(result)remember(job.request.key,result)
  stop(lane);job.listeners.forEach(listener=>listener(update))
 }
 return {
  get:(key:string)=>cache.get(key),
  invalidate:(key:string)=>cache.delete(key),
  subscribe(request:ValidationRequest,listener:Listener){
   const saved=cache.get(request.key)
   if(saved){listener({key:request.key,result:saved});return()=>{}}
   const lane=lanes[request.kind];clearTimeout(lane.idle)
   if(lane.job&&lane.job.request.key!==request.key)stop(lane)
   let job=lane.job
   if(!job){
    job={request,listeners:new Set()};lane.job=job
    const current=job
    current.start=setTimeout(()=>{
     if(lane.job!==current)return
     try{
      lane.worker??=createWorker()
      lane.worker.onmessage=({data}:MessageEvent<ValidationMessage>)=>{
       if(lane.job!==current||data.key!==current.request.key)return
       if(data.result){
        current.last={key:data.key,result:data.result}
        if(data.complete)remember(data.key,data.result)
        current.listeners.forEach(fn=>fn(current.last!))
       }else if(data.error){fail(lane,current,data.error);return}
       if(data.complete)finish(lane,current)
      }
      lane.worker.onerror=()=>{if(lane.job===current)fail(lane,current,'Space validation could not finish. Please try again.')}
      current.deadline=setTimeout(()=>{if(lane.job===current)fail(lane,current,'Space validation took too long. Try checking again.')},options.timeoutMs??60000)
      lane.worker.postMessage(request)
     }catch{fail(lane,current,'Space validation could not start. Please try again.')}
    },options.debounceMs??80)
   }
   clearTimeout(job.release);job.listeners.add(listener)
   if(job.last)listener(job.last)
   const subscribed=job
   return()=>{
    subscribed.listeners.delete(listener)
    // Let React Strict Mode reattach before cancelling an identical request.
    if(!subscribed.listeners.size&&lane.job===subscribed)subscribed.release=setTimeout(()=>{
     if(lane.job===subscribed&&!subscribed.listeners.size)stop(lane)
    },0)
   }
  },
  dispose(){stop(lanes.fit);stop(lanes.shapes);cache.clear()}
 }
}
