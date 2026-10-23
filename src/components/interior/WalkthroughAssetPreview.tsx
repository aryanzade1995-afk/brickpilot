import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Bounds, OrbitControls } from '@react-three/drei'
import { ACESFilmicToneMapping, PCFShadowMap, Plane, Vector3, type Group } from 'three'
import { loadWalkthroughAsset, disposeWalkthroughAsset, applyWalkthroughMaterialBindings } from '@/lib/three/loadWalkthroughAsset.ts'
import { adoptBlenderWalkthroughAppearance, prepareWalkthroughAppearanceUpdate, walkthroughFurnishingGeometryKey } from '@/lib/three/walkthroughAppearance.ts'
import { furnitureColliders, type WalkthroughAppearancePayload, type WalkthroughGeometryPayload } from '@/lib/walkthrough/delivery.ts'
import { acceptedVillaBounds, acceptedVillaCollision, loadAcceptedVilla } from '@/lib/three/acceptedVillaWalkthrough.ts'
import { separateCoplanar } from '@/lib/three/separateCoplanar.ts'
import { bindAcceptedVillaFinishes, disposeAcceptedVillaFinishSources } from '@/lib/three/acceptedVillaFinishes.ts'
import { batchWalkthroughScene, prepareWalkthroughGlazing } from '@/lib/three/walkthroughBatches.ts'
import { applyWalkthroughContactDetail } from '@/lib/three/walkthroughSurfaceDetail.ts'
import { FitAcceptedVilla } from '@/lib/three/SolarCamera.tsx'
import { translate as t } from '@/lib/i18n/index.ts'
import { HouseWalkingSimulation, initializeWalkingPhysics, type NavigationMetadata, type NavigationCollision } from '@/lib/walkthrough/navigation.ts'
import { FirstPersonController, type WalkingControls, type WalkingHud } from './FirstPersonController.tsx'
import { DEFAULT_LOOK_SPEED, LOOK_SPEED } from '@/lib/walkthrough/look.ts'
import { WalkthroughLighting } from './WalkthroughLighting.tsx'
import { WalkthroughPerformance, WalkthroughRoomLights, type WalkthroughMetrics } from './WalkthroughPerformance.tsx'
import { gpuLabel, WALKTHROUGH_QUALITY, type WalkthroughQuality } from '@/lib/walkthrough/quality.ts'

/** Shared orbit / first-person viewer of the same immutable delivered house. */
export type AcceptedVillaPreview = { url: string; geometry: WalkthroughGeometryPayload | null }
export default function WalkthroughAssetPreview({ id, planId, floors, appearance, acceptedVilla }: { id?: string; planId: string; floors: { sourceId: string; level: number; elevationM: number }[]; appearance?: WalkthroughAppearancePayload; acceptedVilla?: AcceptedVillaPreview }) {
  const [model, setModel] = useState<Group | null>(null), [failed, setFailed] = useState(false), [cut, setCut] = useState('all')
  const [simulation, setSimulation] = useState<HouseWalkingSimulation | null>(null), [walkingError, setWalkingError] = useState('')
  const [walking, setWalking] = useState(false), [controls, setControls] = useState<WalkingControls | null>(null)
  const [lookMode, setLookMode] = useState<'locked' | 'drag'>('locked')
  const [lookSpeed, setLookSpeed] = useState(DEFAULT_LOOK_SPEED)
  const [quality, setQuality] = useState<WalkthroughQuality>('adaptive')
  const viewport = useRef<HTMLDivElement>(null)
  const walkButton = useRef<HTMLButtonElement>(null)
  const [appearanceState, setAppearanceState] = useState(''), [safeToWalk, setSafeToWalk] = useState(true), [appearanceRevision, setAppearanceRevision] = useState(0)
  const [blenderRoomCount, setBlenderRoomCount] = useState(0)
  const [metrics, setMetrics] = useState<WalkthroughMetrics | null>(null)
  const appliedGeometry = useRef<string | null>(null), liveGroup = useRef<Group | null>(null)
  const batches = useRef<ReturnType<typeof batchWalkthroughScene> | null>(null)
  const controlsRef = useRef(controls)
  useEffect(() => { controlsRef.current = controls }, [controls])
  const [hud, setHud] = useState<WalkingHud>({ room: '', floor: 0, door: null, blocked: null, feet: [0, 0, 0], grounded: false, look: [0, 0] })
  const cameraConfiguration = useMemo(() => ({ position: [22, 20, 15] as [number, number, number], fov: 45 }), [])
  const framing = useMemo(() => acceptedVilla && model ? acceptedVillaBounds(model) : undefined, [acceptedVilla, model])
  useEffect(() => {
    const stage = viewport.current
    if (!walking || !stage) return
    const doc = stage.ownerDocument, previousOverflow = doc.body.style.overflow, inert: [HTMLElement, boolean][] = [], returnButton = walkButton.current
    doc.body.style.overflow = 'hidden'
    let branch: HTMLElement = stage
    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) if (sibling !== branch && sibling instanceof HTMLElement) { inert.push([sibling, sibling.inert]); sibling.inert = true }
      if (branch.parentElement === doc.body) break
      branch = branch.parentElement
    }
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const nodes = [...stage.querySelectorAll<HTMLElement>('button:not(:disabled),input,select')], first = nodes[0], last = nodes.at(-1)
      if (event.shiftKey && (doc.activeElement === first || !stage.contains(doc.activeElement))) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (doc.activeElement === last || !stage.contains(doc.activeElement))) { event.preventDefault(); first?.focus() }
    }
    doc.addEventListener('keydown', trap)
    return () => { doc.removeEventListener('keydown', trap); doc.body.style.overflow = previousOverflow; inert.forEach(([node, value]) => { node.inert = value }); returnButton?.focus({ preventScroll: true }) }
  }, [walking])
  useEffect(() => {
    const controller = new AbortController(); let owned: Group | null = null, ownedSimulation: HouseWalkingSimulation | null = null
    if (acceptedVilla) {
      void loadAcceptedVilla(acceptedVilla.url, planId, controller.signal).then(async group => {
        owned = group
        if (controller.signal.aborted) return
        // Reuse the exterior viewer's face separation without batching doors.
        separateCoplanar(group)
        prepareWalkthroughGlazing(group)
        try {
          if (!acceptedVilla.geometry) throw new Error('The exact villa can be viewed, but its source entrance or stairs need review before walking.')
          await initializeWalkingPhysics()
          if (controller.signal.aborted) return
          const geometry = acceptedVilla.geometry, identity = { designId: planId, projectId: 'accepted-villa', geometryKey: acceptedVilla.url, appearanceKey: acceptedVilla.url }
          ownedSimulation = new HouseWalkingSimulation({ ...geometry.metadata, ...identity }, { ...geometry.collision, ...identity }, planId, acceptedVillaCollision(group, geometry.metadata.openings))
          setSimulation(ownedSimulation)
        } catch (error) { if (!controller.signal.aborted) setWalkingError(error instanceof Error ? error.message : 'Walking could not be prepared. The orbit view is still available.') }
        if (!controller.signal.aborted) setModel(group)
      }).catch(error => { if (!controller.signal.aborted && error.name !== 'AbortError') setFailed(true) })
      return () => { controller.abort(); batches.current?.release(); batches.current = null; ownedSimulation?.dispose(); if (owned) { disposeAcceptedVillaFinishSources(owned); disposeWalkthroughAsset(owned) } }
    }
    loadWalkthroughAsset(`/api/walkthrough-assets/${id}/house.glb`, planId, controller.signal).then(async group => {
      owned = group
      const response = await fetch(`/api/walkthrough-assets/${id}/materials.json`, { signal: controller.signal })
      if (!response.ok) throw new Error('Selected Blender material data is unavailable.')
      const materials = await response.json()
      if (materials.designId !== planId) throw new Error('The selected materials belong to another house.')
      if (!controller.signal.aborted) { liveGroup.current = adoptBlenderWalkthroughAppearance(group, materials); setModel(group) }
    }).catch(error => { if (error.name !== 'AbortError') setFailed(true) })
    const loadJson = async (name: string) => { const response = await fetch(`/api/walkthrough-assets/${id}/${name}`, { signal: controller.signal }); if (!response.ok) throw new Error('Walking data is unavailable. Generate the house assets again.'); return response.json() }
    Promise.all([loadJson('metadata.json'), loadJson('collision.json'), initializeWalkingPhysics()]).then(([metadata, collision]) => {
      if (controller.signal.aborted) return
      ownedSimulation = new HouseWalkingSimulation(metadata as NavigationMetadata, collision as NavigationCollision, planId)
      setSimulation(ownedSimulation)
    }).catch(error => { if (!controller.signal.aborted) setWalkingError(error instanceof Error ? error.message : 'Walking could not be prepared. The orbit view is still available.') })
    return () => { controller.abort(); ownedSimulation?.dispose(); if (owned) disposeWalkthroughAsset(owned) }
  }, [id, planId, acceptedVilla])
  useEffect(() => {
    if (!model || !appearance) return
    let cancelled = false
    const current = () => !cancelled
    // oxlint-disable-next-line react/set-state-in-effect -- Synchronize the external Three scene and report its asynchronous update state.
    setAppearanceState('Updating selected finishes…')
    void (async () => {
      if (acceptedVilla) {
        if (!acceptedVilla.geometry) throw new Error('Source material domains are unavailable.')
        batches.current?.release(); batches.current = null
        bindAcceptedVillaFinishes(model, acceptedVilla.geometry, appearance)
        const warnings = await applyWalkthroughMaterialBindings(model, appearance.bindings, current)
        if (!current()) return
        // Wall tiles already partition the actual Blender faces. Only fitted
        // ceilings and room products belong in this separate appearance layer.
        const fitted = { ...appearance, skins: appearance.skins.filter(f => !/wall-tiles/.test(f.id)) }
        const update = await prepareWalkthroughAppearanceUpdate(fitted, liveGroup.current, current)
        if (!current()) { update.dispose(); return }
        const geometryKey = walkthroughFurnishingGeometryKey(fitted)
        if (simulation && appliedGeometry.current !== geometryKey) {
          const safe = simulation.replaceFurnishing(furnitureColliders(fitted)); setSafeToWalk(safe)
          if (!safe) { controlsRef.current?.exit(); setWalkingError('A selected product overlaps your standing position. Adjust it in Finishes & Cost before walking again.') }
          appliedGeometry.current = geometryKey
        }
        const next = update.commit(), old = liveGroup.current
        old?.removeFromParent(); model.add(next); liveGroup.current = next
        if (old) disposeWalkthroughAsset(old)
        // Replacements are explicit only for tagged interior product roots.
        // Untagged architectural/exterior furniture is never guessed away.
        model.traverse(o => { if (o.userData.assetKind === 'walkthrough-furniture') o.visible = false })
        applyWalkthroughContactDetail(model, acceptedVilla.geometry, appearance)
        batches.current = batchWalkthroughScene(model)
        setBlenderRoomCount(next.children.length)
        setAppearanceRevision(n => n + 1)
        setAppearanceState(warnings.length || next.userData.textureWarnings?.length ? 'Some surface images are unavailable. Selected colours are shown as approximations.' : 'Current Finishes & Cost selections and room furnishings applied.')
        return
      }
      const update = await prepareWalkthroughAppearanceUpdate(appearance, liveGroup.current, current), next = update.group
      try {
        const textureWarnings = await applyWalkthroughMaterialBindings(model, appearance.bindings, current)
        if (!current()) { update.dispose(); return }
        const geometryKey = walkthroughFurnishingGeometryKey(appearance)
        if (simulation && appliedGeometry.current !== geometryKey) {
          const safe = simulation.replaceFurnishing(furnitureColliders(appearance)); setSafeToWalk(safe)
          if (!safe) { controlsRef.current?.exit(); setWalkingError('A changed product overlaps your standing position. Adjust it in Finishes & Cost before walking again.') }
          else setWalkingError('')
          appliedGeometry.current = geometryKey
        } else setSafeToWalk(simulation ? simulation.canStand(simulation.feet) : false)
        update.commit()
        if (liveGroup.current) { liveGroup.current.removeFromParent(); disposeWalkthroughAsset(liveGroup.current) }
        model.add(next); liveGroup.current = next
        setBlenderRoomCount(next.children.filter(g => g.userData.source === 'blender-glb').length)
        setAppearanceRevision(n => n + 1); setAppearanceState(textureWarnings.length || next.userData.textureWarnings?.length ? 'Some surface images are unavailable. Selected colours are shown as approximations.' : 'Current Finishes & Cost selections applied.')
      } catch (error) { update.dispose(); throw error }
    })().catch(error => { if (!cancelled && error.name !== 'AbortError') { setSafeToWalk(false); controlsRef.current?.exit(); setAppearanceState('Finish preview could not update. The displayed materials may be out of date. Reopen the model to retry.') } })
    return () => { cancelled = true }
  }, [appearance, model, simulation, acceptedVilla])
  const floor = floors.find(f => f.sourceId === cut), plane = useMemo(() => floor && !walking ? new Plane(new Vector3(0, -1, 0), floor.elevationM + 1.4) : null, [floor, walking])
  const walkingHelp = lookMode === 'drag' ? 'WASD to move · Drag to look · E for doors · Escape to return to 3D' : 'WASD to move · Mouse to look · E for doors · Escape to return to 3D'
  return <div className="mt-4 border border-line">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2"><p className="max-w-xl text-xs text-ink-dim">{t(walking ? walkingHelp : 'Drag to orbit, or choose Walk inside for first-person movement.')}</p>
      <div className="flex flex-wrap items-center gap-3">{!acceptedVilla && <label className="flex min-h-11 items-center gap-2 text-xs">{t('Model view')}<select disabled={walking} className="min-h-11 border border-line bg-bg px-3 disabled:opacity-40" value={cut} onChange={e => setCut(e.target.value)}><option value="all">{t('Complete house')}</option>{floors.map(f => <option key={f.sourceId} value={f.sourceId}>{t('Floor')} {f.level} · {t('Cutaway')}</option>)}</select></label>}
        <button ref={walkButton} type="button" disabled={!controls || failed || !safeToWalk} onClick={() => { setWalkingError(''); if (walking) controls?.exit(); else controls?.enter() }} className="min-h-11 border border-line bg-accent px-4 text-xs text-bg focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40">{t(walking ? 'Return to 3D view' : 'Walk inside')}</button></div></div>
    {appearanceState && <p role="status" className="border-b border-line p-3 text-xs text-ink-dim">{t(appearanceState)}</p>}
    <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2 text-xs text-ink-dim">
      <label className="flex min-h-11 items-center gap-2">{t('Graphics')}<select value={quality} onChange={e => { setQuality(e.target.value as WalkthroughQuality); setMetrics(null) }} className="min-h-11 border border-line bg-bg px-3 text-ink">{Object.entries(WALKTHROUGH_QUALITY).map(([key, value]) => <option key={key} value={key}>{t(value.label)}</option>)}</select></label>
      <span>{t('40 FPS target · quality adapts to your GPU')}</span>
      <details className="basis-full"><summary className="min-h-11 cursor-pointer py-3">{t('Graphics card & quality')}</summary><p className="pb-3 leading-relaxed">{t('High-performance graphics requested. Windows and your browser choose the GPU. For RTX 3050, set this browser to High performance in Windows graphics settings and reopen it.')}</p>{metrics && <p className="pb-3">GPU: {gpuLabel(metrics.renderer)}</p>}</details>
    </div>
    {walkingError && <div role="status" className="border-b border-line p-4 text-xs leading-relaxed text-ink-dim"><p>{t(walkingError)}</p>{controls && safeToWalk && !walking && <><p className="mt-2">{t('If mouse capture is unavailable in this browser, use drag-look mode with the same walking physics.')}</p><button type="button" className="mt-3 min-h-11 border border-line bg-bg px-4 text-ink" onClick={() => { setWalkingError(''); controls.enterDrag() }}>{t('Use drag-look mode')}</button></>}</div>}
    {walking && lookMode === 'drag' && <p role="status" className="border-b border-line px-4 py-2 text-xs text-ink-dim">{t(acceptedVilla ? 'Drag to look · WASD to move' : 'Drag-look mode: hold the left mouse button to look around. WASD, doors and stair movement work normally.')}</p>}
    {simulation && [...simulation.doors.values()].some(d => d.operation === 'unresolved') && <p className="border-b border-line px-4 py-2 text-xs leading-relaxed text-ink-dim">{t('Some door swings are unspecified. Those leaves are hidden when opened; the source openings stay unchanged.')}</p>}
    {!simulation && !walkingError && model && <p role="status" className="p-3 text-xs text-ink-dim">{t('Preparing walking physics…')}</p>}
    {failed ? <p role="alert" className="p-5 text-sm text-bad">{t(acceptedVilla ? 'The accepted Blender villa could not load. Check its export in 3D Massing.' : 'The exported model could not be loaded. Generate the assets again.')}</p> : !model ? <p role="status" className="p-5 text-sm text-ink-dim">{t('Loading the exported house…')}</p> : <div ref={viewport} className={walking ? 'fixed inset-0 z-[1000] h-dvh w-screen cursor-none bg-bg-inset [&_canvas]:cursor-none' : 'relative h-[420px] bg-bg-inset'} role={walking ? 'dialog' : undefined} aria-modal={walking || undefined} aria-label={t(walking ? 'First-person house walkthrough' : 'Exported house model')}
      data-model-source={acceptedVilla ? 'accepted-massing-glb' : 'blender-glb'} data-model-url={acceptedVilla?.url} data-blender-room-count={blenderRoomCount} data-building-instance={model.uuid} data-finish-revision={appearanceRevision} data-walk-mode={walking ? 'first-person' : 'orbit'} data-walk-input={lookMode} data-walk-feet={JSON.stringify(hud.feet)} data-walk-look={JSON.stringify(hud.look)} data-walk-grounded={hud.grounded} data-walk-floor={hud.floor}>
      <ModelBoundary><Canvas frameloop="demand" shadows={{ type: PCFShadowMap, autoUpdate: false }} dpr={metrics?.dpr ?? WALKTHROUGH_QUALITY[quality].start} camera={cameraConfiguration} gl={{ antialias: true, powerPreference: 'high-performance' }} onCreated={({ gl }) => { gl.localClippingEnabled = true; gl.toneMapping = ACESFilmicToneMapping; gl.toneMappingExposure = 1; gl.shadowMap.type = PCFShadowMap; gl.shadowMap.autoUpdate = false; gl.shadowMap.needsUpdate = true }}>
        <color attach="background" args={['#e7e9e7']} /><WalkthroughLighting model={model} bounds={framing} />
        <WalkthroughRoomLights appearance={appearance} /><WalkthroughPerformance active={walking} revision={appearanceRevision} quality={quality} onMetrics={setMetrics} />
        <Bounds fit={!acceptedVilla && !walking} clip={!acceptedVilla && !walking} observe={false} margin={1.25}><primitive object={model} /></Bounds>
        {acceptedVilla && <FitAcceptedVilla scene={model} bounds={framing} />}
        <Clipping model={model} plane={plane} revision={appearanceRevision} /><OrbitControls enabled={!walking} makeDefault enableDamping={false} minDistance={1} maxDistance={80} />
        {simulation && <FirstPersonController simulation={simulation} model={model} lookSpeed={lookSpeed} onControls={setControls} onActive={(active, mode) => { setWalking(active); setMetrics(null); if (active) { setCut('all'); setLookMode(mode ?? 'locked') } else setWalkingError('') }} onHud={setHud} onError={setWalkingError} />}
      </Canvas></ModelBoundary>
      {walking && <><div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-black/30" />
        <div className="absolute inset-x-0 top-0 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-bg/95 p-4 text-ink">
          <div className="pointer-events-none"><p className="font-display text-lg">{t('House walkthrough')}</p><p className="text-xs text-ink-dim">{t('Floor')} {hud.floor}{hud.room ? ` · ${t(hud.room)}` : ''}</p>{metrics && <p className="mt-1 text-[10px] text-ink-dim" data-walkthrough-performance data-fps={metrics.fps} data-draw-calls={metrics.calls} data-triangles={metrics.triangles} data-dpr={metrics.dpr} data-renderer={metrics.renderer} data-render-ms={metrics.renderMs} data-page-focused={metrics.focused} data-page-visible={metrics.pageVisible}>{metrics.fps} FPS · {t('Target')} 40 · {t('Adaptive quality')}</p>}</div>
          <div className="flex cursor-auto flex-wrap items-center gap-4"><label className="flex min-h-11 items-center gap-2 text-xs">{t('Graphics')}<select value={quality} onChange={e => { setQuality(e.target.value as WalkthroughQuality); setMetrics(null) }} className="min-h-11 max-w-40 border border-line bg-bg px-2">{Object.entries(WALKTHROUGH_QUALITY).map(([key,value])=><option key={key} value={key}>{t(value.label)}</option>)}</select></label>{metrics && <span className="text-[10px] text-ink-dim">GPU: {gpuLabel(metrics.renderer)}</span>}<label className="flex items-center gap-2 text-xs">{t('Look speed')}<input aria-label={t('Look speed')} type="range" min={LOOK_SPEED.min} max={LOOK_SPEED.max} step="0.25" value={lookSpeed} onChange={e => setLookSpeed(Number(e.target.value))} className="w-20 accent-accent" /><span>{lookSpeed.toFixed(2)}×</span></label>
            <button type="button" onClick={() => controls?.exit()} className="min-h-11 border border-line bg-bg px-4 text-xs focus-visible:outline-2 focus-visible:outline-accent">{t('Exit')} <kbd className="ml-2 border border-line px-1.5 py-1">Esc</kbd></button></div>
        </div>
        <div className="absolute bottom-4 left-4 grid cursor-auto grid-cols-3 gap-1.5 rounded-lg border border-line bg-bg/90 p-2 text-ink" aria-label={t('Movement controls')}>
          <span /><MoveButton direction="forward" label={t('Move forward')} text="W ↑" controls={controls} /><span />
          <MoveButton direction="left" label={t('Move left')} text="A ←" controls={controls} /><MoveButton direction="back" label={t('Move backward')} text="S ↓" controls={controls} /><MoveButton direction="right" label={t('Move right')} text="D →" controls={controls} />
        </div>
        <div className="pointer-events-none absolute bottom-4 right-4 max-w-[calc(100%_-_210px)] border border-line bg-bg/95 p-3 text-xs leading-relaxed text-ink sm:max-w-md">
          <p>{t(lookMode === 'drag' ? 'Drag to look · WASD to move' : 'Mouse to look · WASD to move')}</p><p className="mt-1">{t('E: open / close doors · Esc: return to page')}</p>
          {hud.blocked && <p role="status" className="mt-2">{t(hud.blocked === 'edge' ? 'Edge reached — no supported floor ahead.' : 'Walking paused: no supported floor. Press Escape to return to 3D.')}</p>}
          {hud.door?.blocked && <p role="status" className="mt-2">{t('Step back to let the door swing clear.')}</p>}
          {hud.door && <button type="button" onClick={() => controls?.interact()} className="pointer-events-auto mt-2 min-h-11 cursor-auto border border-line bg-bg px-3">E · {t(hud.door.open ? 'Close door' : 'Open door')}</button>}
        </div></>}
    </div>}
  </div>
}

function MoveButton({ direction, label, text, controls }: { direction: 'forward' | 'back' | 'left' | 'right'; label: string; text: string; controls: WalkingControls | null }) {
  return <button type="button" aria-label={label} className="min-h-11 min-w-11 touch-none rounded border border-line bg-bg px-2 text-xs active:bg-accent active:text-bg focus-visible:outline-2 focus-visible:outline-accent"
    onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); controls?.move(direction, true) }}
    onPointerUp={() => controls?.move(direction, false)} onPointerCancel={() => controls?.move(direction, false)} onLostPointerCapture={() => controls?.move(direction, false)}
    onKeyDown={e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); e.stopPropagation(); controls?.move(direction, true) } }} onKeyUp={e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); controls?.move(direction, false) } }} onBlur={() => controls?.move(direction, false)}>{text}</button>
}

function Clipping({ model, plane, revision }: { model: Group; plane: Plane | null; revision: number }) {
  const invalidate = useThree(s => s.invalidate)
  useEffect(() => { model.traverse(o => { if (!('material' in o)) return
    const materials = Array.isArray(o.material) ? o.material : [o.material]
    for (const material of materials) { material.clippingPlanes = plane ? [plane] : []; material.clipShadows = !!plane; material.needsUpdate = true }
  }); invalidate() }, [model, plane, revision, invalidate])
  return null
}

class ModelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <p role="alert" className="p-5 text-sm text-ink-dim">{t('3D review is unavailable on this device. The exported files are still available.')}</p> : this.props.children }
}
