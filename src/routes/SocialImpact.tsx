import {useEffect,useMemo,useRef,useState} from 'react'
import {Link,useSearchParams} from 'react-router-dom'
import {Download,Upload} from 'lucide-react'
import {WorkspaceTabs} from '@/components/WorkspaceTabs.tsx'
import {useStudio} from '@/state/studio.ts'
import {useProjects,noteChange} from '@/state/projects.ts'
import {useFinishes} from '@/state/finishes.ts'
import {useSocialImpact} from '@/state/socialImpact.ts'
import {estimateProjectBoq,type CostEstimate} from '@/lib/cost/index.ts'
import {geometryCostKey} from '@/lib/cost/quantities.ts'
import {emptyImpact,parseImpact,type ImpactDocument} from '@/lib/impact/schema.ts'
import {analyzeImpact,IMPACT_SOURCES} from '@/lib/impact/analysis.ts'
import {translate as t,useLanguage} from '@/lib/i18n/index.ts'
import type {Brief} from '@/lib/model/brief.ts'
import {ProjectImpactViews,type ImpactData} from '@/components/impact/ProjectImpactViews.tsx'
import {IMPACT_VIEWS,type ImpactView,button} from '@/components/impact/presentation.ts'
import {ImpactVisuals} from '@/components/impact/ImpactVisuals.tsx'
import {ImpactSources} from '@/components/impact/ImpactSources.tsx'
import {Card,Action} from '@/components/impact/ImpactPrimitives.tsx'

export function SocialImpact(){
 useLanguage(s=>s.language)
 const result=useStudio(s=>s.result),brief=useStudio(s=>s.brief),run=useStudio(s=>s.run)
 const projectId=useProjects(s=>s.currentId),saved=useFinishes(s=>s.entries[result?geometryCostKey(result.design):''])
 useEffect(()=>{if(!result)run()},[result,run])
 const prepared=useMemo(()=>{
  if(!result?.report.hardChecksPass)return null
  try{return {cost:estimateProjectBoq(result.design,brief,saved,result),error:null}}catch{return {cost:null,error:'The current estimate needs review. Open Finishes & Cost before comparing impact.'}}
 },[result,brief,saved])
 return <div className="social-impact mx-auto max-w-[1400px] px-4 py-6 md:px-8">
  <WorkspaceTabs/>
  <header className="mt-5 mb-4"><p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">{brief.project.name}</p><h1 className="mt-2 font-display text-2xl">{t('Social Impact')}</h1><p className="mt-2 max-w-2xl text-sm text-ink-dim">{t('Practical improvements for your home, your budget and your community.')}</p></header>
  {!result?<p role="status" className="p-6 text-sm text-ink-dim">{t('Preparing your project…')}</p>:!result.report.hardChecksPass?<Card title="Review your plan first"><p>{t('Resolve the plan issues before calculating building impact.')}</p><Action to="/workspace/plan">Review 2D plan</Action></Card>:!prepared?.cost?<Card title="Review your estimate"><p>{t(prepared?.error??'Preparing your project…')}</p><Action to="/workspace/finishes">Open Finishes & Cost</Action></Card>:<ImpactWorkspace key={projectId??'draft'} result={result} brief={brief} cost={prepared.cost}/>}
 </div>
}
function ImpactWorkspace({result,brief,cost}:{result:NonNullable<ReturnType<typeof useStudio.getState>['result']>;brief:Brief;cost:CostEstimate}){
 const document=useSocialImpact(s=>s.document),error=useSocialImpact(s=>s.error),update=useSocialImpact(s=>s.update)
 const doc=useMemo(()=>document??emptyImpact(),[document])
 const [params,setParams]=useSearchParams(),fileInput=useRef<HTMLInputElement>(null),[importError,setImportError]=useState('')
 const legacy:Record<string,ImpactView>={dashboard:'overview',access:'accessibility',safety:'accessibility',assistant:'overview',sustainability:'affordability',intelligence:'all',pilots:'community',essentials:'overview'}
 const requested=params.get('tab')??params.get('section')??'overview'
 const view:ImpactView=requested==='guidance'?'overview':IMPACT_VIEWS.some(v=>v.id===requested)?requested as ImpactView:legacy[requested]??'overview'
 const navigate=(id:ImpactView)=>setParams(p=>{p.delete('section');p.set('tab',id);return p})
 const analyzed=useMemo(()=>{try{return {data:analyzeImpact(result.design,brief,cost,result.report,doc),error:null}}catch{return {data:null,error:'Some source geometry needs review. Your home and saved inputs are unchanged.'}}},[result,brief,cost,doc])
 const save=(next:ImpactDocument)=>{if(update(next))noteChange('Social Impact inputs')}
 const handleImport=async(file:File|undefined)=>{
  if(!file)return
  try{
   const json=JSON.parse(await file.text())
   const restored=(json.format==='brickpilot-social-impact'||json.format==='formstead-social-impact')?parseImpact(json.inputs??json.document):null
   if(!restored)throw Error('Invalid impact record')
   if(update(restored)){noteChange('Imported Social Impact inputs');setImportError('')}
  }catch{setImportError('This file could not be restored. Choose a valid Social Impact JSON record.')}
  if(fileInput.current)fileInput.current.value=''
 }
 if(!analyzed.data)return <p role="status" className="text-sm text-ink-dim">{t(analyzed.error!)}</p>
 const data=analyzed.data
 return <>
  <nav className="mb-4 flex flex-wrap gap-2" aria-label={t('Social Impact views')}>{IMPACT_VIEWS.filter(v=>v.id!=='community'&&v.id!=='guidance').map(v=><button key={v.id} type="button" aria-pressed={view===v.id} aria-controls="impact-view" className={`${button} ${view===v.id?'bg-ink text-bg hover:bg-ink/90':'text-ink-dim'}`} onClick={()=>navigate(v.id)}>{t(v.label)}</button>)}</nav>
  {(error||importError)&&<p role="alert" className="mb-4 rounded border border-line p-4 text-sm">{t(importError||error!)}</p>}
  <section id="impact-view" aria-label={t(IMPACT_VIEWS.find(v=>v.id===view)!.label)} className="min-w-0 space-y-4">
   <h2 className="font-display text-xl">{t(IMPACT_VIEWS.find(v=>v.id===view)!.label)}</h2>
   {view==='standards'?<ImpactSources doc={doc} cost={cost} data={data}/>:<ProjectImpactViews view={view} data={data} brief={brief} cost={cost} doc={doc} save={save} navigate={navigate} visuals={<ImpactVisuals view={view} design={result.design} brief={brief} cost={cost} doc={doc}/>}/>}
   {view==='all'&&<Card title="Save your impact record"><p>{t('Includes project inputs, calculated scenarios and recorded outcomes.')}</p><div className="flex flex-wrap gap-3"><button className={button} onClick={()=>downloadImpact(doc,data,cost,brief.project.name)}><Download size={14} aria-hidden/>{t('Download impact record')}</button><button className={button} onClick={()=>fileInput.current?.click()}><Upload size={14} aria-hidden/>{t('Import impact record')}</button><input ref={fileInput} type="file" accept=".json,application/json" className="hidden" onChange={e=>void handleImport(e.target.files?.[0])}/></div></Card>}
  </section>
  <nav className="mt-6 flex flex-wrap justify-between gap-4 border-t border-line pt-4 text-sm" aria-label={t('Next steps')}><Link className="underline underline-offset-4" to="/workspace/finishes">{t('Finishes & Cost')}</Link><Link className="underline underline-offset-4" to="/workspace/report">{t('Project report')} →</Link></nav>
 </>
}
function downloadImpact(doc:ImpactDocument,data:ImpactData,cost:CostEstimate,name:string){
 const record={format:'brickpilot-social-impact',version:2,project:name,exportedAt:new Date().toISOString(),geometryKey:cost.quantities.geometryKey,inputs:doc,calculated:{conceptEstimate:cost.expected,costRange:cost.total,water:data.water,partialCarbon:data.carbon,annualEnergyScenarioDifference:data.annualEnergyDifference},userReportedOutcomes:data.pilots,review:data.checks,qualifications:['Concept calculations are not certified engineering results.','User-reported outcomes are not independently verified.'],sources:IMPACT_SOURCES}
 const url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='formstead-social-impact.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
