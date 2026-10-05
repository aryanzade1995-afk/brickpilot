import { useDeferredValue, useMemo } from 'react'
import { Check, AlertTriangle, Sparkles } from 'lucide-react'
import { assessBriefFit, fitSuggestions, type FitSuggestion } from '@/lib/engine/planner/fit.ts'
import { useStudio } from '@/state/studio.ts'
import { cx } from '@/lib/cx.ts'

type Tone = 'ok' | 'tight' | 'bad'
const TONE = {
  ok: { text: 'text-ok', bar: '#2E7D32', soft: 'border-ok bg-ok/5', fill: '#BFE3C0' },
  tight: { text: 'text-warn', bar: '#C77700', soft: 'border-warn bg-warn/5', fill: '#F5D9A8' },
  bad: { text: 'text-bad', bar: '#B3261E', soft: 'border-bad bg-bad/5', fill: '#F3C9C5' },
} as const

/** The plot, the buildable area inside the setbacks, and a block for the rooms that grows as you add them. */
function PlotDiagram({ plotSqm, w, d, need, tone }: { plotSqm: number; w: number; d: number; need: number; tone: Tone }) {
  const W = 150, H = 110
  const aspect = Math.max(0.5, Math.min(2, w / Math.max(d, 1)))
  const bw = aspect >= 1 ? 110 : 110 * aspect, bh = aspect >= 1 ? 110 / aspect : 110
  const ratio = Math.min(1.25, need / Math.max(1, w * d))
  const f = Math.sqrt(ratio)
  const hw = bw * 0.9 * f, hh = bh * 0.9 * f
  const cx = W / 2, cy = H / 2 - 4
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-28 w-36 flex-none" role="img" aria-label="Rooms against the buildable area">
      <rect x={cx - bw / 2 - 6} y={cy - bh / 2 - 6} width={bw + 12} height={bh + 12} fill="#F4F4F1" stroke="#9AA0A6" />
      <rect x={cx - bw / 2} y={cy - bh / 2} width={bw} height={bh} fill="#FDF1DD" stroke="#E0873A" strokeDasharray="4 3" />
      <rect x={cx - hw / 2} y={cy - hh / 2} width={hw} height={hh} fill={TONE[tone].fill} stroke={TONE[tone].bar} strokeWidth={1.5}
        style={{ transition: 'all 400ms ease' }} />
      <text x={cx} y={H - 1} textAnchor="middle" fontSize="7" fill="#6B7280">{Math.round(plotSqm)} m² plot</text>
    </svg>
  )
}

export function FitMeter() {
  const brief = useStudio((s) => s.brief)
  const edit = useStudio((s) => s.edit)
  const capacityBrief = useDeferredValue(brief)
  const checking = capacityBrief !== brief
  const fit = useMemo(() => assessBriefFit(capacityBrief), [capacityBrief])
  const help = useMemo(() => (fit.fits ? null : fitSuggestions(capacityBrief)), [fit.fits, capacityBrief])

  // rooms + circulation the busiest floor needs, against the buildable area of one floor (walls take ~12%)
  const buildable = fit.buildableWidthM * fit.buildableDepthM
  const need = fit.minimumSqm / 0.88
  const ratio = buildable > 0 ? need / buildable : 2
  const tone: Tone = !fit.fits ? 'bad' : fit.atTarget ? 'ok' : 'tight'
  const pct = Math.max(4, Math.min(100, Math.round(ratio * 100)))
  const title = fit.issues.length ? 'These requirements cannot produce a valid plan yet'
    : !fit.fits ? 'This brief does not fit the plot yet'
      : fit.atTarget ? 'Everything fits comfortably' : 'It fits, but space is tight'
  const apply = (s: FitSuggestion) => edit((b) => s.recipe(b))

  return (
    <div role="status" aria-live="polite" className={cx('mb-8 border-l-2 px-5 py-4', TONE[tone].soft)}>
      <div className="flex flex-wrap items-center gap-5">
        <PlotDiagram plotSqm={fit.plotSqm} w={fit.buildableWidthM} d={fit.buildableDepthM} need={need} tone={tone} />
        <div className="min-w-[16rem] flex-1">
          <p className={cx('flex items-center gap-2 font-medium', TONE[tone].text)}>
            {tone === 'ok' ? <Check size={16} /> : <AlertTriangle size={16} />}{title}
            {checking && <span className="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-ink-faint">checking…</span>}
          </p>
          <div className="mt-3" aria-label="Space used">
            <div className="flex justify-between text-xs text-ink-dim">
              <span>Rooms need about {Math.round(need)} m² on {fit.busiestFloor.toLowerCase()}</span>
              <span>{Math.round(buildable)} m² buildable per floor</span>
            </div>
            <div className="relative mt-1 h-2.5 w-full overflow-hidden bg-bg-inset">
              <div className="h-full transition-[width] duration-500" style={{ width: `${pct}%`, background: TONE[tone].bar }} />
            </div>
            <p className="mt-1 text-[0.7rem] text-ink-faint">
              Buildable: {fit.buildableWidthM.toFixed(1)} × {fit.buildableDepthM.toFixed(1)} m after setbacks. Choose freely; this updates as you go.
            </p>
          </div>
          {fit.issues.length > 0 && <p className="mt-2 text-xs text-bad">{fit.issues.slice(0, 2).join(' ')}</p>}
        </div>
      </div>

      {help && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="flex items-center gap-1.5 font-mono text-[0.68rem] uppercase tracking-[0.1em] text-ink-dim"><Sparkles size={12} /> Make it fit</p>
          {help.single.length > 0 || help.combined ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {[...help.single, ...(help.combined ? [help.combined] : [])].map((s) => (
                <button key={s.id} type="button" onClick={() => apply(s)}
                  className="border border-line-strong bg-bg px-3 py-2 text-left text-xs transition-colors hover:border-accent">
                  <span className="block font-medium text-ink">{s.label}</span>
                  <span className="block text-ink-faint">{s.detail}. Tap to apply</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-ink-dim">Try a larger plot, smaller setbacks, fewer rooms or another floor.</p>
          )}
        </div>
      )}
    </div>
  )
}
