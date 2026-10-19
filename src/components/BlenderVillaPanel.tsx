import { translate as translateUi, useLanguage } from '@/lib/i18n/index.ts'
import { useStudio } from '@/state/studio.ts'
import { finishSignature } from '@/lib/cost/finishAssignments.ts'
import { newDesignSeed } from '@/lib/newDesignSeed.ts'
import { Component, memo, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import type { Design } from '@/lib/engine/types.ts'
import { createBuildingModel } from '@/lib/engine/buildingModel.ts'
import { useBlender, directionRenderKey } from '@/state/blender.ts'
import { RenderProgress } from './RenderProgress.tsx'
import { StudioReflections } from './StudioReflections.tsx'
import { prepareVillaScene } from '@/lib/three/prepareVillaScene.ts'
import { BuildingFormSummary } from './BuildingFormSummary.tsx'
import { MODERN_COMPOSITION_CHOICES, type ModernComposition } from '@/lib/model/modernCompositions.ts'
import { useSolarVillaEditor } from './solar/useSolarVillaEditor.ts'
import { SolarVillaControls } from './solar/SolarVillaControls.tsx'
import { SolarLayer } from '@/lib/three/SolarLayer.tsx'
import { SolarCamera, FitAcceptedVilla } from '@/lib/three/SolarCamera.tsx'

// Stable Canvas options prevent React updates to solar controls from reconfiguring the camera.
const VILLA_CAMERA = { position: [20, 14, -25] as [number, number, number], fov: 40 }
const VILLA_GL = { antialias: true, logarithmicDepthBuffer: true }
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
  const [quality, setQuality] = useState<'preview' | 'final'>('preview')
  const [view, setView] = useState<'hero' | 'front' | 'aerial'>('hero')
  const [findingShape, setFindingShape] = useState(false)
  const [fillingBalcony,setFillingBalcony]=useState(false)
  const fillBalconyArea=useStudio(s=>s.fillBalconyArea)
  const [compositionDraft,setComposition]=useState<{planId:string;value:ModernComposition|'auto'}|null>(null)
  const composition=compositionDraft?.planId===id?compositionDraft.value:brief.style.composition??'auto'
  const newBuildingShape = useStudio(s => s.newBuildingShape)
  const existingStructure = useStudio(s => s.existing)
  const shapeNotice = useStudio(s => s.generationNotice)
  const jobBusy = Boolean(job && !['complete', 'failed'].includes(job.status))
  const previewBusy = Boolean(preview && ['queued', 'generating', 'rendering'].includes(preview.status))
  const busy = jobBusy || previewBusy || findingShape || fillingBalcony
  const currentJob = sourcePlanId === id ? job : null
  const displayJob = findingShape || fillingBalcony ? job : currentJob
  useEffect(() => { void resume() }, [resume])
  useEffect(() => { if (autoGenerate) void ensureForPlan(finishedPlan, selectedSeed) }, [autoGenerate, finishedPlan, selectedSeed, ensureForPlan, busy])
  return <section className="mt-5 border border-line p-4 md:p-6">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h2 className="font-display text-xl">{translateUi("Blender architectural design")}</h2>
        <p className="mt-1 text-sm text-ink-dim">{translateUi("Your current rooms, footprint and planned outdoor spaces become one editable 3D villa.")}</p></div>
      <div className="flex flex-wrap items-center gap-2">
        {!existingStructure && <button type="button" disabled={busy} onClick={async () => {
          setFindingShape(true)
          try { await newBuildingShape(quality) } finally { setFindingShape(false) }
        }} className="bg-accent px-4 py-2 text-sm uppercase tracking-wide text-white disabled:opacity-50">
          {translateUi(findingShape ? 'Planning a new shape…' : 'New building shape')}
        </button>}
        <select aria-label={translateUi("Render quality")} className="border border-line bg-bg px-3 py-2 text-sm" value={quality}
          disabled={busy} onChange={(e) => setQuality(e.target.value as 'preview' | 'final')}>
          <option value="preview">{translateUi("Fast preview")}</option><option value="final">{translateUi("High quality")}</option>
        </select>
        {result && <button type="button" disabled={busy} onClick={() => void generate(finishedPlan, result.seed, quality, true)}
          className="border border-line px-4 py-2 text-sm uppercase tracking-wide disabled:opacity-50">
          {translateUi("Refresh current design")}</button>}
        <button type="button" disabled={busy} onClick={() => void generate(finishedPlan, newDesignSeed(result?.seed ?? plan.dna.seed, brief.style.character), quality)}
          className="border border-line-strong px-4 py-2 text-sm uppercase tracking-wide disabled:opacity-50">
          {translateUi(busy ? 'Generating…' : result ? 'New exterior on this plan' : 'Generate architectural design')}
        </button>
      </div>
    </div>
    {!existingStructure&&brief.style.character==='modern-box'&&<div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
      <label className="text-sm">{translateUi('Villa composition')}
        <select aria-label={translateUi('Villa composition')} value={composition} disabled={busy}
          onChange={e=>setComposition({planId:id,value:e.target.value as ModernComposition|'auto'})} className="ml-3 border border-line bg-bg px-3 py-2">
          <option value="auto">{translateUi('Automatic')}</option>
          {MODERN_COMPOSITION_CHOICES.map(c=><option key={c.value} value={c.value}>{translateUi(c.title)}</option>)}
        </select>
      </label>
      <button type="button" disabled={busy} onClick={async()=>{
        setFindingShape(true)
        try{await newBuildingShape(quality,composition)}finally{setFindingShape(false)}
      }} className="border border-line-strong px-4 py-2 text-sm disabled:opacity-50">{translateUi('Apply composition')}</button>
      <p className="w-full text-xs text-ink-dim">{translateUi('Replans the rooms and building shape together. Your current villa stays visible until the new 3D design is ready.')}</p>
    </div>}
    <BuildingFormSummary plan={plan}/>
    {!existingStructure&&!plan.balconyExtent&&plan.floors.some(f=>f.rooms.some(r=>r.outdoor&&r.id.startsWith('balcony')))&&<div className="mt-4 border-t border-line pt-4">
      <button type="button" disabled={busy} onClick={async()=>{
        setFillingBalcony(true)
        try{await fillBalconyArea(quality)}finally{setFillingBalcony(false)}
      }} className="border border-line-strong px-4 py-2 text-sm disabled:opacity-50">{translateUi(fillingBalcony?'Extending balcony…':'Use full balcony area')}</button>
      <p className="mt-2 text-xs text-ink-dim">{translateUi('Extends the balcony and its glass boundary to the available supported slab. The 2D plan and quantities update together.')}</p>
    </div>}
    {previewBusy && <RenderProgress progress={preview!.progress} label={preview!.phase} />}
    {previewBusy && <p role="status" className="mt-4 text-sm text-ink-dim">{translateUi("Preparing your selected direction: ")}{translateUi(preview!.phase)}{translateUi(". The same villa will appear here when ready.")}</p>}
    {displayJob && jobBusy && !previewBusy && <RenderProgress progress={displayJob.progress} label={displayJob.phase} />}
    {displayJob && jobBusy && <p role="status" className="mt-4 text-sm text-ink-dim">{translateUi(displayJob.phase)}{translateUi(displayJob.attempt ? ` · candidate ${displayJob.attempt}` : '')}{translateUi(". Rendering can take a few minutes.")}</p>}
    {jobBusy && !currentJob && !findingShape && !fillingBalcony && !previewBusy && <p role="status" className="mt-4 text-sm text-ink-dim">{translateUi("Another plan is being generated. This plan will start when it finishes.")}</p>}
      {!existingStructure && <p className="mt-3 text-sm text-ink-dim">{translateUi("New building shape creates a different footprint, wing arrangement or upper-floor profile with the same room requirements. The 2D plan updates together with the 3D villa.")}</p>}
      {findingShape && <p role="status" className="mt-3 text-sm text-ink-dim">{translateUi("Comparing occupied building shapes and checking rooms, circulation and structure…")}</p>}
      {shapeNotice && <p role="status" className="mt-3 text-sm text-ink-dim">{translateUi(shapeNotice)}</p>}
      {brief.style.character === 'modern-box' && <p className="mt-3 text-sm text-ink-dim">{translateUi("1,000 modern exterior seeds are also available for the current floor plan.")}</p>}
      {!result && <div className="mt-4 flex aspect-[4/3] items-center justify-center border border-line bg-bg-inset p-8 text-center text-sm text-ink-dim">
      {translateUi(busy ? 'Building and rendering your villa…' : 'The interactive Blender model and three rendered views will appear here.')}
    </div>}
    {sourcePlanId === id && error && <p role="alert" className="mt-4 text-sm text-bad">{translateUi(error)}</p>}
    {result && <>
      {result.finishSignature !== signature && <p className="mt-3 text-sm text-ink-dim">{translateUi("Updating selected finishes on this same design…")}</p>}
      <p className="mt-4 font-mono text-xs text-ink-dim">{translateUi("Visualisation · Blender · Seed ")}{translateUi(result.seed)} · {translateUi(result.family.replaceAll('_', ' '))} · {translateUi(result.quality === 'final' ? 'Final render' : 'Preview')}</p>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <div id="villa-interactive-view" role="region" aria-label={translateUi('Interactive villa with rooftop solar')} className="aspect-[4/3] overflow-hidden border border-line">
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
        <div><p className="mb-2 text-xs text-ink-dim">{translateUi('Building only · live rooftop PV and keep-free areas are not included in this image.')}</p><img src={result.files[view]} alt={translateUi(`${view} view of architectural design ${result.seed}`)} className="aspect-[4/3] w-full object-contain" />
          <div className="mt-2 flex gap-2">{(['hero', 'front', 'aerial'] as const).map((key) =>
            <button type="button" key={key} onClick={() => setView(key)} className="border border-line px-3 py-1 text-xs uppercase">{translateUi(key)}</button>)}</div>
        </div>
      </div>
      <SolarVillaControls editor={solar}/>
      <div className="mt-4 flex flex-wrap gap-4 text-sm">{(['blend', 'glb', 'hero', 'front', 'aerial'] as const).map((key) =>
        <a key={key} href={result.files[key]} download className="underline underline-offset-4">{translateUi(key === 'blend' ? 'Editable Blender scene' : key === 'glb' ? 'Interactive 3D model' : `${key} image`)}</a>)}</div>
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
