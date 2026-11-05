/// <reference lib="webworker" />
import {prepareDrawingImport} from '@/lib/existing/prepareDrawingImport.ts'
import type {PlanDraft} from '@/lib/existing/planDraft.ts'
self.onmessage=(event:MessageEvent<PlanDraft>)=>{try{const {brief,structure}=prepareDrawingImport(event.data);self.postMessage({ok:true,brief,structure})}catch(error){self.postMessage({ok:false,error:error instanceof Error?error.message:'The drawing could not be validated.'})}}
