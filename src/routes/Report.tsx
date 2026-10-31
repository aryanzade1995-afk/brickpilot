import { formatINR, formatRange } from '@/lib/format.ts'
import { translate as translateUi, useLanguage } from '@/lib/i18n/index.ts'
import { useVillaVisualizations } from '@/state/villaVisualizations.ts'
import { VILLA_VIEW_LABELS, visualizationSourceId } from '@/lib/render/villaVisualizations.ts'
import { SpecificationSchedule } from '@/components/SpecificationSchedule.tsx'
import { specificationSchedule } from '@/lib/cost/schedule.ts'
import { QuantitiesView, EstimateView, LabourEstimateCard } from './finishes/CostViews.tsx'
import { useBlender } from '@/state/blender.ts'
import { useSolarArtifacts, solarArtifactKey, isCurrentSolarArtifact } from '@/state/solarArtifacts.ts'
import { createBuildingModel } from '@/lib/engine/buildingModel.ts'
import { finishSignature } from '@/lib/cost/finishAssignments.ts'
import type { Result } from '@/state/studio.ts'
import type { Brief } from '@/lib/model/brief.ts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, FileText, Loader2 } from 'lucide-react'
import { useStudio } from '@/state/studio.ts'
import { useRender, REF_LABEL, type RefKey } from '@/state/render.ts'
import { FloorDrawing, TerraceDrawing } from '@/lib/draw/FloorDrawing.tsx'
import { MassingViewport, MASSING_CANVAS, type CaptureView } from '@/lib/render/CaptureCanvas.tsx'
import { rasterizeSvg } from '@/lib/render/rasterizeSvg.ts'
import { WorkspaceTabs } from '@/components/WorkspaceTabs.tsx'
import { InvalidPlanNotice } from '@/components/InvalidPlanNotice.tsx'
import { useFinishes } from '@/state/finishes.ts'
import { useCostResearch } from '@/state/costResearch.ts'
import { estimateProjectBoq } from '@/lib/cost/index.ts'
import { geometryCostKey } from '@/lib/cost/quantities.ts'
import { ZONE_LABEL } from '@/lib/model/canonical.ts'
import { cx } from '@/lib/cx.ts'
import type { ReportImage } from '@/lib/report/buildPdf.ts'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '') || 'project'

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function Report({ sourceResult, sourceBrief, visualisations = [] }: { sourceResult?: Result; sourceBrief?: Brief; visualisations?: ReportImage[] } = {}) {
  useLanguage(s => s.language);

  const storedResult = useStudio((s) => s.result)
  const result = sourceResult ?? storedResult
  const run = useStudio((s) => s.run)
  const storedBrief = useStudio(s => s.brief)
  const brief = sourceBrief ?? storedBrief
  const costKey = useMemo(() => result ? geometryCostKey(result.design) : '', [result])
  const selection = useFinishes(s => s.entries[costKey])
  const pricingSnapshot = useCostResearch(s => s.acceptedSnapshot)
  const manualOverrides = useCostResearch(s => s.manualOverrides)
  const interiorSchedule = useCostResearch(s => s.interiorSchedule)
  const scopeMode = useCostResearch(s => s.scopeMode)
  const location = useCostResearch(s => s.location)
  const pricingContext = useMemo(() => ({
    id: pricingSnapshot?.id || 'baseline',
    location: pricingSnapshot?.location || location,
    rates: pricingSnapshot?.rates || {},
    manualOverrides,
    interiorSchedule: interiorSchedule || undefined,
    scopeMode,
  }), [pricingSnapshot, manualOverrides, interiorSchedule, scopeMode, location])
  const cost = useMemo(() => result ? estimateProjectBoq(result.design, brief, selection, result, pricingContext) : null, [result, selection, brief, pricingContext])
  useEffect(() => {
    if (!result) run()
  }, [result, run])

  const planId = useMemo(() => result ? createBuildingModel({ ...result.design, model: { ...result.design.model, brief } }).planId : '', [result, brief])
  const blender = useBlender(s => s.accepted[planId])
  const solarPreview = useSolarArtifacts(s => s.renders[solarArtifactKey(blender, brief.solar, 'preview')])
  const solarFinal = useSolarArtifacts(s => s.renders[solarArtifactKey(blender, brief.solar, 'final')])
  const currentSolar = isCurrentSolarArtifact(solarFinal, blender, brief.solar) ? solarFinal :
    isCurrentSolarArtifact(solarPreview, blender, brief.solar) ? solarPreview : undefined
  const blenderImages = useMemo<ReportImage[]>(() => blender?.finishSignature === finishSignature(brief)
    ? (['hero','front'] as const).map(view => currentSolar ? ({ label: view === 'front' ? 'Front view' : 'Perspective', dataUrl: currentSolar.files[view],
      artifactScope: 'building-plus-solar', solarVisualSignature: currentSolar.solarVisualSignature }) :
      ({label: view === 'front' ? 'Front view' : 'Perspective', dataUrl: blender.files[view], artifactScope: 'building-only'})) : visualisations,
    [blender, brief, visualisations, currentSolar])
  const villaPairs=useVillaVisualizations(s=>s.pairs)
  const renderJobs = useRender((s) => s.jobs)

  const svgRefs = useRef<(SVGSVGElement | null)[]>([])
  // the 3D massing canvas is mounted only during a capture — no persistent WebGL context
  const [grab3d, setGrab3d] = useState(false)
  const [view, setView] = useState<CaptureView>('front')
  const [floorIdx, setFloorIdx] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const character = result?.model.brief.style.character ?? 'modern-indian'

  const conceptImages = useMemo<ReportImage[]>(() => {
    const out: ReportImage[] = []
    const currentSources=new Set(result?[
      ...(blender?[visualizationSourceId(planId,'blender',blender.seed,blender.files.glb,finishSignature(brief))]:[]),
    ]:[])
    for(const pair of Object.values(villaPairs).filter(p=>currentSources.has(p.sourceId))) {
      const label='Blender villa'
      pair.images.forEach(image=>out.push({label:`Building-only AI reference · not current solar design (${label}) — ${VILLA_VIEW_LABELS[image.view]}`,dataUrl:image.url,artifactScope:'building-only'}))
    }
    for (const k of Object.keys(renderJobs) as RefKey[]) {
      const j = renderJobs[k]
      if (j.status === 'done' && j.url) out.push({ label: `Building/interior-only reference · not current solar design (${j.mock ? 'source preview' : 'AI'}) — ${REF_LABEL[k]}`, dataUrl: j.url, artifactScope: 'building-only' })
    }
    return out
  }, [renderJobs, villaPairs, planId, brief, result, blender])

  if (!result || !cost) {
    return <div className="mx-auto max-w-[1400px] px-10 py-24 text-ink-dim">{translateUi("Preparing report…")}</div>
  }
  if (!result.report.hardChecksPass) return <InvalidPlanNotice report={result.report} />

  const { design, model, report } = result
  const floor = design.floors[Math.min(floorIdx, design.floors.length - 1)]

  /** briefly mount the 3D massing offscreen, drive two poses, read the canvas */
  const captureMassing = async (): Promise<ReportImage[]> => {
    setGrab3d(true)
    try {
      const canvas = () => document.querySelector<HTMLCanvasElement>(MASSING_CANVAS)
      for (let i = 0; i < 50 && !(canvas()?.width ?? 0); i++) await wait(150)
      if (!canvas()?.width) return []
      const out: ReportImage[] = []
      for (const [key, label] of [
        ['front', 'Building only · Visualisation (3D) — front'],
        ['top', 'Building only · Visualisation (3D) — roof + site'],
      ] as const) {
        setView(key)
        await wait(1000)
        const el = canvas()
        if (el?.width) {
          const url = el.toDataURL('image/png')
          if (url.length > 5000) out.push({ label, dataUrl: url })
        }
      }
      return out
    } catch {
      return []
    } finally {
      setGrab3d(false)
    }
  }

  const downloadExtra = async (format: 'xlsx' | 'spec') => {
    if (busy) return
    setBusy(format === 'xlsx' ? 'Preparing Excel…' : 'Preparing specification sheet…'); setError(null)
    try {
      const blob = format === 'xlsx'
        ? await (await import('@/lib/cost/exportExcel.ts')).buildBoqExcel(cost, brief.project.name)
        : await (await import('@/lib/report/specSheet.ts')).buildSpecSheetPdf({ projectName: brief.project.name, schedule: specificationSchedule(brief, cost), cost })
      triggerDownload(blob, `formstead-${slug(brief.project.name)}-${format === 'xlsx' ? 'boq.xlsx' : 'specifications.pdf'}`)
    } catch (e) { setError(e instanceof Error ? e.message : 'The export could not be prepared.') }
    finally { setBusy(null) }
  }
  const imageBytes = async (img: ReportImage): Promise<ReportImage> => {
    if (img.dataUrl.startsWith('data:')) return img
    const response = await fetch(img.dataUrl)
    if (!response.ok) throw new Error('A rendered view could not load. Please try the report again.')
    const blob = await response.blob()
    const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob) })
    return {...img,dataUrl}
  }
  const download = async () => {
    if (busy) return
    setError(null)
    try {
      setBusy('Capturing 3D massing…')
      const massingImages = blenderImages.length ? await Promise.all(blenderImages.map(imageBytes)) : await captureMassing()

      setBusy('Drawing floor plans…')
      const planImages: ReportImage[] = []
      for (let i = 0; i < design.floors.length; i++) {
        const svg = svgRefs.current[i]
        if (svg) planImages.push({ label: design.floors[i].name, dataUrl: await rasterizeSvg(svg) })
      }
      // the roof terrace sheet follows the floors (the PDF gives it a heading, no room table)
      const terraceSvg = svgRefs.current[design.floors.length]
      if (terraceSvg) planImages.push({ label: 'Terrace', dataUrl: await rasterizeSvg(terraceSvg) })

      setBusy('Building the PDF…')
      const { buildReportPdf } = await import('@/lib/report/buildPdf.ts')
      const blob = await buildReportPdf({
        projectName: model.brief.project.name,
        brief,
        design,
        report,
        cost,
        planImages,
        massingImages,
        conceptImages: await Promise.all(conceptImages.map(imageBytes)),
      })
      triggerDownload(blob, `formstead-${slug(model.brief.project.name)}-report.pdf`)
    } catch (e) {
      setError(String((e as Error).message || e))
    } finally {
      setBusy(null)
    }
  }


  return (
    <div className="mx-auto max-w-[1400px] px-6 py-8 md:px-10">
      <WorkspaceTabs />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl">{model.brief.project.name}</h1>
        <div className="label text-accent">{translateUi("Step 7 · Report")}</div>
      </div>

      {/* Top Cards: Expected Total Investment & Project Report */}
      <div className="mt-4 flex flex-wrap items-stretch gap-4">
        {/* Expected Total Investment Box */}
        <div className="flex-1 min-w-[280px] rounded-xl border border-line bg-bg p-5 sm:p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[0.7rem] uppercase tracking-wider text-ink-dim">
                {translateUi("Expected Total Investment")}
              </span>
              <span className="rounded-full border border-line bg-bg-inset px-2.5 py-0.5 font-mono text-xs text-ink font-medium">
                {translateUi("Built area: ")}{design.builtAreaSqm.toFixed(1)} m²
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-baseline gap-3">
              <h2 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
                {translateUi(formatINR(cost.expected))}
              </h2>
              <span className="rounded-full border border-line bg-bg-inset px-2.5 py-0.5 font-mono text-xs text-ink-dim">
                {translateUi(formatINR(cost.ratePerSqft))} / sq ft
              </span>
            </div>
          </div>
          <p className="mt-4 font-mono text-xs text-ink-dim">
            {translateUi("Projected range: ")}
            <span className="text-ink">{translateUi(formatRange(cost.total.low, cost.total.high, formatINR))}</span>
          </p>
        </div>

        {/* Project Report Box - Matching exact styling */}
        <div className="flex-1 min-w-[280px] rounded-xl border border-line bg-bg p-5 sm:p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 font-display text-lg font-medium text-ink">
              <FileText size={18} className="text-accent" />
              <span>{translateUi("Project Report")}</span>
            </div>
            <p className="mt-1 text-xs text-ink-faint">
              {translateUi("Complete project documentation & schedule exports")}
            </p>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={download}
              disabled={!!busy}
              className={cx(
                'inline-flex items-center gap-2 rounded-lg px-4 py-2.5 font-mono text-xs uppercase tracking-wider transition-colors',
                busy ? 'border border-line text-ink-faint' : 'bg-accent text-white hover:bg-accent-hot shadow-xs',
              )}
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              {translateUi(busy ?? 'Download PDF')}
            </button>

            <button
              type="button"
              disabled={!!busy}
              onClick={()=>void downloadExtra('xlsx')}
              className="rounded-lg border border-line bg-bg px-3.5 py-2.5 text-xs text-ink hover:bg-bg-inset disabled:opacity-50 transition-colors"
            >
              {translateUi("BOQ Excel")}
            </button>

            <button
              type="button"
              disabled={!!busy}
              onClick={()=>void downloadExtra('spec')}
              className="rounded-lg border border-line bg-bg px-3.5 py-2.5 text-xs text-ink hover:bg-bg-inset disabled:opacity-50 transition-colors"
            >
              {translateUi("Spec PDF")}
            </button>
          </div>

          {error && (
            <p className="mt-2 text-xs text-bad">{translateUi(error)}</p>
          )}
        </div>
      </div>



      <div className="mt-6 space-y-10">
          {/* plan preview + floor picker */}
          <section>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-xl">{translateUi(floor.name)} {translateUi(" plan")}</h2>
              <div className="flex gap-1">
                {design.floors.map((f, i) => (
                  <button
                    key={f.level}
                    type="button"
                    onClick={() => setFloorIdx(i)}
                    className={cx(
                      'border px-2.5 py-1 font-mono text-[0.65rem] uppercase tracking-[0.1em]',
                      i === floorIdx ? 'border-accent text-accent' : 'border-line text-ink-dim hover:text-ink',
                    )}
                  >
                    {translateUi(f.name)}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-3 aspect-[4/3] w-full border border-line-strong bg-bg-inset">
              <FloorDrawing floor={floor} model={model} theme="presentation" showLabels showDimensions={false} />
            </div>
            <div className="mt-4 overflow-x-auto border-y border-line">
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="label [&>th]:py-2 [&>th]:pr-6 [&>th]:text-left">
                    <th>{translateUi("Space")}</th>
                    <th>{translateUi("Zone")}</th>
                    <th className="text-right">{translateUi("Size")}</th>
                    <th className="text-right">{translateUi("Area")}</th>
                  </tr>
                </thead>
                <tbody>
                  {floor.rooms.map((r, i) => (
                    <tr key={r.id} className={cx('border-t border-line [&>td]:py-2.5 [&>td]:px-4', i % 2 === 1 && 'bg-bg-inset/50')}>
                      <td className="text-ink">{translateUi(r.name)}</td>
                      <td className="text-ink-dim">{translateUi(ZONE_LABEL[r.zone])}</td>
                      <td className="text-right font-mono text-xs text-ink-dim tnum">
                        {translateUi((r.rect.w / 1000).toFixed(1))} × {translateUi((r.rect.h / 1000).toFixed(1))} {translateUi(" m")}</td>
                      <td className="text-right font-mono text-xs text-ink tnum">{translateUi(r.area.toFixed(1))} {translateUi(" m²")}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-line bg-bg-inset [&>td]:py-2.5 [&>td]:px-4 font-medium">
                    <td colSpan={3} className="text-ink-dim">{translateUi("Total")}</td>
                    <td className="text-right font-mono text-xs text-ink tnum">{translateUi(floor.rooms.reduce((sum, r) => sum + r.area, 0).toFixed(1))} {translateUi(" m²")}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <section><h2 className="font-display text-xl">{translateUi("3D & renders")}</h2><p className="mt-2 text-xs text-ink-dim">{translateUi('')}</p>
            {blenderImages.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2">{blenderImages.map(img => <figure key={img.label} className="border border-line"><img src={img.dataUrl} alt={translateUi(img.label)} className="aspect-[4/3] w-full object-contain"/><figcaption className="p-3 text-xs text-ink-dim">{translateUi(img.label)}</figcaption></figure>)}</div> : <p className="mt-3 text-sm text-ink-dim">{translateUi("Generate views on ")}<Link to="/workspace/massing" className="underline">{translateUi("3D Massing")}</Link>{translateUi(". Your report can also capture the current 3D study.")}</p>}
          </section>

          {conceptImages.length > 0 && (
            <section>
              <h2 className="font-display text-xl">{translateUi("Generated concepts")}</h2><p className="mt-2 text-xs text-ink-dim">{translateUi('')}</p>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {conceptImages.map((img, i) => (
                  <figure key={i} className="border border-line">
                    <img src={img.dataUrl} alt={translateUi(img.label)} className="aspect-[3/2] w-full object-cover" />
                    <figcaption className="border-t border-line px-2 py-1.5 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-ink-faint">
                      {translateUi(img.label)}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </section>
          )}
          <SpecificationSchedule rows={specificationSchedule(brief, cost)} />
          <div className="border-t border-line pt-6"><LabourEstimateCard cost={cost} /></div>
          <div className="border-t border-line pt-4"><QuantitiesView cost={cost}/></div>
          <section className="border-t border-line pt-6"><EstimateView cost={cost}/></section>

      </div>

      {/* offscreen plan sources for the PDF raster */}
      <div aria-hidden style={{ position: 'fixed', left: -10000, top: 0, width: 1200, height: 800 }}>
        {design.floors.map((f, i) => (
          <FloorDrawing
            key={f.level}
            svgRef={(el) => {
              svgRefs.current[i] = el
            }}
            floor={f}
            model={model}
            theme="presentation"
            showLabels
            showDimensions={false}
          />
        ))}
        <TerraceDrawing
          design={design}
          svgRef={(el) => {
            svgRefs.current[design.floors.length] = el
          }}
        />
      </div>

      {/* offscreen 3D massing — mounted only during a PDF capture */}
      {grab3d && (
        <div aria-hidden style={{ position: 'fixed', left: -10000, top: 0, width: 900, height: 600 }}>
          <MassingViewport design={design} character={character} view={view} />
        </div>
      )}
    </div>
  )
}


