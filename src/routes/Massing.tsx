import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Canvas, useThree } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import { EffectComposer, N8AO, SMAA } from '@react-three/postprocessing'
import { ArrowRight, Grid3x3 } from 'lucide-react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useStudio } from '@/state/studio.ts'
import { buildMassing } from '@/lib/three/buildMassing.ts'
import { MassingModel, SceneEnv } from '@/lib/three/MassingScene.tsx'
import type { Group } from '@/lib/three/massingGroups.ts'
import { cx } from '@/lib/cx.ts'
import { WorkspaceTabs } from '@/components/WorkspaceTabs.tsx'

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
  useEffect(() => {
    if (!result) run()
  }, [result, run])

  const massing = useMemo(() => (result ? buildMassing(result.design) : null), [result])

  const [explode, setExplode] = useState(0)
  const [hidden, setHidden] = useState<Set<Group>>(new Set())
  const [showSite, setShowSite] = useState(true)
  const [pendingView, setPendingView] = useState<CamKey | null>('iso')

  if (!result || !massing) {
    return <div className="mx-auto max-w-[1400px] px-10 py-24 text-ink-dim">Preparing model…</div>
  }

  const span = Math.max(massing.bounds.w, massing.bounds.d)
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
          <div className="mb-3 flex flex-wrap gap-1">
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
              shadows="soft"
              dpr={[1, 2]}
              gl={{ preserveDrawingBuffer: true, antialias: true }}
              camera={{ fov: 37, near: 0.1, far: span * 40, position: [span * 1.1, span * 0.85, span * 1.1] }}
              onCreated={({ gl }) => {
                gl.toneMapping = THREE.ACESFilmicToneMapping
                gl.toneMappingExposure = 1.12
              }}
            >
              <SceneEnv massing={massing} />
              {showSite && (
                <Grid
                  position={[massing.center[0], -0.01, massing.center[2]]}
                  args={[span * 3, span * 3]}
                  cellSize={1}
                  cellThickness={0.5}
                  cellColor="#2c2921"
                  sectionSize={5}
                  sectionThickness={0.8}
                  sectionColor="#403c30"
                  fadeDistance={span * 3.4}
                  fadeStrength={1.3}
                />
              )}

              <MassingModel massing={massing} explode={explode} hidden={hidden} character={character} />

              <EffectComposer enableNormalPass multisampling={4}>
                <N8AO aoRadius={1.2} intensity={2.4} distanceFalloff={1} halfRes />
                <SMAA />
              </EffectComposer>

              <CameraRig span={span} center={massing.center} pendingView={pendingView} onApplied={() => setPendingView(null)} />
            </Canvas>

            <div className="pointer-events-none absolute bottom-2 left-3 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-ink-faint">
              drag rotate · wheel zoom · right-drag pan
            </div>
          </div>

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
        </div>

        <div className="space-y-6">
          <Panel title="Model">
            <Stat k="Storeys" v={String(massing.stats.storeys)} />
            <Stat k="Height" v={`${massing.stats.heightM} m`} />
            <Stat k="Built area" v={`${massing.stats.builtAreaSqm.toFixed(1)} m²`} />
            <Stat k="Openings" v={String(massing.stats.openings)} />
          </Panel>

          <div className="border border-line">
            <div className="label border-b border-line px-4 py-2.5">Layers</div>
            <div className="p-2">
              {LAYER_TOGGLES.map((l) => (
                <LayerRow key={l.g} label={l.label} on={!hidden.has(l.g)} onClick={() => toggle(l.g)} />
              ))}
              <LayerRow label="Site + grid" on={showSite} onClick={() => setShowSite((v) => !v)} />
            </div>
          </div>

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
    const d = span * 1.3
    const spots: Record<CamKey, [number, number, number]> = {
      front: [tx, ty + d * 0.1, tz + d],
      rear: [tx, ty + d * 0.1, tz - d],
      left: [tx - d, ty + d * 0.1, tz],
      right: [tx + d, ty + d * 0.1, tz],
      iso: [tx + d * 0.78, ty + d * 0.52, tz + d * 0.82],
      top: [tx + 0.001, ty + d * 1.9, tz + 0.001],
    }
    const [x, y, z] = spots[pendingView]
    camera.position.set(x, y, z)
    controls.target.set(tx, ty, tz)
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
