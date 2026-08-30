import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { ContactShadows, Grid, OrbitControls } from '@react-three/drei'
import { EffectComposer, N8AO } from '@react-three/postprocessing'
import { Camera, Grid3x3 } from 'lucide-react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useStudio } from '@/state/studio.ts'
import { buildMassing, type MassKind, type Massing } from '@/lib/three/buildMassing.ts'
import { cx } from '@/lib/cx.ts'
import { WorkspaceTabs } from '@/components/WorkspaceTabs.tsx'

type Group = 'shell' | 'glazing' | 'slabs' | 'roof' | 'stair'

const GROUP_OF: Record<MassKind, Group> = {
  wall: 'shell',
  parapet: 'shell',
  column: 'shell',
  railing: 'shell',
  glass: 'glazing',
  slab: 'slabs',
  plinth: 'slabs',
  roof: 'roof',
  canopy: 'roof',
  stair: 'stair',
}

const GROUP_MAT: Record<Group, { color: string; roughness: number; metalness?: number; opacity?: number }> = {
  shell: { color: '#e7dfce', roughness: 0.88 },
  glazing: { color: '#2b3134', roughness: 0.15, metalness: 0.1, opacity: 0.85 },
  slabs: { color: '#d7cdb6', roughness: 0.92 },
  roof: { color: '#c6bca3', roughness: 0.95 },
  stair: { color: '#cfc5ac', roughness: 0.9 },
}

const LAYER_TOGGLES: { g: Group; label: string }[] = [
  { g: 'shell', label: 'Walls' },
  { g: 'glazing', label: 'Glazing' },
  { g: 'slabs', label: 'Floor slabs' },
  { g: 'roof', label: 'Roof + canopies' },
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
    requestAnimationFrame(() =>
      gl.domElement.toBlob((blob) => {
        if (!blob) return
        setShots((s) => [...s.filter((x) => x.key !== key), { key, url: URL.createObjectURL(blob) }])
      }, 'image/png'),
    )
  }

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
              shadows
              dpr={[1, 2]}
              gl={{ preserveDrawingBuffer: true, antialias: true }}
              camera={{ fov: 42, near: 0.1, far: span * 40, position: [span * 1.1, span * 0.85, span * 1.1] }}
              onCreated={({ gl }) => {
                glRef.current = gl
              }}
            >
              <color attach="background" args={['#0b0b0c']} />
              <ambientLight intensity={0.55} />
              <hemisphereLight args={['#eae3d0', '#20211c', 0.5]} />
              <directionalLight
                position={[span * 0.6, span * 1.3, span * 0.45]}
                intensity={1.15}
                castShadow
                shadow-mapSize={[2048, 2048]}
                shadow-bias={-0.0005}
                shadow-camera-left={-span}
                shadow-camera-right={span}
                shadow-camera-top={span}
                shadow-camera-bottom={-span}
                shadow-camera-far={span * 6}
              />
              <directionalLight position={[-span, span * 0.6, -span * 0.6]} intensity={0.3} />

              <mesh
                rotation={[-Math.PI / 2, 0, 0]}
                position={[massing.center[0], -0.03, massing.center[2]]}
                receiveShadow
              >
                <planeGeometry args={[massing.bounds.w * 2.4, massing.bounds.d * 2.4]} />
                <meshStandardMaterial color="#16130e" roughness={1} />
              </mesh>
              {showSite && (
                <Grid
                  position={[massing.center[0], 0, massing.center[2]]}
                  args={[span * 2, span * 2]}
                  cellSize={1}
                  cellThickness={0.5}
                  cellColor="#2c2a22"
                  sectionSize={5}
                  sectionThickness={0.8}
                  sectionColor="#3d3a2d"
                  fadeDistance={span * 2.6}
                  fadeStrength={2}
                />
              )}

              <MergedModel massing={massing} explode={explode} hidden={hidden} />

              <ContactShadows
                position={[massing.center[0], 0.015, massing.center[2]]}
                scale={span * 1.8}
                far={span * 0.9}
                opacity={0.55}
                blur={2}
                resolution={1024}
                color="#000000"
              />

              <EffectComposer enableNormalPass multisampling={4}>
                <N8AO aoRadius={1.1} intensity={2} distanceFalloff={0.6} halfRes />
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
              <p className="text-[0.7rem] text-ink-faint">Locked camera captures feed the concept-render step.</p>
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

function MergedModel({ massing, explode, hidden }: { massing: Massing; explode: number; hidden: Set<Group> }) {
  const lift = explode * massing.floorHeight * 1.6

  const groups = useMemo(() => {
    const byGroup = new Map<Group, THREE.BufferGeometry[]>()
    for (const b of massing.boxes) {
      const g = GROUP_OF[b.kind]
      if (hidden.has(g)) continue
      const geo = new THREE.BoxGeometry(b.size[0], b.size[1], b.size[2])
      geo.translate(b.pos[0], b.pos[1] + b.level * lift, b.pos[2])
      if (!byGroup.has(g)) byGroup.set(g, [])
      byGroup.get(g)!.push(geo)
    }
    const merged: { g: Group; geo: THREE.BufferGeometry }[] = []
    for (const [g, list] of byGroup) {
      const m = mergeGeometries(list, false)
      list.forEach((x) => x.dispose())
      if (m) merged.push({ g, geo: m })
    }
    return merged
  }, [massing, hidden, lift])

  useEffect(() => () => groups.forEach((x) => x.geo.dispose()), [groups])

  return (
    <group>
      {groups.map(({ g, geo }) => {
        const mat = GROUP_MAT[g]
        return (
          <mesh key={g} geometry={geo} castShadow receiveShadow>
            <meshStandardMaterial
              color={mat.color}
              roughness={mat.roughness}
              metalness={mat.metalness ?? 0}
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
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null
  const [tx, ty, tz] = center

  useEffect(() => {
    if (!pendingView || !controls) return
    const d = span * 1.25
    const spots: Record<CamKey, [number, number, number]> = {
      front: [tx, ty + d * 0.15, tz + d],
      rear: [tx, ty + d * 0.15, tz - d],
      left: [tx - d, ty + d * 0.15, tz],
      right: [tx + d, ty + d * 0.15, tz],
      iso: [tx + d * 0.8, ty + d * 0.65, tz + d * 0.8],
      top: [tx + 0.001, ty + d * 1.8, tz + 0.001],
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
