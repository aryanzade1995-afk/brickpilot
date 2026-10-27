import { useProjectPipelines } from '../water/useProjectPipelines.ts'
import { lazy, Suspense, useMemo, useState } from 'react'
import type { BlenderResult } from '@/state/blender.ts'
import type { WalkthroughSource } from '@/lib/walkthrough/source.ts'
import { buildWalkthroughScene } from '@/lib/walkthrough/scene.ts'
import { prepareWalkthroughGeometry, prepareWalkthroughAppearance } from '@/lib/walkthrough/delivery.ts'
import type { Design } from '@/lib/engine/types.ts'
import { translate as t } from '@/lib/i18n/index.ts'
import type { AcceptedVillaPreview } from './WalkthroughAssetPreview.tsx'
import {WalkthroughBakeControls} from './WalkthroughBakeControls.tsx'
import {lightingLayoutSignature} from '@/lib/walkthrough/lighting.ts'

const Preview = lazy(() => import('./WalkthroughAssetPreview.tsx'))

/** The accepted URL is the authority. Preparing navigation metadata never
 * generates, modifies, dresses or replaces any displayed model geometry. */
export function AcceptedVillaWalkthrough({ asset, source, design }: { asset?: BlenderResult; source: WalkthroughSource; design: Design }) {
  const [open, setOpen] = useState(false)
  const pipelines=useProjectPipelines(design,source.building,design.model.brief,open)
  const [lightingId,setLightingId]=useState<string|null>(null)
  // Parent is keyed by plan ID. Material/preference changes keep navigation
  // metadata and the loaded accepted asset alive until a new export is selected.
  const [geometry] = useState(() => {
    try { return prepareWalkthroughGeometry(buildWalkthroughScene(source.building, { hardChecksPass: source.state !== 'blocked' })) } catch { return null }
  })
  const url = asset?.files.glb, planId = source.building.planId, acceptedPlanId = asset?.planId
  const appearance = useMemo(() => geometry ? prepareWalkthroughAppearance(design, source, geometry) : undefined, [design, source, geometry])
  const lightingSignature=appearance?lightingLayoutSignature(appearance):''
  const acceptedVilla = useMemo<AcceptedVillaPreview | null>(() => {
    if (!url || acceptedPlanId !== planId) return null
    return { url, geometry,lighting:lightingId?{id:lightingId,signature:lightingSignature}:undefined }
  }, [url, acceptedPlanId, planId, geometry,lightingId,lightingSignature])
  return <div className="border-t border-line p-5 md:px-7" aria-label={t('Accepted Blender villa walkthrough')}>
    {!acceptedVilla ? <div className="mt-4 border border-line bg-bg-inset p-4"><p className="text-sm">{t('Open 3D Massing and prepare your Blender villa first.')}</p><a href="/workspace/massing" className="mt-3 inline-flex min-h-11 items-center text-xs underline">{t('Open 3D Massing')}</a></div> : <>
      <div className="mt-4 flex flex-wrap gap-3"><button type="button" onClick={() => setOpen(v => !v)} className="min-h-11 border border-line bg-accent px-4 text-xs text-bg">{t(open ? 'Close 3D view' : 'Open 3D view')}</button>
        <a href={acceptedVilla.url} download className="inline-flex min-h-11 items-center border border-line px-4 text-xs underline">{t('Download GLB')}</a></div>
      {open && <Suspense fallback={<p role="status" className="py-4 text-xs">{t('Loading the exported house…')}</p>}><Preview key={acceptedVilla.url+':'+(lightingId??'realtime')} planId={source.building.planId} acceptedVilla={acceptedVilla} pipelines={pipelines} appearance={appearance} floors={acceptedVilla.geometry?.metadata.floors ?? []} /></Suspense>}
      {appearance&&<WalkthroughBakeControls design={design} source={source} acceptedUrl={acceptedVilla.url} signature={lightingSignature} onReady={setLightingId}/>}
      <details className="mt-3 text-xs text-ink-dim"><summary className="min-h-11 cursor-pointer py-3">{t('Controls & model details')}</summary>
        <p>{t('WASD: move · Mouse: look · E: doors · Esc: exit')}</p>
        <p className="mt-2">{t('Selected products are shown where supported. Textures and procedural furnishings are visual approximations.')}</p>
        {geometry?.metadata.issues.filter(i=>i.code==='GUARD_REVIEW').map(i=><p key={i.sourceId} className="mt-2">{t(i.message)}</p>)}
        <p className="mt-2">{t('Model credits')}: <a href="https://sketchfab.com/models/57bf6cc56931426e87494f554df1dab6" target="_blank" rel="noreferrer" className="underline">Ferrari 458 Italia · vicent091036</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer" className="underline">CC BY 4.0</a>.</p>
        <a href="/interior-assets/ATTRIBUTION.txt" target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-11 items-center underline">{t('Furniture & fixture credits')}</a>
      </details>
    </>}
  </div>
}
