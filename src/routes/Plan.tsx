import { useFinishes } from '@/state/finishes.ts'
import { estimateProjectBoq } from '@/lib/cost/index.ts'
import { geometryCostKey } from '@/lib/cost/quantities.ts'
import { formatINR, formatRange } from '@/lib/format.ts'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Dices, Download } from 'lucide-react'
import { useStudio } from '@/state/studio.ts'
import { DrawingWorkspace } from '@/components/DrawingWorkspace.tsx'
import { ZONE_LABEL } from '@/lib/model/canonical.ts'
import { cx } from '@/lib/cx.ts'
import { WorkspaceTabs } from '@/components/WorkspaceTabs.tsx'
import { VillaGenerationNotice } from '@/components/VillaGenerationNotice.tsx'
import { InvalidPlanNotice } from '@/components/InvalidPlanNotice.tsx'
import type { Severity } from '@/lib/rules/index.ts'
import { preferenceScore } from '@/lib/engine/score.ts'

const SEV_COLOR: Record<Severity, string> = {
  error: 'text-bad',
  warning: 'text-warn',
  info: 'text-ink-dim',
}

export function Plan() {
  const navigate = useNavigate(), [params] = useSearchParams()
  const [floorIdx, setFloorIdx] = useState(Number(params.get("floor")) || 0)
  const brief = useStudio(s => s.brief)
  const result = useStudio((s) => s.result)
  const run = useStudio((s) => s.run)
  const reroll = useStudio((s) => s.reroll)

  const saved = useFinishes(s => s.entries[result ? geometryCostKey(result.design) : ''])
  const cost = useMemo(() => result?.report.hardChecksPass ? estimateProjectBoq(result.design, brief, saved) : null, [result, brief, saved])
  const drawingDesign = useMemo(() => result ? { ...result.design, model: { ...result.design.model, brief } } : null, [result, brief])
  const roomLink = (id: string) => `/workspace/finishes?tab=specifications&room=${encodeURIComponent(id)}`
  useEffect(() => {
    if (!result) run()
  }, [result, run])

  if (!result) {
    return <div className="mx-auto max-w-[1400px] px-10 py-24 text-ink-dim">Generating…</div>
  }
  if (!result.report.hardChecksPass) return <InvalidPlanNotice report={result.report} />

  const { design, report } = result
  const floor = design.floors[Math.min(floorIdx, design.floors.length - 1)]
  // cheap to compute; not a hook, so it is fine after the early returns
  const why = preferenceScore(design)
  const whyTerms = why.terms.filter((t) => t.value !== 0)

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-8 md:px-10">
      <WorkspaceTabs />
      <VillaGenerationNotice />

      {design.siteNotes?.length ? <div className="mt-4 border border-line px-4 py-3 text-xs text-ink-dim" role="status">{design.siteNotes.map(note => <p key={note}>{note}</p>)}</div> : null}
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
        <Metric k="Built area" v={`${design.builtAreaSqm.toFixed(1)} m²`} />
        <Metric k="Height" v={`${design.heightM} m`} />
        <Metric k="Coverage" v={`${(design.coverage * 100).toFixed(0)} %`} />
      </div>

      <div className="mt-6"><DrawingWorkspace key={`${params.get("floor")}:${params.get("highlight")}`} design={drawingDesign!} onFloorChange={setFloorIdx} initialFloorLevel={params.has("floor") ? Number(params.get("floor")) : undefined} highlightCategory={params.get("highlight") ?? undefined} onRoomClick={id => navigate(roomLink(id))} /></div>
      {cost && <section aria-label="Cost summary" className="mt-6 flex flex-wrap items-center justify-between gap-4 border-y border-line py-5"><div><Link to="/workspace/finishes?tab=estimate" className="text-sm underline">Cost band · {formatRange(cost.total.low, cost.total.high, formatINR)}</Link><p className="mt-2 text-xs text-ink-faint">{cost.label}</p></div><Link to="/workspace/finishes" className="text-sm underline">Finishes & cost →</Link></section>}
      <div className="mt-6 grid gap-6 md:grid-cols-3">
          <Panel title="Study record">
            <RecRow k="Seed" v={design.seed} />
            <RecRow k="Candidate" v={design.candidate} />
            <RecRow k="Footprint" v={`${design.footprintSqm.toFixed(1)} m²`} />
            <RecRow k="Openings" v={`${design.openingCounts.doors} doors · ${design.openingCounts.windows} windows`} />
            <RecRow k="Rooms" v={String(design.floors.reduce((n, f) => n + f.rooms.length, 0))} />
          </Panel>

          <Panel title="Why this plan">
            {whyTerms.length === 0 ? (
              <p className="text-xs text-ink-dim">No orientation or lifestyle preferences changed the choice.</p>
            ) : (
              whyTerms.map((t) => (
                <Row2 key={t.name} k={t.name}>
                  <span className={cx('font-mono text-xs tnum', t.value > 0 ? 'text-ok' : 'text-bad')}>
                    {t.value > 0 ? '+' : ''}{t.value}
                  </span>
                </Row2>
              ))
            )}
            <Row2 k="Preference score">
              <span className="font-mono text-xs text-ink tnum">{why.total}</span>
            </Row2>
          </Panel>

          <button
            type="button"
            onClick={reroll}
            className="flex w-full items-center justify-center gap-2 border border-line-strong py-3 font-mono text-xs uppercase tracking-[0.12em] text-ink-dim hover:border-ink-dim hover:text-ink"
          >
            <Dices size={13} />
            Reroll variation
          </button>
          <Link
            to="/workspace/massing"
            className="flex w-full items-center justify-center gap-2 border border-line-strong py-3 font-mono text-xs uppercase tracking-[0.12em] text-ink-dim hover:border-ink-dim hover:text-ink"
          >
            <Download size={13} />
            Continue to 3D
          </Link>
      </div>

      {/* validation findings */}
      <section className="mt-14 border-t border-line pt-8">
        <div className="flex items-baseline gap-3">
          <h2 className="font-display text-2xl">Validation findings</h2>
          <span className="label">
            {report.counts.error} errors · {report.counts.warning} warnings · pack {report.pack}
          </span>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-ink-dim">
          Deterministic checks against the plan geometry — {report.checksRun.join(' · ')}.
        </p>

        {report.findings.length === 0 ? (
          <p className="mt-6 text-sm text-ok">No findings. The concept passes every rule in this pack.</p>
        ) : (
          <ul className="mt-6 divide-y divide-line border-y border-line">
            {report.findings.map((f, i) => (
              <li key={i} className="flex gap-4 py-3 text-sm">
                <span className={cx('flex-none font-mono text-[0.7rem] uppercase tracking-[0.1em]', SEV_COLOR[f.severity])}>
                  {f.severity}
                </span>
                <span className="flex-none font-mono text-[0.7rem] uppercase tracking-[0.08em] text-ink-faint">
                  {f.code}
                </span>
                <span className="text-ink-dim">{f.message}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* room schedule */}
      <section className="mt-14 border-t border-line pt-8">
        <h2 className="font-display text-2xl">Room schedule — {floor.name}</h2>
        <div className="mt-5 overflow-x-auto border-y border-line">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="label [&>th]:py-2.5 [&>th]:pr-6 [&>th]:text-left">
                <th>Space</th>
                <th>Zone</th>
                <th className="text-right">Size</th>
                <th className="text-right">Area</th>
              </tr>
            </thead>
            <tbody>
              {floor.rooms.map((r) => (
                <tr key={r.id} className="border-t border-line [&>td]:py-2.5 [&>td]:pr-6">
                  <td className="text-ink">{r.outdoor ? r.name : <Link to={roomLink(`${floor.level}:${r.semanticId || r.id}`)} className="underline">{r.name}</Link>}</td>
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
    </div>
  )
}

/* ---------------------------------- bits ---------------------------------- */

function Metric({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <span className="label">{k}</span>
      <div className="mt-0.5 font-mono text-sm text-ink tnum">{v}</div>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-line">
      <div className="label border-b border-line px-4 py-2.5">{title}</div>
      <div className="space-y-2.5 p-4">{children}</div>
    </div>
  )
}

function Row2({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-ink-dim">{k}</span>
      {children}
    </div>
  )
}

function RecRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-ink-dim">{k}</span>
      <span className="truncate font-mono text-[0.7rem] text-ink tnum">{v}</span>
    </div>
  )
}
