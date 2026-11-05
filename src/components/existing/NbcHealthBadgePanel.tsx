import { AlertTriangle, Check, Info } from 'lucide-react'
import { type NbcCheckResult, type NbcHealthReport } from '@/lib/existing/nbcPreflight.ts'
import { cx } from '@/lib/cx.ts'

interface NbcHealthBadgePanelProps {
  report: NbcHealthReport
  onFocusElement?: (roomId?: string, openingIdx?: number) => void
  onPlotChangeRequested?: () => void
}

export function NbcHealthBadgePanel({
  report,
  onFocusElement,
  onPlotChangeRequested,
}: NbcHealthBadgePanelProps) {
  const getBadgeIcon = (status: NbcCheckResult['status']) => {
    switch (status) {
      case 'pass':
        return <Check size={14} className="text-emerald-600 dark:text-emerald-400" />
      case 'warn':
        return <AlertTriangle size={14} className="text-amber-500" />
      case 'fail':
        return <AlertTriangle size={14} className="text-rose-500" />
    }
  }

  const getBadgeStyle = (status: NbcCheckResult['status']) => {
    switch (status) {
      case 'pass':
        return 'border-emerald-200 bg-emerald-50/50 text-emerald-900 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-200'
      case 'warn':
        return 'border-amber-200 bg-amber-50/60 text-amber-900 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-200'
      case 'fail':
        return 'border-rose-200 bg-rose-50/60 text-rose-900 dark:border-rose-800/40 dark:bg-rose-950/20 dark:text-rose-200'
    }
  }

  return (
    <div className="rounded-md border border-line bg-bg-inset p-4 shadow-sm">
      <div className="flex items-center justify-between pb-3 border-b border-line">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs uppercase tracking-wider text-ink-dim">Pre-Flight Check</span>
          <h3 className="font-display text-sm font-semibold text-ink">NBC Compliance Preview</h3>
        </div>
        <span
          className={cx(
            'px-2 py-0.5 text-[0.7rem] font-medium font-mono uppercase tracking-wider rounded border',
            report.allPass
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-300'
          )}
        >
          {report.allPass ? 'All Checks Passed' : 'Advisory Warnings'}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
        {report.checks.map((check) => (
          <div
            key={check.id}
            className={cx('rounded-lg border p-3 flex flex-col justify-between transition-all', getBadgeStyle(check.status))}
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-medium text-xs">
                  {getBadgeIcon(check.status)}
                  <span>{check.title}</span>
                </div>
                <span className="font-mono text-[0.65rem] uppercase tracking-wider opacity-75">
                  {check.status === 'pass' ? 'PASS' : 'WARN'}
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed opacity-90">{check.message}</p>
            </div>

            {check.suggestion && (
              <div className="mt-2 pt-2 border-t border-black/5 dark:border-white/5 flex items-start gap-1.5 text-[0.72rem] opacity-80">
                <Info size={12} className="flex-none mt-0.5" />
                <span>{check.suggestion}</span>
              </div>
            )}

            {check.offendingRoomIds.length > 0 && onFocusElement && (
              <div className="mt-2 flex flex-wrap gap-1">
                {check.offendingRoomIds.map((rId) => (
                  <button
                    key={rId}
                    type="button"
                    onClick={() => onFocusElement(rId, undefined)}
                    className="text-[0.68rem] px-2 py-0.5 rounded border border-current hover:bg-black/5 dark:hover:bg-white/5 font-mono"
                  >
                    Focus {rId}
                  </button>
                ))}
              </div>
            )}

            {check.id === 'setbacks' && check.assumedPlot && onPlotChangeRequested && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={onPlotChangeRequested}
                  className="text-[0.7rem] underline font-medium hover:text-accent"
                >
                  Specify actual plot size →
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="mt-3 text-[0.72rem] text-ink-dim leading-relaxed">
        Note: NBC pre-flight alerts are advisory and do not block building your 2D plan. You can adjust openings and setbacks at any stage.
      </p>
    </div>
  )
}

