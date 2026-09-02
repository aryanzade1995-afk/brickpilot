import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { RoomMatKey, RoomModel } from './buildRoom.ts'
import { THEMES, type Character } from '@/lib/model/themes.ts'

/* A neutral, evenly-lit shell of one room. Deliberately plain — the AI
 * pass supplies the real materials and mood; this only has to hold the
 * geometry and read cleanly as depth / edges. */

type Mtl = { color: string; roughness: number; metalness: number; emissive?: string; emissiveIntensity?: number }

function palette(character: Character): Record<RoomMatKey, Mtl> {
  const m = THEMES[character].materials
  return {
    wall: { color: m.shell.color, roughness: 0.92, metalness: 0 },
    slab: { color: m.paving.color, roughness: 0.85, metalness: 0 },
    ceil: { color: m.roof.color, roughness: 0.9, metalness: 0 },
    trim: { color: '#f3efe6', roughness: 0.7, metalness: 0 },
    reveal: { color: '#1f1d1b', roughness: 1, metalness: 0 },
    // a window reads as a bright daylight source, never a dark hole
    glass: { color: '#cdd9e6', roughness: 0.2, metalness: 0, emissive: '#e8eef5', emissiveIntensity: 0.55 },
  }
}

export function RoomModelMesh({ model, character }: { model: RoomModel; character: Character }) {
  const mat = useMemo(() => palette(character), [character])

  const merged = useMemo(() => {
    const byMat = new Map<RoomMatKey, THREE.BufferGeometry[]>()
    for (const b of model.boxes) {
      const g = new THREE.BoxGeometry(b.size[0], b.size[1], b.size[2])
      g.translate(b.pos[0], b.pos[1], b.pos[2])
      if (!byMat.has(b.mat)) byMat.set(b.mat, [])
      byMat.get(b.mat)!.push(g)
    }
    const out: { key: RoomMatKey; geo: THREE.BufferGeometry }[] = []
    for (const [key, list] of byMat) {
      const g = mergeGeometries(list, false)
      list.forEach((x) => x.dispose())
      if (g) out.push({ key, geo: g })
    }
    return out
  }, [model])

  useEffect(() => () => merged.forEach((x) => x.geo.dispose()), [merged])

  return (
    <group>
      {merged.map(({ key, geo }) => {
        const m = mat[key]
        return (
          <mesh key={key} geometry={geo} castShadow={key === 'wall'} receiveShadow>
            <meshStandardMaterial
              color={m.color}
              roughness={m.roughness}
              metalness={m.metalness}
              emissive={m.emissive ?? '#000000'}
              emissiveIntensity={m.emissiveIntensity ?? 0}
              side={THREE.FrontSide}
            />
          </mesh>
        )
      })}
    </group>
  )
}

/** even interior light: ambient + hemisphere + a warm shaft from the window wall */
export function RoomEnv({ model }: { model: RoomModel }) {
  const [dx, dy, dz] = model.daylightDir
  const span = Math.max(model.dims.w, model.dims.d)
  return (
    <>
      <color attach="background" args={['#20242a']} />
      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#eef2f7', '#3b352c', 0.5]} />
      <directionalLight
        position={[dx * span * 1.6, 2.0 + dy * span, dz * span * 1.6]}
        intensity={2.1}
        color="#fff2df"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
      />
      {/* soft fill from behind the camera so nothing crushes to black */}
      <directionalLight position={[-dx * span, model.dims.h * 0.9, -dz * span]} intensity={0.5} color="#cdd7e4" />
      <pointLight position={[0, model.dims.h - 0.25, 0]} intensity={0.35} distance={span * 3} color="#fbead2" />
    </>
  )
}
