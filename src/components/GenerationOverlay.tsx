import { DotLottieWorkerReact, setWasmUrl } from '@lottiefiles/dotlottie-react'

// a worker cannot resolve root-relative URLs
const absolute = (path: string) => new URL(path, window.location.origin).href
setWasmUrl(absolute('/animations/dotlottie-player.wasm'))

const EST_SECONDS = 20
const STEPS = Array.from({ length: 20 }, (_, i) => i * 5)

/** Full-page centred loader. Concept generation blocks the main thread, so the animation is drawn in a
 *  worker and the bar and percentage use compositor-only animations (transform, opacity) — both keep moving. */
export function GenerationOverlay({ label }: { label: string }) {
  return <div role="progressbar" aria-label={label} aria-busy="true"
    className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-bg px-6">
    <style>{`
      @keyframes gen-bar { from { transform: scaleX(0) } to { transform: scaleX(.95) } }
      @keyframes gen-pop { from { opacity: 0 } to { opacity: 1 } }
    `}</style>
    <div className="aspect-square w-[min(70vw,420px)] border border-line bg-white">
      <DotLottieWorkerReact src={absolute('/animations/building.lottie')} loop autoplay style={{ width: '100%', height: '100%' }} />
    </div>
    <div className="w-[min(80vw,420px)]">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-xs uppercase tracking-[0.1em] text-ink-dim">{label}</span>
        <span className="relative h-5 w-12 text-right font-mono text-sm tabular-nums text-ink">
          {STEPS.map((p) => <span key={p} className="absolute inset-0 bg-bg opacity-0"
            style={{ animation: `gen-pop .01s linear ${(p / 95) * EST_SECONDS}s forwards` }}>{p}%</span>)}
        </span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden bg-bg-inset">
        <div className="h-full origin-left bg-ink" style={{ animation: `gen-bar ${EST_SECONDS}s linear forwards`, transform: 'scaleX(0)' }} />
      </div>
    </div>
  </div>
}
