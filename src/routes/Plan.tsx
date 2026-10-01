import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Dices, Download } from 'lucide-react'
import { useStudio } from '@/state/studio.ts'
import { DrawingWorkspace } from '@/components/DrawingWorkspace.tsx'
import { ZONE_LABEL } from '@/lib/model/canonical.ts'
import { formatINR, formatINRShort, formatRange } from '@/lib/format.ts'
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
  const [floorIdx, setFloorIdx] = useState(0)
  const result = useStudio((s) => s.result)
  const run = useStudio((s) => s.run)
  const reroll = useStudio((s) => s.reroll)

  useEffect(() => {
    if (!result) run()
  }, [result, run])

  if (!result) {
    return <div className="mx-auto max-w-[1400px] px-10 py-24 text-ink-dim">Generating…</div>
  }
  if (!result.report.hardChecksPass) return <InvalidPlanNotice report={result.report} />

  const { design, report, cost } = result
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
        <Metric k="Cost band" v={formatRange(cost.total.low, cost.total.high, formatINRShort)} />
        <div>
          <span className="label">Budget</span>
          <div className="mt-0.5 flex items-baseline gap-2 font-mono text-sm text-ink tnum">
            <span>{formatINRShort(cost.budget.amountInr)} vs {formatINRShort(cost.budget.expected)}</span>
            <span
              className={cx(
                'text-xs uppercase tracking-[0.1em]',
                cost.budget.status === 'within' ? 'text-ok' : cost.budget.status === 'tight' ? 'text-warn' : 'text-bad',
              )}
            >
              ● {cost.budget.status === 'within' ? 'Within' : cost.budget.status === 'tight' ? 'Tight' : 'Over'}
            </span>
          </div>
        </div>
        <Metric k="Built area" v={`${design.builtAreaSqm.toFixed(1)} m²`} />
        <Metric k="Height" v={`${design.heightM} m`} />
        <Metric k="Coverage" v={`${(design.coverage * 100).toFixed(0)} %`} />
      </div>

      <div className="mt-6"><DrawingWorkspace design={design} onFloorChange={setFloorIdx} /></div>
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
            to="/workspace/report"
            className="flex w-full items-center justify-center gap-2 border border-line-strong py-3 font-mono text-xs uppercase tracking-[0.12em] text-ink-dim hover:border-ink-dim hover:text-ink"
          >
            <Download size={13} />
            Project report · PDF
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

      {/* cost */}
      <section className="mt-14 border-t border-line pt-8">
        <div className="flex items-baseline gap-3">
          <h2 className="font-display text-2xl">Build-cost estimate</h2>
          <span className="label">Confidence {cost.confidence} · {cost.currency}</span>
        </div>
        <p className="mt-2 text-sm text-ink-dim">{cost.basis}</p>

        <div className="mt-6 border-y border-line">
          {cost.lines.map((l) => (
            <div key={l.label} className="flex items-baseline justify-between border-b border-line py-3 last:border-0">
              <div>
                <span className="text-sm text-ink">{l.label}</span>
                <span className="ml-3 text-xs text-ink-faint">{l.note}</span>
              </div>
              <span className="font-mono text-xs text-ink-dim tnum">
                {formatRange(l.low, l.high, formatINR)}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-baseline justify-between">
          <span className="label">Expected total</span>
          <span className="font-display text-2xl tnum">{formatINR(cost.expected)}</span>
        </div>

        <div className="mt-6 grid gap-6 text-xs text-ink-dim sm:grid-cols-2">
          <div>
            <div className="label mb-2">Included</div>
            <ul className="space-y-1">
              {cost.included.map((x) => (
                <li key={x}>— {x}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="label mb-2">Excluded</div>
            <ul className="space-y-1">
              {cost.excluded.map((x) => (
                <li key={x}>— {x}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="label mt-6">
          Sources — {cost.sources.join(' · ')}
        </div>
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
