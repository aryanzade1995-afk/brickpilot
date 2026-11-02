import {useState} from 'react'
import {Check} from 'lucide-react'
import type {ImpactDocument} from '@/lib/impact/schema.ts'
import type {CostEstimate} from '@/lib/cost/index.ts'
import {translate as t} from '@/lib/i18n/index.ts'
import {Card} from './ImpactPrimitives.tsx'
import {button,field,number} from './presentation.ts'

export function CarbonEditor({doc,cost,save}:{doc:ImpactDocument;cost:CostEstimate;save:(v:ImpactDocument)=>void}){
  const [lineId,setLine]=useState(cost.boq[0]?.id??''),[low,setLow]=useState(''),[high,setHigh]=useState(''),[source,setSource]=useState(''),[boundary,setBoundary]=useState(''),[error,setError]=useState('')
  const line=cost.boq.find(l=>l.id===lineId)
  return <Card title="Evidence-based carbon ledger"><p>{t('Add a documented kgCO₂e factor per estimate unit. No generic factors are assumed. Totals cover only matching, current entries; do not combine overlapping life-cycle boundaries.')}</p><form className="mt-4 space-y-4" onSubmit={e=>{e.preventDefault();if(!line||low===''||high===''||Number(high)<Number(low)){setError('Enter a valid factor range.');return}save({...doc,carbon:[...doc.carbon.filter(r=>r.lineId!==lineId),{lineId,specId:line.specId,unit:line.unit,low:Number(low),high:Number(high),source,boundary,geometryKey:cost.quantities.geometryKey}]});setError('')}}>
    <label className="block text-xs">{t('Estimate line')}<select value={lineId} onChange={e=>setLine(e.target.value)} className={`${field} mt-2`}>{cost.boq.map(l=><option key={l.id} value={l.id}>{l.label} · {number(l.quantity)} {l.unit}</option>)}</select></label>
    <div className="grid gap-4 sm:grid-cols-2"><label className="text-xs">{t('Low factor')} (kgCO₂e/{line?.unit})<input className={`${field} mt-2`} type="number" min="0" max="1000000000" step="any" required value={low} onChange={e=>setLow(e.target.value)}/></label><label className="text-xs">{t('High factor')} (kgCO₂e/{line?.unit})<input className={`${field} mt-2`} type="number" min="0" max="1000000000" step="any" required value={high} onChange={e=>setHigh(e.target.value)}/></label></div>
    <label className="block text-xs">{t('EPD or factor source')}<input className={`${field} mt-2`} required maxLength={1000} value={source} onChange={e=>setSource(e.target.value)}/></label><label className="block text-xs">{t('Life-cycle boundary and inclusions')}<input className={`${field} mt-2`} required maxLength={1000} placeholder="e.g. A1–A3, product only" value={boundary} onChange={e=>setBoundary(e.target.value)}/></label>
    {error&&<p role="alert">{t(error)}</p>}<button className={button} type="submit"><Check size={13}/>{t('Save factor')}</button>
  </form><ul className="mt-4 space-y-3">{doc.carbon.map(r=><li key={r.lineId} className="border-t border-line pt-3"><p>{cost.boq.find(l=>l.id===r.lineId)?.label??r.lineId}</p><p className="text-xs">{r.low}–{r.high} kgCO₂e/{r.unit} · {r.boundary} · {r.source}</p>{(r.geometryKey!==cost.quantities.geometryKey||!cost.boq.some(l=>l.id===r.lineId&&l.specId===r.specId&&l.unit===r.unit))&&<p>{t('Plan or product changed: review this factor.')}</p>}<button className={`${button} mt-2`} onClick={()=>save({...doc,carbon:doc.carbon.filter(x=>x.lineId!==r.lineId)})}>{t('Remove factor')}</button></li>)}</ul></Card>
}

export function PilotEditor({doc,save}:{doc:ImpactDocument;save:(v:ImpactDocument)=>void}){
  const [error,setError]=useState('')
  return <><Card title="Measure real outcomes"><p>{t('Use an anonymous household code, never a name or contact detail. Repeat codes are counted once using the latest dated record. Evidence notes are user-reported, not independently verified.')}</p><form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={e=>{
    e.preventDefault();const form=e.currentTarget,f=new FormData(form),num=(key:string)=>{const v=String(f.get(key)??'');return v===''?null:Number(v)},stage=f.get('stage') as 'planned'|'supported',evidence=String(f.get('evidence')??'').trim()
    if(stage==='supported'&&!evidence){setError('Add an evidence note for supported households.');return}
    save({...doc,pilots:[...doc.pilots,{id:crypto.randomUUID(),householdCode:String(f.get('code')).trim(),date:String(f.get('date')),stage,evidence,baselineCostInr:num('baseline'),actualCostInr:num('actual'),sameScope:f.get('scope')==='on',measuredWaterL:num('water'),resilienceNote:String(f.get('resilience')??'')}]});form.reset();setError('')
  }}>
    <label className="text-xs">{t('Anonymous household code')}<input className={`${field} mt-2`} name="code" required maxLength={80}/></label><label className="text-xs">{t('Observation date')}<input className={`${field} mt-2`} name="date" required type="date"/></label><label className="text-xs">{t('Outcome status')}<select className={`${field} mt-2`} name="stage"><option value="planned">{t('Planned')}</option><option value="supported">{t('Supported')}</option></select></label><label className="text-xs">{t('Evidence / source note')}<input className={`${field} mt-2`} name="evidence" maxLength={1000}/></label>
    {([['baseline','Comparable baseline cost (INR)'],['actual','Actual construction cost (INR)'],['water','Measured harvested water (L)']] as const).map(([name,label])=><label key={name} className="text-xs">{t(label)}<input className={`${field} mt-2`} name={name} type="number" min="0" max="1000000000000" step="any"/></label>)}
    <label className="text-xs">{t('Measured resilience observations')}<input className={`${field} mt-2`} name="resilience" maxLength={1000}/></label><label className="flex min-h-11 items-center gap-3 text-xs sm:col-span-2"><input name="scope" type="checkbox"/>{t('Baseline and actual costs have the same scope and price basis.')}</label>
    {error&&<p role="alert">{t(error)}</p>}<button className={`${button} justify-self-start`} type="submit">{t('Add outcome')}</button>
  </form></Card><Card title="Pilot records">{!doc.pilots.length?<p>{t('No pilot outcomes recorded yet.')}</p>:<ul className="space-y-4">{doc.pilots.map(r=><li key={r.id} className="border-b border-line pb-3"><p className="text-ink">{r.householdCode} · {r.date} · {t(r.stage==='supported'?'Supported':'Planned')}</p><p className="mt-1 text-xs">{r.evidence||t('No evidence recorded')}</p><button className={`${button} mt-2`} onClick={()=>save({...doc,pilots:doc.pilots.filter(x=>x.id!==r.id)})}>{t('Remove record')}</button></li>)}</ul>}</Card></>
}

