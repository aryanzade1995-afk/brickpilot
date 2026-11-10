import {COASTAL_ROOF_REVISION} from '@/lib/engine/massing/coastalRoof.ts'
import { EntryRampLayer } from './EntryRampLayer.tsx'
import {ServiceClosureLayer} from './ServiceClosureLayer.tsx'
import {PlinthEnclosureLayer} from './PlinthEnclosureLayer.tsx'
import {ParkedCarsLayer} from './ParkedCarsLayer.tsx'
import {VEHICLES,parkedVehicleChoice} from '@/lib/three/vehicleGeometry.ts'
import { BalconyShadeLayer } from './BalconyShadeLayer.tsx'
import { SHADE_CHOICES, SHADE_CONTROL, shadeChoice } from '@/lib/three/shadeVariants.ts'
import {useReference} from '@/state/reference.ts'
import {reconstructFacade} from '@/lib/reference/reconstruct.ts'
import {ReferenceLayer} from './reference/ReferenceLayer.tsx'
import {Link} from 'react-router-dom'
import { WALKTHROUGH_ACCESS_REVISION } from '@/lib/walkthrough/access.ts'
import { plumbingExportScene } from '@/lib/plumbing/pipeGeometry.ts'
import { selectedPipeSizes } from '@/lib/plumbing/villaPlumbing.ts'
import { ProjectPipelineLayer } from './water/ProjectPipelineLayer.tsx'
import { useProjectPipelines } from './water/useProjectPipelines.ts'
import { ResizableRoofTanks } from './water/ResizableRoofTanks.tsx'
import type { Group } from 'three'
import { exportThreeSceneToGlb } from '@/lib/export/index.ts'
import { translate as translateUi, useLanguage } from '@/lib/i18n/index.ts'
import { useStudio } from '@/state/studio.ts'
import { finishSignature } from '@/lib/cost/finishAssignments.ts'
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {useProgress} from '@react-three/drei'
import type { Design } from '@/lib/engine/types.ts'
import { createBuildingModel } from '@/lib/engine/buildingModel.ts'
import {generateFacadeVariation} from '@/lib/engine/facade/variations.ts'
import {automaticFacadeDesign} from '@/lib/model/facadeDesign.ts'
import {buildFacadeZones} from '@/lib/engine/facade/FacadeGrammar.ts'
import type {MassingModel} from '@/lib/engine/massing/model.ts'
import {FacadeDesignControls} from './FacadeDesignControls.tsx'
import {FacadeDesignLayer} from './FacadeDesignLayer.tsx'
import { useBlender, directionRenderKey } from '@/state/blender.ts'
import { RenderProgress } from './RenderProgress.tsx'
import { VillaSceneCanvas, AcceptedVillaModel } from './VillaSceneCanvas.tsx'
import { useSolarVillaEditor } from './solar/useSolarVillaEditor.ts'
import { SolarVillaControls } from './solar/SolarVillaControls.tsx'
import { SolarLayer } from '@/lib/three/SolarLayer.tsx'
import { SolarCamera } from '@/lib/three/SolarCamera.tsx'
import { useSolarArtifacts, solarArtifactKey, isCurrentSolarArtifact } from '@/state/solarArtifacts.ts'
import { ExportDropdown } from '@/components/export/ExportDropdown.tsx'
import { villaCadExportItems, VILLA_CAD_HELP } from '@/components/export/villaCadExports.ts'
import { captureCanvasPng } from '@/lib/export/index.ts'
import {RAYTRACE_SAMPLES,type RaytraceQuality,type RaytraceStatus} from '@/lib/three/raytraceScene.ts'
import {gpuLabel} from '@/lib/walkthrough/quality.ts'
const RealisticSiteEnvironment=lazy(()=>import('./RealisticSiteEnvironment.tsx'))
function SiteLoading(){const {active,progress}=useProgress();return <div role="status" className="absolute inset-0 z-10 flex items-center justify-center bg-bg/85"><div className="w-64 border border-line bg-bg p-5 shadow-lg"><p className="font-display text-xl">Preparing the surroundings</p><progress aria-label="Loading realistic house view" max={100} value={active?Math.max(10,progress):10} className="mt-4 h-2 w-full accent-emerald-800"/><p className="mt-2 text-xs text-ink-dim">Loading the villa, trees and road traffic…</p></div></div>}

export function BlenderVillaPanel({ plan, autoGenerate = false, selectedSeed }: { plan: Design; autoGenerate?: boolean; selectedSeed?: number }) {
  useLanguage(s => s.language);
  const villaContainerRef = useRef<HTMLDivElement>(null)
  const [contextMode,setContextMode]=useState(false),[siteReady,setSiteReady]=useState(false),[golden,setGolden]=useState(false)
  const [traffic,setTraffic]=useState(()=>!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [raytraced,setRaytraced]=useState(false),[rayQuality,setRayQuality]=useState<RaytraceQuality>('balanced'),[rayStatus,setRayStatus]=useState<RaytraceStatus|null>(null)
  const assetsLoading=useProgress(s=>s.active)
  const siteLoaded=useCallback(()=>setSiteReady(true),[])

  const brief = useStudio(s => s.result?.design === plan ? s.brief : plan.model.brief)
  const edit=useStudio(s=>s.edit),shade=shadeChoice(brief.specs?.overrides[SHADE_CONTROL])
  const setFacadeDesign=useStudio(s=>s.setFacadeDesign)
  const facadeSettings=useMemo(()=>automaticFacadeDesign(selectedSeed??plan.dna.seed,brief.facadeDesign),[selectedSeed,plan.dna.seed,brief.facadeDesign])
  useEffect(()=>{if(brief.facadeDesign?.facadeStyle!=='MIXED'&&useStudio.getState().result?.design===plan)setFacadeDesign(facadeSettings)},[brief.facadeDesign,plan,facadeSettings,setFacadeDesign])
  const parkedCar=parkedVehicleChoice(brief.specs?.overrides['visual-model-parked-car'])
  // Solar is a sibling scene layer, never an input to the prepared building or its render effect.
  const finishedPlan = useMemo(() => ({ ...plan, model: { ...plan.model, brief: { ...plan.model.brief, finish: brief.finish, specs: brief.specs,facadeDesign:facadeSettings } } }), [plan, brief.finish, brief.specs,facadeSettings])
  const building = useMemo(() => createBuildingModel(finishedPlan), [finishedPlan])
  const coveredFacade=useStudio(s=>s.result?.design===plan?s.result.facadeModel?.coveredOutdoor:undefined)
  const facadeDesign=useMemo(()=>generateFacadeVariation(building,buildFacadeZones(building,{masses:[]} as unknown as MassingModel),facadeSettings,brief,coveredFacade),[building,facadeSettings,brief,coveredFacade])
  const referenceDocument = useReference(s=>s.document)
  const referenceFacade = useMemo(()=>{const d=referenceDocument;if(!d?.enabled||d.sourcePlanId!==building.planId||!d.accepted||(d.accepted.settings.mode!=='preserve-plan'&&d.accepted.settings.operation!=='style-transfer'))return null;try{const geometry=reconstructFacade(building,d.accepted.spec,d.accepted.settings);return geometry.status==='rejected'?null:{geometry,operation:d.accepted.settings.operation}}catch{return null}},[referenceDocument,building])
  const pipelines = useProjectPipelines(finishedPlan, building, brief)
  const liveExport = useRef<Group>(null)
  const [waterPipes, setWaterPipes] = useState(false), [drainPipes, setDrainPipes] = useState(false), [pipeXray, setPipeXray] = useState(false)
  const [rainVisibility, setRainVisibility] = useState<{planId: string; visible: boolean} | null>(null)
  const rainPipes = rainVisibility?.planId === building.planId ? rainVisibility.visible : (pipelines?.options.rainwater ?? false)
  const setRainPipes = (visible: boolean) => setRainVisibility({planId: building.planId, visible})
  const signature = finishSignature(brief)
  const id = building.planId
  const acceptedRender = useBlender((s) => s.accepted[id])
  const baseRender=useBlender(s=>s.baseModels[id])
  const matchingBase=baseRender?.seed===(selectedSeed??acceptedRender?.seed)&&baseRender?.finishSignature===signature?baseRender:undefined
  const accepted=!brief.facadeDesign&&matchingBase?matchingBase:acceptedRender
  const job = useBlender((s) => s.job)
  const sourcePlanId = useBlender((s) => s.sourcePlanId)
  const previewKey = selectedSeed === undefined ? '' : directionRenderKey(id, selectedSeed)
  const result = accepted?.planId === id && (selectedSeed === undefined || accepted.seed === selectedSeed) ? accepted : undefined
  const solar = useSolarVillaEditor(plan, result?.seed)
  const preview = useBlender((s) => s.previews[previewKey])
  const error = useBlender((s) => s.error)
  const generate = useBlender((s) => s.generate)
  const resume = useBlender((s) => s.resume)
  const ensureForPlan = useBlender((s) => s.ensureForPlan)
  const quality = result?.quality ?? 'preview'
  const solarKey = solarArtifactKey(result, solar.solar, quality)
  const solarArtifact = useSolarArtifacts(s => s.renders[solarKey])
  const solarJob = useSolarArtifacts(s => s.jobs[solarKey])
  const renderSolar = useSolarArtifacts(s => s.render), resumeSolar = useSolarArtifacts(s => s.resume)
  const currentSolar = isCurrentSolarArtifact(solarArtifact, result, solar.solar) ? solarArtifact : undefined
  const solarBusy = !!solarJob && !['complete', 'failed'].includes(solarJob.status)
  const shapeNotice = useStudio(s => s.generationNotice)
  const jobBusy = Boolean(job && !['complete', 'failed'].includes(job.status))
  const previewBusy = Boolean(preview && ['queued', 'generating', 'rendering'].includes(preview.status))
  const busy = jobBusy || previewBusy
  const currentJob = sourcePlanId === id ? job : null
  const displayJob = currentJob
  useEffect(() => { void resume() }, [resume])
  useEffect(() => { void resumeSolar() }, [resumeSolar])
  useEffect(() => {
    if (!autoGenerate) return
    // Opening a viewer exports the selected plan; it must not alter balconies
    // or replace the geometry pinned in Directions / the 2D plan.
    void ensureForPlan(finishedPlan, selectedSeed)
  }, [autoGenerate, jobBusy, job?.id, job?.status, previewBusy, finishedPlan, selectedSeed, ensureForPlan])
  return <section className="mt-5 border border-line p-4 md:p-6">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h2 className="font-display text-xl">{translateUi("Blender architectural design")}</h2></div>
    </div>
    <FacadeDesignControls value={facadeSettings} model={facadeDesign} onChange={setFacadeDesign} onRender={()=>void generate(finishedPlan,result?.seed??selectedSeed??plan.dna.seed,quality,true)} busy={busy} rendered={result?.facadeSignature===facadeDesign.signature}/>
    {previewBusy && <RenderProgress progress={preview!.progress} label={preview!.phase} />}
    {previewBusy && !preview!.phase.includes('Set BLENDER_BIN') && <p role="status" className="mt-4 text-sm text-ink-dim">{translateUi("Preparing your selected direction: ")}{translateUi(preview!.phase)}{translateUi(". The same villa will appear here when ready.")}</p>}
    {displayJob && jobBusy && !previewBusy && <RenderProgress progress={displayJob.progress} label={displayJob.phase} />}
    {displayJob && jobBusy && !displayJob.phase.includes('Set BLENDER_BIN') && <p role="status" className="mt-4 text-sm text-ink-dim">{translateUi(displayJob.phase)}{translateUi(displayJob.attempt ? ` · candidate ${displayJob.attempt}` : '')}{translateUi(". Rendering can take a few minutes.")}</p>}
    {jobBusy && !currentJob && !previewBusy && <p role="status" className="mt-4 text-sm text-ink-dim">{translateUi("Another plan is being generated. This plan will start when it finishes.")}</p>}
    {shapeNotice && !shapeNotice.includes('Valid directions are shown') && <p role="status" className="mt-3 text-sm text-ink-dim">{translateUi(shapeNotice)}</p>}
    {!result && <div className="mt-4 flex aspect-[4/3] items-center justify-center border border-line bg-bg-inset p-8 text-center text-sm text-ink-dim">
      <div role="status" className="space-y-3">
        {(busy || autoGenerate && !error) && <div aria-hidden="true" className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-line border-t-ink motion-reduce:animate-none" />}
        <p>{translateUi(error && sourcePlanId === id ? 'Your 3D model could not be loaded. Retry below.' : 'Preparing your selected 3D model…')}</p>
      </div>
    </div>}
    {sourcePlanId === id && error && <p role="alert" className="mt-4 text-sm text-bad">{translateUi(error)}</p>}
    {!busy && (!result || sourcePlanId === id && error) && <button type="button" onClick={() => void generate(finishedPlan, result?.seed ?? selectedSeed ?? plan.dna.seed, quality, true)}
      className="mt-3 border border-line px-4 py-2 text-sm">{translateUi('Retry 3D model')}</button>}
    {result && <>
      {(result.geometryRevision !== WALKTHROUGH_ACCESS_REVISION || brief.style.character==='coastal-bungalow'&&result.roofRevision!==COASTAL_ROOF_REVISION) && <div className="mt-4 flex flex-wrap items-center gap-3 border border-line bg-bg-inset p-3"><p className="flex-1 text-xs text-ink-dim">{translateUi(brief.style.character==='coastal-bungalow'?'Update this villa with a continuous coastal roof.':'Update terrace walls and floor edges on this same villa.')}</p><button type="button" disabled={busy} onClick={() => void generate(finishedPlan, result.seed, quality, true)} className="min-h-11 border border-line bg-accent px-4 text-xs text-bg disabled:opacity-50">{translateUi(busy ? 'Updating Blender villa…' : 'Update 3D model')}</button></div>}
      {result.finishSignature !== signature && <p className="mt-3 text-sm text-ink-dim">{translateUi("Updating selected finishes on this same design…")}</p>}
      <p className="mt-4 font-mono text-xs text-ink-dim">{translateUi("Visualisation · Blender · Seed ")}{translateUi(result.seed)} · {translateUi(result.family.replaceAll('_', ' '))} · {translateUi(result.quality === 'final' ? 'Final render' : 'Preview')}</p>
      <div className="mt-3 min-w-0">
        <div id="villa-interactive-view" ref={villaContainerRef} role="region" aria-label={translateUi('Interactive villa with rooftop solar')} className="house-viewer relative h-[clamp(420px,75vh,900px)] w-full min-w-0 border border-line [&:fullscreen]:h-screen">
          <div className="absolute left-2 top-2 z-20 flex flex-wrap gap-1"><button type="button" aria-pressed={contextMode} onClick={()=>{setSiteReady(false);setRaytraced(false);setRayStatus(null);setContextMode(v=>!v)}} className="min-h-11 border border-line bg-bg/95 px-3 text-xs shadow-sm">{contextMode?'Studio view':'Realistic house view'}</button>
          {contextMode&&<div role="group" aria-label="Realistic rendering mode" className="flex border border-line bg-bg/95 p-1 shadow-sm">{([false,true] as const).map(value=><button key={String(value)} type="button" aria-pressed={raytraced===value} disabled={value&&(!siteReady||assetsLoading)} onClick={()=>{if(raytraced===value)return;setRaytraced(value);setRayStatus(null)}} className={`min-h-9 px-3 text-xs disabled:opacity-40 ${raytraced===value?'bg-ink text-bg':'text-ink-dim'}`}>{value?'Ray-traced':'Interactive'}</button>)}</div>}</div>
          {contextMode&&!siteReady&&<SiteLoading/>}
          {contextMode&&raytraced&&<details open={rayStatus?.phase!=='complete'} className="absolute left-2 top-16 z-20 w-[min(19rem,calc(100%-1rem))] border border-line bg-bg/95 p-3 shadow-sm" aria-label="Ray tracing progress">
            <summary className="cursor-pointer text-xs">{rayStatus?.phase==='complete'?`Ray-traced · ${rayStatus.samples} samples · Refined`:'Path-traced light'}</summary>
            <div className="mt-3 flex items-center justify-between gap-3"><span className="text-xs text-ink-dim">Quality</span><select aria-label="Ray tracing quality" value={rayQuality} onChange={e=>{setRayStatus(null);setRayQuality(e.target.value as RaytraceQuality)}} className="min-h-8 border border-line bg-bg px-2 text-xs"><option value="balanced">Balanced · 64</option><option value="fine">Fine · 128</option></select></div>
            <p role={rayStatus?.phase==='error'?'alert':'status'} className="mt-2 text-xs">{rayStatus?.phase==='error'?rayStatus.message:rayStatus?.phase==='complete'?'View refined':rayStatus?.phase==='rendering'?`Refining light · ${rayStatus.samples} / ${rayStatus.target} samples`:'Preparing ray tracing…'}</p>
            {rayStatus?.phase!=='error'&&<progress aria-label="Ray tracing samples" max={rayStatus?.phase==='preparing'?1:RAYTRACE_SAMPLES[rayQuality]} value={rayStatus?.phase==='preparing'?rayStatus.progress:rayStatus?.samples??0} className="mt-2 h-1 w-full accent-[#657e72]"/>}
            <p className="mt-2 text-[10px] leading-relaxed text-ink-dim">{rayStatus?.gpu?`${gpuLabel(rayStatus.gpu)} · `:''}Drag to frame; hold still to refine. Traffic pauses for a clean render.</p>
          </details>}
          {contextMode&&<div className="absolute bottom-2 left-2 right-2 z-20 flex flex-wrap items-center gap-2 border border-line bg-bg/95 p-2 text-xs"><button type="button" disabled={raytraced} aria-pressed={traffic&&!raytraced} onClick={()=>setTraffic(v=>!v)} className="min-h-11 border border-line px-3 disabled:opacity-50">{raytraced?'Traffic paused':traffic?'Pause traffic':'Play traffic'}</button><button type="button" aria-pressed={golden} onClick={()=>setGolden(v=>!v)} className="min-h-11 border border-line px-3">{golden?'Golden hour':'Daylight'}</button><button type="button" onClick={()=>{if(document.fullscreenElement)void document.exitFullscreen();else void villaContainerRef.current?.requestFullscreen().catch(()=>{})}} className="min-h-11 border border-line px-3">Expand view</button><span className="text-ink-dim">Illustrative surroundings · not a site survey</span><a className="underline" href="/exterior-assets/site-context/ATTRIBUTION.md" target="_blank" rel="noreferrer">Model credits</a></div>}
          <div className="absolute top-2 right-2 z-20 pointer-events-auto">
            <ExportDropdown
              label="Download Villa"
              title="Download Interactive Villa"
              description={VILLA_CAD_HELP}
              size="sm"
              floating
              items={[
                ...villaCadExportItems(currentSolar ?? result),
                { id: 'villa-live-pipelines', label: 'Live villa + visible pipelines GLB', ext: '.glb', onExport: async () => { if(liveExport.current) { const exported=plumbingExportScene(liveExport.current); try { await exportThreeSceneToGlb(exported.root, 'villa-live-pipelines.glb') } finally { exported.dispose() } } } },
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
          {referenceFacade&&<p className="absolute bottom-2 left-2 right-2 z-10 bg-bg/90 px-3 py-2 text-xs text-ink-dim">Accepted reference facade overlay · source building retained. <Link className="underline" to="/workspace/plan#reference-facade">Edit / return to original</Link></p>}
          <VillaSceneCanvas key={`${result.files.glb}:${contextMode}`} realistic={contextMode} golden={contextMode&&golden} raytrace={contextMode&&raytraced?{quality:rayQuality,onStatus:setRayStatus,revision:JSON.stringify([result.files.glb,signature,facadeDesign.signature,shade,parkedCar,waterPipes,drainPipes,rainPipes,pipeXray,pipelines?.options,solar.displayConfiguration,solar.draft])}:undefined}>
            <Suspense fallback={null}><group ref={liveExport}><AcceptedVillaModel exteriorPalette={facadeSettings.exteriorPalette} url={result.files.glb} facadeDesign={!!facadeDesign} replaceParkedCars gardenShade={brief.rooms.priorities.garden && brief.rooms.priorities.gardenShade} separateRoofTanks={!!pipelines} style={referenceFacade?.operation==='style-transfer'?referenceFacade.geometry.style:undefined}/><PlinthEnclosureLayer building={building} url={result.files.glb}/>{facadeDesign&&<FacadeDesignLayer model={facadeDesign} url={result.files.glb}/>}<ParkedCarsLayer url={result.files.glb} choice={parkedCar} building={building}/>{referenceFacade&&<ReferenceLayer geometry={referenceFacade.geometry}/>}
              <ServiceClosureLayer building={building} design={finishedPlan} url={result.files.glb}/>
              {building.entryRamp&&<EntryRampLayer ramp={building.entryRamp}/>}
              {shade!=='original'&&<BalconyShadeLayer url={result.files.glb} choice={shade}/>}
              <SolarLayer layout={solar.displayLayout} roof={solar.displayRoof} reservedAreas={solar.displayConfiguration.inputs.reservedAreas} selectedIds={solar.selectedIds} onSelect={solar.pickPanel}/>
              {pipelines&&<><ResizableRoofTanks url={result.files.glb} ports={pipelines.originalPorts} diameterScale={pipelines.options.roofDiameterScale??1} heightScale={pipelines.options.roofHeightScale??1} xray={false} onSelect={()=>{}}/><ProjectPipelineLayer network={pipelines} water={waterPipes} drain={drainPipes} rainwater={rainPipes} xray={pipeXray}/></>}
            </group><SolarCamera request={solar.camera} roof={solar.displayRoof} layout={solar.displayLayout} selectedIds={solar.selectedIds}/></Suspense>
            {contextMode&&<Suspense fallback={null}><RealisticSiteEnvironment key={result.files.glb} building={building} traffic={traffic&&!raytraced} golden={golden} onReady={siteLoaded}/></Suspense>}
          </VillaSceneCanvas>
        </div>

      </div>
      <label className="mt-4 flex flex-wrap items-center gap-3 text-xs">Parked car<select aria-label="Parked car" className="min-h-11 border border-line bg-bg px-3" value={parkedCar} onChange={e=>edit(b=>{b.specs??={overrides:{}};b.specs.overrides['visual-model-parked-car']=e.target.value})}>{Object.entries(VEHICLES).filter(([id])=>id!=='compact-hatch').map(([id,car])=><option key={id} value={id}>{car.label}</option>)}</select><a className="underline text-ink-dim" href="/exterior-assets/free-cars/SOURCE.md" target="_blank" rel="noreferrer">Car model credits</a></label>
      <section className="mt-4 border border-line bg-bg-raised p-4" aria-label={translateUi('Water & drainage pipelines')}>
        <label className="mb-4 flex flex-wrap items-center gap-3 text-xs">Balcony shade<select aria-label="Balcony shade" className="min-h-11 border border-line bg-bg px-3" value={shade} onChange={e=>edit(b=>{b.specs??={overrides:{}};b.specs.overrides[SHADE_CONTROL]=shadeChoice(e.target.value)})}>{SHADE_CHOICES.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select><span className="text-ink-dim">Existing framed balconies · live 3D / combined GLB only · saved images unchanged</span><a className="underline" href="https://kenney.nl/assets/city-kit-commercial" target="_blank" rel="noreferrer">Kenney · CC0</a></label>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2"><h3 className="mr-auto font-display text-lg">{translateUi('Water & drainage pipelines')}</h3>{([[waterPipes,setWaterPipes,'Tank water supply'],[drainPipes,setDrainPipes,'Drainage & vents'],[rainPipes,setRainPipes,'Collect rainwater'],[pipeXray,setPipeXray,'See pipes through walls']] as const).map(([value,setter,label])=><label key={label} className="flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" className="accent-accent" checked={value} onChange={e=>setter(e.target.checked)}/>{translateUi(label)}</label>)}</div>
        <p className="mt-2 text-xs text-ink-dim">{translateUi('Ivory: water pipes. Charcoal: drainage stacks. Warm grey: vents. Existing shaft openings are preserved.')}</p>
        <p role="status" className="mt-2 text-xs text-ink-dim">{translateUi(`Tank-fed fixtures: ${pipelines?.supply.fixtures.filter(f=>f.connected).length??0}/${pipelines?.supply.fixtures.length??0} · connected drains: ${pipelines?.fixtureScene.fixtures.filter(f=>f.branch?.connected).length??0}/${pipelines?.fixtureScene.fixtures.length??0}`)}</p>
        <details className="mt-2 text-xs text-ink-dim"><summary className="min-h-11 cursor-pointer py-3">{translateUi('Pipeline details & connections to review')}</summary><p>{translateUi('Selected pipe sizes')}: {selectedPipeSizes(brief).waterMm} mm · {translateUi('Tank water supply')}; {selectedPipeSizes(brief).soilMm} / {selectedPipeSizes(brief).wasteMm} mm · {translateUi('Drainage & vents')}</p><p className="mt-2">{translateUi('Pipe sizes are concept envelopes. Structural openings, fixture branches, vent sizing, gradients and final discharge need professional review. The house and estimate stay unchanged.')}</p><ul className="mt-3 space-y-2">{[...new Set([...(pipelines?.issues??[]),...(pipelines?.supply.issues??[]),...(pipelines?.fixtureScene.issues??[]),...(pipelines?.continuity.issues??[]),...(pipelines?.drainNetwork.issues??[])])].map((issue,i)=><li key={i}>{translateUi(issue)}</li>)}</ul><p className="mt-3">{translateUi('Use Live villa + visible pipelines GLB to download the pipework shown here. Saved images and original downloads keep their previously generated contents.')}</p></details>
      </section>
      <p className="mt-2 text-xs text-ink-faint"><a href="https://polyhaven.com/a/modular_pipes" target="_blank" rel="noreferrer" className="underline">{translateUi('Pipe fittings · Poly Haven · CC0')}</a></p>
      {building.entryRamp&&<section className="mt-4 rounded-lg border border-line p-4" aria-label="Entry ramp"><h3 className="font-display text-lg">{translateUi('Wheelchair entry ramp')}</h3><p className="mt-2 text-xs text-ink-dim">{building.entryRamp.status==='ready'?`${building.entryRamp.riseMm} mm rise · 1:${building.entryRamp.gradientRatio} · ${building.entryRamp.clearWidthMm} mm clear width`:'Ramp needs a revised site layout.'}</p>{building.entryRamp.issues.map((issue,i)=><p key={i} className="mt-2 text-xs text-ink-dim">{translateUi(issue)}</p>)}</section>}
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
