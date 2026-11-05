import {useEffect,useState} from 'react'
import {geometryBrief,type Brief} from '@/lib/model/brief.ts'
import {createBriefValidationClient} from './briefValidationClient.ts'
import type {BriefValidation} from './briefValidationTypes.ts'
export type {BriefValidation,FitAction} from './briefValidationTypes.ts'
type Snapshot={key:string;result?:BriefValidation;error?:string}
const client=createBriefValidationClient(()=>new Worker(new URL('./briefValidation.worker.ts',import.meta.url),{type:'module'}))
export const briefValidationKey=(brief:Brief,kind:'fit'|'shapes'='fit')=>kind+JSON.stringify(geometryBrief(brief))
if(import.meta.hot)import.meta.hot.dispose(()=>client.dispose())

/** Validation never runs during React rendering. Old results cannot approve new inputs. */
export function useBriefValidation(brief:Brief,kind:'fit'|'shapes'='fit'){
 const key=briefValidationKey(brief,kind)
 const [snapshot,setSnapshot]=useState<Snapshot>({key:''})
 const [retry,setRetry]=useState(0)
 useEffect(()=>client.subscribe({key,kind,brief:JSON.parse(JSON.stringify(brief))},setSnapshot),
 // Only changes to the exact planner input invalidate the result.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 [key,retry])
 const current=client.get(key)??(snapshot.key===key?snapshot.result:undefined)
 const error=snapshot.key===key?snapshot.error:undefined
 return {...current,checking:!current&&!error,error,retry:()=>{client.invalidate(key);setSnapshot({key:''});setRetry(n=>n+1)}}
}
