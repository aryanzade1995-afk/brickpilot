import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Canvas, useThree } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import { BrightnessContrast, EffectComposer, N8AO, SMAA, Vignette } from '@react-three/postprocessing'
import { ArrowRight, Grid3x3 } from 'lucide-react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useStudio } from '@/state/studio.ts'
import { SHAPE_LABEL } from '@/lib/engine/index.ts'
import { buildMassing } from '@/lib/three/buildMassing.ts'
import { buildDollhouse } from '@/lib/three/buildDollhouse.ts'
import { MassingModel, SceneEnv } from '@/lib/three/MassingScene.tsx'
import { DollhouseModel, DollhouseEnv } from '@/lib/three/DollhouseScene.tsx'
import { GlbVilla } from '@/lib/three/GlbVilla.tsx'
import { useVillaGlb } from '@/lib/three/villaCatalog.ts'
import type { Group } from '@/lib/three/massingGroups.ts'
import { cx } from '@/lib/cx.ts'
import { WorkspaceTabs } from '@/components/WorkspaceTabs.tsx'

type ViewMode = 'study' | 'furnished'

const LAYER_TOGGLES: { g: Group; label: string }[] = [
  { g: 'shell', label: 'Walls' },
  { g: 'glazing', label: 'Glazing' },
  { g: 'slabs', label: 'Floor slabs' },
  { g: 'roof', label: 'Roof + canopies' },
  { g: 'partition', label: 'Partitions (explode)' },
  { g: 'stair', label: 'Stair core' },
]

type CamKey = 'front' | 'rear' | 'left' | 'right' | 'iso' | 'top'

export function Massing() {
  const result = useStudio((s) => s.result)
  const run = useStudio((s) => s.run)
  const reseed = useStudio((s) => s.reseed)
  useEffect(() => {
    if (!result) run()
  }, [result, run])

  const massing = useMemo(() => (result ? buildMassing(result.design) : null), [result])
  // the architectural-grammar DesignSpec for this design, and a Blender GLB for
  // it if one is baked/available (else glb=null → the procedural buildMassing
  // model below is used, exactly as before)
  const { glb: villaGlb, spec: designSpec } = useVillaGlb(result?.design)
  const [mode, setMode] = useState<ViewMode>('study')
  const [floorSel, setFloorSel] = useState<number | 'all'>(0)
  const doll = useMemo(
    () =>
      result && mode === 'furnished'
        ? buildDollhouse(result.design, floorSel === 'all' ? undefined : floorSel)
        : null,
    [result, mode, floorSel],
  )
  const levels = useMemo(
    () => (result ? [...new Set(result.design.floors.map((f) => f.level))].sort((a, b) => a - b) : []),
    [result],
  )

  const [explode, setExplode] = useState(0)
  const [hidden, setHidden] = useState<Set<Group>>(new Set())
  const [showSite, setShowSite] = useState(true)
  const [pendingView, setPendingView] = useState<CamKey | null>('iso')
  const switchMode = (mm: ViewMode) => {
    setMode(mm)
    setPendingView('iso')
  }
  const selectFloor = (f: number | 'all') => {
    setFloorSel(f)
    setPendingView('iso')
  }

  if (!result || !massing) {
    return <div className="mx-auto max-w-[1400px] px-10 py-24 text-ink-dim">Preparing model…</div>
  }

  const furnished = mode === 'furnished' && doll
  const center = furnished ? doll.center : massing.center
  const span = furnished
    ? Math.max(doll.footprint.w, doll.footprint.d)
    : Math.max(massing.bounds.w, massing.bounds.d)
  const character = result.model.brief.style.character

  const toggle = (g: Group) =>
    setHidden((h) => {
      const n = new Set(h)
      if (n.has(g)) n.delete(g)
      else n.add(g)
      return n
    })

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-8 md:px-10">
      <WorkspaceTabs />
      <div className="mt-4 flex items-center justify-between">
        <h1 className="font-display text-2xl">{result.model.brief.project.name}</h1>
        <div className="font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ok">● Geometry verified</div>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_280px]">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="inline-flex border border-line-strong">
              {(['study', 'furnished'] as ViewMode[]).map((mm, i) => (
                <button
                  key={mm}
                  type="button"
                  onClick={() => switchMode(mm)}
                  className={cx(
                    'px-3 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] transition-colors',
                    i > 0 && 'border-l border-line-strong',
                    mode === mm ? 'bg-accent text-white' : 'text-ink-dim hover:bg-bg-raised hover:text-ink',
                  )}
                >
                  {mm === 'study' ? 'Study model' : 'Furnished'}
                </button>
              ))}
            </div>
            {designSpec && (
              <span
                className={cx(
                  'border px-2 py-1 font-mono text-[0.6rem] uppercase tracking-[0.1em]',
                  villaGlb && mode === 'study'
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : 'border-line-strong text-ink-dim',
                )}
                title={`${designSpec.grammar.label} · ${designSpec.genome.massingComposition.replace(/_/g, ' ')} · ${designSpec.genome.volumeCount} volumes · roof ${designSpec.genome.roof.replace(/_/g, ' ')} · seed ${designSpec.seed} · fp ${designSpec.fingerprint.hash}`}
              >
                {villaGlb && mode === 'study' ? 'Blender GLB · ' : ''}
                {designSpec.genome.massingComposition.replace(/_/g, ' ')}
              </span>
            )}
            <div className="flex flex-wrap gap-1">
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

            {mode === 'furnished' && levels.length > 1 && (
              <div className="inline-flex border border-line-strong">
                {(['all', ...levels] as (number | 'all')[]).map((f, i) => (
                  <button
                    key={String(f)}
                    type="button"
                    onClick={() => selectFloor(f)}
                    className={cx(
                      'px-3 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] transition-colors',
                      i > 0 && 'border-l border-line-strong',
                      floorSel === f ? 'bg-accent text-white' : 'text-ink-dim hover:bg-bg-raised hover:text-ink',
                    )}
                  >
                    {f === 'all' ? 'All floors' : f === 0 ? 'Ground' : `Floor ${f}`}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative aspect-[4/3] w-full overflow-hidden border border-line">
            <Canvas
              key={mode}
              shadows="soft"
              dpr={[1, 2]}
              gl={{ preserveDrawingBuffer: true, antialias: true }}
              camera={{ fov: 37, near: 0.1, far: span * 40, position: [span * 1.1, span * 0.85, span * 1.1] }}
              onCreated={({ gl }) => {
                gl.toneMapping = THREE.NeutralToneMapping
                gl.toneMappingExposure = furnished ? 1.18 : 1.5
              }}
            >
              {furnished ? (
                <>
                  <DollhouseEnv doll={doll} />
                  <DollhouseModel doll={doll} />
                </>
              ) : (
                <>
                  <SceneEnv massing={massing} />
                  {showSite && (
                    <Grid
                      position={[massing.center[0], -0.01, massing.center[2]]}
                      args={[span * 3, span * 3]}
                      cellSize={1}
                      cellThickness={0.5}
                      cellColor="#343b44"
                      sectionSize={5}
                      sectionThickness={0.8}
                      sectionColor="#48515c"
                      fadeDistance={span * 3.4}
                      fadeStrength={1.3}
                    />
                  )}
                  {villaGlb && mode === 'study' ? (
                    <GlbVilla url={villaGlb.url} hidden={hidden as Set<string>} />
                  ) : (
                    <MassingModel massing={massing} explode={explode} hidden={hidden} character={character} />
                  )}
                </>
              )}

              <EffectComposer enableNormalPass multisampling={4}>
                <N8AO aoRadius={1.5} intensity={furnished ? 1.8 : 2.7} distanceFalloff={1.1} halfRes />
                <BrightnessContrast brightness={0.015} contrast={furnished ? 0.05 : 0.09} />
                <SMAA />
                <Vignette eskil={false} offset={0.42} darkness={furnished ? 0.28 : 0.36} />
              </EffectComposer>

              <CameraRig
                span={span}
                center={center}
                pendingView={pendingView}
                onApplied={() => setPendingView(null)}
                dollhouse={!!furnished}
                stacked={!!furnished && floorSel === 'all'}
              />
            </Canvas>

            <div className="pointer-events-none absolute bottom-2 left-3 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-ink-faint">
              drag rotate · wheel zoom · right-drag pan
            </div>
          </div>

          {!furnished && (
            <div className="mt-4 flex items-center gap-4">
              <span className="label flex-none">Explode</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={explode}
                onChange={(e) => setExplode(Number(e.target.value))}
                className="w-full accent-accent"
              />
              <span className="w-10 flex-none text-right font-mono text-xs text-ink-dim tnum">
                {Math.round(explode * 100)}%
              </span>
            </div>
          )}
          {furnished && (
            <p className="mt-4 text-[0.8rem] leading-relaxed text-ink-dim">
              A deterministic furnished cut-away — {doll.stats.pieces} pieces across {doll.stats.rooms} rooms,
              placed from the plan by room type, size and the real door / window positions. Not a design proposal,
              a scale study.
            </p>
          )}
        </div>

        <div className="space-y-6">
          <Panel title="Model">
            <Stat k="Shape" v={SHAPE_LABEL[result.design.shape] ?? result.design.shape} />
            {designSpec && <Stat k="Massing" v={`${designSpec.genome.massingComposition.replace(/_/g, ' ')} · ${designSpec.genome.volumeCount} vol`} />}
            {designSpec && <Stat k="Roof" v={designSpec.genome.roof.replace(/_/g, ' ')} />}
            {designSpec && (
              <Stat
                k="Entrance"
                v={`${designSpec.genome.entrance.replace(/_/g, ' ')}${designSpec.genome.doubleHeightEntrance ? ' · 2H' : ''}`}
              />
            )}
            {designSpec && designSpec.genome.balcony !== 'none' && (
              <Stat k="Balcony" v={designSpec.genome.balcony.replace(/_/g, ' ')} />
            )}
            {designSpec && <Stat k="Facade" v={`${designSpec.genome.facadeComposition.replace(/_/g, ' ')}${designSpec.genome.screen !== 'none' ? ` · ${designSpec.genome.screen.replace(/_/g, ' ')}` : ''}`} />}
            <Stat k="Storeys" v={String(massing.stats.storeys)} />
            <Stat k="Height" v={`${massing.stats.heightM} m`} />
            <Stat k="Built area" v={`${massing.stats.builtAreaSqm.toFixed(1)} m²`} />
            {furnished ? (
              <>
                <Stat k="Rooms furnished" v={String(doll.stats.rooms)} />
                <Stat k="Furniture pieces" v={String(doll.stats.pieces)} />
              </>
            ) : (
              <Stat k="Openings" v={String(massing.stats.openings)} />
            )}
            {designSpec && <Stat k="Design seed" v={`${designSpec.seed} · ${designSpec.fingerprint.hash}`} />}
            <button
              type="button"
              onClick={reseed}
              className="mt-1 flex w-full items-center justify-center gap-1.5 border border-line-strong py-2 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-ink-dim transition-colors hover:border-accent hover:text-ink"
            >
              <Grid3x3 size={11} /> Regenerate design
            </button>
          </Panel>

          {!furnished && (
            <div className="border border-line">
              <div className="label border-b border-line px-4 py-2.5">Layers</div>
              <div className="p-2">
                {LAYER_TOGGLES.map((l) => (
                  <LayerRow key={l.g} label={l.label} on={!hidden.has(l.g)} onClick={() => toggle(l.g)} />
                ))}
                <LayerRow label="Site + grid" on={showSite} onClick={() => setShowSite((v) => !v)} />
              </div>
            </div>
          )}

          <div className="border border-line">
            <div className="label flex items-center justify-between border-b border-line px-4 py-2.5">
              Next step
              <Grid3x3 size={12} />
            </div>
            <div className="space-y-3 p-4">
              <p className="text-[0.8rem] leading-relaxed text-ink-dim">
                The verified massing is the reference the concept renders are grounded to.
              </p>
              <Link
                to="/workspace/render"
                className="flex w-full items-center justify-center gap-2 border border-line-strong py-3 font-mono text-xs uppercase tracking-[0.12em] text-ink-dim hover:border-ink-dim hover:text-ink"
              >
                Continue to render
                <ArrowRight size={13} />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function CameraRig({
  span,
  center,
  pendingView,
  onApplied,
  dollhouse = false,
  stacked = false,
}: {
  span: number
  center: [number, number, number]
  pendingView: CamKey | null
  onApplied: () => void
  dollhouse?: boolean
  stacked?: boolean
}) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null
  const [tx, ty, tz] = center

  useEffect(() => {
    if (!pendingView || !controls) return
    const d = span * (stacked ? 1.95 : dollhouse ? 1.7 : 1.65)
    const aim = ty - span * 0.04
    // per-floor: a steep near-aerial 3/4 look-down. stacked: shallower, so the
    // floating storey-trays read as layers rather than hiding behind each other.
    const isoH = stacked ? 0.62 : dollhouse ? 1.15 : 0.46
    const isoR = stacked ? 0.6 : dollhouse ? 0.42 : 0.72
    const isoF = stacked ? 0.74 : dollhouse ? 0.42 : 0.8
    const elev = dollhouse ? 0.55 : 0.05
    const spots: Record<CamKey, [number, number, number]> = {
      front: [tx, aim + d * elev, tz + d],
      rear: [tx, aim + d * elev, tz - d],
      left: [tx - d, aim + d * elev, tz],
      right: [tx + d, aim + d * elev, tz],
      iso: [tx + d * isoR, aim + d * isoH, tz + d * isoF],
      top: [tx + 0.001, ty + d * 2.3, tz + 0.001],
    }
    const [x, y, z] = spots[pendingView]
    camera.position.set(x, y, z)
    controls.target.set(tx, aim, tz)
    controls.update()
    onApplied()
  }, [pendingView, span, tx, ty, tz, camera, controls, onApplied, dollhouse, stacked])

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

function LayerRow({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'flex w-full items-center justify-between px-2 py-2 text-left text-sm',
        on ? 'text-ink' : 'text-ink-faint',
      )}
    >
      {label}
      <span className={cx('h-2 w-2 rounded-full', on ? 'bg-accent' : 'bg-line-strong')} />
    </button>
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
