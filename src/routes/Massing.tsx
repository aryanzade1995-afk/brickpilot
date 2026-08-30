import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import { Camera, Grid3x3 } from 'lucide-react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useStudio } from '@/state/studio.ts'
import { buildMassing, type MassBox, type Massing } from '@/lib/three/buildMassing.ts'
import { cx } from '@/lib/cx.ts'
import { WorkspaceTabs } from '@/components/WorkspaceTabs.tsx'

const MAT: Record<MassBox['kind'], { color: string; opacity?: number }> = {
  wall: { color: '#e9e1d0' },
  'floor-slab': { color: '#d8cfba' },
  roof: { color: '#c9bfa6' },
  parapet: { color: '#e4dbc8' },
  canopy: { color: '#d3c9b1' },
  stair: { color: '#c7bda3', opacity: 0.5 },
}

const LAYERS: { key: MassBox['kind'][]; label: string }[] = [
  { key: ['wall'], label: 'Walls' },
  { key: ['floor-slab'], label: 'Floor slabs' },
  { key: ['roof', 'parapet'], label: 'Roof' },
  { key: ['canopy'], label: 'Canopies' },
  { key: ['stair'], label: 'Stair core' },
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
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [showSite, setShowSite] = useState(true)
  const [shots, setShots] = useState<{ key: string; url: string }[]>([])
  const [pendingView, setPendingView] = useState<CamKey | null>('iso')

  const glRef = useRef<THREE.WebGLRenderer | null>(null)

  if (!result || !massing) {
    return <div className="mx-auto max-w-[1400px] px-10 py-24 text-ink-dim">Preparing model…</div>
  }

  const span = Math.max(massing.bounds.w, massing.bounds.d)

  const capture = (key: string) => {
    const gl = glRef.current
    if (!gl) return
    gl.domElement.toBlob((blob) => {
      if (!blob) return
      setShots((s) => [...s.filter((x) => x.key !== key), { key, url: URL.createObjectURL(blob) }])
    }, 'image/png')
  }

  const toggleLayer = (keys: MassBox['kind'][]) =>
    setHidden((h) => {
      const n = new Set(h)
      const anyHidden = keys.some((k) => n.has(k))
      keys.forEach((k) => (anyHidden ? n.delete(k) : n.add(k)))
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
              shadows
              dpr={[1, 2]}
              gl={{ preserveDrawingBuffer: true, antialias: true }}
              camera={{ fov: 40, near: 0.1, far: span * 20, position: [span, span * 0.9, span] }}
              onCreated={({ gl }) => {
                glRef.current = gl
              }}
            >
              <color attach="background" args={['#0b0b0c']} />
              <hemisphereLight args={['#f2ecdc', '#1a1b17', 0.6]} />
              <directionalLight
                position={[span * 0.7, span * 1.4, span * 0.5]}
                intensity={1.6}
                castShadow
                shadow-mapSize={[2048, 2048]}
                shadow-camera-left={-span}
                shadow-camera-right={span}
                shadow-camera-top={span}
                shadow-camera-bottom={-span}
                shadow-camera-far={span * 6}
              />
              <directionalLight position={[-span, span * 0.6, -span * 0.5]} intensity={0.4} />

              <Scene massing={massing} explode={explode} hidden={hidden} />

              {showSite && (
                <>
                  <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]} receiveShadow>
                    <planeGeometry args={[massing.bounds.w * 4, massing.bounds.d * 4]} />
                    <meshStandardMaterial color="#131313" roughness={1} />
                  </mesh>
                  <Grid
                    position={[0, -0.05, 0]}
                    args={[span * 3, span * 3]}
                    cellSize={1}
                    cellThickness={0.6}
                    cellColor="#2b2b2b"
                    sectionSize={5}
                    sectionThickness={1}
                    sectionColor="#3c3c3c"
                    fadeDistance={span * 4}
                    fadeStrength={1.5}
                    infiniteGrid
                  />
                </>
              )}

              <CameraRig
                span={span}
                center={massing.center}
                pendingView={pendingView}
                onApplied={() => setPendingView(null)}
              />
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
              {LAYERS.map((l) => {
                const on = !l.key.some((k) => hidden.has(k))
                return (
                  <LayerRow key={l.label} label={l.label} on={on} onClick={() => toggleLayer(l.key)} />
                )
              })}
              <LayerRow label="Site + grid" on={showSite} onClick={() => setShowSite((v) => !v)} />
            </div>
          </div>

          <div className="border border-line">
            <div className="label flex items-center justify-between border-b border-line px-4 py-2.5">
              Reference captures
              <Grid3x3 size={12} />
            </div>
            <div className="space-y-2 p-4">
              <div className="grid grid-cols-3 gap-2">
                {['front', 'collage', 'top'].map((k) => {
                  const shot = shots.find((s) => s.key === k)
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => capture(k)}
                      className="flex aspect-[3/2] items-center justify-center overflow-hidden border border-line-strong text-ink-faint hover:border-ink-dim"
                    >
                      {shot ? (
                        <img src={shot.url} alt={k} className="h-full w-full object-cover" />
                      ) : (
                        <Camera size={13} />
                      )}
                    </button>
                  )
                })}
              </div>
              <p className="text-[0.7rem] text-ink-faint">
                Locked camera captures feed the concept-render step.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled
            className="w-full border border-line py-3 font-mono text-xs uppercase tracking-[0.12em] text-ink-faint opacity-50"
          >
            Generate concept renders (soon)
          </button>
        </div>
      </div>
    </div>
  )
}

function Scene({ massing, explode, hidden }: { massing: Massing; explode: number; hidden: Set<string> }) {
  const lift = explode * massing.floorHeight * 1.5
  return (
    <group>
      {massing.boxes
        .filter((b) => !hidden.has(b.kind))
        .map((b) => {
          const mat = MAT[b.kind]
          return (
            <mesh
              key={b.id}
              position={[b.pos[0], b.pos[1] + b.level * lift, b.pos[2]]}
              castShadow
              receiveShadow
            >
              <boxGeometry args={b.size} />
              <meshStandardMaterial
                color={mat.color}
                roughness={0.9}
                transparent={mat.opacity != null}
                opacity={mat.opacity ?? 1}
              />
            </mesh>
          )
        })}
    </group>
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
  const controls = useRef<OrbitControlsImpl>(null)
  const camera = useThree((s) => s.camera)
  const [tx, ty, tz] = center

  useEffect(() => {
    if (!pendingView || !controls.current) return
    const d = span * 1.15
    const spots: Record<CamKey, [number, number, number]> = {
      front: [tx, ty, tz + d],
      rear: [tx, ty, tz - d],
      left: [tx - d, ty, tz],
      right: [tx + d, ty, tz],
      iso: [tx + d * 0.8, ty + d * 0.7, tz + d * 0.8],
      top: [tx + 0.001, ty + d * 1.6, tz + 0.001],
    }
    const [x, y, z] = spots[pendingView]
    camera.position.set(x, y, z)
    controls.current.target.set(tx, ty, tz)
    controls.current.update()
    onApplied()
  }, [pendingView, span, tx, ty, tz, camera, onApplied])

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      minDistance={span * 0.4}
      maxDistance={span * 6}
      maxPolarAngle={Math.PI / 2.03}
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
