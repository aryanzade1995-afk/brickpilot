import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, FileText, Loader2, Trash2 } from 'lucide-react'
import { useStudio } from '@/state/studio.ts'
import { useRender, REF_LABEL, type RefKey } from '@/state/render.ts'
import { useInterior } from '@/state/interior.ts'
import { FloorDrawing } from '@/lib/draw/FloorDrawing.tsx'
import { MassingViewport, MASSING_CANVAS, type CaptureView } from '@/lib/render/CaptureCanvas.tsx'
import { rasterizeSvg } from '@/lib/render/rasterizeSvg.ts'
import { WorkspaceTabs } from '@/components/WorkspaceTabs.tsx'
import { ZONE_LABEL } from '@/lib/model/canonical.ts'
import { formatINR, formatINRShort, formatRange } from '@/lib/format.ts'
import { cx } from '@/lib/cx.ts'
import type { Severity } from '@/lib/rules/index.ts'
import type { ReportImage } from '@/lib/report/buildPdf.ts'

const SEV_COLOR: Record<Severity, string> = {
  error: 'text-bad',
  warning: 'text-warn',
  info: 'text-ink-dim',
}

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

export function Report() {
  const result = useStudio((s) => s.result)
  const run = useStudio((s) => s.run)
  useEffect(() => {
    if (!result) run()
  }, [result, run])

  const renderJobs = useRender((s) => s.jobs)
  const resetRender = useRender((s) => s.reset)
  const interiorResults = useInterior((s) => s.results)
  const resetInterior = useInterior((s) => s.reset)

  const svgRefs = useRef<(SVGSVGElement | null)[]>([])
  // the 3D massing canvas is mounted only during a capture — no persistent WebGL context
  const [grab3d, setGrab3d] = useState(false)
  const [view, setView] = useState<CaptureView>('front')
  const [floorIdx, setFloorIdx] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  const character = result?.model.brief.style.character ?? 'modern-indian'

  const conceptImages = useMemo<ReportImage[]>(() => {
    const out: ReportImage[] = []
    for (const k of Object.keys(renderJobs) as RefKey[]) {
      const j = renderJobs[k]
      if (j.status === 'done' && j.url) out.push({ label: `Concept — ${REF_LABEL[k]}`, dataUrl: j.url })
    }
    interiorResults.forEach((r, i) => {
      r.urls.forEach((u, v) =>
        out.push({
          label: `Interior — ${r.roomLabel}${r.urls.length > 1 ? ` (view ${v + 1})` : ''}${
            interiorResults.length > 1 ? ` #${i + 1}` : ''
          }`,
          dataUrl: u,
        }),
      )
    })
    return out
  }, [renderJobs, interiorResults])

  if (!result) {
    return <div className="mx-auto max-w-[1400px] px-10 py-24 text-ink-dim">Preparing report…</div>
  }

  const { design, model, report, cost } = result
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
        ['front', 'Massing — front'],
        ['top', 'Massing — roof + site'],
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

  const download = async () => {
    if (busy) return
    setError(null)
    try {
      setBusy('Capturing 3D massing…')
      const massingImages = await captureMassing()

      setBusy('Drawing floor plans…')
      const planImages: ReportImage[] = []
      for (let i = 0; i < design.floors.length; i++) {
        const svg = svgRefs.current[i]
        if (svg) planImages.push({ label: design.floors[i].name, dataUrl: await rasterizeSvg(svg) })
      }

      setBusy('Building the PDF…')
      const { buildReportPdf } = await import('@/lib/report/buildPdf.ts')
      const blob = await buildReportPdf({
        projectName: model.brief.project.name,
        brief: model.brief,
        design,
        report,
        cost,
        planImages,
        massingImages,
        conceptImages,
      })
      triggerDownload(blob, `brickpilot-${slug(model.brief.project.name)}-report.pdf`)
    } catch (e) {
      setError(String((e as Error).message || e))
    } finally {
      setBusy(null)
    }
  }

  const clearImages = () => {
    resetRender()
    resetInterior()
    setConfirmClear(false)
  }

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-8 md:px-10">
      <WorkspaceTabs />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl">{model.brief.project.name}</h1>
        <div className="label text-accent">Step 6 · Report</div>
      </div>

      {/* metric bar */}
      <div className="mt-5 flex flex-wrap items-center gap-x-10 gap-y-3 border-b border-line pb-4">
        <Metric k="Validation" v={`${report.score} / 100`} />
        <div
          className={cx(
            'font-mono text-xs uppercase tracking-[0.1em]',
            report.hardChecksPass ? 'text-ok' : 'text-bad',
          )}
        >
          {report.hardChecksPass ? '● Hard checks pass' : '● Hard checks fail'}
        </div>
        <Metric k="Cost band" v={formatRange(cost.total.low, cost.total.high, formatINRShort)} />
        <Metric k="Expected" v={formatINR(cost.expected)} />
        <Metric k="Built area" v={`${design.builtAreaSqm.toFixed(1)} m²`} />
        <Metric k="Coverage" v={`${(design.coverage * 100).toFixed(0)} %`} />
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-10">
          {/* plan preview + floor picker */}
          <section>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-xl">{floor.name} plan</h2>
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
                    {f.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-3 aspect-[4/3] w-full border border-line-strong bg-bg-inset">
              <FloorDrawing floor={floor} model={model} theme="dark" showLabels showDimensions={false} />
            </div>
            <div className="mt-4 overflow-x-auto border-y border-line">
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="label [&>th]:py-2 [&>th]:pr-6 [&>th]:text-left">
                    <th>Space</th>
                    <th>Zone</th>
                    <th className="text-right">Size</th>
                    <th className="text-right">Area</th>
                  </tr>
                </thead>
                <tbody>
                  {floor.rooms.map((r) => (
                    <tr key={r.id} className="border-t border-line [&>td]:py-2 [&>td]:pr-6">
                      <td className="text-ink">{r.name}</td>
                      <td className="text-ink-dim">{ZONE_LABEL[r.zone]}</td>
                      <td className="text-right font-mono text-xs text-ink-dim tnum">
                        {(r.rect.w / 1000).toFixed(1)} × {(r.rect.h / 1000).toFixed(1)} m
                      </td>
                      <td className="text-right font-mono text-xs text-ink tnum">{r.area.toFixed(1)} m²</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* findings */}
          <section>
            <h2 className="font-display text-xl">Validation findings</h2>
            {report.findings.length === 0 ? (
              <p className="mt-3 text-sm text-ok">No findings — the concept passes every rule in this pack.</p>
            ) : (
              <ul className="mt-4 divide-y divide-line border-y border-line">
                {report.findings.map((f, i) => (
                  <li key={i} className="flex gap-4 py-2.5 text-sm">
                    <span
                      className={cx(
                        'flex-none font-mono text-[0.7rem] uppercase tracking-[0.1em]',
                        SEV_COLOR[f.severity],
                      )}
                    >
                      {f.severity}
                    </span>
                    <span className="text-ink-dim">{f.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* cost */}
          <section>
            <h2 className="font-display text-xl">Build-cost estimate</h2>
            <p className="mt-1 text-sm text-ink-dim">{cost.basis}</p>
            <div className="mt-4 border-y border-line">
              {cost.lines.map((l) => (
                <div
                  key={l.label}
                  className="flex items-baseline justify-between border-b border-line py-2.5 last:border-0"
                >
                  <span className="text-sm text-ink">{l.label}</span>
                  <span className="font-mono text-xs text-ink-dim tnum">
                    {formatRange(l.low, l.high, formatINR)}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-baseline justify-between">
              <span className="label">Expected total</span>
              <span className="font-display text-xl tnum">{formatINR(cost.expected)}</span>
            </div>
          </section>

          {conceptImages.length > 0 && (
            <section>
              <h2 className="font-display text-xl">Generated concepts</h2>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {conceptImages.map((img, i) => (
                  <figure key={i} className="border border-line">
                    <img src={img.dataUrl} alt={img.label} className="aspect-[3/2] w-full object-cover" />
                    <figcaption className="border-t border-line px-2 py-1.5 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-ink-faint">
                      {img.label}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* actions */}
        <div className="space-y-4">
          <div className="border border-line p-4">
            <div className="flex items-center gap-2 font-display text-lg">
              <FileText size={16} className="text-accent" /> Project report
            </div>
            <p className="mt-1.5 text-[0.8rem] leading-relaxed text-ink-faint">
              One PDF: the brief, every floor plan and room schedule, the 3D massing, all validation
              findings and the full cost estimate — plus any concepts you have generated.
            </p>

            <button
              type="button"
              onClick={download}
              disabled={!!busy}
              className={cx(
                'mt-4 flex w-full items-center justify-center gap-2 px-5 py-3 font-mono text-xs uppercase tracking-[0.12em] transition-colors',
                busy ? 'border border-line text-ink-faint' : 'bg-accent text-white hover:bg-accent-hot',
              )}
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              {busy ?? 'Download PDF'}
            </button>

            {error && (
              <p className="mt-3 border-l-2 border-bad/60 bg-bad/5 px-3 py-2 text-xs text-bad">{error}</p>
            )}
          </div>

          <div className="border border-line p-4">
            <div className="label mb-2">Generated images</div>
            <p className="text-[0.8rem] leading-relaxed text-ink-faint">
              {conceptImages.length > 0
                ? `${conceptImages.length} generated image${conceptImages.length === 1 ? '' : 's'} held in this browser.`
                : 'No generated concept or interior images yet.'}
            </p>
            {confirmClear ? (
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={clearImages}
                  className="border border-bad/60 px-3 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-bad"
                >
                  Clear them
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-ink-faint hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                disabled={conceptImages.length === 0}
                className="mt-3 flex items-center gap-1.5 border border-line-strong px-3 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-ink-dim hover:border-ink-dim hover:text-ink disabled:opacity-40"
              >
                <Trash2 size={12} /> Clear
              </button>
            )}
            <p className="mt-2 text-[0.7rem] text-ink-faint">
              Clears only the generated images — the brief, plan, findings and cost stay.
            </p>
          </div>
        </div>
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
            theme="dark"
            showLabels
            showDimensions={false}
          />
        ))}
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

function Metric({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <span className="label">{k}</span>
      <div className="mt-0.5 font-mono text-sm text-ink tnum">{v}</div>
    </div>
  )
}
