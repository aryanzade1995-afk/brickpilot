import { translate as translateUi, useLanguage } from '@/lib/i18n/index.ts'
import { DotLottieWorkerReact, setWasmUrl } from '@lottiefiles/dotlottie-react'

// a worker cannot resolve root-relative URLs
const absolute = (path: string) => new URL(path, window.location.origin).href
setWasmUrl(absolute('/animations/dotlottie-player.wasm'))


/** One worker-rendered loader survives the navigation from Brief to Directions. */
export function GenerationOverlay({ label, value = 0 }: { label: string; value?:number }) {
  useLanguage(s => s.language);

  return <div role="progressbar" aria-label={translateUi(label)} aria-busy="true" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}
    className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-bg px-6">
    <div className="aspect-square w-[min(70vw,420px)] border border-line bg-white">
      <DotLottieWorkerReact src={absolute('/animations/building.lottie')} loop autoplay style={{ width: '100%', height: '100%' }} />
    </div>
    <div className="w-[min(80vw,420px)]">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-xs uppercase tracking-[0.1em] text-ink-dim">{translateUi(label)}</span>
        <span className="relative h-5 w-12 text-right font-mono text-sm tabular-nums text-ink">
          {Math.round(Math.max(0,Math.min(100,value)))}%
        </span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden bg-bg-inset">
        <div className="h-full origin-left bg-ink" style={{transform:`scaleX(${Math.max(0,Math.min(100,value))/100})`,transition:'transform .2s ease-out'}} />
      </div>
    </div>
  </div>
}
