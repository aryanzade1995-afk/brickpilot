import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Bounds, OrbitControls } from '@react-three/drei'
import { Plane, Vector3, type Group } from 'three'
import { loadWalkthroughAsset, disposeWalkthroughAsset, applyWalkthroughMaterialBindings } from '@/lib/three/loadWalkthroughAsset.ts'
import { prepareWalkthroughAppearanceUpdate, walkthroughFurnishingGeometryKey } from '@/lib/three/walkthroughAppearance.ts'
import { furnitureColliders, type WalkthroughAppearancePayload } from '@/lib/walkthrough/delivery.ts'
import { translate as t } from '@/lib/i18n/index.ts'
import { HouseWalkingSimulation, initializeWalkingPhysics, type NavigationMetadata, type NavigationCollision } from '@/lib/walkthrough/navigation.ts'
import { FirstPersonController, type WalkingControls, type WalkingHud } from './FirstPersonController.tsx'

/** Shared orbit / first-person viewer of the same immutable delivered house. */
export default function WalkthroughAssetPreview({ id, planId, floors, appearance }: { id: string; planId: string; floors: { sourceId: string; level: number; elevationM: number }[]; appearance: WalkthroughAppearancePayload }) {
  const [model, setModel] = useState<Group | null>(null), [failed, setFailed] = useState(false), [cut, setCut] = useState('all')
  const [simulation, setSimulation] = useState<HouseWalkingSimulation | null>(null), [walkingError, setWalkingError] = useState('')
  const [walking, setWalking] = useState(false), [controls, setControls] = useState<WalkingControls | null>(null)
  const [lookMode, setLookMode] = useState<'locked' | 'drag'>('locked')
  const viewport = useRef<HTMLDivElement>(null)
  const [appearanceState, setAppearanceState] = useState(''), [safeToWalk, setSafeToWalk] = useState(true), [appearanceRevision, setAppearanceRevision] = useState(0)
  const appliedGeometry = useRef<string | null>(null), liveGroup = useRef<Group | null>(null)
  const controlsRef = useRef(controls)
  useEffect(() => { controlsRef.current = controls }, [controls])
  const [hud, setHud] = useState<WalkingHud>({ room: '', floor: 0, door: null, blocked: null, feet: [0, 0, 0], grounded: false, look: [0, 0] })
  const cameraConfiguration = useMemo(() => ({ position: [22, 20, 15] as [number, number, number], fov: 45 }), [])
  useEffect(() => { if (walking) viewport.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }, [walking])
  useEffect(() => {
    const controller = new AbortController(); let owned: Group | null = null, ownedSimulation: HouseWalkingSimulation | null = null
    loadWalkthroughAsset(`/api/walkthrough-assets/${id}/house.glb`, planId, controller.signal).then(group => {
      owned = group
      // Combined downloads contain furnishing once. The live package replaces
      // that root, it is never appended on top of the exported furniture.
      const furnishing: Group[] = []; group.traverse(o => { if (o.userData.assetKind === 'walkthrough-furniture') furnishing.push(o as Group) })
      for (const f of furnishing) { f.removeFromParent(); disposeWalkthroughAsset(f) }
      if (!controller.signal.aborted) setModel(group)
    }).catch(error => { if (error.name !== 'AbortError') setFailed(true) })
    const loadJson = async (name: string) => { const response = await fetch(`/api/walkthrough-assets/${id}/${name}`, { signal: controller.signal }); if (!response.ok) throw new Error('Walking data is unavailable. Generate the house assets again.'); return response.json() }
    Promise.all([loadJson('metadata.json'), loadJson('collision.json'), initializeWalkingPhysics()]).then(([metadata, collision]) => {
      if (controller.signal.aborted) return
      ownedSimulation = new HouseWalkingSimulation(metadata as NavigationMetadata, collision as NavigationCollision, planId)
      setSimulation(ownedSimulation)
    }).catch(error => { if (!controller.signal.aborted) setWalkingError(error instanceof Error ? error.message : 'Walking could not be prepared. The orbit view is still available.') })
    return () => { controller.abort(); ownedSimulation?.dispose(); if (owned) disposeWalkthroughAsset(owned) }
  }, [id, planId])
  useEffect(() => {
    if (!model) return
    let cancelled = false
    const current = () => !cancelled
    // oxlint-disable-next-line react/set-state-in-effect -- Synchronize the external Three scene and report its asynchronous update state.
    setAppearanceState('Updating selected finishes…')
    void (async () => {
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
        setAppearanceRevision(n => n + 1); setAppearanceState(textureWarnings.length || next.userData.textureWarnings?.length ? 'Some surface images are unavailable. Selected colours are shown as approximations.' : 'Current Finishes & Cost selections applied.')
      } catch (error) { update.dispose(); throw error }
    })().catch(error => { if (!cancelled && error.name !== 'AbortError') { setSafeToWalk(false); controlsRef.current?.exit(); setAppearanceState('Finish preview could not update. The displayed materials may be out of date. Reopen the model to retry.') } })
    return () => { cancelled = true }
  }, [appearance, model, simulation])
  const floor = floors.find(f => f.sourceId === cut), plane = useMemo(() => floor && !walking ? new Plane(new Vector3(0, -1, 0), floor.elevationM + 1.4) : null, [floor, walking])
  const walkingHelp = lookMode === 'drag' ? 'WASD to move · Drag to look · E for doors · Escape to return to 3D' : 'WASD to move · Mouse to look · E for doors · Escape to return to 3D'
  return <div className="mt-4 border border-line">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2"><p className="max-w-xl text-xs text-ink-dim">{t(walking ? walkingHelp : 'Drag to orbit, or choose Walk inside for first-person movement.')}</p>
      <div className="flex flex-wrap items-center gap-3"><label className="flex min-h-11 items-center gap-2 text-xs">{t('Model view')}<select disabled={walking} className="min-h-11 border border-line bg-bg px-3 disabled:opacity-40" value={cut} onChange={e => setCut(e.target.value)}><option value="all">{t('Complete house')}</option>{floors.map(f => <option key={f.sourceId} value={f.sourceId}>{t('Floor')} {f.level} · {t('Cutaway')}</option>)}</select></label>
        <button type="button" disabled={!controls || failed || !safeToWalk} onClick={() => { setWalkingError(''); if (walking) controls?.exit(); else controls?.enter() }} className="min-h-11 border border-line bg-accent px-4 text-xs text-bg focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40">{t(walking ? 'Return to 3D view' : 'Walk inside')}</button></div></div>
    {appearanceState && <p role="status" className="border-b border-line p-3 text-xs text-ink-dim">{t(appearanceState)}</p>}
    {walkingError && <div role="status" className="border-b border-line p-4 text-xs leading-relaxed text-ink-dim"><p>{t(walkingError)}</p>{controls && safeToWalk && !walking && <><p className="mt-2">{t('If mouse capture is unavailable in this browser, use drag-look mode with the same walking physics.')}</p><button type="button" className="mt-3 min-h-11 border border-line bg-bg px-4 text-ink" onClick={() => { setWalkingError(''); controls.enterDrag() }}>{t('Use drag-look mode')}</button></>}</div>}
    {walking && lookMode === 'drag' && <p role="status" className="border-b border-line px-4 py-2 text-xs text-ink-dim">{t('Drag-look mode: hold the left mouse button to look around. WASD, doors and stair movement work normally.')}</p>}
    {simulation && [...simulation.doors.values()].some(d => d.operation === 'unresolved') && <p className="border-b border-line px-4 py-2 text-xs leading-relaxed text-ink-dim">{t('Some door swings are unspecified. Those leaves are hidden when opened; the source openings stay unchanged.')}</p>}
    {!simulation && !walkingError && model && <p role="status" className="p-3 text-xs text-ink-dim">{t('Preparing walking physics…')}</p>}
    {failed ? <p role="alert" className="p-5 text-sm text-bad">{t('The exported model could not be loaded. Generate the assets again.')}</p> : !model ? <p role="status" className="p-5 text-sm text-ink-dim">{t('Loading the exported house…')}</p> : <div ref={viewport} className={`relative bg-bg-inset ${walking ? 'h-[min(72vh,680px)] min-h-[380px]' : 'h-[380px]'}`} aria-label={t(walking ? 'First-person house walkthrough' : 'Exported house model')}
      data-building-instance={model.uuid} data-finish-revision={appearanceRevision} data-walk-mode={walking ? 'first-person' : 'orbit'} data-walk-input={lookMode} data-walk-feet={JSON.stringify(hud.feet)} data-walk-look={JSON.stringify(hud.look)} data-walk-grounded={hud.grounded} data-walk-floor={hud.floor}>
      <ModelBoundary><Canvas frameloop="demand" dpr={[1, 1.5]} camera={cameraConfiguration} gl={{ antialias: true }} onCreated={({ gl }) => { gl.localClippingEnabled = true }}>
        <color attach="background" args={['#eeeee8']} /><ambientLight intensity={1.7} /><directionalLight position={[8, 20, 6]} intensity={2.5} />
        <Bounds fit={!walking} clip={!walking} observe={!walking} margin={1.25}><primitive object={model} /></Bounds>
        <Clipping model={model} plane={plane} revision={appearanceRevision} /><OrbitControls enabled={!walking} makeDefault enableDamping={false} minDistance={1} maxDistance={80} />
        {simulation && <FirstPersonController simulation={simulation} model={model} onControls={setControls} onActive={(active, mode) => { setWalking(active); if (active) { setCut('all'); setLookMode(mode ?? 'locked') } }} onHud={setHud} onError={setWalkingError} />}
      </Canvas></ModelBoundary>
      {walking && <><div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-black/30" />
        <div className="pointer-events-none absolute left-3 top-3 border border-line bg-bg/95 px-3 py-2 text-xs text-ink">{t('Floor')} {hud.floor}{hud.room ? ` · ${t(hud.room)}` : ''}</div>
        <div aria-live="polite" className="pointer-events-none absolute bottom-3 left-3 right-3 border border-line bg-bg/95 px-3 py-2 text-xs leading-relaxed text-ink">
          {hud.blocked ? t(hud.blocked === 'edge' ? 'Edge reached — no supported floor ahead.' : 'Walking paused: no supported floor. Press Escape to return to 3D.') : hud.door ? `E · ${t(hud.door.open ? 'Close door' : 'Open door')}` : t(walkingHelp)}
        </div></>}
    </div>}
  </div>
}

function Clipping({ model, plane, revision }: { model: Group; plane: Plane | null; revision: number }) {
  const invalidate = useThree(s => s.invalidate)
  useEffect(() => { model.traverse(o => { if (!('material' in o)) return
    const materials = Array.isArray(o.material) ? o.material : [o.material]
    for (const material of materials) { material.clippingPlanes = plane ? [plane] : []; material.needsUpdate = true }
  }); invalidate() }, [model, plane, revision, invalidate])
  return null
}

class ModelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <p role="alert" className="p-5 text-sm text-ink-dim">{t('3D review is unavailable on this device. The exported files are still available.')}</p> : this.props.children }
}
