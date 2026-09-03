import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { ContactShadows, Environment, Lightformer } from '@react-three/drei'
import type { Massing, MassKind, RoofPrism } from './buildMassing.ts'
import { GROUP_OF, CUTAWAY_WALL, type Group } from './massingGroups.ts'
import { THEMES, type Character } from '@/lib/model/themes.ts'

/** exterior trim + anything sitting on / above the roof — dropped in the cutaway */
const CUTAWAY_SKIP = new Set<MassKind>([
  'roof',
  'prism',
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

/**
 * A sloped-roof solid centred at the origin: base at y=-h/2 (the eaves
 * rectangle w×d), ridge / apex at y=+h/2. Built as a flat-shaded triangle soup.
 */
function makePrism(w: number, h: number, d: number, p: RoofPrism): THREE.BufferGeometry {
  const hw = w / 2
  const hh = h / 2
  const hd = d / 2
  const tris: number[] = []
  const quad = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    e: [number, number, number],
  ) => tris.push(...a, ...b, ...c, ...a, ...c, ...e)
  const tri = (a: [number, number, number], b: [number, number, number], c: [number, number, number]) =>
    tris.push(...a, ...b, ...c)

  // shared bottom (eaves) rectangle — faces down
  quad([-hw, -hh, hd], [hw, -hh, hd], [hw, -hh, -hd], [-hw, -hh, -hd])

  if (p.form === 'mono') {
    // low edge on `low`, high edge opposite
    const lowZ = p.low === 'z+' ? hd : -hd
    const lowX = p.low === 'x+' ? hw : -hw
    if (p.ridge === 'x') {
      const zL = lowZ
      const zH = -lowZ
      quad([-hw, hh, zH], [hw, hh, zH], [hw, -hh, zL], [-hw, -hh, zL]) // sloped top
      quad([-hw, -hh, zH], [hw, -hh, zH], [hw, hh, zH], [-hw, hh, zH]) // high wall
      tri([-hw, -hh, zL], [-hw, -hh, zH], [-hw, hh, zH]) // gable-ish ends
      tri([hw, -hh, zH], [hw, -hh, zL], [hw, hh, zH])
    } else {
      const xL = lowX
      const xH = -lowX
      quad([xH, hh, -hd], [xH, hh, hd], [xL, -hh, hd], [xL, -hh, -hd])
      quad([xH, -hh, -hd], [xH, -hh, hd], [xH, hh, hd], [xH, hh, -hd])
      tri([xL, -hh, -hd], [xH, -hh, -hd], [xH, hh, -hd])
      tri([xH, -hh, hd], [xL, -hh, hd], [xH, hh, hd])
    }
  } else if (p.form === 'gable') {
    if (p.ridge === 'x') {
      quad([-hw, hh, 0], [hw, hh, 0], [hw, -hh, hd], [-hw, -hh, hd]) // +z slope
      quad([hw, hh, 0], [-hw, hh, 0], [-hw, -hh, -hd], [hw, -hh, -hd]) // -z slope
      tri([-hw, -hh, -hd], [-hw, -hh, hd], [-hw, hh, 0]) // -x gable
      tri([hw, -hh, hd], [hw, -hh, -hd], [hw, hh, 0]) // +x gable
    } else {
      quad([0, hh, -hd], [0, hh, hd], [hw, -hh, hd], [hw, -hh, -hd])
      quad([0, hh, hd], [0, hh, -hd], [-hw, -hh, -hd], [-hw, -hh, hd])
      tri([-hw, -hh, -hd], [hw, -hh, -hd], [0, hh, -hd])
      tri([hw, -hh, hd], [-hw, -hh, hd], [0, hh, hd])
    }
  } else {
    // hip — the ridge is inset from both ends along the ridge axis
    const inset = p.ridge === 'x' ? Math.min(hw, hd) * 0.55 : Math.min(hw, hd) * 0.55
    if (p.ridge === 'x') {
      const r0: [number, number, number] = [-hw + inset, hh, 0]
      const r1: [number, number, number] = [hw - inset, hh, 0]
      quad(r0, r1, [hw, -hh, hd], [-hw, -hh, hd]) // +z hip plane
      quad(r1, r0, [-hw, -hh, -hd], [hw, -hh, -hd]) // -z hip plane
      tri([-hw, -hh, -hd], [-hw, -hh, hd], r0) // -x hip end
      tri([hw, -hh, hd], [hw, -hh, -hd], r1) // +x hip end
    } else {
      const r0: [number, number, number] = [0, hh, -hd + inset]
      const r1: [number, number, number] = [0, hh, hd - inset]
      quad(r1, r0, [hw, -hh, -hd], [hw, -hh, hd])
      quad(r0, r1, [-hw, -hh, hd], [-hw, -hh, -hd])
      tri([-hw, -hh, -hd], [hw, -hh, -hd], r0)
      tri([hw, -hh, hd], [-hw, -hh, hd], r1)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3))
  const nv = tris.length / 3
  // a matching uv attr + a trivial index so this merges with the (indexed,
  // uv'd) BoxGeometry roof decks in the same group
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(nv * 2), 2))
  geo.setIndex(Array.from({ length: nv }, (_, i) => i))
  geo.computeVertexNormals()
  return geo
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

      const geo =
        b.kind === 'prism' && b.prism ? makePrism(w, h, d, b.prism) : new THREE.BoxGeometry(w, h, d)
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
