import { Suspense, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Wind, Play, Pause, Eye, EyeOff } from 'lucide-react'
import { useStudio } from '@/state/studio.ts'
import { useBlender } from '@/state/blender.ts'
import { AIR_SIDES, ventilationPaths } from '@/lib/utilities/ventilation.ts'
import { VillaSceneCanvas, AcceptedVillaModel } from '@/components/VillaSceneCanvas.tsx'
import { AirflowLayer } from './AirflowLayer.tsx'
import { VentilationCamera } from './VentilationCamera.tsx'
import { translate as t } from '@/lib/i18n/index.ts'

const button='inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line px-3 py-2 text-xs hover:bg-bg-inset focus-visible:outline-2 focus-visible:outline-accent'
const names={N:'North',E:'East',S:'South',W:'West'}
export function Ventilation() {
  const result=useStudio(s=>s.result),brief=useStudio(s=>s.brief),edit=useStudio(s=>s.edit)
  const settings=brief.site.ventilation??{version:1 as const,direction:'cycle' as const,speed:1,doorsOpen:true}
  const [reduced]=useState(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [running,setRunning]=useState(!reduced),[xray,setXray]=useState(true),[cycle,setCycle]=useState(0)
  const building=result?.buildingModel
  const asset=useBlender(s=>building?s.accepted[building.planId]:undefined)
  const scenarios=useMemo(()=>building?Object.fromEntries(AIR_SIDES.map(side=>[side,ventilationPaths(building,side,settings.doorsOpen)])):null,[building,settings.doorsOpen])
  useEffect(()=>{
    if(settings.direction!=='cycle'||!running)return
    const timer=setInterval(()=>setCycle(c=>(c+1)%4),7000)
    return()=>clearInterval(timer)
  },[settings.direction,running])
  if(!building||!scenarios)return <p className="p-6 text-sm text-ink-dim">{t('Open a house plan first.')}</p>
  const from=settings.direction==='cycle'?AIR_SIDES[cycle]:settings.direction,scenario=scenarios[from]
  const update=(patch:Partial<typeof settings>)=>edit(b=>{b.site.ventilation={...settings,...patch}})
  return <section className="mt-6 space-y-4" aria-label="Air ventilation">
    <header><p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-ink-faint"><Wind size={14}/>{t('Natural ventilation')}</p><h2 className="mt-2 font-display text-3xl">{t('Follow the breeze.')}</h2></header>
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="overflow-hidden rounded-xl border border-line">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-3"><div className="flex flex-wrap gap-1" aria-label="Wind direction">
          <button className={`${button} ${settings.direction==='cycle'?'bg-ink text-bg hover:bg-ink/90':''}`} aria-pressed={settings.direction==='cycle'} onClick={()=>update({direction:'cycle'})}>{t('All four sides')}</button>
          {AIR_SIDES.map(side=><button key={side} className={`${button} ${settings.direction===side?'bg-ink text-bg hover:bg-ink/90':''}`} aria-pressed={settings.direction===side} onClick={()=>update({direction:side})}>{t(names[side])}</button>)}
        </div><button className={button} aria-pressed={xray} onClick={()=>setXray(v=>!v)}>{xray?<EyeOff size={14}/>:<Eye size={14}/>} {t(xray?'Normal view':'See inside walls')}</button></div>
        <div className="relative h-[430px] bg-[#e5e5e5] sm:h-[570px]" aria-label="Airflow on the accepted house">
          {asset?<VillaSceneCanvas><Suspense fallback={null}><AcceptedVillaModel url={asset.files.glb} technicalXray={xray} fit={false}/><AirflowLayer paths={scenario.paths} running={running} speed={settings.speed} xray={xray}/><VentilationCamera building={building}/></Suspense></VillaSceneCanvas>:<div className="grid h-full place-items-center p-8 text-center text-sm text-ink-dim"><Link className="underline" to="/workspace/massing">{t('Prepare your accepted villa in 3D Massing')}</Link></div>}
          <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-2"><span className="rounded-full border border-line bg-bg/95 px-3 py-2 text-xs">{t('Air from')} {t(names[from])}</span>{settings.direction==='cycle'&&<span className="rounded-full border border-line bg-bg/95 px-3 py-2 text-xs">{t('Four directions · one at a time')}</span>}</div>
          {!scenario.paths.length&&<p role="status" className="absolute bottom-3 left-3 right-3 rounded-lg border border-line bg-bg/95 p-3 text-xs">{t('No unobstructed cross-ventilation path is recorded for this direction. Try another side or review the openings in 2D.')}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-4 border-t border-line p-3"><button className={button} onClick={()=>setRunning(v=>!v)}>{running?<Pause size={14}/>:<Play size={14}/>} {t(running?'Pause air':'Start air')}</button><span className="flex items-center gap-2 text-xs"><i className="h-2.5 w-2.5 rounded-full bg-[#168DD0]"/>{t('Cooler incoming air')}</span><span className="flex items-center gap-2 text-xs"><i className="h-2.5 w-2.5 rounded-full bg-[#E66E32]"/>{t('Warmer outgoing air')}</span></div>
      </div>
      <aside className="space-y-4 rounded-xl border border-line p-4"><h3 className="font-display text-lg">{t('Air through your home')}</h3><p className="text-xs leading-relaxed text-ink-dim">{t('Recorded windows → connected rooms → opposite-side windows.')}</p><label className="flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" checked={settings.doorsOpen} onChange={e=>update({doorsOpen:e.target.checked})}/>{t('Assume internal doors open')}</label><label className="grid gap-2 text-xs">{t('Animation speed')}<input aria-label="Air animation speed" type="range" min=".5" max="3" step=".25" value={settings.speed} onChange={e=>update({speed:Number(e.target.value)})}/></label>
        <p role="status" className="rounded-lg bg-bg-inset p-3 text-xs">{scenario.paths.length} {t('illustrated paths')} · {scenario.inletCount} {t('inlet windows')}</p><p className="text-[11px] leading-relaxed text-ink-dim">{t('Concept illustration. Openable windows and open internal doors are assumed. Colours do not predict room temperatures, cooling or air-change rates. Plan directions are not live weather.')}</p>
        <details className="text-xs text-ink-dim"><summary className="min-h-11 cursor-pointer py-3">{t('Openings to review')}</summary><ul className="space-y-2">{scenario.reviews.map((issue:string,i:number)=><li key={i}>{issue}</li>)}</ul><Link className="mt-3 inline-flex min-h-11 items-center underline" to="/workspace/plan">{t('Review 2D openings')}</Link></details>
      </aside>
    </div>
  </section>
}
