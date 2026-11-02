import type {ReactNode} from 'react'
import {ArrowRight,ArrowUpRight,BookOpen,ChevronDown,Droplets,Layers3,Ruler,Sun} from 'lucide-react'
import type {LucideIcon} from 'lucide-react'
import {Link} from 'react-router-dom'
import type {CostEstimate} from '@/lib/cost/index.ts'
import type {ImpactDocument} from '@/lib/impact/schema.ts'
import {IMPACT_SOURCES} from '@/lib/impact/analysis.ts'
import {roofComparison} from '@/lib/impact/roofComparison.ts'
import {translate as t} from '@/lib/i18n/index.ts'
import type {ImpactData} from './ProjectImpactViews.tsx'
import {number} from './presentation.ts'

type Props={doc:ImpactDocument;cost:CostEstimate;data:ImpactData}
const value=(n:number|null,unit='')=>n===null?t('Not entered'):`${number(n)}${unit?` ${unit}`:''}`

export function ImpactSources({doc,cost,data}:Props){
 const roof=roofComparison(doc.climate,cost.quantities.roofArea)
 const referenceTopics=['Roof & energy','Access & safety','Water planning','Rooftop solar','Housing support']
 return <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
  <div className="min-w-0 space-y-3">
   <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
    <div><p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">{t('Project evidence')}</p><p className="mt-1 text-xs text-ink-dim">{t('Trace each result to its inputs and references.')}</p></div>
    <span className="rounded border border-line bg-bg-raised px-2 py-1 font-mono text-[10px] text-ink-dim">{t('Current design')}</span>
   </div>
   <div className="grid min-w-0 gap-3 md:grid-cols-2">
    <SourceCard icon={Ruler} title="Plan & dimensions" kind="Calculated" status="From current plan" to="/workspace/plan" action="View plan">
     <p>{t('Dimensions are taken from your validated 2D plan.')}</p>
     <Readout rows={[[t('Roof area'),value(cost.quantities.roofArea,'m²')]]}/>
    </SourceCard>
    <SourceCard icon={Layers3} title="Cost & materials" kind="Estimated" status={`${cost.boq.length} ${t('estimate lines')}`} to="/workspace/finishes" action="Review selections">
     <p>{t('Current finishes, quantities and selected rates.')}</p>
     <Readout rows={[[t('Rate version'),cost.rateVersion]]}/>
     <details className="group border-t border-line pt-2">
      <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 text-ink">{t('Estimate basis')}<ChevronDown size={13} className="transition-transform group-open:rotate-180" aria-hidden/></summary>
      <div className="space-y-2 pb-1 leading-relaxed"><p>{cost.basis}</p>{cost.assumptions.length>0&&<ul className="list-disc space-y-1 pl-4">{cost.assumptions.map((item,i)=><li key={i}>{item}</li>)}</ul>}{cost.sources.length>0&&<p className="break-words">{cost.sources.join(' · ')}</p>}</div>
     </details>
    </SourceCard>
    <SourceCard icon={Droplets} title="Rainwater inputs" kind="User-provided" status={data.water.litres===null?'Needs input':'Inputs recorded'} to="/workspace/impact?tab=water" action="Review water inputs">
     <p className="line-clamp-2 break-words">{doc.water.source.trim()||t('Add a rainfall source and catchment assumptions.')}</p>
     <Readout rows={[[t('Rainfall event'),value(doc.water.rainfallMm,'mm')],[t('Catchment'),value(doc.water.areaM2,'m²')]]}/>
     <details className="group border-t border-line pt-2"><summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 text-ink">{t('Assumptions & source')}<ChevronDown size={13} className="transition-transform group-open:rotate-180" aria-hidden/></summary><div className="pb-1"><Readout rows={[[t('Runoff coefficient'),value(doc.water.runoff)],[t('Collection efficiency'),value(doc.water.efficiency)],[t('Tank capacity'),value(doc.water.capacityL,'L')],[t('Daily demand'),value(doc.water.dailyDemandL,'L')]]}/><p className="mt-2 break-words leading-relaxed">{doc.water.source.trim()||t('Source not recorded')}</p>{doc.water.geometryKey&&doc.water.geometryKey!==cost.quantities.geometryKey&&<p className="mt-2 font-medium text-ink">{t('Catchment inputs refer to an earlier plan. Review the area.')}</p>}</div></details>
    </SourceCard>
    <SourceCard icon={Sun} title="Roof comparison" kind="User-provided" status={roof.ready?'Inputs recorded':'Needs input'} to="/workspace/impact?tab=climate" action="Review roof inputs">
     <p className="line-clamp-2 break-words">{doc.climate.source.trim()||t('Record the roof specification used for this comparison.')}</p>
     <Readout rows={[[t('Roof area'),value(roof.areaM2,'m²')],[t('Area basis'),t(roof.areaBasis)]]}/>
     <details className="group border-t border-line pt-2"><summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 text-ink">{t('Assumptions & source')}<ChevronDown size={13} className="transition-transform group-open:rotate-180" aria-hidden/></summary><div className="pb-1"><Readout rows={[[t('Current U-value'),value(doc.climate.currentRoofU,'W/m²K')],[t('Proposed U-value'),value(doc.climate.proposedRoofU,'W/m²K')],[t('Temperature difference'),value(doc.climate.temperatureDifferenceK,'K')]]}/><p className="mt-2 break-words leading-relaxed">{doc.climate.source.trim()||t('Source not recorded')}</p></div></details>
    </SourceCard>
   </div>
   <details className="group rounded border border-line bg-bg-raised px-4">
    <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-2 py-3 text-xs"><span className="font-medium text-ink">{t('Carbon evidence')}</span><span className="inline-flex items-center gap-3 text-ink-dim">{data.carbon.covered} / {cost.boq.length} {t('lines covered')}<ChevronDown size={13} className="transition-transform group-open:rotate-180" aria-hidden/></span></summary>
    <div className="border-t border-line pb-3 pt-2 text-xs text-ink-dim">
     {doc.carbon.length?<ul className="divide-y divide-line">{doc.carbon.map(factor=><li key={factor.lineId} className="py-2"><p className="font-medium text-ink">{cost.boq.find(line=>line.id===factor.lineId)?.label??factor.lineId}</p><p className="mt-1 break-words">{factor.source} · {factor.boundary}</p><p className="mt-1">{value(factor.low)}–{value(factor.high)} kgCO₂e / {factor.unit}{data.carbon.excluded.includes(factor.lineId)&&` · ${t('Excluded: selection or plan has changed')}`}</p></li>)}</ul>:<p>{t('No documented material factors recorded.')}</p>}
     {data.carbon.mixedBoundaries&&<p className="mt-2">{t('Mixed assessment boundaries: a combined total is unavailable.')}</p>}
     <Link to="/workspace/impact?tab=affordability" className="mt-3 inline-flex min-h-9 items-center gap-2 underline underline-offset-4 text-ink">{t('Review carbon evidence')}<ArrowRight size={13} aria-hidden/></Link>
    </div>
   </details>
   {doc.pilots.length>0&&<p className="px-1 text-xs text-ink-faint">{doc.pilots.length} {t('user-entered pilot records · outcomes are recorded separately from estimates.')}</p>}
   <ol aria-label={t('How inputs become results')} className="grid grid-cols-3 divide-x divide-line rounded border border-line bg-bg-inset/50 py-3">
    {['Project inputs','Calculation','Design review'].map((step,i)=><li key={step} className="px-3"><span className="block font-mono text-[10px] text-ink-faint">0{i+1}</span><span className="mt-1 block text-xs text-ink-dim">{t(step)}</span></li>)}
   </ol>
  </div>
  <aside className="min-w-0 rounded border border-line bg-bg-raised" aria-label={t('Reference library')}>
   <header className="flex items-start gap-3 border-b border-line p-4"><BookOpen size={16} className="mt-1 shrink-0 text-ink-dim" aria-hidden/><div><h3 className="font-display text-base">{t('Reference library')}</h3><p className="mt-1 text-xs text-ink-faint">{IMPACT_SOURCES.length} {t('official resources')}</p></div></header>
   <ul className="divide-y divide-line">{IMPACT_SOURCES.map((source,i)=><li key={source.url}><a href={source.url} target="_blank" rel="noreferrer" className="group block p-4 transition-colors hover:bg-bg focus-visible:outline-2 focus-visible:outline-accent"><span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">{t(referenceTopics[i])}</span><span className="mt-1 flex items-start justify-between gap-3 text-xs font-medium leading-relaxed text-ink"><span>{t(source.label)}</span><ArrowUpRight size={14} className="mt-0.5 shrink-0" aria-hidden/></span><span className="mt-2 block break-words text-[10px] text-ink-faint">{new URL(source.url).hostname.replace(/^www\./,'')} · {t('Recorded')} {source.checked}</span><span className="sr-only">{t('Opens in a new tab')}</span></a></li>)}</ul>
   <p className="border-t border-line bg-bg/60 p-4 text-[11px] leading-relaxed text-ink-faint">{t('References support design review. Confirm current requirements and project compliance with the relevant authority.')}</p>
  </aside>
 </div>
}

function SourceCard({icon:Icon,title,kind,status,to,action,children}:{icon:LucideIcon;title:string;kind:string;status:string;to:string;action:string;children:ReactNode}){
 return <article className="flex min-w-0 flex-col rounded border border-line bg-bg-raised p-4">
  <header className="flex items-start gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-line bg-bg"><Icon size={15} strokeWidth={1.5} className="text-ink-dim" aria-hidden/></span><div className="min-w-0 flex-1"><p className="font-mono text-[9px] uppercase tracking-widest text-ink-faint">{t(kind)}</p><h3 className="mt-1 font-display text-base text-ink">{t(title)}</h3></div></header>
  <div className="mt-3 flex-1 space-y-3 text-xs leading-relaxed text-ink-dim">{children}</div>
  <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2"><span className="text-[10px] text-ink-faint">{t(status)}</span><Link to={to} className="inline-flex min-h-9 items-center gap-1.5 text-xs text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink focus-visible:outline-2 focus-visible:outline-accent">{t(action)}<ArrowUpRight size={12} aria-hidden/></Link></footer>
 </article>
}
function Readout({rows}:{rows:[string,string][]}){
 return <dl className="space-y-1.5">{rows.map(([label,result])=><div key={label} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><dt className="text-ink-faint">{label}</dt><dd className="min-w-0 break-words font-mono text-[11px] text-ink">{result}</dd></div>)}</dl>
}
