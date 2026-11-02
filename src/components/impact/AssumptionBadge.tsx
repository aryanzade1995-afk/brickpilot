import { useState } from 'react'
import { AlertCircle } from 'lucide-react'

interface AssumptionBadgeProps {
  label: string
  value: string | number
  notes?: string
  overrideHint?: string
}

export function AssumptionBadge({
  label,
  value,
  notes = 'This value is an empirical modeling assumption, not a statutory code requirement.',
  overrideHint = 'You can override this value in the Inputs & Assumptions panel.',
}: AssumptionBadgeProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 rounded border border-amber-300 bg-amber-50 px-2 py-1 font-mono text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-accent cursor-pointer"
        title="Click to view modeling assumption details"
      >
        <AlertCircle className="h-3.5 w-3.5 text-amber-700 shrink-0" />
        <span>Assumption</span>
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute top-full left-0 z-50 mt-1.5 w-72 rounded-xl border border-line bg-bg-raised p-4 shadow-lg text-left">
            <div className="mb-2 flex items-center justify-between border-b border-line pb-2">
              <span className="font-sans text-xs font-bold text-ink">{label}</span>
              <span className="font-mono text-xs font-semibold text-amber-800">{value}</span>
            </div>
            <p className="font-sans text-xs text-ink-dim leading-relaxed">{notes}</p>
            <div className="mt-2.5 rounded-lg bg-bg-inset p-2 font-sans text-xs text-ink-dim">
              <span className="font-semibold text-ink">How to override: </span>
              {overrideHint}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
