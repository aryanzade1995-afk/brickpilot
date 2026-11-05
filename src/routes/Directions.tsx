import {useDirectionRecommendations} from '@/state/directionAdviceClient.ts'
import {DirectionRecommendation} from '@/components/DirectionRecommendation.tsx'
import {useConceptProgress} from '@/state/directionsWorkerClient.ts'
import { translate as translateUi, useLanguage } from '@/lib/i18n/index.ts'
import { FloorDrawing } from '@/lib/draw/FloorDrawing.tsx'
import type { Design } from '@/lib/engine/types.ts'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Check, Download, Pin } from 'lucide-react'
import { ExportDropdown } from '@/components/export/ExportDropdown.tsx'
import { downloadSvg, downloadSvgAsPng } from '@/lib/export/index.ts'
import { useStudio } from '@/state/studio.ts'
import { WorkspaceTabs } from '@/components/WorkspaceTabs.tsx'
import { VillaGenerationNotice } from '@/components/VillaGenerationNotice.tsx'
import { cx } from '@/lib/cx.ts'
import { briefSiteIssues, compile } from '@/lib/model/canonical.ts'
import { generate } from '@/lib/engine/generate.ts'
import { validate } from '@/lib/rules/index.ts'
import { RenderProgress } from '@/components/RenderProgress.tsx'
import { useBlender, directionRenderKey } from '@/state/blender.ts'
import {horizontalPlan} from '@/lib/engine/planner/directionFrontage.ts'
import {modernCompositionTitle} from '@/lib/model/modernCompositions.ts'

const MemoFloorDrawing=memo(FloorDrawing)

export function Directions() {
  useLanguage(s => s.language);

  const directions = useStudio((s) => s.directions)
  const conceptProgress=useConceptProgress()
  const explore = useStudio((s) => s.exploreInBackground)
  const pin = useStudio((s) => s.pin)
  const pinned = useStudio((s) => s.pinned)
  const brief = useStudio((s) => s.brief)
  const generationNotice = useStudio((s) => s.generationNotice)
  const navigate = useNavigate()
  const [selecting,setSelecting]=useState<string|null>(null),[selectionError,setSelectionError]=useState('')
  const adviceDesigns=useMemo(()=>directions?.map(d=>d.design)??[],[directions])
  const query=useMemo(()=>`Home priorities: ${Object.entries(brief.rooms.priorities).filter(([,v])=>v===true).map(([k])=>k).join(', ')}. ${brief.project.buildingType}. Vastu ${brief.lifestyle.vastu}.`,[brief])
  const {evidence,advice}=useDirectionRecommendations(adviceDesigns,query)
  const streamedPlans=conceptProgress.sourceBrief===brief?conceptProgress.plans:[]

  useEffect(() => {
    if (!directions) void explore()
  }, [directions, explore])

  // each direction is rendered in Blender exactly as shown on its card
  const previewDirections = useBlender((s) => s.previewDirections)
  useEffect(() => {
    if (directions?.length) void previewDirections(directions.map((d) => ({ plan: d.design, seed: d.seed })))
  }, [directions, previewDirections])


  if(!directions&&streamedPlans.some(Boolean))return <div className="mx-auto max-w-[1400px] px-6 py-8 md:px-10">
    <WorkspaceTabs/>
    <h1 className="mt-6 font-display text-[clamp(1.8rem,3.5vw,2.6rem)]">{translateUi('Your plans are taking shape')}</h1>
    <div className="mt-4 max-w-xl"><RenderProgress progress={conceptProgress.value} label={conceptProgress.label}/></div>
    <p className="mt-3 text-sm text-ink-dim">{translateUi('View the ready 2D plans while the remaining directions are checked.')}</p>
    {conceptProgress.error&&<div role="alert" className="mt-3 border border-line p-3 text-sm">{conceptProgress.error}<button className="ml-3 underline" onClick={()=>void explore()}>{translateUi('Retry directions')}</button></div>}
    <div className="mt-8 grid gap-6 lg:grid-cols-2" aria-busy={conceptProgress.active}>
      {Array.from({length:4},(_,index)=>{
        const plan=streamedPlans[index],composition=plan?.model.brief.style.composition
        const label=`Direction ${'ABCD'[index]}${composition?` — ${modernCompositionTitle(composition)}`:''}`
        return <section key={index} className="direction-card overflow-hidden border border-line bg-bg" data-direction-stage={plan?'plan-ready':'pending'}>
          <div className="flex items-center justify-between gap-3 border-b border-line p-5"><h2 className="font-display text-xl">{label}</h2><span className="font-mono text-[10px] uppercase tracking-wider text-ink-dim">{plan?'2D ready':'Preparing'}</span></div>
          {plan?<DirectionPlanPreview design={plan} label={label}/>:<div className="flex aspect-[3/2] items-center justify-center bg-bg-inset text-sm text-ink-dim" role="status">{translateUi('Preparing next plan…')}</div>}
          <p className="p-4 text-xs text-ink-dim">{translateUi(plan?'Checking 3D details. This plan stays visible.':'Finding another distinct layout.')}</p>
        </section>
      })}
    </div>
  </div>
  if (!directions) {
    if(!conceptProgress.error)return null
    return <div className="mx-auto max-w-[1400px] px-6 py-8 md:px-10"><WorkspaceTabs/><div role="alert" className="mt-6 border border-line p-4 text-sm"><p>{conceptProgress.error}</p><button className="mt-3 min-h-11 border border-line px-4" onClick={()=>void explore()}>Retry directions</button></div></div>
  }

  if (directions.length === 0) {
    if (generationNotice) return <div className="mx-auto max-w-3xl px-6 py-12 md:px-10">
      <WorkspaceTabs /><h1 className="mt-8 font-display text-3xl">{translateUi("No new distinct direction")}</h1>
      <VillaGenerationNotice blocked />
      <Link to="/workspace" className="text-sm text-ink underline">{translateUi("Edit brief")}</Link>
    </div>
    const siteIssues = briefSiteIssues(brief)
    const errors = siteIssues.length ? siteIssues : validate(generate(compile(brief))).findings
      .filter((finding) => finding.severity === 'error').map((finding) => finding.message)
    return <div className="mx-auto max-w-3xl px-6 py-12 md:px-10">
      <WorkspaceTabs />
      <h1 className="mt-8 font-display text-3xl">{translateUi("The saved brief needs adjustment")}</h1>
      <p className="mt-3 text-sm text-ink-dim">{translateUi("This safety check protects older saved briefs and direct links. No generated direction passes the plan checks yet. Adjust the plot, setbacks, requested rooms or massing choice, then generate again.")}</p>
      <ul className="mt-6 space-y-2 border-y border-line py-4 text-sm text-bad">
        {errors.slice(0, 8).map((message, index) => <li key={index}>• {translateUi(message)}</li>)}
      </ul>
      <Link to="/workspace" className="mt-6 inline-block border border-line-strong px-5 py-3 font-mono text-xs uppercase text-ink hover:border-accent">{translateUi("Edit brief")}</Link>
    </div>
  }

  const choose = (d: (typeof directions)[number]) => {
    if(selecting)return
    setSelecting(d.design.id);setSelectionError('')
    requestAnimationFrame(()=>setTimeout(()=>{
      try{pin({massing:d.massing,seed:d.seed,...(d.planSeed!==undefined?{planSeed:d.planSeed}:{})});navigate('/workspace/plan')}
      catch(error){setSelectionError(error instanceof Error?error.message:'This direction could not be opened. Please try again.')}
      finally{setSelecting(null)}
    },0))
  }

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-8 md:px-10">
      <WorkspaceTabs />

      <div className="mt-6 max-w-2xl">
        <h1 className="font-display text-[clamp(1.8rem,3.5vw,2.6rem)]">{translateUi("Choose a design direction")}</h1>
      </div>



      {selectionError&&<p role="alert" className="mt-4 rounded border border-line p-3 text-sm text-ink">{selectionError}</p>}
      {directions.length<4&&<p role="status" className="mt-3 text-xs text-ink-dim">{directions.length} distinct checked plans fit this brief. Adjust the brief to explore more layouts.</p>}
      {generationNotice&&directions.length===4&&<VillaGenerationNotice/>}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {directions.map((d) => {
          const isPinned = pinned?.massing === d.massing && pinned?.seed === d.seed && pinned?.planSeed === d.planSeed
          return (
            <div
              key={`${d.massing}:${d.seed}`}
              className={cx(
                'direction-card flex flex-col border transition-colors',
                isPinned ? 'border-accent' : 'border-line',
              )}
            >
              <div className="flex items-start justify-between gap-4 border-b border-line p-5">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-display text-xl">{translateUi(d.label)}</h2>
                    {isPinned && (
                      <span className="inline-flex items-center gap-1 bg-accent px-1.5 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-white">
                        <Pin size={9} /> {translateUi(" Pinned")}</span>
                    )}
                  </div>
                  <p className="mt-1.5 max-w-sm text-sm text-ink-dim">{translateUi(d.blurb)}</p>
                  <p className="mt-2 font-mono text-[0.65rem] uppercase tracking-[0.08em] text-ink-faint">
                    {translateUi(d.design.dna.styleFamily.replaceAll('-', ' '))} · {translateUi(d.design.dna.roofDesign.replaceAll('-', ' '))} {translateUi(" roof · novelty ")}{translateUi(Math.round(d.novelty))}/100
                  </p>
                </div>
                <div className="flex-none text-right">
                  <div className="font-display text-2xl tnum">{translateUi(d.report.score)}</div>
                  <div className="label">/ 100</div>
                </div>
              </div>

              <DirectionPlanPreview design={d.design} label={d.label} />
              <DirectionRender plan={d.design} planId={d.buildingModel.planId} seed={d.seed} label={d.label}
                elements={d.facadeModel.features.map((f) => FEATURE_LABEL[f.type] ?? f.type.replaceAll('_', ' ').toLowerCase())} />

              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 p-5 font-mono text-[0.7rem] uppercase tracking-[0.08em]">
                <span className={d.report.hardChecksPass ? 'text-ok' : 'text-bad'}>
                  {translateUi(d.report.hardChecksPass ? '● Hard checks pass' : '● Hard checks fail')}
                </span>
                <span className="text-ink-faint">
                  {translateUi(d.report.counts.warning)} {translateUi(" advisories")}</span>
                <span className="text-ink-faint">
                  {translateUi(d.design.builtAreaSqm.toFixed(0))} {translateUi(" m² · ")}{translateUi(d.design.floors.length)} {translateUi(" floors")}</span>
              </div>

              {evidence.find(e=>e.id===d.design.id)&&<DirectionRecommendation evidence={evidence.find(e=>e.id===d.design.id)!} advice={advice}/>}
              <button
                type="button"
                disabled={selecting!==null}
                aria-busy={selecting===d.design.id}
                onClick={() => choose(d)}
                className={cx(
                  'mt-auto flex items-center justify-center gap-2 border-t py-3.5 font-mono text-xs uppercase tracking-[0.12em] transition-colors',
                  isPinned
                    ? 'border-accent bg-accent text-white'
                    : 'border-line text-ink-dim hover:bg-bg-raised hover:text-ink',
                )}
              >
                {selecting===d.design.id?'Opening plan…':isPinned ? (
                  <>
                    {translateUi("Continue to 2D plan")}<ArrowRight size={13} />
                  </>
                ) : (
                  <>
                    <Check size={13} />
                    {translateUi("Pin this direction")}</>
                )}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** plain names for the architectural elements a direction is built from */
const FEATURE_LABEL: Partial<Record<string, string>> = {
  PERGOLA_COURT: 'courtyard pergola', FOLDED_CANOPY: 'folded canopy', PERFORATED_BRICK_WALL: 'brick veil',
  BAY_WINDOW: 'glazed bay', CANTILEVER_STAIR_TOWER: 'stair frame', ROOF_GARDEN_EDGE: 'roof planter edge',
  SOLAR_SHADE_ROOF: 'slatted solar shade', GATE_PORTAL: 'garden gate portal',
  CHIMNEY_TOWER: 'sculpted tower', POOL_PAVILION: 'pool pavilion',
  COLONNADE: 'stone colonnade', FREEFORM_CANOPY: 'free-standing canopy', STEEL_GRID: 'steel frame grid',
  TIMBER_BATTEN: 'timber battens', STONE_PLINTH: 'stone plinth', COURTYARD_SCREEN: 'courtyard screen',
  JALI_SCREEN: 'jaali screen', DEEP_OVERHANG: 'deep overhang', FLOATING_BOX: 'floating box',
  ENTRY_PORTAL: 'entrance portal', DOUBLE_HEIGHT_PORTAL: 'double-height portal', PERGOLA_FRAME: 'pergola',
}

/** the direction's Blender villa: its hero render, or where the render stands */
function DirectionRender({ plan, planId, seed, label, elements }: { plan: Design; planId: string; seed: number; label: string; elements: string[] }) {
  useLanguage(s => s.language);

  const key = directionRenderKey(planId, seed)
  const result = useBlender((s) => s.directionRenders[key])
  const preview = useBlender((s) => s.previews[key])
  const retryPreview=useBlender(s=>s.previewDirections)
  return <div className="house-preview border-b border-line relative group">
    {result||preview?.heroPreview ? (
      <>
        <div className="absolute top-2 right-2 z-10 pointer-events-auto">
          <a
            href={result?.files.hero??preview?.heroPreview}
            download={`${label.toLowerCase().replace(/\s+/g, '-')}-hero.jpg`}
            className="flex items-center gap-1.5 border border-line bg-bg-raised/95 backdrop-blur-xs px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-ink shadow-xs hover:border-accent hover:text-accent transition-colors"
            title={translateUi("Download 3D Render")}
          >
            <Download size={11} className="text-ink-dim" />
            <span>{translateUi("Render")}</span>
            <span className="text-[9px] text-ink-faint">.JPG</span>
          </a>
        </div>
        <img src={result?.files.hero??preview?.heroPreview} alt={translateUi(`${label} — Blender render`)} className="aspect-[3/2] w-full object-cover" loading="lazy" decoding="async" />
        {!result&&preview?.status!=='complete'&&<div className="absolute bottom-12 left-2 right-2 border border-line bg-bg/95 px-3 py-2"><RenderProgress progress={preview?.progress} label="Main view ready · finishing model files"/></div>}
      </>
    ) : (
      <div className="flex aspect-[3/2] w-full flex-col items-center justify-center bg-bg-inset p-6 text-center text-sm text-ink-dim" role="status">
        {!preview || ['queued', 'generating', 'rendering'].includes(preview.status)
          ? <div className="w-full"><RenderProgress progress={preview?.progress} label={preview?.phase || 'Building this villa in Blender…'} /></div>
          : preview.status === 'unavailable' ? `3D render unavailable: ${preview.phase}`
            : `The render stopped: ${preview.error ?? preview.phase}`}
        {preview&&['failed','unavailable'].includes(preview.status)&&<button type="button" className="mt-3 min-h-11 border border-line px-4 py-2 text-sm text-ink hover:bg-bg" onClick={()=>void retryPreview([{plan,seed}],true)}>{translateUi('Retry this render')}</button>}
      </div>
    )}
    <p className="px-5 py-2.5 font-mono text-[0.65rem] uppercase tracking-[0.08em] text-ink-faint">{translateUi(result ? 'Visualisation · Blender · ' : '')}{translateUi(elements.join(' · '))}</p>
  </div>
}

export function DirectionPlanPreview({ design, label }: { design: Design; label: string }) {
  useLanguage(s => s.language);

  const [level, setLevel] = useState(0)
  const svgRef = useRef<SVGSVGElement>(null)
  const floor = design.floors[Math.min(level, design.floors.length - 1)]
  return <div className="border-b border-line">
    <div className="flex flex-wrap items-center justify-between gap-1 bg-bg-inset p-2" role="tablist" aria-label={translateUi(`${label} floors`)}>
      <div className="flex flex-wrap gap-1">
        {design.floors.map((f, i) => (
          <button
            key={f.level}
            type="button"
            role="tab"
            aria-selected={i === level}
            onClick={() => setLevel(i)}
            className={cx('border px-3 py-2 font-mono text-xs', i === level ? 'border-accent bg-accent text-white' : 'border-line text-ink-dim')}
          >
            {translateUi(f.level === 0 ? 'Ground' : `Floor ${f.level}`)}
          </button>
        ))}
      </div>
      <ExportDropdown
        size="sm"
        label="Download Plan"
        title="Download Direction Plan"
        items={[
          {
            id: 'dir-plan-svg',
            label: 'Vector Plan',
            ext: '.svg',
            onExport: async () => {
              if (svgRef.current) {
                await downloadSvg(svgRef.current, `${label.toLowerCase().replace(/\s+/g, '-')}-floor-${floor.level}.svg`, {
                  title: `${label} Floor ${floor.level}`,
                  background: '#ffffff',
                })
              }
            },
          },
          {
            id: 'dir-plan-png',
            label: 'High-DPI Sheet',
            ext: '.png',
            onExport: async () => {
              if (svgRef.current) {
                await downloadSvgAsPng(svgRef.current, `${label.toLowerCase().replace(/\s+/g, '-')}-floor-${floor.level}.png`, {
                  scale: 2,
                  background: '#ffffff',
                })
              }
            },
          },
        ]}
      />
    </div>
    <div className="aspect-[3/2] w-full" aria-label={translateUi(`${label} ${floor.name} 2D plan`)}>
      <MemoFloorDrawing svgRef={svgRef} floor={floor} model={design.model} siteFeatures={design.siteFeatures} theme="paper" showDimensions={false} />
    </div>
    <div className="flex items-center justify-between gap-3 border-t border-line bg-bg-inset px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-dim"><span>{translateUi('Front entrance')} · {design.model.entrySide}</span>{horizontalPlan(design)&&<span>{translateUi('Wide frontage')}</span>}</div>
  </div>
}
