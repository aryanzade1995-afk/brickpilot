import {useEffect,useMemo,useState} from 'react'
import type {Design} from '@/lib/engine/types.ts'
import {directionEvidence,type DirectionEvidence} from '@/lib/engine/directionAdvice.ts'

export type Advice={mode:'local-ai'|'plan-analysis';model:string|null;recommendations:({planId:string}&DirectionEvidence['candidates'][number])[]}
const requests=new Map<string,Promise<Advice|null>>()
export function useDirectionRecommendations(designs:Design[],query:string){
 const evidence=useMemo(()=>directionEvidence(designs),[designs])
 const key=useMemo(()=>JSON.stringify({query,options:evidence.map(d=>({id:d.id,candidates:d.candidates}))}),[evidence,query])
 const [response,setResponse]=useState<{key:string;value:Advice|null}|null>(null)
 useEffect(()=>{
  if(!evidence.length)return
  let active=true,task=requests.get(key)
  if(!task){
   if(requests.size>=64)requests.delete(requests.keys().next().value!)
   task=fetch('/api/directions/advice',{method:'POST',headers:{'content-type':'application/json'},body:key,signal:AbortSignal.timeout(12000)}).then(async res=>{
    if(!res.ok)return null
    const value=await res.json() as Advice
    return ['local-ai','plan-analysis'].includes(value.mode)&&Array.isArray(value.recommendations)?value:null
   }).catch(()=>null)
   requests.set(key,task)
  }
  void task.then(value=>{if(active)setResponse({key,value})})
  return()=>{active=false}
 },[key,evidence])
 return {evidence,advice:response?.key===key?response.value:null}
}
