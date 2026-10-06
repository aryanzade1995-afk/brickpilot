import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { BrightnessContrast, EffectComposer, N8AO, SMAA, Vignette } from '@react-three/postprocessing'
import { ArrowRight, Grid3x3 } from 'lucide-react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useStudio } from '@/state/studio.ts'
import { MASSING_LABEL } from '@/lib/engine/index.ts'
import { buildDollhouse } from '@/lib/three/buildDollhouse.ts'
import { furnishedDresser } from '@/lib/three/dressRoom.ts'
import { DENSITIES, INTERIOR_STYLES, type InteriorConfiguration } from '@/lib/interior/preview.ts'
import { useInterior360 } from '@/state/interior360.ts'
import { DollhouseModel, DollhouseEnv } from '@/lib/three/DollhouseScene.tsx'
import { cx } from '@/lib/cx.ts'
import { WorkspaceTabs } from '@/components/WorkspaceTabs.tsx'
import { InvalidPlanNotice } from '@/components/InvalidPlanNotice.tsx'
import { BlenderVillaPanel } from '@/components/BlenderVillaPanel.tsx'
import { AiVisualization } from '@/components/AiVisualization.tsx'

type ViewMode = 'architecture' | 'furnished'

type CamKey = 'front' | 'rear' | 'left' | 'right' | 'iso' | 'top'

export function Massing() {
  const result = useStudio((s) => s.result)
  const run = useStudio((s) => s.run)
  useEffect(() => {
    if (!result) run()
  }, [result, run])

  const [mode, setMode] = useState<ViewMode>('architecture')
  const [pendingView, setPendingView] = useState<CamKey | null>('iso')
  const [floorSel, setFloorSel] = useState<number | 'all'>('all')
  // the furnished view is dressed like the 360 preview: the brief's Finishes & Cost choices room by room, and the
  // interior style and furniture density chosen in the 360 panel. Any change rebuilds it at once.
  const brief = useStudio((s) => s.brief)
  const style = useInterior360((s) => s.style)
  const density = useInterior360((s) => s.furnitureDensity) as InteriorConfiguration['furnitureDensity']
  const setInterior = useInterior360((s) => s.set)
  const doll = useMemo(() => {
    if (!result?.shapeFingerprint || mode !== 'furnished') return null
    const plan = { ...result.design, model: { ...result.design.model, brief } }
    return buildDollhouse(plan, floorSel === 'all' ? undefined : floorSel, furnishedDresser(plan, style, density))
  }, [result, brief, mode, floorSel, style, density])

  if (result && !result.report.hardChecksPass) return <InvalidPlanNotice report={result.report} />
  if (result && (mode === 'architecture' || !result.shapeFingerprint)) return <div className="mx-auto max-w-[1400px] px-6 py-8 md:px-10">
    <WorkspaceTabs />
    <h1 className="mt-5 font-display text-2xl">3D massing · {result.model.brief.project.name}</h1>
    <MassingViewTabs mode="architecture" onChange={setMode} furnishedAvailable={Boolean(result.shapeFingerprint)} />
    <BlenderVillaPanel plan={result.design} selectedSeed={result.villaDesignDNA?.seed ?? result.design.dna.seed} autoGenerate />
    <div className="mt-6 flex gap-6 text-sm">
      <Link to="/workspace/plan" className="underline underline-offset-4">View the 2D plan</Link>
      <Link to="/workspace/finishes" className="underline underline-offset-4">Continue to finishes & cost</Link>
    </div>
    <AiVisualization design={result.design} />
  </div>
  if (!result || !doll) {
    return <div className="mx-auto max-w-[1400px] px-10 py-24 text-ink-dim">Preparing model…</div>
  }

  const levels = result.design.floors.map((f) => f.level)
  const span = Math.max(doll.bounds.w, doll.bounds.d)
  const center = doll.center
  const switchMode = (mm: ViewMode) => {
    setMode(mm)
    setPendingView('iso')
  }
  const design = result.design

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-8 md:px-10">
      <WorkspaceTabs />
      <MassingViewTabs mode={mode} onChange={switchMode} furnishedAvailable />
      <div className="mt-4 flex items-center justify-between">
        <h1 className="font-display text-2xl">Furnished · {result.model.brief.project.name}</h1>
        <div className="font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ok">● Geometry verified</div>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_280px]">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-1">
            {levels.length > 1 && (
              <div className="mr-3 flex border border-line">
                {(['all', ...levels] as (number | 'all')[]).map((l) => (
                  <button
                    key={String(l)}
                    type="button"
                    onClick={() => {
                      setFloorSel(l)
                      setPendingView('iso')
                    }}
                    className={cx(
                      'px-2.5 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.1em]',
                      floorSel === l ? 'bg-bg-raised text-ink' : 'text-ink-dim hover:text-ink',
                    )}
                  >
                    {l === 'all' ? 'All' : l === 0 ? 'G' : `F${l}`}
                  </button>
                ))}
              </div>
            )}
            {(['front', 'rear', 'left', 'right', 'iso', 'top'] as CamKey[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setPendingView(k)}
                className="border border-line px-3 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-ink-dim hover:border-ink-dim hover:text-ink"
              >
                {k}
              </button>
            ))}
          </div>

          <div className="relative aspect-[4/3] w-full overflow-hidden border border-line">
            <Canvas
              frameloop="demand"
              shadows="soft"
              dpr={[1, 2]}
              gl={{ preserveDrawingBuffer: true, antialias: true }}
              // a depth range fitted to the house: with near 0.1 the far walls ran out of depth precision and flickered
              camera={{ fov: 37, near: Math.max(0.3, span * 0.02), far: span * 12, position: [span * 1.1, span * 0.85, span * 1.1] }}
              onCreated={({ gl }) => {
                gl.toneMapping = THREE.NeutralToneMapping
                gl.toneMappingExposure = 1.5
              }}
            >
              <DollhouseEnv doll={doll} />
              <DollhouseModel doll={doll} />

              <EffectComposer enableNormalPass multisampling={4}>
                <N8AO aoRadius={1.5} intensity={2.7} distanceFalloff={1.1} quality="high" />
                <BrightnessContrast brightness={0.015} contrast={0.09} />
                <SMAA />
                <Vignette eskil={false} offset={0.42} darkness={0.36} />
              </EffectComposer>

              <CameraRig span={span} center={center} pendingView={pendingView} onApplied={() => setPendingView(null)} />
            </Canvas>

            <div className="pointer-events-none absolute bottom-2 left-3 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-ink-faint">
              drag rotate · wheel zoom · right-drag pan
            </div>
          </div>

        </div>

        <div className="space-y-6">
          <Panel title="Dressed as your 360">
            <p className="text-[0.75rem] leading-relaxed text-ink-dim">
              Every room shows the same furniture as its 360 preview, in your Finishes &amp; Cost choices. Change a finish
              and this view follows at once; that room's 360 is marked to render again.
            </p>
            {([['Interior style', style, INTERIOR_STYLES, 'style'], ['Furniture density', density, DENSITIES, 'furnitureDensity']] as const).map(([label, value, list, key]) =>
              <label key={key} className="block text-xs text-ink-dim">{label}
                <select value={value} onChange={(e) => setInterior({ [key]: e.target.value })} className="mt-1 w-full border border-line bg-bg p-1.5 text-sm text-ink">
                  {list.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </label>)}
            <div className="flex gap-4 pt-1 text-xs">
              <Link to="/workspace/finishes?tab=specifications" className="underline underline-offset-4">Change finishes</Link>
              <Link to="/workspace/interior" className="underline underline-offset-4">Open 360 preview</Link>
            </div>
          </Panel>

          <Panel title="Model">
            <Stat k="Massing" v={MASSING_LABEL[result.design.massingType] ?? result.design.massingType} />
            <Stat k="Storeys" v={String(design.floors.length)} />
            <Stat k="Height" v={`${design.heightM} m`} />
            <Stat k="Built area" v={`${design.builtAreaSqm.toFixed(1)} m²`} />
            <Stat k="Openings" v={String(design.openingCounts.doors + design.openingCounts.windows)} />
            <Stat k="New element" v={result.design.dna.roofGeometry?.element ?? 'portal'} />
          </Panel>

          <div className="border border-line">
            <div className="label flex items-center justify-between border-b border-line px-4 py-2.5">
              Next step
              <Grid3x3 size={12} />
            </div>
            <div className="space-y-3 p-4">
              <p className="text-[0.8rem] leading-relaxed text-ink-dim">
                This furnished view follows the floor plan. The AI visualization of the villa is below.
              </p>
              <Link
                to="/workspace/finishes"
                className="flex w-full items-center justify-center gap-2 border border-line-strong py-3 font-mono text-xs uppercase tracking-[0.12em] text-ink-dim hover:border-ink-dim hover:text-ink"
              >
                Continue to finishes & cost
                <ArrowRight size={13} />
              </Link>
            </div>
          </div>
        </div>
      </div>
      <AiVisualization design={result.design} />
    </div>
  )
}

function MassingViewTabs({ mode, onChange, furnishedAvailable }: { mode: ViewMode; onChange: (mode: ViewMode) => void; furnishedAvailable: boolean }) {
  return <div className="mt-5 flex flex-wrap gap-1" role="tablist" aria-label="3D views">
    {([['architecture', 'Blender design'], ['furnished', 'Furnished']] as const).map(([key, label]) =>
      <button key={key} type="button" role="tab" aria-selected={mode === key} disabled={key !== 'architecture' && !furnishedAvailable}
        onClick={() => onChange(key)} className={cx('border border-line px-3 py-2 text-xs disabled:opacity-40',
          mode === key ? 'border-ink text-ink' : 'text-ink-dim hover:text-ink')}>{label}</button>)}
  </div>
}

function CameraRig({
  span,
  center,
  pendingView,
  onApplied,
}: {
  span: number
  center: [number, number, number]
  pendingView: CamKey | null
  onApplied: () => void
}) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null
  const [tx, ty, tz] = center

  useEffect(() => {
    if (!pendingView || !controls) return
    const d = span * 1.65
    const aim = ty - span * 0.04
    const spots: Record<CamKey, [number, number, number]> = {
      front: [tx, aim + d * 0.05, tz + d],
      rear: [tx, aim + d * 0.05, tz - d],
      left: [tx - d, aim + d * 0.05, tz],
      right: [tx + d, aim + d * 0.05, tz],
      iso: [tx + d * 0.72, aim + d * 0.46, tz + d * 0.8],
      top: [tx + 0.001, ty + d * 2.3, tz + 0.001],
    }
    const [x, y, z] = spots[pendingView]
    camera.position.set(x, y, z)
    controls.target.set(tx, aim, tz)
    controls.update()
    onApplied()
  }, [pendingView, span, tx, ty, tz, camera, controls, onApplied])

  return (
    <OrbitControls
      makeDefault
      enableDamping
      dampingFactor={0.1}
      minDistance={span * 0.3}
      maxDistance={span * 7}
      maxPolarAngle={Math.PI / 2.05}
    />
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-line">
      <div className="label border-b border-line px-4 py-2.5">{title}</div>
      <div className="space-y-2 p-4">{children}</div>
    </div>
  )
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-ink-dim">{k}</span>
      <span className="font-mono text-[0.8rem] text-ink tnum">{v}</span>
    </div>
  )
}
