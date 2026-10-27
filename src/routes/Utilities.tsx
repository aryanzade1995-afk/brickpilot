import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { WorkspaceTabs } from '@/components/WorkspaceTabs.tsx'
import { InvalidPlanNotice } from '@/components/InvalidPlanNotice.tsx'
import { UtilityPlanViewer } from '@/components/utilities/UtilityPlanViewer.tsx'
import { utilityFloor } from '@/lib/utilities/plan.ts'
import { useStudio } from '@/state/studio.ts'
import { useProjects } from '@/state/projects.ts'
import { translate as t, useLanguage } from '@/lib/i18n/index.ts'
const WaterIntelligence=lazy(()=>import('@/components/water/WaterIntelligence.tsx').then(m=>({default:m.WaterIntelligence})))

export function Utilities() {
  const [params,setParams]=useSearchParams()
  const waterView=params.get('view')==='water'
  useLanguage(s => s.language)
  const result = useStudio(s => s.result), brief = useStudio(s => s.brief), run = useStudio(s => s.run)
  const projectId = useProjects(s => s.currentId)
  const [selectedLevel, setLevel] = useState(0)
  const requestedFloor=params.get('floor')
  const level=requestedFloor!==null&&Number.isInteger(Number(requestedFloor))?Number(requestedFloor):selectedLevel
  useEffect(() => { if (!result) run() }, [result, run])
  const design = result?.design
  const floor = design?.floors.find(f => f.level === level) ?? design?.floors[0]
  const model = useMemo(() => design && floor ? utilityFloor(design, floor.level, brief) : null, [design, floor, brief])
  const models = useMemo(() => design ? design.floors.map(f => utilityFloor(design, f.level, brief)) : [], [design, brief])
  if (result && !result.report.hardChecksPass) return <InvalidPlanNotice report={result.report} />
  if (!design || !model) return <p className="p-10 text-ink-dim">{t('Preparing model…')}</p>
  return <div className="mx-auto max-w-[1400px] px-6 py-8 md:px-10">
    <WorkspaceTabs />
    <div className="mt-6 flex flex-wrap items-start justify-between gap-4"><div><p className="font-mono text-[10px] uppercase tracking-widest text-ink-faint">{t('Whole home')} · {t('Concept utility coordination')}</p><h1 className="mt-2 font-display text-3xl">{t('Utilities')} · {brief.project.name}</h1><p className="mt-2 max-w-2xl text-sm text-ink-dim">{waterView?'Explore your tanks and pipe connections in 3D.':t('Plan your services, one room at a time. Choose a layer to get started.')}</p></div>{!waterView&&<label className="text-xs text-ink-dim">{t('Floor')}<select className="ml-3 min-h-11 border border-line bg-bg px-3 text-ink" value={model.floor.level} onChange={e => {setLevel(Number(e.target.value));setParams(p=>{p.delete('floor');p.delete('fixture');return p})}}>{design.floors.map(f => <option key={f.level} value={f.level}>{t(f.name)}</option>)}</select></label>}</div>
    <nav aria-label="Building systems workspace" className="mt-5 flex flex-wrap gap-2"><button aria-pressed={!waterView} className={`min-h-11 rounded border border-line px-4 text-sm ${!waterView?'bg-ink text-bg':''}`} onClick={()=>setParams(p=>{p.delete('view');return p})}>2D utility plans</button><button aria-pressed={waterView} className={`min-h-11 rounded border border-line px-4 text-sm ${waterView?'bg-ink text-bg':''}`} onClick={()=>setParams(p=>{p.set('view','water');return p})}>Water Intelligence</button></nav>
    {waterView?<Suspense fallback={<p className="p-6 text-sm text-ink-dim">Loading water systems…</p>}><WaterIntelligence key={projectId??'draft'}/></Suspense>:<UtilityPlanViewer key={`${projectId ?? design.id}:${model.floor.level}`} initialService={params.get('service')==='water_supply'?'water_supply':'drainage'} initialSelection={params.get('fixture')??undefined} model={model} project={brief.project.name} reviewScope={`${projectId ?? `draft:${design.id}`}:floor:${model.floor.level}`} models={models} />}
    <nav className="mt-6 flex flex-wrap justify-between gap-4 text-sm" aria-label={t('Next steps')}><Link className="underline underline-offset-4" to="/workspace/plan">{t('Edit 2D plan')}</Link><Link className="underline underline-offset-4" to="/workspace/finishes?tab=specifications&section=plumbing-sanitary">{t('Pipelines & tanks')}</Link><Link className="underline underline-offset-4" to="/workspace/finishes">{t('Continue to finishes & cost')} →</Link></nav>
  </div>
}
