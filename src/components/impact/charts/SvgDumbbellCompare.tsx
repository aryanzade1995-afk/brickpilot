import {translate as t} from '@/lib/i18n/index.ts'

interface SvgDumbbellCompareProps {
 baselineCost:number
 swappedCost:number
 baselineCarbonKg:number
 swappedCarbonKg:number
}
const money=(value:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(value)
const tonnes=(value:number)=>`${new Intl.NumberFormat('en-IN',{maximumFractionDigits:2}).format(value/1000)} tCO₂e`

export function SvgDumbbellCompare({baselineCost,swappedCost,baselineCarbonKg,swappedCarbonKg}:SvgDumbbellCompareProps){
 return <article className="rounded border border-line bg-bg-raised p-4">
  <header className="mb-4 flex flex-wrap items-center justify-between gap-3"><h3 className="font-display text-base text-ink">{t('Material alternatives comparison')}</h3><div className="flex gap-4 text-[10px] text-ink-faint"><span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-ink"/>{t('Current')}</span><span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#677e74]"/>{t('Alternative')}</span></div></header>
  <div className="divide-y divide-line">
   <CompareTrack title="Construction cost" current={baselineCost} proposed={swappedCost} format={money}/>
   <CompareTrack title="Illustrative carbon footprint" current={baselineCarbonKg} proposed={swappedCarbonKg} format={tonnes}/>
  </div>
 </article>
}
function CompareTrack({title,current,proposed,format}:{title:string;current:number;proposed:number;format:(value:number)=>string}){
 const maximum=Math.max(current,proposed,1)
 const x=(value:number)=>40+Math.max(0,value)/maximum*420
 const difference=current-proposed
 return <div className="py-4 first:pt-0 last:pb-0">
  <div className="flex flex-wrap justify-between gap-2 text-xs"><h4 className="font-medium text-ink">{t(title)}</h4><span className="text-ink-faint">{Math.abs(difference)<.005?t('Unchanged'):`${format(Math.abs(difference))} ${t(difference>=0?'less':'more')}`}</span></div>
  <svg viewBox="0 0 500 40" className="my-2 h-10 w-full" role="img" aria-label={`${t(title)}: ${t('Current')} ${format(current)}; ${t('Alternative')} ${format(proposed)}.`}>
   <title>{t(title)}</title><line x1="40" y1="20" x2="460" y2="20" stroke="#e4e6e1" strokeWidth="3" strokeLinecap="round"/>
   {[0,1,2,3,4].map(i=><line key={i} x1={40+i*105} y1="15" x2={40+i*105} y2="25" stroke="#d1d6cf"/>)}
   <line x1={x(current)} y1="20" x2={x(proposed)} y2="20" stroke="#677e74" strokeWidth="4" strokeLinecap="round"/>
   <circle cx={x(current)} cy="20" r="7" fill="#242a27" stroke="white" strokeWidth="2"/>
   <circle cx={x(proposed)} cy="20" r="4" fill="#677e74" stroke="white" strokeWidth="1"/>
  </svg>
  <dl className="grid grid-cols-2 gap-3 rounded border border-line bg-bg/60 px-3 py-2 text-[11px]">
   <div className="min-w-0"><dt className="text-ink-faint">{t('Current')}</dt><dd className="mt-1 break-words font-mono text-ink">{format(current)}</dd></div>
   <div className="min-w-0 text-right"><dt className="text-ink-faint">{t('Alternative')}</dt><dd className="mt-1 break-words font-mono text-[#52685b]">{format(proposed)}</dd></div>
  </dl>
 </div>
}
