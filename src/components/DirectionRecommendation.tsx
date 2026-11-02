import {ArrowUpRight,Armchair,BedDouble,ChevronDown,Compass,Leaf,Maximize2,Sparkles,Trees} from 'lucide-react'
import type {DirectionEvidence} from '@/lib/engine/directionAdvice.ts'
import type {Advice} from '@/state/directionAdviceClient.ts'
import {translate as t} from '@/lib/i18n/index.ts'
export function DirectionRecommendation({evidence,advice}:{evidence:DirectionEvidence;advice:Advice|null}){
 const recommended=advice?.recommendations.find(r=>r.planId===evidence.id)
 const match=evidence.candidates.find(c=>c.id===recommended?.id)??[...evidence.candidates].sort((a,b)=>b.score-a.score)[0]
 const Icon=match.id==='outdoor'||match.id==='court'?Trees:match.id==='living'?Armchair:match.id==='access'?BedDouble:Compass
 const ring=2*Math.PI*20
 const stats=[{Icon:Maximize2,label:'Built area',value:`${evidence.built} m²`},{Icon:Armchair,label:'Living space',value:`${evidence.living} m²`},evidence.groundBeds>0?{Icon:BedDouble,label:'Ground bedrooms',value:String(evidence.groundBeds)}:evidence.court>0?{Icon:Trees,label:'Courtyard',value:`${evidence.court} m²`}:{Icon:ArrowUpRight,label:'Circulation',value:`${evidence.circulation}%`}]
 return <section className="mx-5 mb-4 overflow-hidden rounded-lg border border-line bg-bg-raised" aria-label={t('Why choose this direction')}>
  <div className="flex items-center justify-between gap-3 px-4 pt-3"><span className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[.12em] text-ink-faint">{advice?.mode==='local-ai'?<Sparkles size={11} aria-hidden/>:<Leaf size={11} aria-hidden/>}{t(advice?.mode==='local-ai'?'Local AI recommendation':'Plan recommendation')}</span><span className="rounded-full border border-[#6b8072]/20 bg-[#edf1ec] px-2 py-0.5 text-[9px] text-[#52685b]">{t('Design fit')}</span></div>
  <div className="flex items-center gap-3 px-4 py-3">
   <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line bg-bg text-[#627968]"><Icon size={19} strokeWidth={1.4} aria-hidden/></span>
   <div className="min-w-0 flex-1"><p className="text-[9px] text-ink-faint">{t('Choose this home for')}</p><h3 className="mt-0.5 font-display text-lg leading-tight text-ink">{t(match.label)}</h3><p className="mt-1 text-[11px] leading-relaxed text-ink-dim">{t(match.reason)}</p></div>
   <figure className="m-0 hidden shrink-0 text-center sm:block"><svg viewBox="0 0 52 52" role="img" aria-label={`${evidence.open}% ${t('of plot unbuilt')}`} className="h-14 w-14"><circle cx="26" cy="26" r="20" fill="none" stroke="#e9e7e1" strokeWidth="3.5"/><circle cx="26" cy="26" r="20" fill="none" stroke="#768d7c" strokeWidth="3.5" strokeLinecap="round" strokeDasharray={ring} strokeDashoffset={ring*(1-evidence.open/100)} transform="rotate(-90 26 26)"/><text x="26" y="29" textAnchor="middle" fill="#52685b" fontSize="11" fontFamily="var(--font-mono)">{evidence.open}%</text></svg><figcaption className="text-[8px] text-ink-faint">{t('Plot unbuilt')}</figcaption></figure>
  </div>
  <div className="mx-4 grid grid-cols-3 gap-2 border-t border-line pt-2.5 pb-2">{stats.map(({Icon:MetricIcon,label,value})=><div key={label} className="min-w-0"><span className="flex items-center gap-1 text-[9px] text-ink-faint"><MetricIcon size={10} strokeWidth={1.5} aria-hidden/>{t(label)}</span><span className="mt-0.5 block font-mono text-xs tabular-nums text-ink">{value}</span></div>)}</div>
  <details className="group border-t border-line bg-bg/60 px-4 text-[10px] text-ink-faint"><summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-2">{t('What to consider')}<ChevronDown size={11} className="transition-transform group-open:rotate-180" aria-hidden/></summary><p className="pb-3 leading-relaxed">{t(match.tradeoff)}</p></details>
 </section>
}
