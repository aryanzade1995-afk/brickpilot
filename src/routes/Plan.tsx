import { translate as translateUi, useLanguage } from '@/lib/i18n/index.ts'
import { useFinishes } from '@/state/finishes.ts'
import { useCostResearch } from '@/state/costResearch.ts'
import { estimateProjectBoq } from '@/lib/cost/index.ts'
import { geometryCostKey } from '@/lib/cost/quantities.ts'
import { formatINR, formatRange } from '@/lib/format.ts'
import { lazy, Suspense, useEffect, useMemo } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { Pencil } from 'lucide-react'
import { useStudio } from '@/state/studio.ts'
import { DrawingWorkspace } from '@/components/DrawingWorkspace.tsx'
import { PlanEditor } from '@/components/PlanEditor.tsx'
import { isEditable } from '@/lib/plan/ops.ts'
import { cx } from '@/lib/cx.ts'
import { WorkspaceTabs } from '@/components/WorkspaceTabs.tsx'
import { VillaGenerationNotice } from '@/components/VillaGenerationNotice.tsx'
import { InvalidPlanNotice } from '@/components/InvalidPlanNotice.tsx'
import { ExportDropdown } from '@/components/export/ExportDropdown.tsx'
import { downloadSvg, downloadSvgAsPng } from '@/lib/export/index.ts'
import { downloadSheetPdf } from '@/lib/draw/exportSheet.ts'

const ReferenceFacadeSection = lazy(() => import('@/components/reference/ReferenceFacadeSection.tsx').then(module => ({ default: module.ReferenceFacadeSection })))

export function Plan() {
  useLanguage(s => s.language);

  const [params, setParams] = useSearchParams()
  const { hash } = useLocation()
  const brief = useStudio(s => s.brief)
  const result = useStudio((s) => s.result)
  const run = useStudio((s) => s.run)
  const layout = useStudio((s) => s.layout)
  const basePlan = useStudio((s) => s.basePlan)
  const editable = useMemo(() => (result ? isEditable(basePlan() ?? result.design) : false), [result?.design.id, basePlan]) // eslint-disable-line react-hooks/exhaustive-deps
  const editing = params.get('edit') === '1' && editable
  const toggleEdit = () => { const next = new URLSearchParams(params); if (editing) next.delete('edit'); else next.set('edit', '1'); setParams(next, { replace: true }) }

  const saved = useFinishes(s => s.entries[result ? geometryCostKey(result.design) : ''])
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

  const cost = useMemo(() => result?.report.hardChecksPass ? estimateProjectBoq(result.design, brief, saved, result, pricingContext) : null, [result, brief, saved, pricingContext])
  const drawingDesign = useMemo(() => result ? { ...result.design, model: { ...result.design.model, brief } } : null, [result, brief])
  useEffect(() => {
    if (!result) run()
  }, [result, run])

  useEffect(() => {
    if (result && (hash === '#reference-facade' || hash === '#floor-plan')) {
      document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' })
    }
  }, [result, hash])

  if (!result) {
    return <div className="mx-auto max-w-[1400px] px-10 py-24 text-ink-dim">{translateUi("Generating…")}</div>
  }
  if (!result.report.hardChecksPass) return <InvalidPlanNotice report={result.report} />

  const { design } = result

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-8 md:px-10">
      <WorkspaceTabs />
      <VillaGenerationNotice />

      {design.siteNotes?.length ? <div className="mt-4 border border-line px-4 py-3 text-xs text-ink-dim" role="status">{design.siteNotes.map(note => <p key={note}>{translateUi(note)}</p>)}</div> : null}
      {/* metric bar */}
      <div className="mt-5 flex flex-wrap items-center gap-x-10 gap-y-3 border-b border-line pb-4">
        <Metric k="Built area" v={`${design.builtAreaSqm.toFixed(1)} m²`} />
        <Metric k="Height" v={`${design.heightM} m`} />
        <Metric k="Coverage" v={`${(design.coverage * 100).toFixed(0)} %`} />
      </div>

      <div id="floor-plan" className="mt-4 flex scroll-mt-6 flex-wrap items-center justify-between gap-3" data-testid="edit-bar">
        <div className="flex flex-wrap items-center gap-3">
          {editable ? (
            <button type="button" onClick={toggleEdit} aria-pressed={editing}
              className={cx('flex items-center gap-2 border px-3 py-2 font-mono text-[0.7rem] uppercase tracking-[0.1em]', editing ? 'border-accent text-accent' : 'border-line-strong text-ink-dim hover:border-ink-dim hover:text-ink')}>
              <Pencil size={12} /> {translateUi(editing ? 'Done editing' : 'Edit rooms')}
            </button>
          ) : (
            <p className="text-xs text-ink-faint" role="note">{translateUi("Room-by-room editing is available for the standard plan layouts. Wing and courtyard-ring villas are not editable yet.")}</p>
          )}
          <Link to="#reference-facade" className="inline-flex min-h-11 items-center border border-line-strong px-3 py-2 font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-dim hover:text-ink">{translateUi("Reference facade")} ↓</Link>
          {layout && <span className="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-warn">{translateUi("Edited plan · saved with the project")}</span>}
        </div>
        <ExportDropdown
          label="Download Plan"
          title="Download Floor Plan"
          size="md"
          items={[
            {
              id: 'svg',
              label: 'Vector Plan',
              ext: 'SVG',
              onExport: () => {
                const svg = document.querySelector('.drawing-viewport svg') as SVGSVGElement | null
                if (svg) downloadSvg(svg, `plan_${design.dna.seed}`, { background: '#ffffff' })
              },
            },
            {
              id: 'png',
              label: 'High-DPI Sheet',
              ext: 'PNG',
              onExport: async () => {
                const svg = document.querySelector('.drawing-viewport svg') as SVGSVGElement | null
                if (svg) await downloadSvgAsPng(svg, `plan_${design.dna.seed}`, { background: '#ffffff', scale: 2 })
              },
            },
            {
              id: 'pdf',
              label: 'A3 Print Sheet',
              ext: 'PDF',
              onExport: async () => {
                const svg = document.querySelector('.drawing-viewport svg') as SVGSVGElement | null
                if (svg) await downloadSheetPdf(svg, `plan_${design.dna.seed}`)
              },
            },
          ]}
        />
      </div>
      <div className="mt-4">{editing ? <PlanEditor design={drawingDesign!} /> : <DrawingWorkspace key={`${params.get("floor")}:${params.get("highlight")}`} design={drawingDesign!} initialFloorLevel={params.has("floor") ? Number(params.get("floor")) : undefined} highlightCategory={params.get("highlight") ?? undefined} />}</div>
      {cost && <section aria-label={translateUi("Cost summary")} className="mt-6 flex flex-wrap items-center justify-between gap-4 border-y border-line py-5"><div><Link to="/workspace/finishes?tab=estimate" className="text-sm underline">{translateUi("Cost band · ")}{translateUi(formatRange(cost.total.low, cost.total.high, formatINR))}</Link><p className="mt-2 text-xs text-ink-faint">{translateUi(cost.label)}</p></div><Link to="/workspace/finishes" className="text-sm underline">{translateUi("Finishes & cost →")}</Link></section>}
      <div id="reference-facade" className="scroll-mt-6">
        <Suspense fallback={<p role="status" className="py-8 text-sm text-ink-dim">{translateUi("Loading reference facade…")}</p>}>
          <ReferenceFacadeSection />
        </Suspense>
      </div>
    </div>
  )
}

/* ---------------------------------- bits ---------------------------------- */

function Metric({ k, v }: { k: string; v: string }) {
  useLanguage(s => s.language);

  return (
    <div>
      <span className="label">{translateUi(k)}</span>
      <div className="mt-0.5 font-mono text-sm text-ink tnum">{translateUi(v)}</div>
    </div>
  )
}
