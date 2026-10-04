import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Sparkles } from 'lucide-react'
import { useStudio } from '@/state/studio.ts'
import { useBlender } from '@/state/blender.ts'
import { useVillaVisualizations } from '@/state/villaVisualizations.ts'
import { WorkspaceTabs } from '@/components/WorkspaceTabs.tsx'
import { InteriorStudio } from '@/components/InteriorStudio.tsx'
import { InvalidPlanNotice } from '@/components/InvalidPlanNotice.tsx'
import { createBuildingModel } from '@/lib/engine/buildingModel.ts'
import { finishSignature } from '@/lib/cost/finishAssignments.ts'
import { emergencyPlan } from '@/lib/engine/safety.ts'
import { VillaVisualizationViewport, type VillaViewportHandle } from '@/lib/render/VillaVisualizationViewport.tsx'
import { readVisualizationPair, visualizationSourceId, VILLA_VIEW_LABELS } from '@/lib/render/villaVisualizations.ts'
import { cx } from '@/lib/cx.ts'

type Tab='blender'|'study'|'interior'
export function Render() {
  const result=useStudio(s=>s.result),brief=useStudio(s=>s.brief),run=useStudio(s=>s.run)
  const plan=useMemo(()=>result?{...result.design,model:{...result.design.model,brief}}:null,[result,brief])
  const planId=useMemo(()=>plan?createBuildingModel(plan).planId:'',[plan])
  const blender=useBlender(s=>s.accepted[planId]),ensure=useBlender(s=>s.ensureForPlan),resume=useBlender(s=>s.resume)
  const job=useBlender(s=>s.sourcePlanId===planId?s.job:null)
  const [tab,setTab]=useState<Tab>('blender'),[ready,setReady]=useState(false)
  const [storedPhase,storePhase]=useState<{sourceId:string;value:'idle'|'capture'|'generate'}|null>(null)
  const [storedMessage,storeMessage]=useState<{sourceId:string;text:string|null}|null>(null)
  const viewport=useRef<VillaViewportHandle>(null),request=useRef<AbortController|null>(null)
  const source=tab==='study'?'study':'blender',seed=source==='blender'?blender?.seed??0:plan?.planSeed??plan?.dna.seed??0
  const sourceId=visualizationSourceId(planId,source,seed,source==='blender'?blender?.files.glb??'':'',finishSignature(brief))
  const phase=storedPhase?.sourceId===sourceId?storedPhase.value:'idle',message=storedMessage?.sourceId===sourceId?storedMessage.text:null
  const setPhase=(value:'idle'|'capture'|'generate')=>storePhase({sourceId,value})
  const setMessage=(text:string|null)=>storeMessage({sourceId,text})
  const pair=useVillaVisualizations(s=>s.pairs[sourceId]),save=useVillaVisualizations(s=>s.save)
  const readyChanged=useCallback((value:boolean)=>setReady(value),[])
  const busy=phase!=='idle'
  useEffect(()=>{if(!result)run()},[result,run])
  useEffect(()=>{void resume()},[resume])
  useEffect(()=>()=>{request.current?.abort();request.current=null},[sourceId])
  const generate=async()=>{
    if(!viewport.current||!ready||!plan||busy)return
    const controller=new AbortController();request.current=controller;setMessage(null);setPhase('capture')
    try {
      const views=await viewport.current.capture();controller.signal.throwIfAborted();setPhase('generate')
      const response=await fetch('/api/villa-visualizations',{method:'POST',headers:{'content-type':'application/json'},
        signal:AbortSignal.any([controller.signal,AbortSignal.timeout(175000)]),
        body:JSON.stringify({sourceId,source,seed,views,facts:`${plan.floors.length} occupied floors. Keep the supplied ${source==='blender'?'accepted Blender villa':'study model'} unchanged. ${plan.openingCounts.windows} planned windows, ${plan.openingCounts.doors} planned doors. Keep both views consistent.`})})
      const data=await response.json();controller.signal.throwIfAborted()
      if(!response.ok)throw new Error('Visualizations are unavailable right now. Your 3D model is ready.')
      save(readVisualizationPair(data,sourceId))
    } catch(error) {
      if(!controller.signal.aborted){console.warn('[villa-visualizations] Request did not complete:',error instanceof Error?error.message:'Unknown error');setMessage('Visualizations are unavailable right now. Your 3D model is ready.')}
    }
    finally {if(request.current===controller){setPhase('idle');request.current=null}}
  }
  if(!result||!plan)return <div className="mx-auto max-w-[1400px] px-10 py-24 text-ink-dim">Preparing model…</div>
  if(!result.report.hardChecksPass)return <InvalidPlanNotice report={result.report}/>
  const blenderBusy=job&&!['complete','failed'].includes(job.status)
  const hasModel=source==='study'||Boolean(blender)
  return <div className="mx-auto max-w-[1400px] px-6 py-8 md:px-10">
    <WorkspaceTabs/>
    <div className="mt-8"><p className="label">Step 05 · Render</p><h1 className="mt-3 font-display text-3xl md:text-4xl">Visualise your villa</h1>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-dim">Compare your completed 3D model with two realistic exterior views. Your rooms, openings and building geometry remain the reference.</p></div>
    <div role="tablist" aria-label="Visualization model" className="mt-7 flex gap-1 overflow-x-auto border-b border-line">
      {([['blender','Blender Villa'],['study','Study Model'],['interior','AI Interior']] as const).map(([key,label])=><button key={key} type="button" role="tab" aria-selected={tab===key} disabled={busy}
        onClick={()=>{if(tab!==key){setReady(false);setTab(key)}}} className={cx('shrink-0 border-b-2 px-5 py-3 font-mono text-xs uppercase tracking-wider disabled:opacity-50',tab===key?'border-ink text-ink':'border-transparent text-ink-dim')}>{label}</button>)}
    </div>
    {tab==='interior'?<InteriorStudio design={plan} character={brief.style.character}/>:<section role="tabpanel" className="mt-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3"><h2 className="font-display text-2xl">{source==='blender'?'Your Blender villa':'Your architectural study model'}</h2>
        <span className="text-xs text-ink-dim">Same 2D plan · {plan.floors.length} floors · {plan.builtAreaSqm.toFixed(0)} m²</span></div>
      {hasModel?<VillaVisualizationViewport key={sourceId} ref={viewport} design={plan} url={source==='blender'?blender?.files.glb:undefined} onReady={readyChanged}/>:
        <div className="flex min-h-80 flex-col items-center justify-center gap-4 border border-line bg-bg-inset p-8 text-center">
          <p className="max-w-lg text-sm text-ink-dim">{blenderBusy?'Preparing the Blender villa for your current plan…':'Prepare the Blender villa for this plan to visualize its actual architecture.'}</p>
          <button type="button" disabled={Boolean(blenderBusy)} onClick={()=>void ensure(plan,result.villaDesignDNA?.seed??plan.dna.seed)} className="border border-line-strong px-5 py-3 text-sm disabled:opacity-50">{blenderBusy?'Preparing…':'Prepare Blender villa'}</button>
          <Link to="/workspace/massing" className="text-sm underline underline-offset-4">Open 3D Massing</Link>
        </div>}
      <p className="mt-2 text-xs text-ink-faint">Visualisation · Drag to orbit. Two fixed cameras capture the front-left and rear-right sides of this exact model.</p>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
        <div><h3 className="font-display text-xl">AI villa visualization</h3><p className="mt-1 text-xs text-ink-dim">Two views of the same villa, with matching colours and material placement.</p></div>
        <button type="button" disabled={!hasModel||!ready||busy} onClick={()=>void generate()} className="flex items-center gap-2 bg-ink px-5 py-3 text-sm text-bg disabled:opacity-40"><Sparkles size={16}/>{phase==='capture'?'Preparing views…':phase==='generate'?'Creating visualizations…':'Generate AI Visualization'}</button>
      </div>
      {message&&<p role="status" className="mt-4 text-sm text-ink-dim">{message}</p>}
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        {(Object.keys(VILLA_VIEW_LABELS) as (keyof typeof VILLA_VIEW_LABELS)[]).map(view=>{
          const image=pair?.images.find(i=>i.view===view)
          return <figure key={view}><div className="flex aspect-[4/3] items-center justify-center overflow-hidden border border-line bg-bg-inset">
            {image?<a href={image.url} target="_blank" rel="noreferrer" className="block h-full w-full"><img src={image.url} alt={`${VILLA_VIEW_LABELS[view]} of the ${source==='blender'?'Blender villa':'study model'}`} className="h-full w-full object-contain"/></a>:<p className="px-6 text-center text-sm text-ink-faint">{busy?'Creating this view…':`${VILLA_VIEW_LABELS[view]} will appear here.`}</p>}
          </div><figcaption className="mt-3 flex items-center justify-between gap-2 text-sm"><span>{VILLA_VIEW_LABELS[view]}</span>{image&&<a href={image.url} download={`${source}_${seed}_${view}.png`} className="flex items-center gap-1 text-xs underline"><Download size={13}/>Download</a>}</figcaption></figure>
        })}
      </div>
      <p className="mt-3 text-xs text-ink-faint">AI Visualisation · Compare generated images against the authoritative model before presenting architectural details.</p>
      <details className="mt-6 text-xs text-ink-dim"><summary>Emergency escape layout</summary><div className="mt-3 space-y-2">{emergencyPlan(plan).notes.map(n=><p key={n}>{n}</p>)}<p>{emergencyPlan(plan).disclaimer}</p></div></details>
    </section>}
    <div className="mt-10 flex justify-between border-t border-line pt-5 text-sm"><Link to="/workspace/massing" className="underline underline-offset-4">Back to 3D Massing</Link><Link to="/workspace/finishes" className="underline underline-offset-4">Next: finishes & cost →</Link></div>
  </div>
}
