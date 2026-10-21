import { translate as translateUi, useLanguage } from '@/lib/i18n/index.ts'
import React, { Component, useEffect, useMemo } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { buildMassing } from '@/lib/three/buildMassing.ts'
import { MassingModel, SceneEnv } from '@/lib/three/MassingScene.tsx'
import type { Group } from '@/lib/three/massingGroups.ts'
import type { Character } from '@/lib/model/themes.ts'
import type { Design } from '@/lib/engine/types.ts'

const NO_HIDE: Set<Group> = new Set()

export type HouseViewAngle = 'collage' | 'front' | 'top' | 'orbit'

interface ErrorBoundaryProps {
  children: React.ReactNode
  fallback: React.ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

class ViewportErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: any) {
    console.warn('3D Viewport error caught, displaying fallback:', error)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback
    }
    return this.props.children
  }
}

export function HouseIdeaViewport({
  design,
  character,
  view = 'collage',
  zoom = 1,
  className = '',
  containerRef,
}: {
  design: Design
  character: Character
  view?: HouseViewAngle
  zoom?: number
  className?: string
  containerRef?: React.RefObject<HTMLDivElement | null>
}) {
  useLanguage((s) => s.language)

  const massing = useMemo(() => {
    try {
      return buildMassing(design)
    } catch (err) {
      console.warn('Failed to build massing:', err)
      return null
    }
  }, [design])

  const bounds = useMemo(() => {
    if (!massing || !massing.boxes.length) {
      return {
        center: [0, 4.5, 0.8] as [number, number, number],
        span: 16.5,
      }
    }
    let minX = Infinity, maxX = -Infinity
    let minY = Infinity, maxY = -Infinity
    let minZ = Infinity, maxZ = -Infinity

    for (const box of massing.boxes) {
      if (box.kind === 'lawn') continue
      const [px, py, pz] = box.pos
      const [sx, sy, sz] = box.size
      minX = Math.min(minX, px - sx / 2)
      maxX = Math.max(maxX, px + sx / 2)
      minY = Math.min(minY, py - sy / 2)
      maxY = Math.max(maxY, py + sy / 2)
      minZ = Math.min(minZ, pz - sz / 2)
      maxZ = Math.max(maxZ, pz + sz / 2)
    }

    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const cz = (minZ + maxZ) / 2

    const sizeX = maxX - minX
    const sizeY = maxY - minY
    const sizeZ = maxZ - minZ

    const span = Math.max(sizeX, sizeZ, Math.sqrt(sizeX * sizeX + sizeZ * sizeZ) * 0.72, sizeY * 1.4)

    return {
      center: [cx, cy, cz] as [number, number, number],
      span,
    }
  }, [massing])

  if (!massing) {
    return (
      <div className="relative aspect-[16/11.5] w-full flex items-center justify-center bg-neutral-100 text-xs text-neutral-500">
        <img
          src="/previews/08-3d-exterior.png"
          alt={translateUi('Architectural Villa Preview')}
          className="h-full w-full object-cover"
        />
      </div>
    )
  }

  const fallbackContent = (
    <div className="relative aspect-[16/11.5] w-full flex items-center justify-center bg-neutral-100 text-xs text-neutral-500">
      <img
        src="/previews/08-3d-exterior.png"
        alt={translateUi('Architectural Villa Preview')}
        className="h-full w-full object-cover"
      />
    </div>
  )

  return (
    <div
      ref={containerRef}
      className={`relative aspect-[16/11.5] w-full overflow-hidden bg-[#1E2224] ${className}`}
    >
      <ViewportErrorBoundary fallback={fallbackContent}>
        <Canvas
          frameloop="demand"
          dpr={[1, 1.5]}
          shadows="soft"
          gl={{ preserveDrawingBuffer: true, antialias: true }}
          camera={{
            fov: 36,
            near: 0.1,
            far: bounds.span * 60,
            position: [bounds.span * 1.3, bounds.span * 1.0, bounds.span * 1.4],
          }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.NeutralToneMapping
            gl.toneMappingExposure = 1.35
          }}
        >
          <SceneEnv massing={massing} />
          <MassingModel
            massing={massing}
            explode={0}
            hidden={NO_HIDE}
            character={character}
          />
          <ViewRig
            center={bounds.center}
            span={bounds.span}
            view={view}
            zoom={zoom}
          />
        </Canvas>
      </ViewportErrorBoundary>
    </div>
  )
}

function ViewRig({
  center,
  span,
  view,
  zoom = 1,
}: {
  center: [number, number, number]
  span: number
  view: HouseViewAngle
  zoom?: number
}) {
  const camera = useThree((s) => s.camera)
  const invalidate = useThree((s) => s.invalidate)
  const controls = useThree((s) => s.controls) as {
    enabled: boolean
    target: THREE.Vector3
    update: () => void
  } | null
  const [tx, ty, tz] = center

  useEffect(() => {
    if (view === 'orbit') {
      if (controls) {
        // OrbitControls is an imperative Three.js controller, not immutable React state.
        // oxlint-disable-next-line react/immutability
        controls.enabled = true
        controls.target.set(tx, ty, tz)
        controls.update()
      }
      invalidate()
      return
    }

    const safeZoom = Math.max(0.6, Math.min(2.5, zoom))
    const d = (span * 1.85) / safeZoom

    const spots: Record<'collage' | 'front' | 'top', [number, number, number]> = {
      front: [tx, ty + d * 0.1, tz + d * 1.1],
      collage: [tx + d * 0.74, ty + d * 0.48, tz + d * 0.74],
      top: [tx + 0.001, ty + d * 1.7, tz + d * 0.3],
    }

    const [x, y, z] = spots[view]
    camera.position.set(x, y, z)
    camera.up.set(0, 1, 0)
    camera.lookAt(tx, ty, tz)
    camera.updateProjectionMatrix()

    if (controls) {
      controls.enabled = false
      controls.target.set(tx, ty, tz)
      controls.update()
    }
    invalidate()
  }, [view, zoom, camera, controls, span, tx, ty, tz, invalidate])

  return (
    <OrbitControls
      makeDefault
      enableDamping
      dampingFactor={0.12}
      minDistance={span * 0.3}
      maxDistance={span * 5}
      maxPolarAngle={Math.PI / 2.05}
    />
  )
}
