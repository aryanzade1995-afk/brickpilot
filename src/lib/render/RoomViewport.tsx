import { useEffect, useMemo, type MutableRefObject } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { buildRoom, type RoomModel } from '@/lib/three/buildRoom.ts'
import { RoomEnv, RoomModelMesh } from '@/lib/three/RoomScene.tsx'
import type { Character } from '@/lib/model/themes.ts'
import type { Design } from '@/lib/engine/types.ts'

export const CAP_W = 1024
export const CAP_H = 768

export type CaptureMaps = { beauty: string; depth: string; edge: string }
/** one CaptureMaps per camera pose in the room (2 different POVs) */
export type RoomCaptureHandle = { capture: () => CaptureMaps[] | null }

const DEPTH_NEAR = 0.2
const DEPTH_FAR = 9.0

function depthMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uNear: { value: DEPTH_NEAR }, uFar: { value: DEPTH_FAR } },
    vertexShader: `
      varying float vViewZ;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewZ = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vViewZ;
      uniform float uNear;
      uniform float uFar;
      void main() {
        float d = clamp((vViewZ - uNear) / (uFar - uNear), 0.0, 1.0);
        float v = 1.0 - d;
        gl_FragColor = vec4(v, v, v, 1.0);
      }`,
  })
}

/** Sobel on the (bottom-up) RGBA buffer of the normal pass → white lines on black. */
function sobelToDataURL(buf: Uint8Array, w: number, h: number): string {
  const lum = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sy = h - 1 - y // flip: WebGL readPixels is bottom-up
      const i = (sy * w + x) * 4
      lum[y * w + x] = 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2]
    }
  }
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')!
  const img = ctx.createImageData(w, h)
  const at = (x: number, y: number) => lum[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx =
        -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) +
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)
      const gy =
        -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) +
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)
      const g = Math.min(255, Math.hypot(gx, gy))
      const v = g > 36 ? 255 : 0 // threshold to crisp lines
      const o = (y * w + x) * 4
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v
      img.data[o + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return out.toDataURL('image/png')
}

function Capturer({
  handleRef,
  model,
}: {
  handleRef: MutableRefObject<RoomCaptureHandle | null>
  model: RoomModel
}) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera

  useEffect(() => {
    handleRef.current = {
      capture: () => {
        const cvs = gl.domElement as HTMLCanvasElement
        const prevSize = new THREE.Vector2()
        gl.getSize(prevSize)
        const prevTone = gl.toneMapping
        const prevAspect = camera.aspect
        const prevFov = camera.fov
        const prevPos = camera.position.clone()
        const prevQuat = camera.quaternion.clone()

        // one capture pass (beauty + depth + edge) from wherever the camera sits now
        const pass = (): CaptureMaps => {
          // 1 — beauty (tone-mapped, lit)
          gl.render(scene, camera)
          const beauty = cvs.toDataURL('image/png')

          // 2 — linear depth, no tone mapping
          gl.toneMapping = THREE.NoToneMapping
          const dm = depthMaterial()
          scene.overrideMaterial = dm
          gl.render(scene, camera)
          const depth = cvs.toDataURL('image/png')

          // 3 — surface normals → Sobel edge map
          const nm = new THREE.MeshNormalMaterial()
          scene.overrideMaterial = nm
          gl.render(scene, camera)
          const ctx = gl.getContext()
          const px = new Uint8Array(CAP_W * CAP_H * 4)
          ctx.readPixels(0, 0, CAP_W, CAP_H, ctx.RGBA, ctx.UNSIGNED_BYTE, px)
          const edge = sobelToDataURL(px, CAP_W, CAP_H)

          scene.overrideMaterial = null
          gl.toneMapping = prevTone
          dm.dispose()
          nm.dispose()
          return { beauty, depth, edge }
        }

        try {
          gl.setSize(CAP_W, CAP_H, false)
          camera.aspect = CAP_W / CAP_H

          const poses = model.cameras.length ? model.cameras : [model.camera]
          const out: CaptureMaps[] = []
          for (const pose of poses) {
            camera.position.set(...pose.position)
            camera.fov = pose.fov
            camera.updateProjectionMatrix()
            camera.lookAt(...pose.target)
            out.push(pass())
          }
          return out
        } catch {
          scene.overrideMaterial = null
          return null
        } finally {
          gl.toneMapping = prevTone
          camera.aspect = prevAspect
          camera.fov = prevFov
          camera.position.copy(prevPos)
          camera.quaternion.copy(prevQuat)
          camera.updateProjectionMatrix()
          gl.setSize(prevSize.x, prevSize.y, false)
          gl.render(scene, camera)
        }
      },
    }
    return () => {
      handleRef.current = null
    }
  }, [gl, scene, camera, handleRef, model])

  return null
}

function Rig({ model }: { model: RoomModel }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const controls = useThree((s) => s.controls) as { target: THREE.Vector3; update: () => void } | null
  useEffect(() => {
    const [px, py, pz] = model.camera.position
    const [tx, ty, tz] = model.camera.target
    camera.position.set(px, py, pz)
    camera.fov = model.camera.fov
    camera.near = 0.05
    camera.far = 60
    camera.updateProjectionMatrix()
    camera.lookAt(tx, ty, tz)
    if (controls) {
      controls.target.set(tx, ty, tz)
      controls.update()
    }
  }, [model, camera, controls])
  return null
}

export function RoomViewport({
  design,
  floorLevel,
  roomId,
  character,
  captureRef,
  onModel,
}: {
  design: Design
  floorLevel: number
  roomId: string
  character: Character
  captureRef: MutableRefObject<RoomCaptureHandle | null>
  onModel?: (m: RoomModel | null) => void
}) {
  const model = useMemo(
    () => buildRoom(design, floorLevel, roomId, character),
    [design, floorLevel, roomId, character],
  )
  useEffect(() => {
    onModel?.(model)
  }, [model, onModel])

  if (!model) {
    return (
      <div className="flex aspect-[4/3] w-full items-center justify-center border border-line-strong bg-bg-inset text-sm text-ink-faint">
        Select an enclosed room
      </div>
    )
  }

  return (
    <div data-room-capture className="relative aspect-[4/3] w-full overflow-hidden border border-line-strong bg-bg-inset">
      <Canvas
        dpr={[1, 2]}
        shadows
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        camera={{ fov: model.camera.fov, near: 0.05, far: 60, position: model.camera.position }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.NeutralToneMapping
          gl.toneMappingExposure = 1.15
        }}
      >
        <RoomEnv model={model} />
        <RoomModelMesh model={model} character={character} />
        <OrbitControls makeDefault enableDamping dampingFactor={0.12} target={model.camera.target} />
        <Rig model={model} />
        <Capturer handleRef={captureRef} model={model} />
      </Canvas>
      <div className="pointer-events-none absolute bottom-2 left-3 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-ink-faint">
        {model.name} · {model.dims.w.toFixed(1)} × {model.dims.d.toFixed(1)} m · drag to look around
      </div>
    </div>
  )
}
