import { useEffect, useMemo } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { buildMassing } from '@/lib/three/buildMassing.ts'
import { MassingModel, SceneEnv } from '@/lib/three/MassingScene.tsx'
import type { Group } from '@/lib/three/massingGroups.ts'
import type { Character } from '@/lib/model/themes.ts'
import type { RefKey } from '@/state/render.ts'
import type { Design } from '@/lib/engine/types.ts'

const NO_HIDE: Set<Group> = new Set()

export type CaptureView = Exclude<RefKey, 'interior'> | 'orbit'

/** the parent finds this canvas with `document.querySelector(MASSING_CANVAS)` */
export const MASSING_CANVAS = '[data-massing-capture] canvas'

/**
 * The verified massing, shown on the render screen. A `view` prop drives the
 * camera (same pattern as the massing page's CameraRig, which works reliably);
 * the parent reads the canvas element back after each locked pose settles.
 */
export function MassingViewport({
  design,
  character,
  view,
}: {
  design: Design
  character: Character
  view: CaptureView
}) {
  const massing = useMemo(() => buildMassing(design), [design])
  // frame the building, not the plot
  const span = Math.max(massing.footprint.w, massing.footprint.d, massing.stats.heightM)

  return (
    <div
      data-massing-capture
      className="relative aspect-[3/2] w-full overflow-hidden border border-line-strong bg-bg-inset"
    >
      <Canvas
        dpr={[1, 2]}
        shadows="soft"
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        camera={{ fov: 36, near: 0.1, far: span * 60, position: [span * 1.3, span * 1.0, span * 1.4] }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.NeutralToneMapping
          gl.toneMappingExposure = 1.32
        }}
      >
        <SceneEnv massing={massing} />
        <MassingModel massing={massing} explode={0} hidden={NO_HIDE} character={character} />
        <ViewRig center={massing.center} span={span} view={view} />
      </Canvas>
      <div className="pointer-events-none absolute bottom-2 left-3 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-ink-faint">
        verified massing · reference source
      </div>
    </div>
  )
}

function ViewRig({
  center,
  span,
  view,
}: {
  center: [number, number, number]
  span: number
  view: CaptureView
}) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null
  const [tx, ty, tz] = center

  useEffect(() => {
    if (view === 'orbit') {
      if (controls) controls.enabled = true
      return
    }
    const d = span * 1.35
    // aim a little above the storey mid-point so the roof stays in frame
    const aimY = ty + span * 0.18
    const spots: Record<Exclude<CaptureView, 'orbit'>, [number, number, number]> = {
      front: [tx, aimY + d * 0.05, tz + d],
      collage: [tx + d * 0.72, aimY + d * 0.5, tz + d * 0.72],
      top: [tx + 0.001, ty + d * 2.4, tz + 0.001],
    }
    const [x, y, z] = spots[view]
    camera.position.set(x, y, z)
    camera.up.set(0, 1, 0)
    camera.lookAt(tx, aimY, tz)
    camera.updateProjectionMatrix()
    if (controls) {
      controls.enabled = false
      controls.target.set(tx, aimY, tz)
      controls.update()
    }
  }, [view, camera, controls, span, tx, ty, tz])

  return (
    <OrbitControls
      makeDefault
      enableDamping
      dampingFactor={0.12}
      minDistance={span * 0.4}
      maxDistance={span * 6}
      maxPolarAngle={Math.PI / 2.05}
    />
  )
}
