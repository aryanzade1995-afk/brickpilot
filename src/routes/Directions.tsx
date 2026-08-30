import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Check, Pin } from 'lucide-react'
import { useStudio } from '@/state/studio.ts'
import { FloorDrawing } from '@/lib/draw/FloorDrawing.tsx'
import { WorkspaceTabs } from '@/components/WorkspaceTabs.tsx'
import { cx } from '@/lib/cx.ts'

export function Directions() {
  const directions = useStudio((s) => s.directions)
  const explore = useStudio((s) => s.explore)
  const pin = useStudio((s) => s.pin)
  const pinned = useStudio((s) => s.pinned)
  const navigate = useNavigate()

  useEffect(() => {
    if (!directions) explore()
  }, [directions, explore])

  if (!directions) {
    return <div className="mx-auto max-w-[1400px] px-10 py-24 text-ink-dim">Engineering directions…</div>
  }

  const choose = (strategy: (typeof directions)[number]['strategy']) => {
    pin(strategy)
    navigate('/workspace/plan')
  }

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-8 md:px-10">
      <WorkspaceTabs />

      <div className="mt-6 max-w-2xl">
        <h1 className="font-display text-[clamp(1.8rem,3.5vw,2.6rem)]">Choose the direction to engineer</h1>
        <p className="mt-3 text-ink-dim">
          Each option is a verified deterministic scheme built from the same brief. Pin one to make it
          the canonical plan — you can switch later.
        </p>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {directions.map((d) => {
          const isPinned = pinned === d.strategy
          return (
            <div
              key={d.strategy}
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
                </div>
                <div className="flex-none text-right">
                  <div className="font-display text-2xl tnum">{d.report.score}</div>
                  <div className="label">/ 100</div>
                </div>
              </div>

              <div className="aspect-[3/2] w-full border-b border-line bg-bg-inset">
                <FloorDrawing
                  floor={d.design.floors[0]}
                  model={d.design.model}
                  theme="dark"
                  showLabels
                  showDimensions={false}
                />
              </div>

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
                onClick={() => choose(d.strategy)}
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
