import {useEffect,useMemo,useRef,useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {ArrowLeft,ArrowRight,Check,FileImage,RotateCw,UploadCloud} from 'lucide-react'
import {Button} from '@/components/ui/Button.tsx'
import {SpaceValidation} from '@/components/ui/SpaceValidation.tsx'
import {useStudio} from '@/state/studio.ts'
import {validateImageFile,downscaleImageIfNeeded,digitizeWithFallback,rawSurveyToSurvey} from '@/lib/existing/digitizer.ts'
import {newPlanDraft,restorePlanDraft,PLAN_DRAFT_KEY,type PlanDraft,type DrawingFloor,type PlanStep} from '@/lib/existing/planDraft.ts'
import {rotateDrawing90,surveyBackToDrawing} from '@/lib/existing/drawingTransforms.ts'
import {applyIndianConstructionSnapping} from '@/lib/existing/snapping.ts'
import {checkNbcHealth} from '@/lib/existing/nbcPreflight.ts'
import type {Brief} from '@/lib/model/brief.ts'
import type {ExistingStructure} from '@/lib/engine/planner/types.ts'
import {DrawingCanvasReviewer} from './DrawingCanvasReviewer.tsx'
import {InteractiveFitQuestioner} from './InteractiveFitQuestioner.tsx'
import {StyleSelectorCard} from './StyleSelectorCard.tsx'
import {PlanFlowErrorBoundary} from './PlanFlowErrorBoundary.tsx'

const steps: {key:PlanStep;label:string}[]=[{key:'project',label:'Project'},{key:'upload',label:'Drawings'},{key:'review',label:'Review'},{key:'remediation',label:'Site & fit'},{key:'style',label:'Style & finish'}]
const floorName=(level:number)=>level===0?'Ground floor':level===1?'First floor':'Second floor'
const input='mt-1.5 w-full border border-line-strong bg-bg-inset px-3 py-2.5 text-sm text-ink outline-none focus:border-ink'
function readDraft(){try{const value=localStorage.getItem(PLAN_DRAFT_KEY);return value?restorePlanDraft(JSON.parse(value)):newPlanDraft()}catch{return newPlanDraft()}}
async function rotatedImage(url:string){
 return new Promise<string>((resolve,reject)=>{
  const image=new Image();image.onerror=()=>reject(Error('Could not rotate this drawing.'))
  image.onload=()=>{const canvas=document.createElement('canvas');canvas.width=image.height;canvas.height=image.width;const ctx=canvas.getContext('2d');if(!ctx){reject(Error('Could not prepare the image.'));return}ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(Math.PI/2);ctx.drawImage(image,-image.width/2,-image.height/2);resolve(canvas.toDataURL('image/png'))};image.src=url
 })
}

export function StartFromPlanFlow(){
 const [draft,setDraft]=useState<PlanDraft>(readDraft),[busy,setBusy]=useState<'reading'|'validating'|null>(null)
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[storageIssue,setStorageIssue]=useState(false),[confirmed,setConfirmed]=useState(false)
 const [undo,setUndo]=useState<DrawingFloor|null>(null)
 const fileInput=useRef<HTMLInputElement>(null),reader=useRef<AbortController|null>(null),worker=useRef<Worker|null>(null)
 const navigate=useNavigate(),floor=draft.floors[draft.active],index=steps.findIndex(s=>s.key===draft.step)
 const update=(values:Partial<PlanDraft>)=>{setDraft(current=>({...current,...values}));setConfirmed(false);setError('')}
 const updateFloor=(values:Partial<DrawingFloor>,level=draft.active)=>{setDraft(current=>({...current,floors:current.floors.map(f=>f.level===level?{...f,...values}:f)}));setConfirmed(false);setUndo(null);setError('')}
 useEffect(()=>{const timer=setTimeout(()=>{try{localStorage.setItem(PLAN_DRAFT_KEY,JSON.stringify(draft));setStorageIssue(false)}catch{setStorageIssue(true)}},300);return()=>clearTimeout(timer)},[draft])
 useEffect(()=>()=>{reader.current?.abort();worker.current?.terminate()},[])
 const survey=useMemo(()=>{
  if(!floor.raw)return null
  try{const value=rawSurveyToSurvey(floor.raw,floor.scale);return {...value,plotOffsetXM:floor.offsetX,plotOffsetYM:floor.offsetY,heightM:draft.answers.floorHeightM??3,rooms:value.rooms.map(r=>r.type==='stair'?{...r,stairStartSide:floor.stairSide}:r)}}catch{return null}
 },[floor,draft.answers.floorHeightM])
 const health=useMemo(()=>survey?checkNbcHealth(survey,{plotWidthM:draft.answers.plotWidthM,plotDepthM:draft.answers.plotDepthM}):null,[survey,draft.answers.plotWidthM,draft.answers.plotDepthM])
 const complete=draft.floors.slice(0,draft.count).every(f=>f.raw?.elements.rooms.length&&f.calibrated)
 const go=(step:PlanStep)=>{setDraft(current=>({...current,step}));setError('')}
 const upload=async(file:File)=>{
  const valid=validateImageFile(file);if(!valid.valid){setError(valid.error??'Choose an image.');return}
  reader.current?.abort();const controller=new AbortController();reader.current=controller
  const level=draft.active;setBusy('reading');setError('');setNotice('')
  try{
   const image=await downscaleImageIfNeeded(file,2000)
   const result=await digitizeWithFallback(image.blob,undefined,{signal:controller.signal})
   if(controller.signal.aborted)return
   setDraft(current=>({...current,step:'review',active:level,floors:current.floors.map(f=>f.level===level?{...f,imageUrl:image.dataUrl,raw:result.survey,scale:result.survey.scaleMPerPx??.01,calibrated:!!result.survey.scaleMPerPx}:f)}))
   setConfirmed(false)
   setNotice(result.fallbackUsed?'The automatic reader is unavailable. Trace your rooms, walls and openings over the drawing, then calibrate a known dimension.':result.survey.elements.rooms.length?'Review the detected layout and confirm its dimensions before continuing.':'No rooms were detected. You can trace the drawing manually.')
  }catch(reason){if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Could not read the drawing.')}
  finally{if(reader.current===controller)setBusy(null)}
 }
 const rotate=async()=>{if(!floor.imageUrl||!floor.raw)return;try{const url=await rotatedImage(floor.imageUrl);updateFloor({imageUrl:url,raw:rotateDrawing90(floor.raw)})}catch(reason){setError(String(reason))}}
 const snap=()=>{if(!survey||!floor.raw)return;try{const previous=structuredClone(floor),result=applyIndianConstructionSnapping(survey);updateFloor({raw:surveyBackToDrawing(result.snappedSurvey,floor.raw,floor.scale)});setUndo(previous);setNotice(result.diff.summary)}catch(reason){setError(String(reason))}}
 const generate=()=>{
  if(!confirmed||!complete||busy)return
  setBusy('validating');setError('')
  try{
   const job=new Worker(new URL('../../state/planImport.worker.ts',import.meta.url),{type:'module'});worker.current=job
   const timer=setTimeout(()=>{job.terminate();setBusy(null);setError('Drawing validation took too long. Please try again.')},60000)
   job.onmessage=(event:MessageEvent<{ok:boolean;brief:Brief;structure:ExistingStructure;error?:string}>)=>{
    clearTimeout(timer);job.terminate();worker.current=null;setBusy(null)
    if(!event.data.ok){setError(event.data.error??'Review the drawing before continuing.');return}
    useStudio.getState().loadExisting(event.data.brief,event.data.structure,1)
    navigate('/workspace/plan')
   }
   job.onerror=()=>{clearTimeout(timer);job.terminate();worker.current=null;setBusy(null);setError('Drawing validation could not finish. Your draft is saved; please try again.')}
   job.postMessage(JSON.parse(JSON.stringify(draft)))
  }catch{setBusy(null);setError('Could not start drawing validation. Please try again.')}
 }
 const setStepReady=(target:PlanStep)=>{if(target==='project'||target==='upload')return true;if(target==='review')return !!floor.raw;return complete}
 return <div className="plan-import-flow min-w-0 space-y-6 text-left">
  <nav aria-label="Plan import steps" className="flex flex-wrap gap-1 border-b border-line pb-3">
   {steps.map((step,i)=><button key={step.key} type="button" disabled={!!busy||!setStepReady(step.key)} aria-current={step.key===draft.step?'step':undefined} onClick={()=>go(step.key)} className={`inline-flex min-h-10 items-center gap-2 border px-3 py-2 font-mono text-xs disabled:opacity-40 ${i===index?'border-ink bg-bg-inset text-ink':'border-line text-ink-dim'}`}><span>{String(i+1).padStart(2,'0')}</span>{step.label}</button>)}
  </nav>
  <div className="flex flex-wrap items-start justify-between gap-3">
   <div><p className="label">Step {index+1} of {steps.length}</p><h2 className="mt-2 font-display text-2xl">{steps[index].label}</h2></div>
   <button type="button" disabled={!!busy} className="border border-line px-3 py-2 text-xs text-ink-dim" onClick={()=>{if(window.confirm('Start a new drawing draft? Your saved studio project stays available.')){setDraft(newPlanDraft());setNotice('');setError('');setConfirmed(false)}}}>New draft</button>
  </div>
  {storageIssue&&<p role="status" className="border border-line p-3 text-xs text-ink-dim">This drawing draft exceeds browser storage. Keep this page open until it is saved to the studio.</p>}
  {error&&<p role="alert" className="border-l-2 border-ink bg-bg-inset p-4 text-sm leading-relaxed">{error}</p>}
  {notice&&<p role="status" className="max-w-3xl border border-line bg-bg-raised p-3 text-sm leading-relaxed text-ink-dim">{notice}</p>}
  {busy&&<div className="max-w-3xl border border-line bg-bg-raised p-4"><SpaceValidation compact label={busy==='reading'?'Reading your drawing':'Checking your drawings'}/><p className="mt-2 text-xs text-ink-faint">{busy==='reading'?'Reading the uploaded drawing. You can cancel and trace it manually.':'Checking every floor, opening and connection before opening the studio.'}</p>{busy==='reading'&&<button type="button" className="mt-3 border border-line px-3 py-2 text-xs" onClick={()=>reader.current?.abort()}>Cancel reading</button>}</div>}
  {draft.step==='project'&&<div className="max-w-3xl space-y-6">
   <div className="grid gap-6 border border-line bg-bg-raised p-5 sm:grid-cols-2">
    <label className="sm:col-span-2"><span className="label">Project name</span><input className={input} value={draft.name} maxLength={100} onChange={e=>update({name:e.target.value})}/></label>
    <div className="sm:col-span-2"><p className="label">Floors in your drawings</p><div className="mt-2 grid gap-2 sm:grid-cols-3">{[1,2,3].map(count=><button type="button" key={count} aria-pressed={draft.count===count} onClick={()=>update({count,active:Math.min(draft.active,count-1),answers:{...draft.answers,storeysBuilt:count,storeysWanted:count}})} className={`flex items-start justify-between gap-2 border p-4 text-left ${draft.count===count?'border-ink bg-bg-inset':'border-line'}`}><span><span className="block text-sm">{count===1?'Ground only':`Ground + ${count-1}`}</span><span className="mt-1 block text-xs text-ink-faint">{count} separate drawing{count>1?'s':''}</span></span>{draft.count===count&&<Check size={14} className="shrink-0"/>}</button>)}</div></div>
    <label><span className="label">Building type</span><select className={input} value={draft.buildingType} onChange={e=>update({buildingType:e.target.value as PlanDraft['buildingType']})}><option value="villa">Family villa</option><option value="large-villa">Large villa</option></select></label>
    <label><span className="label">Floor-to-floor height (m)</span><input type="number" className={input} min={2.7} max={4} step={.1} value={draft.answers.floorHeightM??3} onChange={e=>{const value=Number(e.target.value);if(value>=2.7&&value<=4)update({answers:{...draft.answers,floorHeightM:value}})}}/><span className="mt-1 block text-xs text-ink-faint">3 m is an editable assumption until confirmed.</span></label>
   </div>
   <Button onClick={()=>go('upload')}>Continue to drawings<ArrowRight size={14}/></Button>
  </div>}
  {draft.step!=='project'&&draft.step!=='style'&&<div role="tablist" aria-label="Drawing floor" className="flex flex-wrap gap-2">{draft.floors.slice(0,draft.count).map(f=><button key={f.level} role="tab" type="button" disabled={!!busy} aria-selected={f.level===draft.active} onClick={()=>{update({active:f.level});setUndo(null)}} className={`inline-flex min-h-10 items-center gap-2 border px-3 py-2 text-xs ${f.level===draft.active?'border-ink bg-bg-inset':'border-line text-ink-dim'}`}>{floorName(f.level)}{f.raw&&<Check size={12}/>}</button>)}</div>}
  {draft.step==='upload'&&<div className="max-w-3xl space-y-5">
   <p className="max-w-xl text-sm leading-relaxed text-ink-dim">Upload a PNG, JPEG or WebP drawing, up to 10 MB. Each floor keeps its own drawing, scale and position.</p>
   <button type="button" disabled={!!busy} onClick={()=>fileInput.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy&&e.dataTransfer.files[0])void upload(e.dataTransfer.files[0])}} className="flex w-full flex-col items-start gap-3 border border-dashed border-line-strong bg-bg-inset p-6 text-left hover:border-ink disabled:opacity-50"><UploadCloud size={24}/><span className="font-display text-xl">Choose {floorName(draft.active).toLowerCase()} drawing</span><span className="text-xs text-ink-dim">Drop an image here or browse files</span></button>
   {floor.imageUrl&&<img src={floor.imageUrl} alt={`${floorName(draft.active)} source drawing`} className="max-h-64 max-w-full border border-line object-contain"/>}
   {floor.raw&&<Button onClick={()=>go('review')}>Review drawing<ArrowRight size={14}/></Button>}
   <a href="/sample-plans/sample-2d-villa-plan.png" download className="inline-flex items-center gap-2 text-xs text-ink-dim underline"><FileImage size={14}/>Download sample drawing</a>
  </div>}
  <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file);e.target.value=''}}/>
  {draft.step==='review'&&<div className="space-y-5">
   {!floor.raw||!floor.imageUrl?<div className="max-w-3xl border border-line p-5"><p className="text-sm text-ink-dim">Upload the drawing for {floorName(draft.active).toLowerCase()}.</p><Button className="mt-4" onClick={()=>go('upload')}>Upload drawing</Button></div>:<>
    <div className="flex flex-wrap gap-2"><Button variant="ghost" size="sm" onClick={()=>go('upload')}>Replace drawing</Button><Button variant="ghost" size="sm" onClick={()=>void rotate()}><RotateCw size={13}/>Rotate drawing</Button><Button variant="ghost" size="sm" onClick={snap}>Preview masonry snapping</Button>{undo&&<Button variant="ghost" size="sm" onClick={()=>{updateFloor(undo);setUndo(null)}}>Undo snapping</Button>}</div>
    <PlanFlowErrorBoundary stepName="Drawing review"><DrawingCanvasReviewer key={`${draft.active}:${floor.imageUrl.slice(-30)}`} imageUrl={floor.imageUrl} rawSurvey={floor.raw} scaleMPerPx={floor.scale} onChangeSurvey={raw=>updateFloor({raw})} onChangeScale={scale=>updateFloor({scale,calibrated:true})} plotWidthM={draft.answers.plotWidthM} plotDepthM={draft.answers.plotDepthM}/></PlanFlowErrorBoundary>
    <div className="grid max-w-3xl gap-4 border border-line bg-bg-raised p-5 sm:grid-cols-3">
     <label><span className="label">Drawing origin · left (m)</span><input type="number" min={0} max={80} step={.1} className={input} value={floor.offsetX} onChange={e=>{const n=Number(e.target.value);if(n>=0&&n<=80)updateFloor({offsetX:n})}}/></label>
     <label><span className="label">Drawing origin · rear (m)</span><input type="number" min={0} max={80} step={.1} className={input} value={floor.offsetY} onChange={e=>{const n=Number(e.target.value);if(n>=0&&n<=80)updateFloor({offsetY:n})}}/></label>
     <label><span className="label">Stair starting side</span><select className={input} value={floor.stairSide} onChange={e=>updateFloor({stairSide:e.target.value as DrawingFloor['stairSide']})}>{(['N','E','S','W'] as const).map(s=><option key={s} value={s}>{s}</option>)}</select></label>
     <label className="flex items-start gap-3 text-sm sm:col-span-3"><input type="checkbox" checked={floor.calibrated} onChange={e=>updateFloor({calibrated:e.target.checked})} className="mt-1"/><span>I checked the drawing scale: {floor.scale.toFixed(5)} m per pixel. Use the two-point calibration tool to correct it.</span></label>
    </div>
    <div className="flex flex-wrap items-center gap-3"><Button disabled={!complete} onClick={()=>go('remediation')}>Continue to site & fit<ArrowRight size={14}/></Button>{!complete&&<p className="text-xs text-ink-dim">Review and calibrate each selected floor to continue.</p>}</div>
   </>}
  </div>}
  {draft.step==='remediation'&&floor.raw&&<div className="space-y-5">
   <PlanFlowErrorBoundary stepName="Site and fit"><InteractiveFitQuestioner rawSurvey={floor.raw} activeSurvey={survey} scaleMPerPx={floor.scale} plotWidthM={draft.answers.plotWidthM} plotDepthM={draft.answers.plotDepthM} roadSide={draft.answers.roadSide} nbcReport={health} snappedDiff={null} onUpdateSurvey={raw=>updateFloor({raw})} onUpdateScale={scale=>updateFloor({scale,calibrated:true})} onUpdatePlot={plot=>update({answers:{...draft.answers,...plot}})} onUpdateRoadSide={roadSide=>update({answers:{...draft.answers,roadSide}})} onApplySnapping={snap} onUndoSnapping={()=>{if(undo)updateFloor(undo)}}/></PlanFlowErrorBoundary>
   <p className="max-w-3xl text-xs leading-relaxed text-ink-faint">These are preliminary design checks. Local rules, structural sizing and construction details require professional verification.</p>
   <Button disabled={!complete} onClick={()=>go('style')}>Choose house style<ArrowRight size={14}/></Button>
  </div>}
  {draft.step==='style'&&<div className="space-y-6">
   <StyleSelectorCard buildingType={draft.buildingType} character={draft.character} plinthHeight={draft.plinth} onChangeBuildingType={buildingType=>update({buildingType})} onChangeCharacter={character=>update({character})} onChangePlinthHeight={plinth=>update({plinth})}/>
   <label className="flex max-w-3xl items-start gap-3 border border-line bg-bg-raised p-4 text-sm leading-relaxed"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} className="mt-1 shrink-0"/><span>I checked every floor's layout, scale, plot position and stairs. I confirm the displayed plot dimensions and the assumed wall, opening and floor heights for this concept.</span></label>
   <Button onClick={generate} disabled={!confirmed||!complete||!!busy}>{busy==='validating'?'Checking drawings…':'Open this plan in the studio'}<ArrowRight size={14}/></Button>
  </div>}
  {index>0&&<button type="button" disabled={!!busy} onClick={()=>go(steps[index-1].key)} className="inline-flex items-center gap-2 border-t border-line pt-5 text-xs text-ink-dim"><ArrowLeft size={13}/>Back to {steps[index-1].label.toLowerCase()}</button>}
 </div>
}
