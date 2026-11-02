import { useState, useEffect } from 'react'
import { Info, X, AlertCircle } from 'lucide-react'
import type { ComprehensiveScores } from '@/lib/impact/analysis.ts'

interface SvgImpactScoreRingProps {
  scores: ComprehensiveScores
}

export function SvgImpactScoreRing({ scores }: SvgImpactScoreRingProps) {
  const [popoverOpen, setPopoverOpen] = useState(false)

  // Escape key closes popover
  useEffect(() => {
    if (!popoverOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPopoverOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [popoverOpen])
  const { composite, rating, subScores, activeSubScoresCount } = scores

  // Radius for 140x140 ring
  const r = 52
  const circ = 2 * Math.PI * r
  const scoreValue = composite ?? 0
  const strokeOffset = composite !== null ? circ - (scoreValue / 100) * circ : circ

  const getScoreColor = (val: number | null) => {
    if (val === null) return '#707070'
    if (val >= 80) return '#059669' // emerald-600
    if (val >= 60) return '#0284c7' // sky-600
    if (val >= 40) return '#d97706' // amber-600
    return '#dc2626' // red-600
  }

  const subScoreList = Object.entries(subScores).map(([key, s]) => ({
    key,
    ...s,
  }))

  return (
    <div className="relative flex flex-col rounded-xl border border-line bg-bg-raised p-5 shadow-2xs sm:flex-row sm:items-center sm:gap-6">
      {/* Radial Meter */}
      <div className="relative flex shrink-0 flex-col items-center justify-center">
        <svg
          width="136"
          height="136"
          viewBox="0 0 130 130"
          className="select-none cursor-pointer"
          onClick={() => setPopoverOpen(true)}
          role="img"
          style={{ fontFamily: 'var(--font-sans), Inter, sans-serif' }}
          aria-label={`Overall Impact Score ring displaying ${composite !== null ? `${composite} out of 100` : 'needs input'} (${rating}). Click to view formula weights.`}
        >
          <title>Overall Social Impact Score</title>
          <desc>Circular meter representing verified social and environmental impact performance.</desc>
          {/* Background Ring */}
          <circle
            cx="65"
            cy="65"
            r={r}
            fill="none"
            stroke="currentColor"
            className="text-line"
            strokeWidth="9"
          />
          {/* Animated Value Ring */}
          <circle
            cx="65"
            cy="65"
            r={r}
            fill="none"
            stroke={getScoreColor(composite)}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={strokeOffset}
            transform="rotate(-90 65 65)"
            style={{
              transition: 'stroke-dashoffset 1s ease-out',
            }}
          />
          <text
            x="65"
            y={composite !== null ? 62 : 68}
            textAnchor="middle"
            className="fill-ink font-display text-3xl font-bold tracking-tight"
          >
            {composite !== null ? composite : '—'}
          </text>
          {composite !== null && (
            <text
              x="65"
              y="79"
              textAnchor="middle"
              className="fill-ink-dim font-mono text-xs font-semibold uppercase tracking-wider"
            >
              / 100
            </text>
          )}
        </svg>

        <button
          type="button"
          onClick={() => setPopoverOpen(true)}
          className="mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-xs font-semibold uppercase tracking-wider hover:opacity-90 transition-opacity cursor-pointer border border-line"
          style={{
            backgroundColor: `${getScoreColor(composite)}15`,
            color: getScoreColor(composite),
          }}
          title="Click to view scoring formulas and weights"
        >
          <span>{rating}</span>
          <Info size={13} aria-hidden />
        </button>
      </div>

      {/* Sub-Score Bars */}
      <div className="mt-4 flex flex-1 flex-col justify-center gap-2.5 sm:mt-0">
        <div className="mb-1 flex items-center justify-between">
          <span className="font-mono text-xs font-semibold uppercase tracking-wider text-ink-dim">
            5-Pillar Calibration ({activeSubScoresCount}/5 Active)
          </span>
          <button
            type="button"
            onClick={() => setPopoverOpen(true)}
            className="font-mono text-xs text-accent hover:underline inline-flex items-center gap-1 cursor-pointer"
          >
            <span>Formulas & Weights</span>
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2.5">
          {subScoreList.map(sub => (
            <div key={sub.key} className="flex items-center gap-3">
              <span className="w-32 truncate font-sans text-xs font-medium text-ink">{sub.name}</span>
              <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-bg-inset">
                {sub.score !== null ? (
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${sub.score}%`,
                      backgroundColor: sub.color,
                    }}
                  />
                ) : (
                  <div className="h-full w-full bg-line/60" />
                )}
              </div>
              <span className="w-24 text-right font-mono text-xs font-semibold text-ink">
                {sub.score !== null ? (
                  `${sub.score} / 100`
                ) : (
                  <span className="text-xs font-normal text-amber-800">
                    Needs input
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Interactive Scoring Formulas Popover */}
      {popoverOpen && (
        <div
          role="dialog"
          aria-label="Impact Score Breakdown and Formulas"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
          onClick={() => setPopoverOpen(false)}
        >
          <div
            className="relative w-full max-w-lg rounded-2xl border border-line bg-bg-raised p-6 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h3 className="font-display text-xl font-medium text-ink">Impact Score Formulas & Weights</h3>
                <p className="mt-1 font-sans text-xs text-ink-dim">
                  Composite score is the unweighted average of all active sub-scores. Missing inputs are excluded.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPopoverOpen(false)}
                className="rounded-lg p-1.5 text-ink-dim hover:bg-bg-inset hover:text-ink cursor-pointer"
                aria-label="Close dialog"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 space-y-3 max-h-[60vh] overflow-y-auto pr-1">
              {subScoreList.map(sub => (
                <div
                  key={sub.key}
                  className="rounded-xl border border-line bg-bg p-3.5 text-xs text-ink space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-sans font-semibold text-sm flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: sub.color }} />
                      {sub.name}
                    </span>
                    <span className="font-mono text-xs font-medium text-ink-dim">
                      {sub.status === 'scored' ? `Weight: ${sub.weight}%` : 'Excluded'}
                    </span>
                  </div>
                  <p className="font-mono text-xs text-ink-dim">
                    Formula: {sub.formula}
                  </p>
                  <div className="flex items-center justify-between pt-1">
                    <span className="font-sans text-xs text-ink-dim">{sub.detail}</span>
                    <span className="font-mono text-xs font-bold text-ink">
                      {sub.score !== null ? `${sub.score} / 100` : 'Needs input'}
                    </span>
                  </div>
                  {sub.status === 'needs input' && (
                    <div className="mt-1.5 flex items-center gap-1.5 rounded-md bg-amber-50 border border-amber-200 px-2.5 py-1.5 font-sans text-xs text-amber-900">
                      <AlertCircle size={14} className="shrink-0 text-amber-700" />
                      <span>Input missing: excluded from composite calculation until data is provided.</span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-5 border-t border-line pt-4 flex items-center justify-between text-xs">
              <span className="font-sans text-ink-dim">
                Active Sub-scores: {activeSubScoresCount} of 5
              </span>
              <span className="font-mono text-sm font-bold text-ink">
                Composite: {composite !== null ? `${composite} / 100` : 'Needs Input'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
