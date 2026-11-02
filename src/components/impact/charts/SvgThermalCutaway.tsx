import {useId,useState} from 'react'
import {ArrowDownRight,ArrowUpRight,Settings2,Sun} from 'lucide-react'
import {roofComparison} from '@/lib/impact/roofComparison.ts'
import {translate as t} from '@/lib/i18n/index.ts'

export interface SvgThermalCutawayProps {
 roofAreaM2:number|null
 standardU?:number|null
 coolRoofU?:number|null
 deltaT?:number|null
 source?:string
 areaBasis?:string
 onEditInputs?:()=>void
 // Legacy callers may pass totals; inputs remain the calculation authority.
 standardWatts?:number;coolWatts?:number;reductionWatts?:number;reductionPercent?:number
 className?:string
}
const fmt=(value:number,digits=1)=>new Intl.NumberFormat('en-IN',{maximumFractionDigits:digits}).format(value)
export function SvgThermalCutaway({roofAreaM2,standardU=null,coolRoofU=null,deltaT=null,source='',areaBasis='Entered roof area',onEditInputs,className=''}:SvgThermalCutawayProps){
 const [mode,setMode]=useState<'current'|'proposed'>('proposed')
 const id=useId().replace(/:/g,'')
 const data=roofComparison({areaM2:roofAreaM2,currentRoofU:standardU,proposedRoofU:coolRoofU,temperatureDifferenceK:deltaT,source},0)
 const proposed=mode==='proposed',activeW=proposed?data.proposedW:data.currentW,activeU=proposed?coolRoofU:standardU
 const maxW=Math.max(data.currentW??0,data.proposedW??0,1),ratio=(activeW??0)/maxW
 const color=proposed?'#677e74':'#9a8770',hasFlow=data.ready&&(activeW??0)>0
 const description=data.ready?`${t(proposed?'Proposed roof':'Current roof')}: ${fmt(activeW!)} W. U ${fmt(activeU!,3)} W/m²K × ${fmt(data.areaM2,3)} m² × ${fmt(deltaT!,3)} K.`:t('Enter roof U-values and temperature difference to calculate heat flow.')
 return <article className={`min-w-0 overflow-hidden rounded border border-line bg-bg-raised ${className}`} aria-label={t('Roof heat-flow comparison')}>
  <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line p-5">
   <div><p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">{t('Roof performance')}</p><h3 className="mt-1 font-display text-xl">{t('Roof heat-flow comparison')}</h3><p className="mt-1 text-xs text-ink-dim">{fmt(data.areaM2>0?data.areaM2:0,2)} m² · {t(areaBasis)}</p></div>
   <div className="flex max-w-full rounded border border-line bg-bg p-1" role="group" aria-label={t('Roof assembly shown')}>
    {(['current','proposed'] as const).map(value=><button key={value} type="button" aria-pressed={mode===value} onClick={()=>setMode(value)} className={`min-h-11 rounded px-4 text-sm focus-visible:outline-2 focus-visible:outline-accent ${mode===value?'bg-ink text-bg':'text-ink-dim hover:bg-bg-inset'}`}>{t(value==='current'?'Current roof':'Proposed roof')}</button>)}
   </div>
  </header>
  <div className="grid min-w-0 lg:grid-cols-[minmax(0,1.5fr)_minmax(260px,1fr)]">
   <div className="min-w-0 p-5 sm:p-6">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-dim"><span className="inline-flex items-center gap-2"><Sun size={16} className="text-[#9a8770]" aria-hidden/>{t('Outside')}</span><span>ΔT {deltaT===null?'—':fmt(deltaT)} K</span></div>
    <div className="relative overflow-hidden rounded border border-line bg-[#f5f6f3]">
     <svg viewBox="0 0 640 270" role="img" aria-label={description} className="block h-auto w-full" style={{fontFamily:'var(--font-sans)'}}>
      <title>{t('Roof assembly and heat flow')}</title><desc>{description}</desc>
      <defs><pattern id={`${id}-slab`} width="24" height="16" patternUnits="userSpaceOnUse"><circle cx="5" cy="5" r="1.2" fill="#bac0bc"/><path d="m16 9 3 2 -4 2" fill="none" stroke="#bec4c0" strokeWidth="1"/></pattern><linearGradient id={`${id}-air`} x1="0" x2="0" y1="0" y2="1"><stop stopColor={color} stopOpacity=".07"/><stop offset="1" stopColor={color} stopOpacity="0"/></linearGradient></defs>
      <rect x="0" y="0" width="640" height="270" fill={`url(#${id}-air)`}/>
      <path d="M50 90 490 70 588 104 148 126Z" fill={proposed?'#dce4de':'#e8e0d5'} stroke="#aeb8af"/>
      <path d="M50 90 148 126 148 164 50 130Z" fill="#aeb8b0"/>
      <path d="M148 126 588 104 588 142 148 164Z" fill="#d4d9d4" stroke="#aeb8af"/>
      <path d="M148 126 588 104 588 142 148 164Z" fill={`url(#${id}-slab)`}/>
      <path d="M50 130 148 164 588 142 588 149 148 171 50 137Z" fill="#eceee9" stroke="#b9c1ba"/>
      <g fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" opacity={data.ready?(hasFlow?1:0):.2}>
       {[0,1,2,3,4].map(i=>{const x=174+i*79,y=177-i*3;return <g key={i}><path d={`M${x} ${y} v${24+ratio*34}`} strokeWidth={1.4+ratio*3} strokeDasharray="4 8" className={hasFlow?'roof-heat-flow':''}/><path d={`m${x-5} ${y+19+ratio*34} 5 5 5 -5`} strokeWidth={1.4+ratio*2}/></g>})}
      </g>
     </svg>
     <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-bg-raised/80 px-4 py-3 text-xs text-ink-dim"><span>{t('Inside')}</span><span>{t('Whole-roof U-value')} · {activeU===null?'—':fmt(activeU,3)} W/m²K</span></div>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-faint"><span className="inline-flex items-center gap-2"><i className="h-2 w-4 rounded-sm bg-[#dce4de]"/>{t('Roof surface')}</span><span className="inline-flex items-center gap-2"><i className="h-2 w-4 rounded-sm bg-[#b9c2ba]"/>{t('Assembly section')}</span><span>{t('Schematic · layers not to scale')}</span></div>
   </div>
   <aside className="min-w-0 border-t border-line bg-bg/60 p-5 lg:border-l lg:border-t-0 sm:p-6">
    <div aria-live="polite"><p className="text-xs text-ink-dim">{t(proposed?'Proposed heat flow':'Current heat flow')}</p><p className="mt-2 break-words font-display text-4xl leading-tight text-ink">{data.ready?fmt(activeW!,0):'—'} <span className="font-sans text-sm text-ink-faint">W</span></p></div>
    <div className="mt-5 space-y-4">{([['Current roof',data.currentW,'#9a8770'],['Proposed roof',data.proposedW,'#677e74']] as const).map(([label,value,shade])=><div key={label}><div className="mb-2 flex justify-between gap-3 text-xs"><span className="text-ink-dim">{t(label)}</span><span className="min-w-0 break-words text-right text-ink">{value===null?'—':`${fmt(value,0)} W`}</span></div><div className="h-2 overflow-hidden rounded-full bg-bg-inset"><div className="h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none" style={{width:`${(value??0)/maxW*100}%`,backgroundColor:shade}}/></div></div>)}</div>
    {data.ready?<div className="mt-5 rounded border border-line bg-bg-raised p-3"><p className="flex items-center gap-2 text-sm text-ink">{data.differenceW!>=0?<ArrowDownRight size={16} aria-hidden/>:<ArrowUpRight size={16} aria-hidden/>}{fmt(Math.abs(data.differenceW!),0)} W {t(data.differenceW!>=0?'less heat flow':'more heat flow')}</p>{data.percent!==null&&<p className="mt-1 text-xs text-ink-dim">{fmt(Math.abs(data.percent))}% {t(data.percent>=0?'lower than current roof':'higher than current roof')}</p>}</div>:<div role="status" className="mt-5 rounded border border-dashed border-line p-3 text-xs leading-relaxed text-ink-dim">{t('Add comparison inputs')}: {data.missing.map(label=>t(label)).join(', ')}.</div>}
    {onEditInputs&&<button type="button" className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm text-ink underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-accent" onClick={onEditInputs}><Settings2 size={14} aria-hidden/>{t('Edit roof data')}</button>}
   </aside>
  </div>
  <details className="border-t border-line px-5 text-xs text-ink-dim"><summary className="min-h-11 cursor-pointer py-3">{t('Calculation basis')}</summary><div className="space-y-2 pb-4"><p className="break-words">{t('Steady-state conduction')}: Q = U × A × ΔT{data.ready?` = ${fmt(activeU!,3)} × ${fmt(data.areaM2,3)} × ${fmt(deltaT!,3)} = ${fmt(activeW!,1)} W`:''}</p><p>{source.trim()||t('U-values and temperature difference are user-provided.')}</p><p>{t('Assembly materials and thicknesses are not inferred from a U-value. This comparison does not predict room temperature or peak solar heat gain.')}</p></div></details>
  <style>{`@keyframes roof-heat-flow{to{stroke-dashoffset:-24}} .roof-heat-flow{animation:roof-heat-flow 1.8s linear infinite}@media(prefers-reduced-motion:reduce){.roof-heat-flow{animation:none}}`}</style>
 </article>
}
