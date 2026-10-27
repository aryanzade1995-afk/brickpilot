import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { parseImpact, type ImpactDocument } from '../lib/impact/schema.ts'

/** Project snapshots own persistence and restore. This companion document never
 * participates in Brief, seed, architectural caches or finish/cost quantities. */
type State={document:ImpactDocument|null;error:string|null;update:(value:unknown)=>boolean;restore:(value:unknown)=>void;clear:()=>void}
let storageError:string|null=null
const storage=createJSONStorage<{document:ImpactDocument|null}>(()=>({
  getItem:key=>{try{return globalThis.localStorage?.getItem(key)??null}catch{return null}},
  setItem:(key,value)=>{try{if(!globalThis.localStorage)throw new Error('Unavailable');globalThis.localStorage.setItem(key,value);storageError=null}catch{storageError='Device storage is unavailable. Impact inputs remain in memory; download a copy.'}},
  removeItem:key=>{try{globalThis.localStorage?.removeItem(key)}catch{/* Retain in-memory state. */}},
}))
export const useSocialImpact=create<State>()(persist(set=>({
  document:null,error:null,
  update:value=>{const document=parseImpact(value);if(!document){set({error:'Check the entered values before saving.'});return false}set({document,error:null});if(storageError){set({error:storageError});return false}return true},
  restore:value=>set({document:parseImpact(value),error:value!=null&&!parseImpact(value)?'Saved impact inputs could not be restored. The house is unchanged.':null}),
  clear:()=>set({document:null,error:null}),
}),{name:'formstead.social-impact.v1',storage,partialize:s=>({document:s.document}),merge:(saved,current)=>({...current,document:parseImpact((saved as {document?:unknown})?.document)})}))
