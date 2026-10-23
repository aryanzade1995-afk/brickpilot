import { useLayoutEffect, useRef, useState } from 'react'
import { translate as t } from '@/lib/i18n/index.ts'
import { utilityTooltipPosition } from '@/lib/utilities/drainagePresentation.ts'

export type UtilityHoverInfo = { title: string; lines: string[]; category?: string; color?: string; status?: string; properties?: { label: string; value: string }[]; reference?: string }
export function UtilityHoverCard({ info, x, y, width, height }: { info: UtilityHoverInfo; x: number; y: number; width: number; height: number }) {
  const ref = useRef<HTMLDivElement>(null), [measured, setMeasured] = useState({ w: 292, h: 210 })
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(() => { const r = element.getBoundingClientRect(); setMeasured(old => old.w === r.width && old.h === r.height ? old : { w: r.width, h: r.height }) })
    observer.observe(element); return () => observer.disconnect()
  }, [])
  const point = utilityTooltipPosition({ x, y }, measured, { w: width, h: height })
  return <div ref={ref} role="tooltip" className="pointer-events-none absolute z-20 overflow-hidden rounded-md border border-line bg-bg-raised text-ink shadow-[0_10px_36px_rgba(23,23,23,0.14)]" style={{ left: point.x, top: point.y, width: Math.min(292, width - 24), maxHeight: height - 24 }}>
    <div className="h-[3px]" style={{ background: info.color ?? 'var(--color-accent)' }} />
    <div className="p-4"><div className="mb-2 flex items-center justify-between gap-2"><span className="font-mono text-[9px] uppercase tracking-[.14em] text-ink-faint">{t(info.category ?? 'Utility details')}</span>{info.status && <span className="rounded-sm border border-line bg-bg-inset px-2 py-1 text-[9px] text-ink-dim">{t(info.status)}</span>}</div>
      <p className="break-words font-display text-lg leading-snug">{t(info.title)}</p>
      {info.properties && <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 border-y border-line py-3">{info.properties.map(p => <div key={p.label}><dt className="text-[9px] uppercase tracking-wide text-ink-faint">{t(p.label)}</dt><dd className="mt-1 text-xs font-medium">{t(p.value)}</dd></div>)}</dl>}
      <div className="mt-3 space-y-2 text-[11px] leading-relaxed text-ink-dim">{info.lines.slice(0, 3).map((line, i) => <p key={i} className="line-clamp-3 break-words">{t(line)}</p>)}</div>
      {info.reference && <p className="mt-3 truncate border-t border-line pt-2 font-mono text-[9px] text-ink-faint">{info.reference}</p>}
    </div>
  </div>
}
