import {registerHooks} from 'node:module'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {performance} from 'node:perf_hooks'
registerHooks({resolve(s,c,next){return s.startsWith('@/')?{url:new URL(`../src/${s.slice(2)}`,import.meta.url).href,shortCircuit:true}:next(s,c)}})
const storage=new Map()
globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}
globalThis.window={localStorage:globalThis.localStorage}
const {computeDirections,useStudio}=await import('../src/state/studio.ts')
const source=JSON.parse(await readFile(resolve('output/directions-speed-baseline/request.json'),'utf8'))
const started=performance.now(),state=useStudio.getState()
const {dirs}=computeDirections({...state,brief:source.plan.model.brief,pinned:null,recentVillaFingerprints:[]})
const planningMs=performance.now()-started
const requests=dirs.map(d=>({plan:d.design,seed:d.seed,quality:'preview',exact:true,directionPreview:true}))
if(requests.length!==4||new Set(dirs.map(d=>d.buildingModel.planId)).size!==4)throw Error('Four different checked source plans are required')
await mkdir('output/directions-speed-batch',{recursive:true})
await writeFile('output/directions-speed-batch/requests.json',JSON.stringify(requests))
const post=async request=>{const res=await fetch('http://localhost:8787/api/villas',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request)});const data=await res.json();if(!res.ok)throw Error(data.error);return data}
const renderStart=performance.now()
const jobs=await Promise.all(requests.map(post))
console.log(JSON.stringify({planningMs,jobs:jobs.map(j=>({id:j.id,status:j.status}))}))
const results=await Promise.all(jobs.map(async job=>{
 let current=job
 while(!['complete','failed'].includes(current.status)){
  if(performance.now()-renderStart>180000)throw Error('Timed out')
  await new Promise(resolve=>setTimeout(resolve,250))
  current=await (await fetch(`http://localhost:8787/api/villas/${job.id}`)).json()
 }
 const value={id:job.id,status:current.status,ms:performance.now()-renderStart,error:current.error,image:current.directionImage}
 console.log(JSON.stringify(value));return value
}))
const completedMs=performance.now()-renderStart,cacheStart=performance.now(),cached=await Promise.all(requests.map(post))
const cacheMs=performance.now()-cacheStart
const report={planningMs,completedMs,results,cacheMs,cacheReused:cached.every((job,i)=>job.id===jobs[i].id&&job.status==='complete')}
await writeFile('output/directions-speed-batch/timings.json',JSON.stringify(report,null,2))
console.log(JSON.stringify(report))
if(results.some(r=>r.status!=='complete')||!report.cacheReused)process.exitCode=1
