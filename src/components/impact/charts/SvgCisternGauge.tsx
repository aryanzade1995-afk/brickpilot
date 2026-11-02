import type { FC } from 'react'

export interface SvgCisternGaugeProps {
  collectedLitres: number | null
  capacityLitres: number | null
  dailyDemandLitres?: number | null
  className?: string
}

export const SvgCisternGauge: FC<SvgCisternGaugeProps> = ({
  collectedLitres,
  capacityLitres,
  dailyDemandLitres: _demand,
  className = '',
}) => {
  const cap = capacityLitres ?? 5000
  const col = collectedLitres ?? 0
  const fillPct = Math.min(100, Math.max(0, Math.round(cap > 0 ? (col / cap) * 100 : 0)))
  const overflowLitres = Math.max(0, col - cap)

  const width = 240
  const height = 230
  const tankX = 45
  const tankY = 32
  const tankW = 150
  const tankH = 145
  const fillH = (fillPct / 100) * (tankH - 8)

  const ariaSummary = `Rainwater cistern tank gauge: ${fillPct}% filled (${col.toLocaleString('en-IN')} L collected of ${cap.toLocaleString('en-IN')} L capacity). ${overflowLitres > 0 ? `Overflows ${overflowLitres.toLocaleString('en-IN')} L.` : 'Fits within tank.'}`

  return (
    <div className={`rounded border border-line bg-bg-raised p-5 text-center ${className}`}>
      <span className="font-mono text-xs uppercase tracking-wider text-ink-dim">Storage Scenario</span>
      <h4 className="font-display text-xl font-medium text-ink">Rain Cistern Fill</h4>

      <div className="relative mx-auto mt-2 flex justify-center">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={ariaSummary}
          className="h-44 w-auto"
          style={{ fontFamily: 'var(--font-sans), Inter, sans-serif' }}
        >
          <desc>{ariaSummary}</desc>

          {/* Inflow pipe top */}
          <path d="M 60 10 L 60 32" stroke="#536a76" strokeWidth={6} strokeLinecap="round" />
          <path d="M 52 14 L 60 22 L 68 14" stroke="#536a76" strokeWidth={2} fill="none" strokeLinecap="round" />

          {/* Overflow pipe right */}
          <path d={`M ${tankX + tankW} 48 L ${tankX + tankW + 20} 48 L ${tankX + tankW + 20} 74`} stroke="#9facbb" strokeWidth={4} fill="none" />
          {overflowLitres > 0 && (
            <text x={tankX + tankW + 24} y={64} className="fill-blue-700 font-mono text-xs font-semibold">
              Overflow
            </text>
          )}

          {/* Tank body outline */}
          <rect
            x={tankX}
            y={tankY}
            width={tankW}
            height={tankH}
            rx={8}
            fill="#f6f8f9"
            stroke="#536a76"
            strokeWidth={2}
          />

          {/* Water Fill */}
          <rect
            x={tankX + 4}
            y={tankY + tankH - 4 - fillH}
            width={tankW - 8}
            height={fillH}
            rx={4}
            fill="#869faa"
            fillOpacity={0.85}
          />

          {/* Percentage badge in centre of tank */}
          <text
            x={tankX + tankW / 2}
            y={tankY + tankH / 2 - 2}
            textAnchor="middle"
            className="fill-sky-950 font-display text-3xl font-bold"
          >
            {fillPct}%
          </text>
          <text
            x={tankX + tankW / 2}
            y={tankY + tankH / 2 + 18}
            textAnchor="middle"
            className="fill-sky-900 font-mono text-xs font-semibold"
            style={{ fontFamily: 'var(--font-mono), monospace' }}
          >
            {col.toLocaleString('en-IN')} / {cap.toLocaleString('en-IN')} L
          </text>

          {/* Base slab */}
          <rect
            x={tankX - 10}
            y={tankY + tankH}
            width={tankW + 20}
            height={12}
            rx={2}
            fill="#9ca3af"
          />
        </svg>
      </div>

      <p className="mt-2 font-mono text-xs text-ink-dim">
        {overflowLitres > 0 ? (
          <span className="font-semibold text-ink-dim">
            ▲ Overflows by {overflowLitres.toLocaleString('en-IN')} L in monsoons
          </span>
        ) : (
          <span className="font-semibold text-ink-dim">
            ● 100% of seasonal harvest safely contained
          </span>
        )}
      </p>
    </div>
  )
}
