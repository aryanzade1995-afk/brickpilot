import { FloorDrawing } from '@/lib/draw/FloorDrawing.tsx'
import type { Design } from '@/lib/engine/types.ts'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Check, ImagePlus, Pin } from 'lucide-react'
import { useStudio } from '@/state/studio.ts'
import { WorkspaceTabs } from '@/components/WorkspaceTabs.tsx'
import { VillaGenerationNotice } from '@/components/VillaGenerationNotice.tsx'
import { cx } from '@/lib/cx.ts'
import { briefSiteIssues, compile } from '@/lib/model/canonical.ts'
import { generate } from '@/lib/engine/generate.ts'
import { validate } from '@/lib/rules/index.ts'
import { prepareInspiration } from '@/lib/render/prepareInspiration.ts'
import { analyzeInspiration } from '@/lib/engine/inspiration.ts'
import { useRender } from '@/state/render.ts'
import { RenderProgress } from '@/components/RenderProgress.tsx'
import { useBlender, directionRenderKey } from '@/state/blender.ts'

export function Directions() {
  const directions = useStudio((s) => s.directions)
  const explore = useStudio((s) => s.explore)
  const pin = useStudio((s) => s.pin)
  const pinned = useStudio((s) => s.pinned)
  const brief = useStudio((s) => s.brief)
  const generationNotice = useStudio((s) => s.generationNotice)
  const referencePreferences = useStudio((s) => s.referencePreferences)
  const setReferencePreferences = useStudio((s) => s.setReferencePreferences)
  const setRenderInspiration = useRender((s) => s.setInspiration)
  const [referenceImage, setReferenceImage] = useState<string | null>(null)
  const [referenceBusy, setReferenceBusy] = useState(false)
  const [referenceError, setReferenceError] = useState<string | null>(null)
  const [analysisAvailable, setAnalysisAvailable] = useState<boolean | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!directions) explore()
  }, [directions, explore])

  // each direction is rendered in Blender exactly as shown on its card
  const previewDirections = useBlender((s) => s.previewDirections)
  useEffect(() => {
    if (directions?.length) void previewDirections(directions.map((d) => ({ plan: d.design, seed: d.seed })))
  }, [directions, previewDirections])

  useEffect(() => {
    let active = true
    fetch('/api/inspiration/health').then((response) => response.json())
      .then((health) => { if (active) setAnalysisAvailable(Boolean(health.reachable)) })
      .catch(() => { if (active) setAnalysisAvailable(false) })
    return () => { active = false }
  }, [])

  if (!directions) {
    return <div className="mx-auto max-w-[1400px] px-10 py-24 text-ink-dim">Engineering directions…</div>
  }

  if (directions.length === 0) {
    if (generationNotice) return <div className="mx-auto max-w-3xl px-6 py-12 md:px-10">
      <WorkspaceTabs /><h1 className="mt-8 font-display text-3xl">No new distinct direction</h1>
      <VillaGenerationNotice blocked />
      <Link to="/workspace" className="text-sm text-ink underline">Edit brief</Link>
    </div>
    const siteIssues = briefSiteIssues(brief)
    const errors = siteIssues.length ? siteIssues : validate(generate(compile(brief))).findings
      .filter((finding) => finding.severity === 'error').map((finding) => finding.message)
    return <div className="mx-auto max-w-3xl px-6 py-12 md:px-10">
      <WorkspaceTabs />
      <h1 className="mt-8 font-display text-3xl">The saved brief needs adjustment</h1>
      <p className="mt-3 text-sm text-ink-dim">This safety check protects older saved briefs and direct links. No generated direction passes the plan checks yet. Adjust the plot, setbacks, requested rooms or massing choice, then generate again.</p>
      <ul className="mt-6 space-y-2 border-y border-line py-4 text-sm text-bad">
        {errors.slice(0, 8).map((message, index) => <li key={index}>• {message}</li>)}
      </ul>
      <Link to="/workspace" className="mt-6 inline-block border border-line-strong px-5 py-3 font-mono text-xs uppercase text-ink hover:border-accent">Edit brief</Link>
    </div>
  }

  const choose = (d: (typeof directions)[number]) => {
    pin({ massing: d.massing, seed: d.seed, ...(d.planSeed !== undefined ? { planSeed: d.planSeed } : {}) })
    navigate('/workspace/plan')
  }

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-8 md:px-10">
      <WorkspaceTabs />

      <div className="mt-6 max-w-2xl">
        <h1 className="font-display text-[clamp(1.8rem,3.5vw,2.6rem)]">Choose a design direction</h1>
        <p className="mt-3 text-ink-dim">
          Each direction is a different house in your chosen style — its own plan shape where your plot allows,
          with every room, door, window and stair checked. Pin the one you prefer.
        </p>
      </div>

      <VillaGenerationNotice />

      <div className="mt-7 border border-line p-5">
        <div className="flex items-start gap-3">
          <ImagePlus size={18} className="mt-0.5 text-accent" />
          <div className="flex-1">
            <div className="label">Use an inspiration image</div>
            <p className="mt-2 max-w-2xl text-sm text-ink-dim">
              An image can guide materials and façade details within your chosen style. The verified plan and its doors and windows stay fixed.
            </p>
            {analysisAvailable === false && <p className="mt-2 text-xs text-ink-dim" role="status">
              AI style analysis is offline. You can still select an image as a visual reference.
            </p>}
            <input type="file" accept="image/png,image/jpeg,image/webp" disabled={referenceBusy}
              className="mt-3 block w-full text-xs text-ink-dim"
              onChange={async (event) => {
                const file = event.target.files?.[0]
                if (!file) return
                setReferenceBusy(true)
                setReferenceError(null)
                try {
                  const image = await prepareInspiration(file)
                  setReferenceImage(image)
                  setRenderInspiration(image)
                  const preferences = await analyzeInspiration(image)
                  setReferencePreferences(preferences)
                } catch (error) {
                  setReferenceError(error instanceof Error ? error.message : 'Could not read that image.')
                } finally {
                  setReferenceBusy(false)
                  event.target.value = ''
                }
              }} />
            {referenceImage && <div className="mt-3 flex items-center gap-3">
              <img src={referenceImage} alt="Villa inspiration" className="h-16 w-20 object-cover" />
              <button type="button" className="text-xs text-ink-dim underline" onClick={() => {
                setReferenceImage(null)
                setRenderInspiration(null)
                setReferencePreferences(null)
                setReferenceError(null)
              }}>Remove inspiration</button>
            </div>}
            {referenceBusy && <p className="mt-3 text-xs text-ink-dim" role="status">Reading architectural style…</p>}
            {referencePreferences?.styleFamily && <p className="mt-3 text-xs text-ok" role="status">
              Reference cues: {referencePreferences.styleFamily.replaceAll('-', ' ')} · {referencePreferences.materialPalette?.replaceAll('-', ' ') ?? 'coordinated materials'}
            </p>}
            {referenceError && <p className="mt-3 text-xs text-bad" role="alert">{referenceError} The image stays selected, but automatic style analysis is unavailable right now.</p>}
          </div>
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {directions.map((d) => {
          const isPinned = pinned?.massing === d.massing && pinned?.seed === d.seed && pinned?.planSeed === d.planSeed
          return (
            <div
              key={`${d.massing}:${d.seed}`}
              className={cx(
                'flex flex-col border transition-colors',
                isPinned ? 'border-accent' : 'border-line',
              )}
            >
              <div className="flex items-start justify-between gap-4 border-b border-line p-5">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-display text-xl">{d.label}</h2>
                    {isPinned && (
                      <span className="inline-flex items-center gap-1 bg-accent px-1.5 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-white">
                        <Pin size={9} /> Pinned
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 max-w-sm text-sm text-ink-dim">{d.blurb}</p>
                  <p className="mt-2 font-mono text-[0.65rem] uppercase tracking-[0.08em] text-ink-faint">
                    {d.design.dna.styleFamily.replaceAll('-', ' ')} · {d.design.dna.roofDesign.replaceAll('-', ' ')} roof · novelty {Math.round(d.novelty)}/100
                  </p>
                </div>
                <div className="flex-none text-right">
                  <div className="font-display text-2xl tnum">{d.report.score}</div>
                  <div className="label">/ 100</div>
                </div>
              </div>

              <DirectionRender planId={d.buildingModel.planId} seed={d.seed} label={d.label}
                elements={d.facadeModel.features.map((f) => FEATURE_LABEL[f.type] ?? f.type.replaceAll('_', ' ').toLowerCase())} />
              <DirectionPlanPreview design={d.design} label={d.label} />

              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 p-5 font-mono text-[0.7rem] uppercase tracking-[0.08em]">
                <span className={d.report.hardChecksPass ? 'text-ok' : 'text-bad'}>
                  {d.report.hardChecksPass ? '● Hard checks pass' : '● Hard checks fail'}
                </span>
                <span className="text-ink-faint">
                  {d.report.counts.warning} advisories
                </span>
                <span className="text-ink-faint">
                  {d.design.builtAreaSqm.toFixed(0)} m² · {d.design.floors.length} floors
                </span>
              </div>

              <button
                type="button"
                onClick={() => choose(d)}
                className={cx(
                  'mt-auto flex items-center justify-center gap-2 border-t py-3.5 font-mono text-xs uppercase tracking-[0.12em] transition-colors',
                  isPinned
                    ? 'border-accent bg-accent text-white'
                    : 'border-line text-ink-dim hover:bg-bg-raised hover:text-ink',
                )}
              >
                {isPinned ? (
                  <>
                    Continue to 2D plan
                    <ArrowRight size={13} />
                  </>
                ) : (
                  <>
                    <Check size={13} />
                    Pin this direction
                  </>
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
function DirectionRender({ planId, seed, label, elements }: { planId: string; seed: number; label: string; elements: string[] }) {
  const key = directionRenderKey(planId, seed)
  const result = useBlender((s) => s.directionRenders[key])
  const preview = useBlender((s) => s.previews[key])
  return <div className="border-b border-line">
    {result ? <img src={result.files.hero} alt={`${label} — Blender render`} className="aspect-[3/2] w-full object-cover" />
      : <div className="flex aspect-[3/2] w-full items-center justify-center bg-bg-inset p-6 text-center text-sm text-ink-dim" role="status">
        {!preview || ['queued', 'generating', 'rendering'].includes(preview.status)
          ? <div className="w-full"><RenderProgress progress={preview?.progress} label={preview?.phase || 'Building this villa in Blender…'} /></div>
          : preview.status === 'unavailable' ? `3D render unavailable: ${preview.phase}`
            : `The render stopped: ${preview.error ?? preview.phase}`}
      </div>}
    <p className="px-5 py-2.5 font-mono text-[0.65rem] uppercase tracking-[0.08em] text-ink-faint">{result ? 'Visualisation · Blender · ' : ''}{elements.join(' · ')}</p>
  </div>
}

export function DirectionPlanPreview({ design, label }: { design: Design; label: string }) {
 const [level, setLevel] = useState(0)
 const floor = design.floors[Math.min(level, design.floors.length - 1)]
 return <div className="border-b border-line">
  <div className="flex flex-wrap gap-1 bg-bg-inset p-2" role="tablist" aria-label={`${label} floors`}>
   {design.floors.map((f,i)=><button key={f.level} type="button" role="tab" aria-selected={i===level}
    onClick={()=>setLevel(i)} className={cx('border px-3 py-2 font-mono text-xs',i===level?'border-accent bg-accent text-white':'border-line text-ink-dim')}>
    {f.level===0?'Ground':`Floor ${f.level}`}
   </button>)}
  </div>
  <div className="aspect-[3/2] w-full" aria-label={`${label} ${floor.name} 2D plan`}>
   <FloorDrawing floor={floor} model={design.model} siteFeatures={design.siteFeatures} theme="paper" showDimensions={false} />
  </div>
 </div>
}
