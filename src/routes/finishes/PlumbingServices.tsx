import {lazy,Suspense} from 'react'
import type {Brief} from '@/lib/model/brief.ts'
import type {CostEstimate} from '@/lib/cost/index.ts'
import {specsCatalogue,resolveSpecification} from '@/lib/cost/catalogue.ts'
import {PLUMBING_CONTROL_IDS} from '@/lib/cost/plumbingCatalogue.ts'
import {formatINR} from '@/lib/format.ts'
import {translate as t,useLanguage} from '@/lib/i18n/index.ts'
const Preview=lazy(()=>import('./PlumbingPreview.tsx'))

export function PlumbingServices({brief,cost,onBrief}:{brief:Brief;cost:CostEstimate;onBrief:(brief:Brief)=>void}){
  useLanguage(s=>s.language)
  const schedule=cost.quantities.plumbing
  const set=(id:string,value:string)=>onBrief({...brief,specs:{overrides:{...brief.specs.overrides,[id]:value}}})
  const select=(id:string,label?:string)=>{
    const item=specsCatalogue.items.find(i=>i.id===id)!,chosen=resolveSpecification(brief,id)
    return <label key={id} className="block min-w-0 text-xs text-ink-dim">{t(label??item.label)}<select aria-label={t(label??item.label)} value={chosen.id} onChange={e=>set(id,e.target.value)} className="mt-2 block w-full border border-line bg-bg px-3 py-2.5 text-sm text-ink">{item.options.map(o=><option key={o.id} value={o.id}>{t(o.name)}</option>)}</select></label>
  }
  const serviceLines=cost.boq.filter(l=>PLUMBING_CONTROL_IDS.includes(l.item))
  const total=serviceLines.reduce((n,l)=>n+l.amount,0)
  const tankDetails=(tank:typeof schedule.underground)=>tank&&<p className="mt-3 text-xs text-ink-dim">{tank.capacityLitres>0&&<>{tank.capacityLitres.toLocaleString('en-IN')} L · </>}{tank.lengthM.toFixed(2)} × {tank.widthM.toFixed(2)} × {tank.depthM.toFixed(2)} m {t('usable dimensions')}</p>
  return <section aria-label={t('Pipelines & tanks')} className="mt-5 rounded-xl border border-line bg-bg p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-display text-xl">{t('Pipelines & tanks')}</h3><p className="mt-1 text-xs text-ink-dim">{t('Whole home')} · {t('Concept allowances linked to your wet rooms and floors')}</p></div><p className="font-mono text-sm">{formatINR(total)}</p></div>
    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <div><h4 className="mb-3 text-sm font-medium">{t('Water supply')}</h4><div className="grid gap-4 sm:grid-cols-2">{select('water-pipes','Water pipe material')}{select('water-pipe-size')}{select('water-riser-size')}{select('water-tanks','Overhead tank quality')}</div><p className="mt-3 text-xs text-ink-dim">{schedule.overheadLitres.toLocaleString('en-IN')} L {t('overhead storage')} · {schedule.waterLengthM.toFixed(1)} m {t('water pipes')}</p></div>
      <div><h4 className="mb-3 text-sm font-medium">{t('Drainage')}</h4><div className="grid gap-4 sm:grid-cols-2">{select('drain-pipes','Drain pipe material')}{select('waste-pipe-size')}{select('soil-pipe-size')}</div><p className="mt-3 text-xs text-ink-dim">{schedule.drainLengthM.toFixed(1)} m {t('drain pipes')}</p></div>
      <div className="border-t border-line pt-4">{select('underground-water-tank')}{tankDetails(schedule.underground)}<p className="mt-2 text-xs text-ink-dim">{t('Clean-water storage. Priced separately from the overhead tank.')}</p></div>
      <div className="border-t border-line pt-4">{select('drain-tank')}{tankDetails(schedule.drain)}<p className="mt-2 text-xs text-ink-dim">{t('Choose a sewer inspection chamber, septic tank or sealed holding tank. Wastewater never shares the clean-water tank.')}</p></div>
    </div>
    <Suspense fallback={<p className="mt-4 text-xs">{t('Loading preview…')}</p>}><Preview schedule={schedule} waterMaterial={resolveSpecification(brief,'water-pipes').id}/></Suspense>
    <details className="mt-5" open><summary className="cursor-pointer text-sm">{t('Pipe sizes, quantities & costs')}</summary><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-line text-ink-dim">{['Floor','Pipeline','Material / size','Length','Installed rate','Cost'].map(h=><th key={h} className="whitespace-nowrap px-2 py-3 font-normal">{t(h)}</th>)}</tr></thead><tbody>{schedule.runs.map(run=>{const item=run.system==='water'?'water-pipes':'drain-pipes',line=serviceLines.find(l=>l.id===`${item}:pipe:${run.id}`)!
      return <tr key={run.id} className="border-b border-line"><td className="whitespace-nowrap px-2 py-3">{t(run.floorName)}</td><td className="px-2 py-3">{t(run.purpose)}</td><td className="whitespace-nowrap px-2 py-3">{t(resolveSpecification(brief,item).name)} · {run.diameterMm} mm</td><td className="whitespace-nowrap px-2 py-3">{run.lengthM.toFixed(1)} m</td><td className="whitespace-nowrap px-2 py-3">{formatINR(line.rate)}/m</td><td className="whitespace-nowrap px-2 py-3">{formatINR(line.amount)}</td></tr>})}</tbody></table></div></details>
    <p className="mt-4 text-xs leading-relaxed text-ink-dim">{t('Pipe lengths are planning allowances, not measured routes. Supply sizes are nominal; waste and soil sizes are outside diameters. Final sizes, slopes, tank placement and disposal need a plumbing design and supplier quote.')}</p>
    <p className="mt-2 text-xs text-ink-dim">{t('Tank allowances include a shell, cover and normal excavation. Pumps, difficult ground, septic disposal fields and approvals are excluded.')}</p>
    <p className="mt-2 text-xs text-ink-dim">{t('Changing these service choices updates the cost and system preview without regenerating your pinned villa.')}</p>
  </section>
}
