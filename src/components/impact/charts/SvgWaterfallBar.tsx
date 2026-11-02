import {useId,useState} from 'react'
import {ArrowDownRight,ArrowUpRight,Minus,SlidersHorizontal} from 'lucide-react'
import {budgetComparison} from '@/lib/impact/budgetComparison.ts'
import {translate as t} from '@/lib/i18n/index.ts'

export interface SvgWaterfallBarProps {
 budget:number|null
 currentCost:number
 swappedCost:number
 /** Kept for existing callers; the displayed difference uses the two costs. */
 totalSavings?:number
 onEditBudget?:()=>void
 className?:string
}
const fmt=(n:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n)
const pct=(n:number)=>new Intl.NumberFormat('en-IN',{maximumFractionDigits:2}).format(Math.abs(n))

export function SvgWaterfallBar({budget,currentCost,swappedCost,onEditBudget,className=''}:SvgWaterfallBarProps){
 const data=budgetComparison({budget,currentCost,swappedCost})
 const [selected,setSelected]=useState<'current'|'proposed'>('proposed')
 const detailId=useId(),headingId=useId()
 const scale=(data.maximum||1)*1.16
 const height=(amount:number)=>Math.max(0,Math.min(100,amount/scale*100))
 const reduction=data.difference!==null&&data.difference>0
 const increase=data.difference!==null&&data.difference<0
 const differenceLabel=reduction?'Potential reduction':increase?'Estimated increase':data.difference===null?'Difference unavailable':'No cost change'
 const status=!data.ready?'Estimate needs review':data.status==='missing'?'No target budget':data.status==='invalid'?'Review target budget':data.status==='within'?'Alternatives within target':data.status==='over'?'Alternatives exceed target':data.status==='on-target'?'Alternatives on target':'More information needed'
 const selectedValue=selected==='current'?data.current:data.proposed
 const balance=data.target!==null&&selectedValue!==null?data.target-selectedValue:null
 return <article className={`impact-budget min-w-0 overflow-hidden rounded border border-line bg-bg-raised ${className}`} aria-labelledby={headingId}>
  <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
   <div><p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">{t('Cost analysis')}</p><h3 id={headingId} className="mt-1 font-display text-base text-ink">{t('Budget comparison')}</h3></div>
   <div className="flex flex-wrap items-center gap-2"><span className="rounded border border-line bg-bg px-2 py-1 text-[10px] text-ink-dim">{t(status)}</span>{onEditBudget&&<button type="button" onClick={onEditBudget} className="inline-flex min-h-11 items-center gap-1.5 rounded px-2 text-xs text-ink underline decoration-line-strong underline-offset-4 focus-visible:outline-2 focus-visible:outline-accent"><SlidersHorizontal size={12} aria-hidden/>{t(data.target===null?'Set budget':'Edit target')}</button>}</div>
  </header>
  <dl className="grid grid-cols-1 divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
   <div className="min-w-0 px-4 py-3"><dt className="text-[11px] text-ink-faint">{t('Current estimate')}</dt><dd className="mt-1 break-words font-display text-xl tabular-nums text-ink">{data.current===null?'—':fmt(data.current)}</dd></div>
   <div className="min-w-0 px-4 py-3"><dt className="text-[11px] text-ink-faint">{t('With alternatives')}</dt><dd className="mt-1 break-words font-display text-xl tabular-nums text-ink">{data.proposed===null?'—':fmt(data.proposed)}</dd></div>
   <div className="min-w-0 bg-bg/70 px-4 py-3"><dt className="text-[11px] text-ink-faint">{t(differenceLabel)}</dt><dd className={`mt-1 inline-flex max-w-full flex-wrap items-center gap-1 font-display text-xl tabular-nums ${increase?'text-[#82715d]':'text-[#52685b]'}`}>{reduction?<ArrowDownRight size={17} aria-hidden/>:increase?<ArrowUpRight size={17} aria-hidden/>:<Minus size={15} aria-hidden/>}<span className="break-words">{data.difference===null?'—':fmt(Math.abs(data.difference))}</span></dd><p className="mt-1 text-[10px] text-ink-faint">{data.percent===null?t('Percentage unavailable'):data.difference===0?t('Same estimated cost'):`${pct(data.percent)}% ${t(reduction?'lower than current':'higher than current')}`}</p></div>
  </dl>
  <div className="border-t border-line px-4 pb-3 pt-4">
   <div className="mb-4 flex flex-wrap justify-between gap-2 text-[10px] text-ink-faint"><span>{t('Same scale · bars start at ₹0')}</span><span className="font-mono">{data.target===null?t('Target not recorded'):`${t('Target')} ${fmt(data.target)}`}</span></div>
   <div className="impact-budget-plot relative mx-auto max-w-xl border-b border-line-strong">
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">{[0,25,50,75].map(tick=><div key={tick} className="absolute inset-x-0 border-t border-dashed border-line" style={{bottom:`${tick}%`}}/>)}</div>
    <div className="absolute inset-0 grid grid-cols-2 gap-6 px-6 sm:px-12">
     {([{id:'current',label:'Current estimate',amount:data.current},{id:'proposed',label:'With alternatives',amount:data.proposed}] as const).map(item=><button key={item.id} type="button" data-motion="none" aria-pressed={selected===item.id} aria-controls={detailId} aria-label={`${t(item.label)}: ${item.amount===null?t('Data unavailable'):fmt(item.amount)}. ${t('Select to compare with target')}`} onClick={()=>setSelected(item.id)} onFocus={()=>setSelected(item.id)} className="group relative mx-auto h-full w-full max-w-28 rounded-t focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">
      <span className={`impact-budget-bar absolute inset-x-0 bottom-0 rounded-t border transition-[height,opacity,background-color] duration-500 motion-reduce:transition-none ${item.id==='current'?'border-ink/10 bg-ink/90':'border-[#52685b]/10 bg-[#677e74]'} ${selected===item.id?'opacity-100':'opacity-65 group-hover:opacity-90'}`} style={{height:`${item.amount===null?0:height(item.amount)}%`}}/>
      {item.amount===0&&<span className="absolute inset-x-0 bottom-2 text-xs text-ink-faint">₹0</span>}
      {item.amount===null&&<span className="absolute inset-x-0 bottom-2 text-xs text-ink-faint">{t('No estimate')}</span>}
     </button>)}
    </div>
    {data.target!==null&&<div className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-ink/60" style={{bottom:`${height(data.target)}%`}}><span className="absolute right-0 bottom-1 rounded border border-line bg-bg-raised px-2 py-0.5 font-mono text-[9px] text-ink-dim">{t('Target')} · {fmt(data.target)}</span></div>}
   </div>
   <div className="mx-auto mt-2 grid max-w-xl grid-cols-2 gap-6 px-6 text-center text-[11px] text-ink-dim sm:px-12"><span>{t('Current estimate')}</span><span>{t('With alternatives')}</span></div>
   <div id={detailId} aria-live="polite" className="mt-4 flex min-h-12 flex-wrap items-center justify-between gap-2 rounded border border-line bg-bg/70 px-3 py-2 text-[11px]">
    <span className="text-ink-dim">{t(selected==='current'?'Current estimate':'With alternatives')} <span className="ml-1 font-mono text-ink">{selectedValue===null?'—':fmt(selectedValue)}</span></span>
    <span className={balance!==null&&balance<0?'text-[#82715d]':'text-ink-faint'}>{balance===null?t(data.target===null?'Set a target to check budget fit':'Estimate needs review'):balance===0?t('Exactly on target'):`${fmt(Math.abs(balance))} ${t(balance<0?'over target':'remaining in budget')}`}</span>
   </div>
  </div>
 </article>
}
