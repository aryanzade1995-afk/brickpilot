import { translate as translateUi, useLanguage } from '@/lib/i18n/index.ts'
import { useStudio } from '@/state/studio.ts'
import { finishSignature } from '@/lib/cost/finishAssignments.ts'
import { Component, memo, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import type { Design } from '@/lib/engine/types.ts'
import { expandBalconyArea } from '@/lib/engine/balconyExtent.ts'
import { createBuildingModel } from '@/lib/engine/buildingModel.ts'
import { useBlender, directionRenderKey } from '@/state/blender.ts'
import { RenderProgress } from './RenderProgress.tsx'
import { StudioReflections } from './StudioReflections.tsx'
import { prepareVillaScene } from '@/lib/three/prepareVillaScene.ts'
import { BuildingFormSummary } from './BuildingFormSummary.tsx'
import { useSolarVillaEditor } from './solar/useSolarVillaEditor.ts'
import { SolarVillaControls } from './solar/SolarVillaControls.tsx'
import { SolarLayer } from '@/lib/three/SolarLayer.tsx'
import { SolarCamera, FitAcceptedVilla } from '@/lib/three/SolarCamera.tsx'
import { useSolarArtifacts, solarArtifactKey, isCurrentSolarArtifact } from '@/state/solarArtifacts.ts'
import { ExportDropdown } from '@/components/export/ExportDropdown.tsx'
import { villaCadExportItems, VILLA_CAD_HELP } from '@/components/export/villaCadExports.ts'
import { captureCanvasPng } from '@/lib/export/index.ts'

// Stable Canvas options prevent React updates to solar controls from reconfiguring the camera.
const VILLA_CAMERA = { position: [20, 14, -25] as [number, number, number], fov: 40 }
const VILLA_GL = { antialias: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: true }
const VILLA_DPR: [number, number] = [1, 2]

const Villa = memo(function Villa({ url }: { url: string }) {
  const gltf = useGLTF(url)
  const maxAnisotropy = useThree((state) => state.gl.capabilities.getMaxAnisotropy())
  const scene = useMemo(() => prepareVillaScene(gltf.scene, maxAnisotropy), [gltf.scene, maxAnisotropy])
  return <><primitive object={scene} dispose={null} /><FitAcceptedVilla scene={scene}/></>
})
class ModelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <p className="p-6 text-sm text-ink-dim">{translateUi("The interactive model could not load. The images and downloads below are still available.")}</p> : this.props.children }
}

export function BlenderVillaPanel({ plan, autoGenerate = false, selectedSeed }: { plan: Design; autoGenerate?: boolean; selectedSeed?: number }) {
  useLanguage(s => s.language);
  const villaContainerRef = useRef<HTMLDivElement>(null)

  const brief = useStudio(s => s.result?.design === plan ? s.brief : plan.model.brief)
  // Solar is a sibling scene layer, never an input to the prepared building or its render effect.
  const finishedPlan = useMemo(() => ({ ...plan, model: { ...plan.model, brief: { ...plan.model.brief, finish: brief.finish, specs: brief.specs } } }), [plan, brief.finish, brief.specs])
  const signature = finishSignature(brief)
  const id = useMemo(() => createBuildingModel(finishedPlan).planId, [finishedPlan])
  const accepted = useBlender((s) => s.accepted[id])
  const selectionKey = useBlender((s) => s.selectionKey)
  const job = useBlender((s) => s.job)
  const sourcePlanId = useBlender((s) => s.sourcePlanId)
  const previewKey = selectedSeed === undefined ? '' : directionRenderKey(id, selectedSeed)
  const result = selectedSeed === undefined || selectionKey === `${previewKey}:${signature}` || accepted?.seed === selectedSeed ? accepted : undefined
  const solar = useSolarVillaEditor(plan, result?.seed)
  const preview = useBlender((s) => s.previews[previewKey])
  const error = useBlender((s) => s.error)
  const generate = useBlender((s) => s.generate)
  const resume = useBlender((s) => s.resume)
  const ensureForPlan = useBlender((s) => s.ensureForPlan)
  const quality = result?.quality ?? 'preview'
  const [view, setView] = useState<'hero' | 'front' | 'aerial'>('hero')
  const solarKey = solarArtifactKey(result, solar.solar, quality)
  const solarArtifact = useSolarArtifacts(s => s.renders[solarKey])
  const solarJob = useSolarArtifacts(s => s.jobs[solarKey])
  const renderSolar = useSolarArtifacts(s => s.render), resumeSolar = useSolarArtifacts(s => s.resume)
  const currentSolar = isCurrentSolarArtifact(solarArtifact, result, solar.solar) ? solarArtifact : undefined
  const solarBusy = !!solarJob && !['complete', 'failed'].includes(solarJob.status)
  const [fillingBalcony,setFillingBalcony]=useState(false)
  const fillBalconyArea=useStudio(s=>s.fillBalconyArea)
  const balconyAttempt = useRef('')
  const balconyInFlight = useRef(false)
  const needsFullBalcony = useMemo(() => expandBalconyArea(plan) !== plan, [plan])
  const existingStructure = useStudio(s => s.existing)
  const shapeNotice = useStudio(s => s.generationNotice)
  const jobBusy = Boolean(job && !['complete', 'failed'].includes(job.status))
  const previewBusy = Boolean(preview && ['queued', 'generating', 'rendering'].includes(preview.status))
  const busy = jobBusy || previewBusy || fillingBalcony
  const currentJob = sourcePlanId === id ? job : null
  const displayJob = fillingBalcony ? job : currentJob
  useEffect(() => { void resume() }, [resume])
  useEffect(() => { void resumeSolar() }, [resumeSolar])
  useEffect(() => {
    if (!autoGenerate || balconyInFlight.current) return
    if (!existingStructure && needsFullBalcony && balconyAttempt.current !== id) {
      if (jobBusy || previewBusy) return
      balconyAttempt.current = id
      balconyInFlight.current = true
      setFillingBalcony(true)
      void fillBalconyArea(quality).finally(() => {
        balconyInFlight.current = false
        setFillingBalcony(false)
      })
      return
    }
    void ensureForPlan(finishedPlan, selectedSeed)
  }, [autoGenerate, existingStructure, needsFullBalcony, id, jobBusy, previewBusy, fillBalconyArea, quality, finishedPlan, selectedSeed, ensureForPlan, fillingBalcony])
  return <section className="mt-5 border border-line p-4 md:p-6">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h2 className="font-display text-xl">{translateUi("Blender architectural design")}</h2>
        <p className="mt-1 text-sm text-ink-dim">{translateUi("Your current rooms, footprint and planned outdoor spaces become one editable 3D villa.")}</p></div>
    </div>
    <BuildingFormSummary plan={plan}/>
    {previewBusy && <RenderProgress progress={preview!.progress} label={preview!.phase} />}
    {previewBusy && <p role="status" className="mt-4 text-sm text-ink-dim">{translateUi("Preparing your selected direction: ")}{translateUi(preview!.phase)}{translateUi(". The same villa will appear here when ready.")}</p>}
    {displayJob && jobBusy && !previewBusy && <RenderProgress progress={displayJob.progress} label={displayJob.phase} />}
    {displayJob && jobBusy && <p role="status" className="mt-4 text-sm text-ink-dim">{translateUi(displayJob.phase)}{translateUi(displayJob.attempt ? ` · candidate ${displayJob.attempt}` : '')}{translateUi(". Rendering can take a few minutes.")}</p>}
    {jobBusy && !currentJob && !fillingBalcony && !previewBusy && <p role="status" className="mt-4 text-sm text-ink-dim">{translateUi("Another plan is being generated. This plan will start when it finishes.")}</p>}
      {shapeNotice && <p role="status" className="mt-3 text-sm text-ink-dim">{translateUi(shapeNotice)}</p>}
      {!result && <div className="mt-4 flex aspect-[4/3] items-center justify-center border border-line bg-bg-inset p-8 text-center text-sm text-ink-dim">
      {translateUi(busy ? 'Building and rendering your villa…' : 'The interactive Blender model and three rendered views will appear here.')}
    </div>}
    {sourcePlanId === id && error && <p role="alert" className="mt-4 text-sm text-bad">{translateUi(error)}</p>}
    {sourcePlanId === id && error && !busy && <button type="button" onClick={() => void generate(finishedPlan, result?.seed ?? selectedSeed ?? plan.dna.seed, quality, true)}
      className="mt-3 border border-line px-4 py-2 text-sm">{translateUi('Retry 3D model')}</button>}
    {result && <>
      {result.finishSignature !== signature && <p className="mt-3 text-sm text-ink-dim">{translateUi("Updating selected finishes on this same design…")}</p>}
      <p className="mt-4 font-mono text-xs text-ink-dim">{translateUi("Visualisation · Blender · Seed ")}{translateUi(result.seed)} · {translateUi(result.family.replaceAll('_', ' '))} · {translateUi(result.quality === 'final' ? 'Final render' : 'Preview')}</p>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <div id="villa-interactive-view" ref={villaContainerRef} role="region" aria-label={translateUi('Interactive villa with rooftop solar')} className="relative aspect-[4/3] border border-line">
          <div className="absolute top-2 right-2 z-20 pointer-events-auto">
            <ExportDropdown
              label="Download Villa"
              title="Download Interactive Villa"
              description={VILLA_CAD_HELP}
              size="sm"
              floating
              items={[
                ...villaCadExportItems(currentSolar ?? result),
                {
                  id: 'villa-viewport-png',
                  label: solar.draft ? 'Live view · draft preview' : 'Live view snapshot',
                  ext: '.png',
                  onExport: async () => {
                    const canvas = villaContainerRef.current?.querySelector('canvas')
                    if (canvas) {
                      await captureCanvasPng(canvas, solar.draft ? 'villa-live-draft-preview.png' : 'villa-live-view.png')
                    }
                  },
                },
                {
                  id: 'villa-model-glb',
                  label: currentSolar ? 'Building + solar GLB' : 'Building-only GLB',
                  ext: '.glb',
                  onExport: async () => {
                    const fileUrl = (currentSolar ?? result).files.glb
                    if (fileUrl) {
                      const a = document.createElement('a')
                      a.href = fileUrl
                      a.download = currentSolar ? 'villa-building-plus-solar.glb' : 'villa-building-only.glb'
                      document.body.appendChild(a)
                      a.click()
                      document.body.removeChild(a)
                    }
                  },
                },
                {
                  id: 'villa-scene-blend',
                  label: currentSolar ? 'Building + solar Blender scene' : 'Building-only Blender scene',
                  ext: '.blend',
                  onExport: async () => {
                    const fileUrl = (currentSolar ?? result).files.blend
                    if (fileUrl) {
                      const a = document.createElement('a')
                      a.href = fileUrl
                      a.download = currentSolar ? 'villa-building-plus-solar.blend' : 'villa-building-only.blend'
                      document.body.appendChild(a)
                      a.click()
                      document.body.removeChild(a)
                    }
                  },
                },
              ]}
            />
          </div>
          <ModelBoundary key={result.files.glb}><Canvas frameloop="demand" shadows dpr={VILLA_DPR} gl={VILLA_GL} camera={VILLA_CAMERA}>
            <color attach="background" args={['#e5e5e5']} /><ambientLight intensity={.6} />
            <directionalLight position={[20, 30, -10]} intensity={2} castShadow shadow-mapSize={[2048, 2048]}
              shadow-camera-left={-35} shadow-camera-right={35} shadow-camera-top={35} shadow-camera-bottom={-35} shadow-camera-far={100} shadow-bias={-0.0005} shadow-normalBias={.05} />
            <Suspense fallback={null}><StudioReflections /><Villa url={result.files.glb} />
              <SolarLayer layout={solar.displayLayout} roof={solar.displayRoof} reservedAreas={solar.displayConfiguration.inputs.reservedAreas} selectedIds={solar.selectedIds} onSelect={solar.pickPanel}/>
              <SolarCamera request={solar.camera} roof={solar.displayRoof} layout={solar.displayLayout} selectedIds={solar.selectedIds}/>
            </Suspense>
            <OrbitControls makeDefault minPolarAngle={0} maxPolarAngle={Math.PI / 2} />
          </Canvas></ModelBoundary>
        </div>
        <div><p role="status" className="mb-2 text-xs text-ink-dim">{translateUi(currentSolar ? 'Current applied solar layout · accepted building unchanged.' : 'Building-only image · out of date for the current solar design. Render the applied solar layout to update.')}{solar.draft && ` ${translateUi('Unsaved layout preview is not included in exported images.')}`}</p><img src={(currentSolar ?? result).files[view]} alt={translateUi(currentSolar ? `${view} view with applied solar layout` : `${view} building-only reference; solar not current`)} className="aspect-[4/3] w-full object-contain" />
          <div className="mt-2 flex gap-2">{(['hero', 'front', 'aerial'] as const).map((key) =>
            <button type="button" key={key} onClick={() => setView(key)} className="border border-line px-3 py-1 text-xs uppercase">{translateUi(key)}</button>)}</div>
        </div>
      </div>
      <SolarVillaControls editor={solar}/>
      <div className="mt-4 border border-line p-4">
        <button type="button" disabled={busy || solarBusy || !!solar.draft || !!currentSolar || solar.solar.intention === 'install-now' && !solar.layout}
          onClick={() => void renderSolar(result, solar.solar, quality)} className="border border-line-strong px-4 py-2 text-sm disabled:opacity-50">
          {translateUi(solarBusy ? 'Rendering saved solar layout…' : currentSolar ? 'Solar exports are current' : 'Render applied solar layout')}
        </button>
        <p className="mt-2 text-xs text-ink-dim">{translateUi('Replays the accepted building and seed. Solar changes do not regenerate the architecture.')}</p>
        {solarBusy && <p role="status" className="mt-2 text-sm">{translateUi(solarJob.phase)}</p>}
        {solarJob?.error && <p role="alert" className="mt-2 text-sm text-bad">{translateUi(solarJob.error)}</p>}
        {currentSolar && <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <a className="underline" href={currentSolar.files.glb} download>{translateUi('Building + solar GLB')}</a>
          <a className="underline" href={currentSolar.files.blend} download>{translateUi('Building + solar Blender scene')}</a>
          <a className="underline" href={currentSolar.files.solarLayout} download>{translateUi('Canonical solar layout JSON')}</a>
          {(['hero', 'front', 'aerial'] as const).map(key => <a key={key} className="underline" href={currentSolar.files[key]} download>{translateUi(`${key} image with applied solar`)}</a>)}
        </div>}
      </div>
      <div className="mt-4 flex flex-wrap gap-4 text-sm">{(['blend', 'glb', 'hero', 'front', 'aerial'] as const).map((key) =>
        <a key={key} href={result.files[key]} download className="underline underline-offset-4">{translateUi(key === 'blend' ? 'Building-only Blender scene' : key === 'glb' ? 'Building-only GLB' : `${key} building-only image`)}</a>)}</div>
      <p className="mt-2 text-xs text-ink-dim">{translateUi('Building-only downloads. Rooftop PV and keep-free areas are shown in the live villa viewer.')}</p>
      <p className="mt-3 text-xs text-ink-faint">{translateUi("Car: ")}<a href="https://sketchfab.com/models/57bf6cc56931426e87494f554df1dab6" target="_blank" rel="noreferrer" className="underline">{translateUi("Ferrari 458 Italia by vicent091036")}</a>{translateUi(", adapted under ")}<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer" className="underline">{translateUi("CC BY 4.0")}</a>.</p>
    </>}
    {currentJob?.debug?.length ? <details className="mt-4 text-xs text-ink-dim"><summary>{translateUi("Design variation checks")}</summary>
      <ul className="mt-2 space-y-1">{currentJob.debug.map((entry, index) => <li key={index}>{translateUi("Seed ")}{translateUi(entry.seed)} · {translateUi(entry.family)} {translateUi(" · nearest seed ")}{translateUi(entry.nearestPreviousSeed ?? 'none')} · {translateUi(entry.similarityPercent ?? 0)}{translateUi("% similar · ")}{translateUi(entry.accepted ? 'Accepted' : 'Retried')}: {translateUi(entry.reason)}</li>)}</ul>
    </details> : null}
    <p className="mt-3 text-xs text-ink-faint">{translateUi("Geometry and architectural consistency checks; structural engineering review is still required.")}</p>
    <div className="mt-3 flex flex-wrap gap-4 text-xs">
      <a href="/output/wing-review/index.html" target="_blank" rel="noreferrer" className="underline underline-offset-4">{translateUi("View 100 designs per wing")}</a>
      <a href="/api/villas/gallery/" target="_blank" rel="noreferrer" className="underline underline-offset-4">{translateUi("Clay render gallery")}</a>
    </div>
  </section>
}
