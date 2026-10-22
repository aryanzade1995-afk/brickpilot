import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Design } from '@/lib/engine/types.ts'
import type { WalkthroughSource } from '@/lib/walkthrough/source.ts'
import { translate as t } from '@/lib/i18n/index.ts'
import { buildWalkthroughScene } from '@/lib/walkthrough/scene.ts'
import { prepareWalkthroughAppearance, prepareWalkthroughGeometry, WALKTHROUGH_APPEARANCE_VERSION } from '@/lib/walkthrough/delivery.ts'
import { specsCatalogue } from '@/lib/cost/catalogue.ts'
import { photographedOptions } from '@/lib/finishes/optionImage.ts'
import { readWalkthroughSession, saveWalkthroughSession } from '@/lib/walkthrough/assetSession.ts'

const Preview = lazy(() => import('./WalkthroughAssetPreview.tsx'))
const ProductEditor = lazy(() => import('./WalkthroughProductEditor.tsx'))
type Job = { id: string; designId: string; projectId: string; geometryKey: string; appearanceKey: string; status: string; stage?: string; error?: string; cached?: boolean; geometryReused?: boolean }
type Metadata = { appearanceVersion?: string; floors: { sourceId: string; level: number; elevationM: number }[]; entries: unknown[]; issues: { message: string }[]; appearanceIssues: { message: string }[] }
const visualLabels: Record<string, string> = { 'product-swatch': 'Product swatch', 'generic-material': 'Generic material illustration',
  'product-photo-reference': 'Photo reference; approximate 3D', 'procedural-approximation': 'Illustrative 3D', 'catalogue-size': 'Catalogue tile size', 'concept-assumption': 'Illustrative size' }

export function WalkthroughAssets({ design, source, projectId }: { design: Design; source: WalkthroughSource; projectId: string }) {
  const [restored] = useState(() => readWalkthroughSession(projectId, source.geometryKey))
  const [job, setJob] = useState<Job | null>(restored), [busy, setBusy] = useState(false), [error, setError] = useState(''), [metadata, setMetadata] = useState<Metadata | null>(null), [preview, setPreview] = useState(false)
  const active = useRef<AbortController | null>(null)
  // Parent is keyed only by project/structural identity. Finish edits retain this
  // exact geometry package, loaded house, orbit camera and walking controller.
  const [geometry] = useState(() => prepareWalkthroughGeometry(buildWalkthroughScene(source.building, { hardChecksPass: source.state !== 'blocked' })))
  const [exportSignature, setExportSignature] = useState(restored?.signature ?? ''), [scheduleRoom, setScheduleRoom] = useState('')
  const [editingItem, setEditingItem] = useState('')
  const appearance = useMemo(() => job?.status === 'ready' ? prepareWalkthroughAppearance(design, source, geometry) : null, [design, source, geometry, job?.status])
  const exportCurrent = exportSignature === source.appearanceKey && metadata?.appearanceVersion === WALKTHROUGH_APPEARANCE_VERSION
  const firstRoom = geometry.metadata.rooms.find(r => /living|bedroom|dining/i.test(r.name))?.id
  const schedule = appearance?.specifications.find(r => r.roomId === (scheduleRoom || firstRoom)) ?? appearance?.specifications[0]
  // Reuse the room resolver's visible summary. Concealed/site/structural systems
  // stay in the export schedule rather than cluttering an interior material list.
  const roomItems = new Set(schedule?.finishes.summary.map(s => specsCatalogue.items.find(i => i.label === s.label)?.id))
  useEffect(() => () => active.current?.abort(), [])
  useEffect(() => {
    if (!restored) return
    const controller = new AbortController(); active.current = controller
    void fetch(`/api/walkthrough-assets/${restored.id}/metadata.json`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Cached export unavailable')
      const info = await response.json()
      if (info.designId !== restored.designId || info.projectId !== restored.projectId || info.geometryKey !== restored.geometryKey) throw new Error('Cached export mismatch')
      if (!controller.signal.aborted) setMetadata(info)
    }).catch(() => { if (!controller.signal.aborted) { setJob(null); setError(t('The saved walkthrough is unavailable. Generate its assets again.')) } })
    return () => controller.abort()
  }, [restored])
  useEffect(() => {
    if (job?.status === 'ready' && metadata) saveWalkthroughSession(projectId, source.geometryKey, { ...job, status: 'ready', signature: exportSignature })
  }, [job, metadata, projectId, source.geometryKey, exportSignature])
  const generate = async () => {
    active.current?.abort(); const controller = new AbortController(); active.current = controller
    setBusy(true); setError(''); setJob(null); setMetadata(null); setPreview(false)
    setExportSignature(source.appearanceKey)
    const read = async (response: Response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error || t('The walkthrough export is unavailable. Please retry.')); return data }
    try {
      let next: Job = await read(await fetch('/api/walkthrough-assets', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ design, projectId, expectedPlanId: source.building.planId, preferences: source.preferences }) }))
      const deadline = Date.now() + 22 * 60 * 1000
      while (true) {
        if (next.designId !== source.building.planId || next.projectId !== projectId) throw new Error(t('The exported model does not match this project.'))
        setJob(next)
        if (next.status === 'ready') break
        if (['missing', 'failed'].includes(next.status)) throw new Error(next.error || t('The walkthrough export is unavailable. Please retry.'))
        if (Date.now() > deadline) throw new Error(t('The export is taking longer than expected. Retry to check the cached result.'))
        await new Promise<void>((resolve, reject) => { const cancel = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')) }; const timer = setTimeout(() => { controller.signal.removeEventListener('abort', cancel); resolve() }, 2000); controller.signal.addEventListener('abort', cancel, { once: true }) })
        next = await read(await fetch(`/api/walkthrough-assets/${next.id}`, { signal: controller.signal }))
      }
      const info = await read(await fetch(`/api/walkthrough-assets/${next.id}/metadata.json`, { signal: controller.signal }))
      if (info.designId !== source.building.planId || info.projectId !== projectId) throw new Error(t('The exported model does not match this project.'))
      setMetadata(info)
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : t('The walkthrough export is unavailable. Please retry.')) }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  const ready = job?.status === 'ready' && metadata && !error
  return <div className="border-t border-line p-5 md:px-7" aria-label={t('Walkthrough assets')}>
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="font-display text-lg">{t('Walkthrough assets')}</h3><p className="mt-2 max-w-2xl text-xs leading-relaxed text-ink-dim">{t('Export the connected house, existing furniture, collision data and room information. Finish changes reuse the shared structure.')}</p></div>
      <button type="button" disabled={busy || source.state === 'blocked'} onClick={generate} className="min-h-11 border border-line bg-accent px-4 py-3 text-xs text-bg disabled:opacity-40">{t(busy ? 'Preparing walkthrough assets…' : 'Generate walkthrough assets')}</button></div>
    <div aria-live="polite">{busy && <p className="mt-4 text-xs text-ink-dim">{t(job?.stage || 'Waiting to export')}</p>}{error && <p role="alert" className="mt-4 text-sm text-bad">{error}</p>}
      {ready && <div className="mt-4 border border-line bg-bg-inset p-4"><p className="text-sm">{t(job.cached ? 'The cached walkthrough assets are ready.' : 'The walkthrough assets are ready for review.')}</p>
        <p className="mt-2 text-xs text-ink-dim">{metadata.floors.length} {t('Floors')} · {metadata.entries.length} {t('Checked entry points')}{job.geometryReused ? ` · ${t('Shared structure reused')}` : ''}</p>
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setPreview(v => !v)} className="min-h-11 border border-line bg-bg px-3 text-xs">{t(preview ? 'Close model review' : 'Review exported model')}</button>{[
          ['house.glb', 'Download furnished house GLB'], ['collision.glb', 'Download collision GLB'], ['collision.json', 'Download collision data'], ['metadata.json', 'Download room and floor data'], ['materials.json', 'Download material map'],
        ].map(([file, label]) => exportCurrent && <a key={file} download href={`/api/walkthrough-assets/${job.id}/${file}`} className="flex min-h-11 items-center border border-line bg-bg px-3 text-xs underline underline-offset-4">{t(label)}</a>)}</div>
        {!exportCurrent && <p role="status" className="mt-3 text-xs text-ink-dim">{t('The live model uses your current finishes. Exported files are out of date; generate assets again to download the updated selections.')}</p>}
        <p className="mt-3 text-xs leading-relaxed text-ink-dim">{t('The furnished GLB already includes furniture. Review the source notes before exploring. Walking stops at unsupported edges.')}</p>
        <details className="mt-3"><summary className="min-h-11 cursor-pointer py-3 text-xs">{t('Export review notes')} ({metadata.issues.length + metadata.appearanceIssues.length})</summary><ul className="space-y-2 text-xs leading-relaxed text-ink-dim">{[...metadata.issues, ...metadata.appearanceIssues].map((issue, i) => <li key={i}>{issue.message}</li>)}</ul></details>
      </div>}
    </div>
    {ready && appearance && <details className="mt-4 border border-line p-4"><summary className="min-h-11 cursor-pointer text-sm">{t('Room finishes and product references')}</summary>
      <p className="my-3 text-xs leading-relaxed text-ink-dim">{t('Selections come from Finishes & Cost. Product shapes, colours and sheen are visual approximations unless verified assets are available. Product photos are references, not exact 3D models. Fitting counts shown are illustrative; cost quantities remain in Finishes & Cost.')}</p>
      <label className="text-xs">{t('Room')}<select value={schedule?.roomId ?? ''} onChange={e => setScheduleRoom(e.target.value)} className="ml-3 min-h-11 max-w-full border border-line bg-bg px-3">{appearance.specifications.map(r => <option key={r.roomId} value={r.roomId}>{t('Floor')} {geometry.metadata.floors.find(f => f.sourceId === geometry.metadata.rooms.find(ref => ref.id === r.roomId)?.floorId)?.level} · {geometry.metadata.rooms.find(ref => ref.id === r.roomId)?.name ?? r.roomId}</option>)}</select></label>
      <a href="/workspace/finishes?tab=specifications" className="ml-3 inline-flex min-h-11 items-center text-xs underline">{t('Edit in Finishes & Cost')}</a>
      <ul className="mt-3 max-h-72 space-y-3 overflow-y-auto text-xs">{schedule?.finishes.visualBasis.filter(v => roomItems.has(v.item)).map(v => { const item = specsCatalogue.items.find(i => i.id === v.item); return <li key={v.item} className="border-t border-line pt-2"><p>{t(item?.label ?? v.item)} · {v.name}{v.item === 'interior-paint' ? ` · ${schedule.finishes.walls.paint}` : ''}</p><p className="mt-1 text-ink-dim">{t(visualLabels[v.representation])} · {t(visualLabels[v.scale])}</p>{v.displayedOptionId !== v.optionId && <p className="mt-1 text-ink-dim">{t('Allowance exemplar; estimate retains the selected allowance.')}</p>}<div className="flex flex-wrap gap-3">{v.image && <a className="inline-flex min-h-11 items-center underline" href={v.image} target="_blank" rel="noreferrer">{t('Product reference')}</a>}{item && photographedOptions(item).length > 0 && <button type="button" className="min-h-11 border border-line px-3" onClick={() => setEditingItem(v.item)}>{t('Change in Finishes & Cost')}</button>}</div></li> })}</ul>
    </details>}
    {editingItem && schedule && <Suspense fallback={<p role="status" className="p-4 text-xs">{t('Loading…')}</p>}><ProductEditor design={design} itemId={editingItem} room={source.rooms.find(r => r.key === schedule.roomId)?.finishRoomKey} onClose={() => setEditingItem('')} /></Suspense>}
    {ready && preview && appearance && <AssetReviewBoundary><Suspense fallback={<p role="status" className="py-4 text-xs">{t('Loading the exported house…')}</p>}><Preview id={job.id} planId={source.building.planId} floors={metadata.floors} appearance={appearance} /></Suspense></AssetReviewBoundary>}
  </div>
}

class AssetReviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <div role="alert" className="mt-4 border border-line p-4 text-xs leading-relaxed text-ink-dim"><p>{t('Refresh the page to reload the model review. Your exported files are still available.')}</p><button type="button" className="mt-3 min-h-11 border border-line px-4" onClick={() => window.location.reload()}>{t('Refresh page')}</button></div> : this.props.children }
}
