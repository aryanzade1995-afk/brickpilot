/// <reference lib="webworker" />
import {assessBriefFit,assessShape,fitSuggestions,applyBriefChoice,SHAPE_CHOICES} from '@/lib/engine/planner/fit.ts'
import type {BriefValidation,ValidationRequest,ValidationMessage} from './briefValidationTypes.ts'

let activeKey=''
const send=(message:ValidationMessage)=>self.postMessage(message)
self.onmessage=(event:MessageEvent<ValidationRequest>)=>{
 const {key,kind,brief}=event.data
 activeKey=key
 try{
  if(kind==='shapes'){
   send({key,complete:true,result:{shapes:Object.fromEntries(SHAPE_CHOICES.map(shape=>[shape,assessShape(brief,shape)])) as NonNullable<BriefValidation['shapes']>}})
   return
  }
  const fit=assessBriefFit(brief)
  send({key,complete:fit.fits,result:{fit,source:brief,suggestions:[],suggestionsChecking:!fit.fits}})
  // Publish the authoritative result before optional repair searches. Yield so
  // the UI can paint and a superseding edit can cancel this work.
  if(!fit.fits)setTimeout(()=>{
   if(activeKey!==key)return
   try{
    const help=fitSuggestions(brief)
    send({key,complete:true,result:{fit,source:brief,suggestionsChecking:false,
     suggestions:[...help.single,...(help.combined?[help.combined]:[])].map(s=>({id:s.id,label:s.label,detail:s.detail,brief:applyBriefChoice(brief,s.recipe)}))}})
   }catch{send({key,complete:true,result:{fit,source:brief,suggestions:[],suggestionsChecking:false,suggestionsError:'Suggestions are unavailable. You can still edit the brief.'}})}
  },0)
 }catch(error){send({key,complete:true,error:error instanceof Error?error.message:'Space validation failed.'})}
}
