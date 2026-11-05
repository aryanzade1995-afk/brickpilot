import { translate as translateUi, useLanguage } from '@/lib/i18n/index.ts'
import { useEffect, useState } from 'react'
import { Check, AlertTriangle, Sparkles, X, ChevronDown, ChevronUp } from 'lucide-react'
import type {useBriefValidation,FitAction} from '@/state/briefValidation.ts'
import {SpaceValidation} from '@/components/ui/SpaceValidation.tsx'
import {applySuggestionChanges} from '@/lib/model/briefSuggestion.ts'
import { useStudio } from '@/state/studio.ts'
import { cx } from '@/lib/cx.ts'

type Tone = 'ok' | 'tight' | 'bad'
const TONE = {
  ok: { text: 'text-ink', bar: '#52635a', soft: 'border-line bg-bg-inset', fill: '#dbe2dc' },
  tight: { text: 'text-ink', bar: '#8a7d66', soft: 'border-line bg-bg-inset', fill: '#e8e1d5' },
  bad: { text: 'text-ink', bar: '#866b68', soft: 'border-line bg-bg-inset', fill: '#e7dbd8' },
} as const

/** The plot, the buildable area inside the setbacks, and a block for the rooms that grows as you add them. */
function PlotDiagram({ plotSqm, w, d, need, tone }: { plotSqm: number; w: number; d: number; need: number; tone: Tone }) {
  useLanguage(s => s.language);

  const W = 150, H = 110
  const aspect = Math.max(0.5, Math.min(2, w / Math.max(d, 1)))
  const bw = aspect >= 1 ? 110 : 110 * aspect, bh = aspect >= 1 ? 110 / aspect : 110
  const ratio = Math.min(1.25, need / Math.max(1, w * d))
  const f = Math.sqrt(ratio)
  const hw = bw * 0.9 * f, hh = bh * 0.9 * f
  const cx = W / 2, cy = H / 2 - 4
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-32 flex-none" role="img" aria-label={translateUi("Rooms against the buildable area")}>
      <rect x={cx - bw / 2 - 6} y={cy - bh / 2 - 6} width={bw + 12} height={bh + 12} fill="#F4F4F1" stroke="#9AA0A6" />
      <rect x={cx - bw / 2} y={cy - bh / 2} width={bw} height={bh} fill="#eeeeec" stroke="#92928a" strokeDasharray="4 3" />
      <rect x={cx - hw / 2} y={cy - hh / 2} width={hw} height={hh} fill={TONE[tone].fill} stroke={TONE[tone].bar} strokeWidth={1.5}
        style={{ transition: 'all 400ms ease' }} />
      <text x={cx} y={H - 1} textAnchor="middle" fontSize="6.5" fill="#6B7280">{translateUi(Math.round(plotSqm))} {translateUi("m²")} ({(plotSqm / 101.17141).toFixed(1)} {translateUi("Guntha")})</text>
    </svg>
  )
}

export function FitMeter({validation,visible=true}:{validation:ReturnType<typeof useBriefValidation>;visible?:boolean}) {
  useLanguage(s => s.language);

  const edit = useStudio((s) => s.edit)
  const {fit,checking,error,suggestions,source}=validation

  // State: expanded (popup window open) vs minimized (notification pill)
  const [isOpen, setIsOpen] = useState(true)

  useEffect(()=>{if(fit&&!fit.fits)setIsOpen(true)},[fit?.fits])
  if(!visible)return null
  if(checking||error||!fit)return <aside aria-label={translateUi('Plot feasibility')} aria-busy={checking}
    className={`fixed bottom-6 right-6 z-40 border border-line-strong bg-bg-raised shadow-lg ${isOpen?'w-[calc(100vw-2rem)] max-w-[410px] overflow-hidden rounded-xl':'rounded-full px-4 py-2.5'}`}>
    {isOpen&&<><div className="h-1.5 bg-ink-dim/30"/><div className="border-b border-line px-4 py-3"><p className="text-xs font-semibold uppercase tracking-wider text-ink-dim">{translateUi('Plot feasibility')}</p></div></>}
    <div className={isOpen?'flex min-h-[155px] items-center p-4':''}>{error?<div role="alert"><p className="text-sm text-ink-dim">{error}</p><button type="button" className="mt-3 border border-line px-3 py-2 text-xs" onClick={validation.retry}>{translateUi('Check again')}</button></div>:<SpaceValidation compact={!isOpen}/>}</div>
  </aside>

  // rooms + circulation the busiest floor needs, against the buildable area of one floor (walls take ~12%)
  const buildable = fit.buildableWidthM * fit.buildableDepthM
  const need = fit.minimumSqm / 0.88
  const ratio = buildable > 0 ? need / buildable : 2
  const tone: Tone = !fit.fits ? 'bad' : fit.atTarget ? 'ok' : 'tight'
  const pct = Math.max(4, Math.min(100, Math.round(ratio * 100)))
  const title = fit.issues.length ? 'These requirements cannot produce a valid plan yet'
    : !fit.fits ? 'This brief does not fit the plot yet'
      : fit.atTarget ? 'Everything fits comfortably' : 'It fits, but space is tight'
  const apply = (s: FitAction) => {if(source)edit(b=>applySuggestionChanges(b,source,s.brief))}
  const help=!fit.fits

  // Compact notification pill when minimized or closed
  if (!isOpen) {
    return (
      <aside aria-label={translateUi("Fit status notification")} className="fixed bottom-6 right-6 z-50">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2.5 rounded-full border border-line-strong bg-bg-raised/95 px-4 py-2.5 shadow-xl backdrop-blur-md transition-all hover:scale-105 active:scale-95 hover:border-ink cursor-pointer"
          aria-label={translateUi("Expand fit notification")}
        >
          <span className="relative flex h-2.5 w-2.5">
            {tone !== 'ok' && (
              <span
                className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                style={{ backgroundColor: TONE[tone].bar }}
              />
            )}
            <span
              className="relative inline-flex h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: TONE[tone].bar }}
            />
          </span>
          <span className={cx('text-xs font-medium', TONE[tone].text)}>
            {translateUi(fit.atTarget ? 'Fits comfortably' : !fit.fits ? 'Does not fit' : 'Space is tight')}
          </span>
          <span className="font-mono text-[11px] text-ink-faint tnum">
            {Math.round(need)}/{Math.round(buildable)} m²
          </span>
          <ChevronUp size={14} className="text-ink-faint ml-0.5" />
        </button>
      </aside>
    )
  }

  // Floating notification popup window
  return (
    <aside
      role="status"
      aria-live="polite"
      className="fixed bottom-6 right-6 z-50 w-[calc(100vw-2rem)] sm:w-[410px] max-w-[410px] overflow-hidden rounded-xl border border-line-strong bg-bg-raised/95 shadow-2xl backdrop-blur-md transition-all duration-200 animate-in fade-in slide-in-from-bottom-3"
    >
      {/* Top accent line matching current fit tone */}
      <div className="h-1.5 w-full" style={{ backgroundColor: TONE[tone].bar }} />

      {/* Notification window header */}
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5 bg-bg/60">
        <div className="flex items-center gap-2 min-w-0">
          <span className="p-1 rounded-md" style={{ backgroundColor: `${TONE[tone].bar}1A` }}>
            {tone === 'ok' ? (
              <Check size={14} className={TONE[tone].text} />
            ) : (
              <AlertTriangle size={14} className={TONE[tone].text} />
            )}
          </span>
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-dim truncate">
            {translateUi("Plot Feasibility")}
          </span>
          {checking && (
            <span className="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-ink-faint animate-pulse">
              {translateUi("checking…")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            aria-label={translateUi("Minimize notification")}
            title="Minimize"
            className="rounded p-1 text-ink-faint hover:bg-bg-inset hover:text-ink transition-colors cursor-pointer"
          >
            <ChevronDown size={15} />
          </button>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            aria-label={translateUi("Close notification")}
            title="Close"
            className="rounded p-1 text-ink-faint hover:bg-bg-inset hover:text-ink transition-colors cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Notification window body */}
      <div className="p-4 space-y-3.5 max-h-[calc(100vh-140px)] overflow-y-auto">
        <p className={cx('flex items-center gap-2 font-medium text-sm', TONE[tone].text)}>
          {translateUi(title)}
        </p>

        <div className="flex items-center gap-3">
          <PlotDiagram plotSqm={fit.plotSqm} w={fit.buildableWidthM} d={fit.buildableDepthM} need={need} tone={tone} />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-ink-dim">
                <span>{translateUi("Rooms need:")}</span>
                <span className="font-medium text-ink tnum">~{Math.round(need)} m² ({fit.busiestFloor})</span>
              </div>
              <div className="flex justify-between text-[11px] text-ink-dim">
                <span>{translateUi("Buildable:")}</span>
                <span className="font-medium text-ink tnum">{Math.round(buildable)} m² / floor</span>
              </div>
            </div>

            <div className="relative h-2 w-full overflow-hidden rounded-full bg-bg-inset">
              <div
                className="h-full transition-[width] duration-500 rounded-full"
                style={{ width: `${pct}%`, background: TONE[tone].bar }}
              />
            </div>
            <p className="text-[10px] text-ink-faint">
              {translateUi("Buildable: ")}{fit.buildableWidthM.toFixed(1)} × {fit.buildableDepthM.toFixed(1)} {translateUi("m after setbacks")}
            </p>
          </div>
        </div>

        {fit.issues.length > 0 && (
          <p className="text-xs text-bad rounded bg-bad/5 p-2 border border-bad/20">
            {translateUi(fit.issues.slice(0, 2).join(' '))}
          </p>
        )}

        {help && (
          <div className="border-t border-line pt-2.5 space-y-2">
            <p className="flex items-center gap-1.5 font-mono text-[0.68rem] uppercase tracking-[0.1em] text-ink-dim">
              <Sparkles size={12} className="text-accent" /> {translateUi("Suggestions to make it fit")}
            </p>
            {validation.suggestionsChecking ? <SpaceValidation compact label="Finding options…"/> : suggestions?.length ? (
              <div className="flex flex-col gap-1.5">
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => apply(s)}
                    className="border border-line rounded bg-bg px-2.5 py-1.5 text-left text-xs transition-colors hover:border-accent hover:bg-bg-inset cursor-pointer"
                  >
                    <span className="block font-medium text-ink">{translateUi(s.label)}</span>
                    <span className="block text-[11px] text-ink-faint">{translateUi(s.detail)} · Tap to apply</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-ink-dim">
                {translateUi("Try a larger plot, smaller setbacks, fewer rooms or another floor.")}
              </p>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
