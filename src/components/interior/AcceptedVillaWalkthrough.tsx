import { lazy, Suspense, useMemo, useState } from 'react'
import type { BlenderResult } from '@/state/blender.ts'
import type { WalkthroughSource } from '@/lib/walkthrough/source.ts'
import { buildWalkthroughScene } from '@/lib/walkthrough/scene.ts'
import { prepareWalkthroughGeometry } from '@/lib/walkthrough/delivery.ts'
import { translate as t } from '@/lib/i18n/index.ts'
import type { AcceptedVillaPreview } from './WalkthroughAssetPreview.tsx'

const Preview = lazy(() => import('./WalkthroughAssetPreview.tsx'))

/** The accepted URL is the authority. Preparing navigation metadata never
 * generates, modifies, dresses or replaces any displayed model geometry. */
export function AcceptedVillaWalkthrough({ asset, source, finishesCurrent }: { asset?: BlenderResult; source: WalkthroughSource; finishesCurrent: boolean }) {
  const [open, setOpen] = useState(false)
  // Parent is keyed by plan ID. Material/preference changes keep navigation
  // metadata and the loaded accepted asset alive until a new export is selected.
  const [geometry] = useState(() => {
    try { return prepareWalkthroughGeometry(buildWalkthroughScene(source.building, { hardChecksPass: source.state !== 'blocked' })) } catch { return null }
  })
  const url = asset?.files.glb, planId = source.building.planId, acceptedPlanId = asset?.planId
  const acceptedVilla = useMemo<AcceptedVillaPreview | null>(() => {
    if (!url || acceptedPlanId !== planId) return null
    return { url, geometry }
  }, [url, acceptedPlanId, planId, geometry])
  return <div className="border-t border-line p-5 md:px-7" aria-label={t('Accepted Blender villa walkthrough')}>
    <h3 className="font-display text-lg">{t('Exact villa from 3D Massing')}</h3>
    <p className="mt-2 max-w-3xl text-xs leading-relaxed text-ink-dim">{t('Uses the same accepted Blender GLB, with its original geometry, materials and included furniture. No replacement house or extra furniture is generated.')}</p>
    {!acceptedVilla ? <div className="mt-4 border border-line bg-bg-inset p-4"><p className="text-sm">{t('Open 3D Massing and prepare your Blender villa first.')}</p><a href="/workspace/massing" className="mt-3 inline-flex min-h-11 items-center text-xs underline">{t('Open 3D Massing')}</a></div> : <>
      <div className="mt-4 flex flex-wrap gap-3"><button type="button" onClick={() => setOpen(v => !v)} className="min-h-11 border border-line bg-accent px-4 text-xs text-bg">{t(open ? 'Close villa walkthrough' : 'Open villa walkthrough')}</button>
        <a href={acceptedVilla.url} download className="inline-flex min-h-11 items-center border border-line px-4 text-xs underline">{t('Download the same Blender GLB')}</a></div>
      {!finishesCurrent && <p role="status" className="mt-3 text-xs leading-relaxed text-ink-dim">{t('Showing the saved Massing materials unchanged. To include newer finish selections, update the accepted villa in 3D Massing.')}</p>}
      <p className="mt-3 text-xs leading-relaxed text-ink-dim">{t('Only furniture already present in this GLB is shown. The separate Furnished tab and 360° room previews are not added. Closed doors remain solid and unchanged.')}</p>
      {open && <Suspense fallback={<p role="status" className="py-4 text-xs">{t('Loading the exported house…')}</p>}><Preview key={acceptedVilla.url} planId={source.building.planId} acceptedVilla={acceptedVilla} floors={acceptedVilla.geometry?.metadata.floors ?? []} /></Suspense>}
      <p className="mt-3 text-xs text-ink-faint">{t('Car: ')}<a href="https://sketchfab.com/models/57bf6cc56931426e87494f554df1dab6" target="_blank" rel="noreferrer" className="underline">{t('Ferrari 458 Italia by vicent091036')}</a>{t(', adapted under ')}<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer" className="underline">{t('CC BY 4.0')}</a>.</p>
    </>}
  </div>
}
