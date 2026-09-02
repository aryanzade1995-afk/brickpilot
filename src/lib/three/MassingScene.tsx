import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { ContactShadows, Environment, Lightformer } from '@react-three/drei'
import type { Massing, MassKind } from './buildMassing.ts'
import { GROUP_OF, CUTAWAY_WALL, type Group } from './massingGroups.ts'
import { THEMES, type Character } from '@/lib/model/themes.ts'

/** exterior trim + anything sitting on / above the roof — dropped in the cutaway */
const CUTAWAY_SKIP = new Set<MassKind>([
  'roof',
  'parapet',
  'canopy',
  'glass',
  'railing',
  'planter',
  'shade',
  'band',
  'screen',
  'mumty',
  'tank',
  'clad', // window frames + timber cladding — float above the cut wall
  'feature', // the entry pier — a full-height stick once the storeys lift
])

export function MassingModel({
  massing,
  explode,
  hidden,
  character,
}: {
  massing: Massing
  explode: number
  hidden: Set<Group>
  character: Character
}) {
  const mat = THEMES[character].materials
  const lift = explode * massing.floorHeight * 1.7
  const cutaway = explode > 0.04

  const merged = useMemo(() => {
    const byGroup = new Map<Group, THREE.BufferGeometry[]>()

    for (const b of massing.boxes) {
      const g = GROUP_OF[b.kind]
      if (hidden.has(g)) continue

      const [w, sh, d] = b.size
      let h = sh
      let cy = b.pos[1] + b.level * lift

      if (cutaway) {
        if (CUTAWAY_SKIP.has(b.kind)) continue
        if (b.kind === 'stair') {
          // keep the whole flight — the dog-leg belongs to this storey and
          // rises to the floor above; only its geometry lifts with the storey
          cy = b.pos[1] + b.level * lift
        } else if (b.kind === 'wall' || b.kind === 'partition') {
          const floorBase = massing.floors.find((f) => f.level === b.level)?.baseY ?? 0
          const boxBase = b.pos[1] - sh / 2
          const above = boxBase - floorBase
          if (above > CUTAWAY_WALL - 0.05) continue
          h = Math.max(0.06, Math.min(sh, CUTAWAY_WALL - above))
          cy = boxBase + b.level * lift + h / 2
        }
      } else if (g === 'partition') {
        continue
      }

      const geo = new THREE.BoxGeometry(w, h, d)
      geo.translate(b.pos[0], cy, b.pos[2])
      if (!byGroup.has(g)) byGroup.set(g, [])
      byGroup.get(g)!.push(geo)
    }

    const out: { g: Group; geo: THREE.BufferGeometry }[] = []
    for (const [g, list] of byGroup) {
      const mg = mergeGeometries(list, false)
      list.forEach((x) => x.dispose())
      if (mg) out.push({ g, geo: mg })
    }
    return out
  }, [massing, hidden, lift, cutaway])

  useEffect(() => () => merged.forEach((x) => x.geo.dispose()), [merged])

  return (
    <group>
      {merged.map(({ g, geo }) => {
        const mm = mat[g]
        return (
          <mesh key={g} geometry={geo} castShadow receiveShadow>
            <meshStandardMaterial
              color={mm.color}
              roughness={mm.roughness}
              metalness={mm.metalness ?? 0}
              envMapIntensity={mm.env ?? 0.4}
            />
          </mesh>
        )
      })}
    </group>
  )
}

/** lights + sky + ground + reflections — shared by the interactive view and the capture canvas */
export function SceneEnv({ massing, contact = true }: { massing: Massing; contact?: boolean }) {
  const span = Math.max(massing.bounds.w, massing.bounds.d)
  const [cx, , cz] = massing.center
  const sun: [number, number, number] = [cx + span * 0.9, span * 1.55, cz + span * 0.55]

  return (
    <>
      <color attach="background" args={['#1e242c']} />
      <fog attach="fog" args={['#1e242c', span * 6, span * 18]} />

      <hemisphereLight args={['#e6ecf4', '#40392e', 0.7]} />
      <ambientLight intensity={0.24} />

      {/* warm key sun — sharp shadows */}
      <directionalLight
        position={sun}
        intensity={3.1}
        color="#fff0dc"
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-bias={-0.0002}
        shadow-normalBias={0.028}
        shadow-camera-near={0.5}
        shadow-camera-far={span * 8}
        shadow-camera-left={-span * 1.45}
        shadow-camera-right={span * 1.45}
        shadow-camera-top={span * 1.45}
        shadow-camera-bottom={-span * 1.45}
      />
      {/* cool sky fill from the opposite side */}
      <directionalLight
        position={[cx - span, span * 0.8, cz - span * 0.85]}
        intensity={0.9}
        color="#c3d4e6"
      />
      {/* gentle front bounce so the entry facade never goes murky */}
      <directionalLight
        position={[cx, span * 0.5, cz + span * 1.5]}
        intensity={0.4}
        color="#f2e8db"
      />

      {/* soft studio reflections — glass, steel, plaster sheen */}
      <Environment resolution={512} frames={2}>
        <Lightformer
          form="rect"
          intensity={3}
          color="#fff4e6"
          scale={[span * 3.2, span * 1.8, 1]}
          position={[cx, span * 2.2, cz + span * 1.6]}
          rotation={[-Math.PI / 3, 0, 0]}
        />
        <Lightformer
          form="rect"
          intensity={1.5}
          color="#d3e2f4"
          scale={[span * 3, span * 2.4, 1]}
          position={[cx - span * 2.3, span * 1.3, cz - span]}
          rotation={[0, Math.PI / 3, 0]}
        />
        <Lightformer
          form="rect"
          intensity={1}
          color="#eef2f8"
          scale={[span * 5, span * 5, 1]}
          position={[cx, span * 4.4, cz]}
          rotation={[Math.PI / 2, 0, 0]}
        />
        <Lightformer
          form="rect"
          intensity={0.7}
          color="#c7d6ea"
          scale={[span * 3, span * 2, 1]}
          position={[cx + span * 2.4, span * 1.1, cz + span * 0.4]}
          rotation={[0, -Math.PI / 3, 0]}
        />
      </Environment>

      {/* ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, -0.02, cz]} receiveShadow>
        <planeGeometry args={[massing.bounds.w * 12, massing.bounds.d * 12]} />
        <meshStandardMaterial color="#34302a" roughness={0.98} metalness={0} />
      </mesh>
      {contact && (
        <ContactShadows
          position={[cx, 0.06, cz]}
          scale={span * 2.7}
          far={span}
          opacity={0.52}
          blur={2.9}
          resolution={1024}
          color="#000000"
        />
      )}
    </>
  )
}
