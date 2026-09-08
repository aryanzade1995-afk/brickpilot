import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { ContactShadows, Environment, Lightformer } from '@react-three/drei'
import type { Dollhouse, DollMat } from './buildDollhouse.ts'

/* ------------------------------------------------------------------ *
 *  DollhouseScene — the furnished cut-away, warm and soft. Walls are
 *  already trimmed to ~1.15 m in buildDollhouse, so nothing to cut
 *  here; just merge by material and light it like a model shoot.
 * ------------------------------------------------------------------ */

type Mat = { color: string; roughness: number; metalness?: number; emissive?: string; emissiveIntensity?: number }

const PALETTE: Record<DollMat, Mat> = {
  wall: { color: '#f0eae0', roughness: 0.96 },
  floor: { color: '#c8a878', roughness: 0.72 },
  rug: { color: '#a9835f', roughness: 1 },
  sage: { color: '#93a878', roughness: 0.92 },
  blush: { color: '#d5a093', roughness: 0.9 },
  clay: { color: '#c07f52', roughness: 0.86 },
  cream: { color: '#ece0c8', roughness: 0.92 },
  wood: { color: '#7c5738', roughness: 0.62 },
  panel: { color: '#e2d6bf', roughness: 0.78 },
  stone: { color: '#cbc2ae', roughness: 0.46 },
  metal: { color: '#37373d', roughness: 0.32, metalness: 0.85 },
  ceramic: { color: '#f4f1ea', roughness: 0.26 },
  plant: { color: '#597e3a', roughness: 0.9 },
  art: { color: '#8ba0a6', roughness: 0.8 },
  lamp: { color: '#f6e4ba', roughness: 0.5, emissive: '#f2cf88', emissiveIntensity: 0.6 },
  glass: { color: '#cdd8dc', roughness: 0.08, metalness: 0.1 },
  stair: { color: '#a07c54', roughness: 0.7 },
}

export function DollhouseModel({ doll }: { doll: Dollhouse }) {
  const merged = useMemo(() => {
    const byMat = new Map<DollMat, THREE.BufferGeometry[]>()
    for (const b of doll.boxes) {
      const geo = new THREE.BoxGeometry(b.size[0], b.size[1], b.size[2])
      geo.translate(b.pos[0], b.pos[1], b.pos[2])
      if (!byMat.has(b.mat)) byMat.set(b.mat, [])
      byMat.get(b.mat)!.push(geo)
    }
    const out: { mat: DollMat; geo: THREE.BufferGeometry }[] = []
    for (const [mat, list] of byMat) {
      const mg = mergeGeometries(list, false)
      list.forEach((x) => x.dispose())
      if (mg) out.push({ mat, geo: mg })
    }
    return out
  }, [doll])

  useEffect(() => () => merged.forEach((x) => x.geo.dispose()), [merged])

  return (
    <group>
      {merged.map(({ mat, geo }) => {
        const p = PALETTE[mat]
        return (
          <mesh key={mat} geometry={geo} castShadow receiveShadow>
            <meshStandardMaterial
              color={p.color}
              roughness={p.roughness}
              metalness={p.metalness ?? 0}
              emissive={p.emissive ?? '#000000'}
              emissiveIntensity={p.emissiveIntensity ?? 0}
              transparent={mat === 'glass'}
              opacity={mat === 'glass' ? 0.28 : 1}
            />
          </mesh>
        )
      })}
    </group>
  )
}

export function DollhouseEnv({ doll }: { doll: Dollhouse }) {
  const span = Math.max(doll.footprint.w, doll.footprint.d, doll.stats.storeys * doll.floorHeight)
  const [cx, , cz] = doll.center
  // high and only lightly raked — a soft top light keeps the far rooms from blowing out
  const sun: [number, number, number] = [cx + span * 0.34, span * 2.5, cz + span * 0.26]

  return (
    <>
      <color attach="background" args={['#2a2622']} />
      <fog attach="fog" args={['#2a2622', span * 5, span * 16]} />
      <hemisphereLight args={['#fff4e4', '#3a3026', 0.9]} />
      <ambientLight intensity={0.5} color="#f6ecdc" />
      <directionalLight
        position={sun}
        intensity={1.65}
        color="#ffedd6"
        castShadow
        shadow-mapSize={[3072, 3072]}
        shadow-bias={-0.0002}
        shadow-normalBias={0.03}
        shadow-camera-near={0.5}
        shadow-camera-far={span * 8}
        shadow-camera-left={-span * 1.4}
        shadow-camera-right={span * 1.4}
        shadow-camera-top={span * 1.4}
        shadow-camera-bottom={-span * 1.4}
      />
      <directionalLight position={[cx - span, span * 0.9, cz - span * 0.8]} intensity={1.0} color="#dbe4ef" />
      <directionalLight position={[cx + span * 0.6, span * 0.5, cz + span * 1.4]} intensity={0.7} color="#ffe9cf" />
      <Environment resolution={256} frames={2}>
        <Lightformer form="rect" intensity={2.6} color="#fff2df" scale={[span * 3, span * 2, 1]} position={[cx, span * 2.2, cz + span]} rotation={[-Math.PI / 3, 0, 0]} />
        <Lightformer form="rect" intensity={1.4} color="#e4ecf6" scale={[span * 3, span * 2, 1]} position={[cx - span * 2, span * 1.2, cz]} rotation={[0, Math.PI / 3, 0]} />
        <Lightformer form="rect" intensity={0.9} color="#f2ede4" scale={[span * 5, span * 5, 1]} position={[cx, span * 4, cz]} rotation={[Math.PI / 2, 0, 0]} />
      </Environment>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, -0.02, cz]} receiveShadow>
        <planeGeometry args={[doll.bounds.w * 10, doll.bounds.d * 10]} />
        <meshStandardMaterial color="#403a32" roughness={0.98} />
      </mesh>
      <ContactShadows position={[cx, 0.03, cz]} scale={span * 2.6} far={span} opacity={0.55} blur={2.4} resolution={1024} color="#000000" />
    </>
  )
}
