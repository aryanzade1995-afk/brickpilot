import { useMemo } from 'react'
import { assessBudgetFit, suggestCuts } from '@/lib/cost/budgetFit.ts'
import { useStudio } from '@/state/studio.ts'

const TONE = {
  comfortable: { box: 'border-ok bg-ok/5', text: 'text-ok', title: 'The budget covers these rooms' },
  tight: { box: 'border-warn bg-warn/5', text: 'text-warn', title: 'The budget covers minimum room sizes, not the targets' },
  over: { box: 'border-bad bg-bad/5', text: 'text-bad', title: 'The budget does not cover these rooms' },
} as const

/** budget vs the rooms asked for — checked before any plan is generated */
export function BudgetNotice() {
  const brief = useStudio((state) => state.brief)
  const edit = useStudio((state) => state.edit)
  const fit = useMemo(() => assessBudgetFit(brief), [brief])
  const cuts = useMemo(() => (fit.status === 'comfortable' ? [] : suggestCuts(brief)), [brief, fit.status])
  const tone = TONE[fit.status]

  return (
    <div role="status" aria-live="polite" className={`border-l-2 px-4 py-3 text-sm ${tone.box}`}>
      <p className={`font-medium ${tone.text}`}>{tone.title}</p>
      <p className="mt-1 text-ink-dim">{fit.message}</p>
      {cuts.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-ink-dim">To bring it within budget:</p>
          {cuts.map((cut, i) => (
            <div key={`${i}-${cut.label}`} className="flex items-center justify-between gap-3 border border-line px-3 py-2">
              <span className="text-ink">
                {cut.label}
                {cut.savesLakh > 0 && <span className="ml-2 font-mono text-xs text-ink-faint tnum">saves ≈ ₹{cut.savesLakh} L</span>}
              </span>
              <button
                type="button"
                onClick={() => edit((b) => cut.patch(b))}
                className="flex-none border border-line-strong px-2.5 py-1 font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-dim transition-colors hover:border-accent hover:text-ink"
              >
                Apply
              </button>
            </div>
          ))}
        </div>
      )}
      {fit.status !== 'comfortable' && cuts.length === 0 && (
        <p className={`mt-2 ${tone.text}`}>Raise the budget, lower the finish level, or ask for fewer rooms.</p>
      )}
    </div>
  )
}
