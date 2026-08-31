import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { ContactShadows } from '@react-three/drei'
import type { Massing } from './buildMassing.ts'
import { hipRoofGeometry } from './hipRoof.ts'
import { GROUP_OF, CUTAWAY_WALL, type Group } from './massingGroups.ts'
import { THEMES, type Character, type TreeStyle } from '@/lib/model/themes.ts'

/** trunk + canopy geometry for one stylised tree, at the origin. All primitives
 *  are indexed so they merge cleanly with the rest of their material group. */
function treeParts(style: TreeStyle, r: number, h: number): {
  trunk: THREE.BufferGeometry
  canopy: THREE.BufferGeometry
} {
  const trunkH = style === 'palm' ? h * 0.74 : h * 0.44
  const trunkR = style === 'palm' ? 0.09 : 0.13
  const trunk = new THREE.CylinderGeometry(trunkR * 0.8, trunkR, trunkH, 5)
  trunk.translate(0, trunkH / 2, 0)

  let canopy: THREE.BufferGeometry
  if (style === 'clipped') {
    const cH = Math.max(h - trunkH, 0.8)
    canopy = new THREE.BoxGeometry(r * 1.25, cH, r * 1.25)
    canopy.translate(0, trunkH + cH / 2, 0)
  } else if (style === 'palm') {
    canopy = new THREE.SphereGeometry(r, 6, 4)
    canopy.scale(1.15, 0.42, 1.15)
    canopy.translate(0, h - r * 0.25, 0)
  } else {
    const a = new THREE.SphereGeometry(r, 6, 5)
    a.translate(0, trunkH + r * 0.75, 0)
    const b = new THREE.SphereGeometry(r * 0.72, 6, 5)
    b.translate(r * 0.28, trunkH + r * 1.6, 0)
    canopy = mergeGeometries([a, b], false) ?? a
    a.dispose()
    b.dispose()
  }
  return { trunk, canopy }
}

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

  const { merged, hips } = useMemo(() => {
    const byGroup = new Map<Group, THREE.BufferGeometry[]>()
    const hipMeshes: { key: string; geo: THREE.BufferGeometry; pos: [number, number, number] }[] = []

    for (const b of massing.boxes) {
      const g = GROUP_OF[b.kind]
      if (hidden.has(g)) continue

      const [w, sh, d] = b.size
      let h = sh
      let cy = b.pos[1] + b.level * lift

      if (cutaway) {
        if (
          b.kind === 'roof' ||
          b.kind === 'parapet' ||
          b.kind === 'canopy' ||
          b.kind === 'glass' ||
          b.kind === 'railing' ||
          b.kind === 'planter'
        )
          continue
        if (b.kind === 'stair') {
          const floorBase = massing.floors.find((f) => f.level === b.level)?.baseY ?? 0
          if (b.pos[1] - sh / 2 - floorBase > massing.floorHeight * 0.5) continue
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

      if (b.shape === 'hip') {
        // hipRoofGeometry has its eave base at local y = 0, so drop the mesh
        // from the box centre to the box bottom
        hipMeshes.push({
          key: b.id,
          geo: hipRoofGeometry(w, h, d, b.ridgeAxis ?? 'x'),
          pos: [b.pos[0], cy - h / 2, b.pos[2]],
        })
        continue
      }

      if (b.shape === 'tree') {
        const { trunk, canopy } = treeParts(b.treeStyle ?? 'canopy', w / 2, h)
        trunk.translate(b.pos[0], b.pos[1], b.pos[2])
        canopy.translate(b.pos[0], b.pos[1], b.pos[2])
        if (!byGroup.has('trunk')) byGroup.set('trunk', [])
        if (!byGroup.has('greenery')) byGroup.set('greenery', [])
        byGroup.get('trunk')!.push(trunk)
        byGroup.get('greenery')!.push(canopy)
        continue
      }

      const geo = new THREE.BoxGeometry(w, h, d)
      geo.translate(b.pos[0], cy, b.pos[2])
      if (!byGroup.has(g)) byGroup.set(g, [])
      byGroup.get(g)!.push(geo)
    }

    const out: { g: Group; geo: THREE.BufferGeometry }[] = []
    for (const [g, list] of byGroup) {
      const m = mergeGeometries(list, false)
      list.forEach((x) => x.dispose())
      if (m) out.push({ g, geo: m })
    }
    return { merged: out, hips: hipMeshes }
  }, [massing, hidden, lift, cutaway])

  useEffect(
    () => () => {
      merged.forEach((x) => x.geo.dispose())
      hips.forEach((x) => x.geo.dispose())
    },
    [merged, hips],
  )

  const roofMat = mat.roof

  return (
    <group>
      {merged.map(({ g, geo }) => (
        <mesh key={g} geometry={geo} castShadow receiveShadow>
          <meshStandardMaterial color={mat[g].color} roughness={mat[g].roughness} metalness={mat[g].metalness ?? 0} />
        </mesh>
      ))}
      {hips.map(({ key, geo, pos }) => (
        <mesh key={key} geometry={geo} position={pos} castShadow receiveShadow>
          <meshStandardMaterial color={roofMat.color} roughness={roofMat.roughness} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  )
}

/** lights + ground + contact shadows — shared by the interactive view and the capture canvas */
export function SceneEnv({ massing, contact = true }: { massing: Massing; contact?: boolean }) {
  const span = Math.max(massing.bounds.w, massing.bounds.d)
  return (
    <>
      <color attach="background" args={['#0b0b0c']} />
      <ambientLight intensity={0.6} />
      <hemisphereLight args={['#f3ead4', '#2a2620', 0.85]} />
      <directionalLight
        position={[
          massing.center[0] + span * 0.7,
          massing.center[1] + span * 1.35,
          massing.center[2] + span * 0.55,
        ]}
        intensity={1.7}
        color="#fff3df"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0003}
        shadow-normalBias={0.03}
        shadow-camera-near={0.5}
        shadow-camera-far={span * 6}
        shadow-camera-left={-span * 1.2}
        shadow-camera-right={span * 1.2}
        shadow-camera-top={span * 1.2}
        shadow-camera-bottom={-span * 1.2}
      />
      <directionalLight
        position={[massing.center[0] - span, massing.center[1] + span * 0.55, massing.center[2] - span * 0.7]}
        intensity={0.45}
        color="#d3dcec"
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[massing.center[0], -0.03, massing.center[2]]} receiveShadow>
        <planeGeometry args={[massing.bounds.w * 8, massing.bounds.d * 8]} />
        <meshStandardMaterial color="#17140f" roughness={1} />
      </mesh>
      {contact && (
        <ContactShadows
          position={[massing.center[0], 0.05, massing.center[2]]}
          scale={span * 2.4}
          far={span}
          opacity={0.42}
          blur={2.6}
          resolution={1024}
          color="#000000"
        />
      )}
    </>
  )
}
