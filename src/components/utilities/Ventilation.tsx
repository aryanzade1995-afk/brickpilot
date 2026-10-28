import { Suspense, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Wind, Play, Pause, Download } from 'lucide-react'
import { useStudio } from '@/state/studio.ts'
import { useInterior360 } from '@/state/interior360.ts'
import { buildDollhouse } from '@/lib/three/buildDollhouse.ts'
import { furnishedDresser } from '@/lib/three/dressRoom.ts'
import type { InteriorConfiguration } from '@/lib/interior/preview.ts'
import { exportThreeSceneToGlb } from '@/lib/export/index.ts'
import type { Group } from 'three'
import { AIR_SIDES, ventilationPaths } from '@/lib/utilities/ventilation.ts'
import { ExplodedVentilationScene } from './ExplodedVentilationScene.tsx'
import { translate as t } from '@/lib/i18n/index.ts'

const button='inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line px-3 py-2 text-xs hover:bg-bg-inset focus-visible:outline-2 focus-visible:outline-accent'
const names={N:'North',E:'East',S:'South',W:'West'}
export function Ventilation() {
  const result=useStudio(s=>s.result),brief=useStudio(s=>s.brief),edit=useStudio(s=>s.edit)
  const settings=brief.site.ventilation??{version:1 as const,direction:'N' as const,speed:1,doorsOpen:true}
  const [reduced]=useState(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [running,setRunning]=useState(!reduced),[exporting,setExporting]=useState(false),[exportError,setExportError]=useState('')
  const [floorSel,setFloorSel]=useState<number|'all'>(0)
  const [follow,setFollow]=useState('all')
  const modelRef=useRef<Group>(null)
  const style=useInterior360(s=>s.style),density=useInterior360(s=>s.furnitureDensity) as InteriorConfiguration['furnitureDensity']
  const building=result?.buildingModel
  const design=result?.design
  const activeFloor=floorSel==='all'?undefined:design?.floors.find(f=>f.level===floorSel)?.level??design?.floors[0]?.level
  const from=settings.direction==='cycle'?'N':settings.direction
  const doll=useMemo(()=>{
    if(!design)return null
    const plan={...design,model:{...design.model,brief:{...design.model.brief,finish:brief.finish,specs:brief.specs}}}
    return buildDollhouse(plan,activeFloor,furnishedDresser(plan,style,density),{fullHeightOpenings:true})
  },[design,brief.finish,brief.specs,style,density,activeFloor])
  const scenario=useMemo(()=>{
    if(!building)return null
    const ids=new Set(building.floors.filter(f=>activeFloor===undefined||f.level===activeFloor).map(f=>f.id))
    return ventilationPaths({...building,floors:building.floors.filter(f=>ids.has(f.id)),rooms:building.rooms.filter(r=>ids.has(r.floorId)),windows:building.windows.filter(w=>ids.has(w.floorId)),doors:building.doors.filter(d=>ids.has(d.floorId))},from,settings.doorsOpen)
  },[building,from,settings.doorsOpen,activeFloor])
  const selected=scenario?.paths.find(p=>p.id===follow)
  const shownPaths=useMemo(()=>selected?[selected]:scenario?.paths??[],[selected,scenario])
  if(!building||!scenario||!doll)return <p className="p-6 text-sm text-ink-dim">{t('Open a house plan first.')}</p>
  const openingName=(id:string,floorId:string)=>{const w=building.windows.find(w=>w.floorId===floorId&&w.id===id);return building.rooms.find(r=>r.floorId===floorId&&r.id===w?.rooms?.[0])?.name??id}
  const update=(patch:Partial<typeof settings>)=>edit(b=>{b.site.ventilation={...settings,...patch}})
  return <section className="mt-6 space-y-4" aria-label="Air ventilation">
    <header><p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-ink-faint"><Wind size={14}/>{t('Natural ventilation')}</p><h2 className="mt-2 font-display text-3xl">{t('Follow the breeze.')}</h2></header>
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="overflow-hidden rounded-xl border border-line">
        <div role="group" aria-label="Visible floor" className="flex flex-wrap gap-2 border-b border-line p-3">
          {building.floors.map(f=><button key={f.id} className={`${button} ${activeFloor===f.level?'bg-ink text-bg hover:bg-ink/90':''}`} aria-pressed={activeFloor===f.level} onClick={()=>{setFloorSel(f.level);setFollow('all')}}>{t(f.level===0?'Ground floor':f.level===1?'First floor':f.name)}</button>)}
          {building.floors.length>1&&<button className={`${button} ${activeFloor===undefined?'bg-ink text-bg hover:bg-ink/90':''}`} aria-pressed={activeFloor===undefined} onClick={()=>{setFloorSel('all');setFollow('all')}}>{t('All floors')}</button>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-3"><div className="flex flex-wrap gap-1" aria-label="Wind direction">
          {AIR_SIDES.map(side=><button key={side} className={`${button} ${from===side?'bg-ink text-bg hover:bg-ink/90':''}`} aria-pressed={from===side} onClick={()=>update({direction:side})}>{t(names[side])}</button>)}
        </div><button className={button} disabled={exporting} onClick={async()=>{if(!modelRef.current)return;setExporting(true);setExportError('');try{await exportThreeSceneToGlb(modelRef.current,'furnished-exploded-house.glb')}catch{setExportError('Could not export the model. Please try again.')}finally{setExporting(false)}}}><Download size={14}/>{exporting?'Exporting…':'Export furnished GLB'}</button></div>
        {exportError&&<p role="alert" className="p-3 text-xs text-bad">{exportError}</p>}
        <div className="relative h-[430px] bg-[#e5e5e5] sm:h-[570px]" aria-label="Airflow on the furnished exploded house">
          <Suspense fallback={<p className="p-6 text-sm">Loading furnished house…</p>}><ExplodedVentilationScene building={building} doll={doll} paths={shownPaths} running={running} speed={settings.speed} modelRef={modelRef}/></Suspense>
          <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-2"><span className="rounded-full border border-line bg-bg/95 px-3 py-2 text-xs">{t('Air from')} {t(names[from])}</span></div>
          {!scenario.paths.length&&<p role="status" className="absolute bottom-3 left-3 right-3 rounded-lg border border-line bg-bg/95 p-3 text-xs">{t('No unobstructed cross-ventilation path is recorded for this direction. Try another side or review the openings in 2D.')}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-4 border-t border-line p-3"><button className={button} onClick={()=>setRunning(v=>!v)}>{running?<Pause size={14}/>:<Play size={14}/>} {t(running?'Pause air':'Start air')}</button><span className="flex items-center gap-2 text-xs"><i className="h-2.5 w-2.5 rounded-full bg-[#168DD0]"/>{t('Cooler incoming air')}</span><span className="flex items-center gap-2 text-xs"><i className="h-2.5 w-2.5 rounded-full bg-[#E66E32]"/>{t('Warmer outgoing air')}</span></div>
      </div>
      <aside className="space-y-4 rounded-xl border border-line p-4"><h3 className="font-display text-lg">{t('Air through your home')}</h3><p className="text-xs leading-relaxed text-ink-dim">{t('Recorded windows → connected rooms → opposite-side windows.')}</p>
        <label className="grid gap-2 text-xs">Follow a path<select className="min-h-11 w-full rounded border border-line bg-bg p-2" value={selected?.id??'all'} onChange={e=>setFollow(e.target.value)}><option value="all">All airflow paths</option>{scenario.paths.map(p=><option key={p.id} value={p.id}>{building.floors.find(f=>f.id===p.floorId)?.name} · {openingName(p.inletId,p.floorId)} → {openingName(p.outletId,p.floorId)}</option>)}</select></label>
        <label className="flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" checked={settings.doorsOpen} onChange={e=>update({doorsOpen:e.target.checked})}/>{t('Assume internal doors open')}</label><label className="grid gap-2 text-xs">{t('Animation speed')}<input aria-label="Air animation speed" type="range" min=".5" max="3" step=".25" value={settings.speed} onChange={e=>update({speed:Number(e.target.value)})}/></label>
        <p role="status" className="rounded-lg bg-bg-inset p-3 text-xs">{scenario.paths.length} {t('illustrated paths')} · {scenario.inletCount} {t('inlet windows')}</p><p className="text-[11px] leading-relaxed text-ink-dim">{t('Concept illustration. Openable windows and open internal doors are assumed. Colours do not predict room temperatures, cooling or air-change rates. Plan directions are not live weather.')}</p>
        <details className="text-xs text-ink-dim"><summary className="min-h-11 cursor-pointer py-3">{t('Openings to review')}</summary><ul className="space-y-2">{scenario.reviews.map((issue:string,i:number)=><li key={i}>{issue}</li>)}</ul><Link className="mt-3 inline-flex min-h-11 items-center underline" to="/workspace/plan">{t('Review 2D openings')}</Link></details>
      </aside>
    </div>
  </section>
}
