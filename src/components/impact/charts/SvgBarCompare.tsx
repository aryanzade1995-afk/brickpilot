import {useId,useMemo,useState} from 'react'
import {ArrowDownRight,ArrowUpRight,Minus} from 'lucide-react'
import {translate as t} from '@/lib/i18n/index.ts'
import {comparisonData,comparisonValue,type ComparisonGroup} from '@/lib/impact/barComparison.ts'
export type SvgBarCompareGroup=ComparisonGroup
export interface SvgBarCompareProps {title:string;subtitle?:string;groups:ComparisonGroup[];currentLabel?:string;swappedLabel?:string;className?:string}
const shades=['#677e74','#8798a5','#a5937d','#7e8176','#a4afa6','#b6a99d']
export function SvgBarCompare({title,subtitle,groups,currentLabel='Current Spec',swappedLabel='Eco-Swapped',className=''}:SvgBarCompareProps){
 const model=useMemo(()=>comparisonData(groups),[groups])
 const [mode,setMode]=useState<'compare'|'current'|'proposed'>('compare'),[sort,setSort]=useState<'largest'|'original'>('largest'),[selected,setSelected]=useState<number|null>(null),[hovered,setHovered]=useState<number|null>(null)
 const rows=useMemo(()=>sort==='largest'?[...model.rows].sort((a,b)=>(b.valid?(mode==='proposed'?b.swappedVal:b.currentVal):-1)-(a.valid?(mode==='proposed'?a.swappedVal:a.currentVal):-1)):model.rows,[model,sort,mode])
 const active=model.rows.find(r=>r.id===(hovered??selected))??null
 const detailId=useId(),headingId=useId()
 const value=(n:number,u='₹')=>comparisonValue(n,u)
 const pct=(n:number,max:number)=>max>0?Math.min(100,Math.max(0,n/max*100)):0
 return <section aria-labelledby={headingId} className={`impact-comparison min-w-0 overflow-hidden rounded border border-line bg-bg-raised ${className}`}>
  <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-5 py-5 sm:px-6">
   <div className="min-w-0"><p className="font-mono text-[10px] uppercase tracking-[.14em] text-ink-faint">{t(model.currency?'Cost composition':'Project comparison')}</p><h3 id={headingId} className="mt-1 font-display text-xl text-ink">{t(title)}</h3>{subtitle&&<p className="mt-2 max-w-2xl text-xs leading-relaxed text-ink-dim">{t(subtitle)}</p>}</div>
   <span className="rounded-full border border-line bg-bg px-3 py-1.5 text-[11px] text-ink-dim">{model.rows.length} {t('categories')}</span>
  </header>
  {!rows.length?<p role="status" className="p-6 text-sm text-ink-dim">{t('No comparison data available.')}</p>:<>
   <dl className="grid grid-cols-1 gap-px border-b border-line bg-bg-inset sm:grid-cols-3">
    {(model.currency?[[currentLabel,value(model.current!)],[swappedLabel,value(model.proposed!)],['Potential difference',value(model.difference!)]]:[['Categories',String(rows.length)],['Highest value',model.unit===null?'—':value(model.maximum,model.unit)],['Changed categories',String(model.changed)]]).map(([label,amount],i)=><div key={label} className="min-w-0 bg-bg-raised px-5 py-4 sm:px-6"><dt className="text-xs text-ink-dim">{t(label)}</dt><dd className={`mt-2 break-words font-display text-2xl tabular-nums ${i===2?'text-[#52685b]':'text-ink'}`}>{amount}</dd></div>)}
   </dl>
   {model.currency&&model.current!>0&&<div className="px-5 pt-5 sm:px-6"><div className="mb-2 flex justify-between text-[10px] uppercase tracking-wider text-ink-faint"><span>{t('Share of displayed costs')}</span><span>100%</span></div><div className="flex h-3 gap-1 overflow-hidden rounded-sm" aria-label={t('Cost distribution')}>{model.rows.map(row=><button key={row.id} type="button" aria-label={`${row.label}: ${pct(row.currentVal,model.current!).toFixed(1)}%`} aria-pressed={selected===row.id} onClick={()=>setSelected(selected===row.id?null:row.id)} data-motion="none" className="impact-share-segment min-w-0 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2" style={{width:`${pct(row.currentVal,model.current!)}%`,backgroundColor:shades[row.id%shades.length]}}/>)}</div></div>}
   <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
    <div className="flex max-w-full gap-1 rounded border border-line bg-bg p-1" role="group" aria-label={t('Comparison display')}>{([['compare','Compare'],['current',currentLabel],['proposed',swappedLabel]] as const).map(([id,label])=><button key={id} type="button" aria-pressed={mode===id} onClick={()=>setMode(id)} className={`min-h-11 rounded px-3 text-xs focus-visible:outline-2 focus-visible:outline-accent ${mode===id?'bg-ink text-bg':'text-ink-dim hover:bg-bg-inset'}`}>{t(label)}</button>)}</div>
    <label className="inline-flex items-center gap-2 text-xs text-ink-faint">{t('Sort')}<select className="min-h-11 max-w-full rounded border border-line bg-bg-raised px-2 text-xs text-ink" value={sort} onChange={e=>setSort(e.target.value as typeof sort)}><option value="largest">{t('Largest first')}</option><option value="original">{t('Original order')}</option></select></label>
   </div>
   <div className="mx-5 mb-4 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-ink-dim sm:mx-6"><span className="inline-flex items-center gap-2"><i className="h-2 w-5 rounded-sm bg-ink"/>{t(currentLabel)}</span><span className="inline-flex items-center gap-2"><i className="h-0.5 w-5 rounded-sm bg-[#677e74]"/>{t(swappedLabel)}</span><span className="ml-auto text-ink-faint">{t('Select a category for details')}</span></div>
   <div className="px-2 pb-3 sm:px-3" onMouseLeave={()=>setHovered(null)}>
    {rows.map((row,rank)=>{
     const amount=mode==='proposed'?row.swappedVal:row.currentVal,delta=row.currentVal-row.swappedVal,same=Math.abs(delta)<.005,share=model.currency&&row.valid?pct(row.currentVal,model.current!):null
     const highlighted=active?.id===row.id
     return <button type="button" key={row.id} aria-pressed={selected===row.id} aria-controls={detailId} aria-label={`${row.label}. ${row.valid?`${currentLabel}: ${value(row.currentVal,row.unit)}. ${swappedLabel}: ${value(row.swappedVal,row.unit)}.`:t('Data unavailable')}`} onClick={()=>setSelected(selected===row.id?null:row.id)} onMouseEnter={()=>setHovered(row.id)} onFocus={()=>setHovered(row.id)} onBlur={()=>setHovered(null)} data-motion="none" className={`impact-comparison-row w-full rounded border text-left focus-visible:outline-2 focus-visible:outline-accent ${highlighted?'border-line-strong bg-[#f1f3ef]':'border-transparent hover:bg-bg'}`}>
      <span className="impact-row-rank font-mono text-[10px] text-ink-faint">{String(rank+1).padStart(2,'0')}</span>
      <span className="impact-row-name min-w-0 text-sm font-medium text-ink">{t(row.label)}{row.isAssumption&&<span className="mt-1 block text-[10px] font-normal text-ink-faint">{t('Assumed input')}</span>}</span>
      <span className="impact-row-values min-w-0 text-right"><span className="block break-words text-sm font-medium tabular-nums text-ink">{row.valid?value(amount,row.unit):'—'}</span><span className="mt-1 block text-[10px] text-ink-faint">{share!==null?`${share.toFixed(1)}% ${t('of shown costs')}`:t(row.unit)}</span></span>
      <span className="impact-row-track relative block h-6 overflow-hidden rounded-sm" aria-hidden="true"><span className="absolute inset-0 impact-track-grid"/><span key={`${mode}:${row.currentVal}:${row.swappedVal}`} className="impact-bar-reveal absolute left-0 top-1 h-2.5 rounded-sm bg-ink/85" style={{width:`${row.valid?pct(amount,model.maximum):0}%`,animationDelay:`${Math.min(rank*35,180)}ms`,...(mode==='proposed'?{backgroundColor:'#677e74'}:{})}}/>{mode==='compare'&&<span className="impact-bar-reveal absolute bottom-0.5 left-0 h-[3px] rounded-sm bg-[#677e74] transition-[width] duration-500" style={{width:`${row.valid?pct(row.swappedVal,model.maximum):0}%`,animationDelay:`${Math.min(rank*35+90,240)}ms`}}/>}</span>
      <span className={`impact-row-delta inline-flex items-center justify-end gap-1 text-[10px] ${delta>0?'text-[#52685b]':delta<0?'text-[#8a7362]':'text-ink-faint'}`}>{!row.valid?t('Needs review'):same?<><Minus size={12} aria-hidden/>{t('Unchanged')}</>:<>{delta>0?<ArrowDownRight size={13} aria-hidden/>:<ArrowUpRight size={13} aria-hidden/>}{value(Math.abs(delta),row.unit)}</>}</span>
     </button>
    })}
   </div>
   <div id={detailId} className="min-h-[80px] border-t border-line bg-bg/70 px-5 py-4 sm:min-h-[64px] sm:px-6" aria-label={t('Selected category details')}>
    {active?<div className="grid items-start gap-4 sm:grid-cols-[minmax(140px,1fr)_2fr]"><div className="flex items-center gap-2 text-sm font-medium text-ink"><i className="h-2 w-2 shrink-0 rounded-full" style={{backgroundColor:shades[active.id%shades.length]}}/>{t(active.label)}</div><dl className="grid grid-cols-2 gap-4 text-xs">{[[currentLabel,active.currentVal],[swappedLabel,active.swappedVal]].map(([label,n])=><div key={String(label)}><dt className="text-ink-faint">{t(String(label))}</dt><dd className="mt-1 break-words font-medium tabular-nums text-ink">{active.valid?value(Number(n),active.unit):t('Data unavailable')}</dd></div>)}</dl></div>:<p className="text-xs leading-relaxed text-ink-faint">{t(model.currency?'Values cover the categories shown. Equal estimates are marked unchanged.':'Compare the recorded values. Select a row to inspect both scenarios.')}</p>}
   </div>
  </>}
 </section>
}
