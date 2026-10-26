import {useEffect,useState} from 'react'
import type {Design} from '@/lib/engine/types.ts'
import type {WalkthroughSource} from '@/lib/walkthrough/source.ts'
import {translate as t} from '@/lib/i18n/index.ts'
type Job={id:string;status:string;stage?:string;error?:string;signature:string;acceptedUrl:string}
export function WalkthroughBakeControls({design,source,acceptedUrl,signature,onReady}:{design:Design;source:WalkthroughSource;acceptedUrl:string;signature:string;onReady:(id:string|null)=>void}){
 const [job,setJob]=useState<Job|null>(null),[error,setError]=useState('')
 const [enabled,setEnabled]=useState(true)
 const storageKey='formstead.walkthrough-lighting:'+acceptedUrl
 useEffect(()=>{
  onReady(null);setJob(null)
  try{const saved=JSON.parse(localStorage.getItem(storageKey)??'null');if(saved?.signature===signature&&saved.acceptedUrl===acceptedUrl)setJob(saved)}catch{}
 },[storageKey,signature,acceptedUrl,onReady])
 useEffect(()=>{
  if(!job||job.signature!==signature)return
  let active=true,timer:ReturnType<typeof setTimeout>
  const poll=async()=>{try{const response=await fetch(`/api/walkthrough-lighting/${job.id}`);if(!response.ok)throw new Error('Saved lighting is unavailable. Prepare it again.')
   const status=await response.json();if(!active)return
   const next={...job,...status};setJob(next)
   if(status.status==='ready'){try{localStorage.setItem(storageKey,JSON.stringify(next))}catch{}onReady(enabled?job.id:null)}
   else if(status.status==='failed')setError(status.error??'Lighting preparation failed.')
   else timer=setTimeout(poll,5000)
  }catch(e){if(active)setError(e instanceof Error?e.message:'Lighting is unavailable.')}}
  void poll();return()=>{active=false;clearTimeout(timer)}
 },[job?.id,job?.status,signature,storageKey,onReady,enabled])
 const busy=job&&['queued','baking'].includes(job.status)
 const request=async()=>{setError('');try{
  const response=await fetch('/api/walkthrough-lighting',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:'accepted-'+acceptedUrl.split('/')[3],expectedPlanId:source.building.planId,design,preferences:source.preferences,acceptedUrl,lightingQuality:'balanced'})})
  const data=await response.json();if(!response.ok)throw new Error(data.error??'Lighting preparation failed.')
  const next={...data,signature,acceptedUrl};setJob(next);try{localStorage.setItem(storageKey,JSON.stringify(next))}catch{}
 }catch(e){setError(e instanceof Error?e.message:'Lighting preparation failed.')}}
 return <div className="mt-4 flex flex-wrap items-center gap-3 border border-line bg-bg-inset p-3 text-xs">
  <button type="button" disabled={!!busy} onClick={()=>void request()} className="min-h-11 border border-line bg-bg px-4 disabled:opacity-50">{t(busy?'Preparing baked daylight…':job?.status==='ready'?'Refresh baked daylight':'Prepare baked daylight')}</button>
  {job?.status==='ready'&&<button type="button" className="min-h-11 border border-line bg-bg px-3" onClick={()=>setEnabled(v=>!v)}>{t(enabled?'Use real-time lighting':'Use baked daylight')}</button>}
  <span role="status" className="max-w-lg leading-relaxed text-ink-dim">{t(error||job?.stage||'Optional Cycles indirect light. Your current villa stays available during preparation.')}</span>
  {job?.status==='ready'&&<span className="text-ink-dim">{t('Daylight · neutral GI · paint changes reuse lighting')}</span>}
 </div>
}
