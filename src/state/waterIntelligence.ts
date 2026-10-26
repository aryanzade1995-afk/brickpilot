import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { parseWaterConfig, type WaterConfig } from '../lib/water/schema.ts'

type State={document:WaterConfig|null;error:string|null;update:(value:unknown)=>boolean;restore:(value:unknown)=>void;clear:()=>void}
let storageError:string|null=null
const storage=createJSONStorage<{document:WaterConfig|null}>(()=>({
  getItem:key=>{try{return globalThis.localStorage?.getItem(key)??null}catch{storageError='Browser storage is unavailable. Water settings are not saved.';return null}},
  setItem:(key,value)=>{try{if(!globalThis.localStorage)throw new Error('Unavailable');globalThis.localStorage.setItem(key,value);storageError=null}catch{storageError='Browser storage is unavailable or full. Water settings remain in memory; free storage and save again.'}},
  removeItem:key=>{try{globalThis.localStorage?.removeItem(key)}catch{/* No destructive retry. */}},
}))
/** Independent downstream configuration: never part of Brief, architecture seed,
 * finishSignature, GLB cache key or the existing indoor water/drainage model. */
export const useWaterIntelligence=create<State>()(persist((set)=>({
  document:null,error:null,
  update:value=>{const document=parseWaterConfig(value);if(!document){set({error:'Water settings are invalid or use an unsupported version.'});return false}set({document,error:null});if(storageError){set({error:storageError});return false}return true},
  restore:value=>set({document:parseWaterConfig(value),error:value!=null&&!parseWaterConfig(value)?'Saved water settings could not be restored. The house is unchanged.':null}),
  clear:()=>set({document:null,error:null}),
}),{name:'formstead.water-intelligence.v1',storage,partialize:s=>({document:s.document}),merge:(saved,current)=>({...current,document:parseWaterConfig((saved as {document?:unknown})?.document)})}))
