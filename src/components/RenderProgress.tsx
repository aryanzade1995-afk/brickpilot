import { useEffect, useRef, useState } from 'react'

/** The server reports stage milestones; between them the bar creeps forward so it never looks frozen,
 *  but never past the next stage and never backwards. */
export function RenderProgress({ progress, label }: { progress?: number; label: string }) {
  const floor = Math.max(2, Math.min(100, progress ?? 2))
  const ceiling = floor >= 100 ? 100 : floor < 60 ? 58 : 97
  const [shown, setShown] = useState(floor)
  const target = useRef(floor)
  useEffect(() => {
    target.current = floor
  }, [floor])
  useEffect(() => {
    const t = setInterval(() => setShown((v) => {
      const next = Math.max(v, target.current)
      return next >= ceiling ? next : Math.min(ceiling, next + (ceiling - next) * 0.02 + 0.05)
    }), 500)
    return () => clearInterval(t)
  }, [ceiling])
  const pct = Math.round(Math.max(shown, floor))
  return <div className="mt-4" role="progressbar" aria-label="3D render progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
    <div className="flex justify-between text-xs text-ink-dim"><span>{label}</span><span className="tabular-nums">{pct}%</span></div>
    <div className="mt-1 h-2 w-full overflow-hidden bg-bg-inset"><div className="h-full bg-ink transition-[width] duration-500" style={{ width: `${pct}%` }} /></div>
  </div>
}
