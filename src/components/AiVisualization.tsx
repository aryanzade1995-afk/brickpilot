import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Sparkles } from 'lucide-react'
import type { Design } from '@/lib/engine/types.ts'
import { useStudio } from '@/state/studio.ts'
import { useBlender } from '@/state/blender.ts'
import { TimedProgress } from '@/components/RenderProgress.tsx'
import { useVillaVisualizations } from '@/state/villaVisualizations.ts'
import { createBuildingModel } from '@/lib/engine/buildingModel.ts'
import { finishSignature } from '@/lib/cost/finishAssignments.ts'
import { VillaVisualizationViewport, type VillaViewportHandle } from '@/lib/render/VillaVisualizationViewport.tsx'
import { readVisualizationPair, visualizationSourceId, VILLA_VIEW_LABELS } from '@/lib/render/villaVisualizations.ts'

/** The AI villa visualization, shown at the bottom of 3D Massing. The Blender villa it is made from is captured off screen,
 *  so only the realistic image is shown here. */
export function AiVisualization({ design }: { design: Design }) {
  const brief = useStudio((s) => s.brief)
  const plan = useMemo(() => ({ ...design, model: { ...design.model, brief } }), [design, brief])
  const planId = useMemo(() => createBuildingModel(plan).planId, [plan])
  const blender = useBlender((s) => s.accepted[planId])
  const [ready, setReady] = useState(false)
  const [storedPhase, storePhase] = useState<{ sourceId: string; value: 'idle' | 'capture' | 'generate' } | null>(null)
  const [storedMessage, storeMessage] = useState<{ sourceId: string; text: string | null } | null>(null)
  const viewport = useRef<VillaViewportHandle>(null), request = useRef<AbortController | null>(null)
  const source = 'blender', seed = blender?.seed ?? 0
  const sourceId = visualizationSourceId(planId, source, seed, blender?.files.glb ?? '', finishSignature(brief))
  const phase = storedPhase?.sourceId === sourceId ? storedPhase.value : 'idle', message = storedMessage?.sourceId === sourceId ? storedMessage.text : null
  const setPhase = (value: 'idle' | 'capture' | 'generate') => storePhase({ sourceId, value })
  const setMessage = (text: string | null) => storeMessage({ sourceId, text })
  const pair = useVillaVisualizations((s) => s.pairs[sourceId]), save = useVillaVisualizations((s) => s.save)
  const readyChanged = useCallback((value: boolean) => setReady(value), [])
  const busy = phase !== 'idle'
  const hasModel = Boolean(blender)
  useEffect(() => () => { request.current?.abort(); request.current = null }, [sourceId])
  const generate = async () => {
    if (!viewport.current || !ready || busy) return
    const controller = new AbortController(); request.current = controller; setMessage(null); setPhase('capture')
    try {
      const views = await viewport.current.capture(); controller.signal.throwIfAborted(); setPhase('generate')
      const response = await fetch('/api/villa-visualizations', { method: 'POST', headers: { 'content-type': 'application/json' },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(340000)]),
        body: JSON.stringify({ sourceId, source, seed, views, facts: `${plan.floors.length} occupied floors. Keep the supplied accepted Blender villa unchanged. ${plan.openingCounts.windows} planned windows, ${plan.openingCounts.doors} planned doors. ${plan.siteFeatures?.some((f) => f.kind === 'pool') ? 'The site has a swimming pool.' : 'The site has NO swimming pool.'}` }) })
      const data = await response.json(); controller.signal.throwIfAborted()
      if (!response.ok) throw new Error('Visualizations are unavailable right now. Your 3D model is ready.')
      save(readVisualizationPair(data, sourceId))
    } catch (error) {
      if (!controller.signal.aborted) { console.warn('[villa-visualizations] Request did not complete:', error instanceof Error ? error.message : 'Unknown error'); setMessage('Visualizations are unavailable right now. Your 3D model is ready.') }
    } finally { if (request.current === controller) { setPhase('idle'); request.current = null } }
  }
  return <section aria-label="AI villa visualization" className="mt-10 border-t border-line pt-6">
    {/* the Blender villa the image is made from, rendered off screen for the capture only */}
    {hasModel && <div aria-hidden className="pointer-events-none h-px w-px overflow-hidden opacity-0">
      <div className="w-[800px]"><VillaVisualizationViewport key={sourceId} ref={viewport} design={plan} url={blender!.files.glb} onReady={readyChanged} /></div>
    </div>}
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
      <div><h2 className="font-display text-2xl">AI villa visualization</h2><p className="mt-1 text-xs text-ink-dim">A realistic front view of the same villa, with matching colours and material placement.</p></div>
      <button type="button" disabled={!hasModel || !ready || busy} onClick={() => void generate()} className="flex items-center gap-2 bg-ink px-5 py-3 text-sm text-bg disabled:opacity-40"><Sparkles size={16} />{phase === 'capture' ? 'Preparing views…' : phase === 'generate' ? 'Creating visualizations…' : 'Generate AI Visualization'}</button>
    </div>
    {!hasModel && <p className="mt-3 text-xs text-ink-dim">The Blender villa above is still being prepared. The visualization can be made once it is ready.</p>}
    {phase !== 'idle' && <TimedProgress key={phase} label={phase === 'capture' ? 'Capturing the model front view' : 'Generating the realistic front view'} expectedSeconds={phase === 'capture' ? 3 : 40} start={phase === 'capture' ? 10 : 18} />}
    {message && <p role="status" className="mt-4 text-sm text-ink-dim">{message}</p>}
    <div className="mt-5 grid max-w-2xl gap-5">
      {(Object.keys(VILLA_VIEW_LABELS) as (keyof typeof VILLA_VIEW_LABELS)[]).map((view) => {
        const image = pair?.images.find((i) => i.view === view)
        return <figure key={view}><div className="flex aspect-[4/3] items-center justify-center overflow-hidden border border-line bg-bg-inset">
          {image ? <a href={image.url} target="_blank" rel="noreferrer" className="block h-full w-full"><img src={image.url} alt={`${VILLA_VIEW_LABELS[view]} of the villa`} className="h-full w-full object-contain" /></a> : <p className="px-6 text-center text-sm text-ink-faint">{busy ? 'Creating this view…' : `${VILLA_VIEW_LABELS[view]} will appear here.`}</p>}
        </div><figcaption className="mt-3 flex items-center justify-between gap-2 text-sm"><span>{VILLA_VIEW_LABELS[view]}</span>{image && <a href={image.url} download={`${source}_${seed}_${view}.png`} className="flex items-center gap-1 text-xs underline"><Download size={13} />Download</a>}</figcaption></figure>
      })}
    </div>
    <p className="mt-3 text-xs text-ink-faint">AI Visualisation · Compare generated images against the authoritative model before presenting architectural details.</p>
  </section>
}
