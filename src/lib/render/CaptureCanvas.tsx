import { useEffect, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { buildMassing } from '@/lib/three/buildMassing.ts'
import { MassingModel, SceneEnv } from '@/lib/three/MassingScene.tsx'
import type { Group } from '@/lib/three/massingGroups.ts'
import type { Character } from '@/lib/model/themes.ts'
import { useRender, type RefKey } from '@/state/render.ts'
import type { Design } from '@/lib/engine/types.ts'

const NO_HIDE: Set<Group> = new Set()

/**
 * A hidden, fixed 1200×800 canvas that captures three locked camera views of
 * the verified massing as the FRONT / COLLAGE / TOP references. No orbit
 * controls, no postprocessing — a clean deterministic read for the image model.
 * Mount only while `phase === 'capturing'`.
 */
export function CaptureCanvas({ design, character }: { design: Design; character: Character }) {
  const massing = buildMassing(design)

  return (
    <div
      aria-hidden
      style={{ position: 'fixed', left: -10000, top: 0, width: 1200, height: 800, pointerEvents: 'none' }}
    >
      <Canvas
        dpr={1}
        frameloop="demand"
        shadows
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        camera={{ fov: 36, near: 0.1, far: 4000 }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.toneMappingExposure = 1.12
        }}
      >
        <SceneEnv massing={massing} contact={false} />
        <MassingModel massing={massing} explode={0} hidden={NO_HIDE} character={character} />
        <CaptureRig center={massing.center} span={Math.max(massing.bounds.w, massing.bounds.d)} />
      </Canvas>
    </div>
  )
}

const raf = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

function CaptureRig({ center, span }: { center: [number, number, number]; span: number }) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const setRef = useRender((s) => s.setRef)
  const captureFailed = useRender((s) => s.captureFailed)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const [tx, ty, tz] = center
    const target = new THREE.Vector3(tx, ty, tz)
    const d = span * 1.4
    const poses: [Exclude<RefKey, 'interior'>, [number, number, number]][] = [
      ['front', [tx, ty + d * 0.06, tz + d]],
      ['collage', [tx + d * 0.82, ty + d * 0.58, tz + d * 0.82]],
      ['top', [tx + 0.001, ty + d * 2.1, tz + 0.001]],
    ]

    ;(async () => {
      try {
        for (const [key, [x, y, z]] of poses) {
          camera.position.set(x, y, z)
          camera.up.set(0, 1, 0)
          camera.lookAt(target)
          const persp = camera as THREE.PerspectiveCamera
          persp.aspect = 1200 / 800
          persp.updateProjectionMatrix()
          await raf()
          await raf()
          gl.render(scene, camera)
          setRef(key, gl.domElement.toDataURL('image/png'))
        }
      } catch (e) {
        captureFailed(String((e as Error).message))
      }
    })()
  }, [camera, gl, scene, center, span, setRef, captureFailed])

  return null
}
