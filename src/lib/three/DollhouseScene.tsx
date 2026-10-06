import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Lightformer } from '@react-three/drei'
import type { Dollhouse, DollMat } from './buildDollhouse.ts'
import type { Look } from './dressRoom.ts'
import { separateCoplanar } from './separateCoplanar.ts'

/* ------------------------------------------------------------------ *
 *  DollhouseScene — the furnished cut-away, warm and soft. Walls are
 *  already trimmed to ~1.15 m in buildDollhouse, so nothing to cut
 *  here; just merge by material and light it like a model shoot.
 * ------------------------------------------------------------------ */

type Mat = { color: string; roughness: number; metalness?: number; emissive?: string; emissiveIntensity?: number }

const PALETTE: Record<DollMat, Mat> = {
  wall: { color: '#f0eae0', roughness: 0.96 },
  door: { color: '#6f4a2e', roughness: 0.55 },
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

type Group = { key: string; mat: DollMat; look?: Look; geo: THREE.BufferGeometry }

const UNIT = {
  box: () => new THREE.BoxGeometry(1, 1, 1),
  cyl: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 28),
  ball: () => new THREE.SphereGeometry(0.5, 18, 12),
}

/** texture coordinates in world metres, one unit per tile, so every floor and wall shows its tiles at their real size */
function worldUV(geo: THREE.BufferGeometry, tileM: number) {
  const pos = geo.getAttribute('position'), nor = geo.getAttribute('normal'), uv = geo.getAttribute('uv')
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i))
    if (ny >= nx && ny >= nz) uv.setXY(i, x / tileM, z / tileM)
    else if (nz >= nx) uv.setXY(i, x / tileM, y / tileM)
    else uv.setXY(i, z / tileM, y / tileM)
  }
  uv.needsUpdate = true
}

export function DollhouseModel({ doll }: { doll: Dollhouse }) {
  const merged = useMemo(() => {
    const groups = new Map<string, { mat: DollMat; look?: Look; list: THREE.BufferGeometry[] }>()
    for (const b of doll.boxes) {
      const key = b.look ? JSON.stringify(b.look) : `mat:${b.mat}`
      // the 360 renderer's bevels: upholstery, bedding and fitted pieces have softened edges, not knife-sharp boxes
      const radius = Math.min(b.bevel ?? 0, Math.min(...b.size) / 2 - 0.001)
      let geo: THREE.BufferGeometry
      if ((b.shape ?? 'box') === 'box' && radius >= 0.006) geo = new RoundedBoxGeometry(b.size[0], b.size[1], b.size[2], 2, radius)
      else {
        geo = UNIT[b.shape ?? 'box']()
        geo.scale(b.size[0], b.size[1], b.size[2])
      }
      if (b.rot) geo.rotateY(b.rot)
      geo.translate(b.pos[0], b.pos[1], b.pos[2])
      if (b.look?.surface) worldUV(geo, b.look.surface.tileM)
      if (!groups.has(key)) groups.set(key, { mat: b.mat, look: b.look, list: [] })
      groups.get(key)!.list.push(geo)
    }
    const out: Group[] = []
    for (const [key, { mat, look, list: parts }] of groups) {
      // merging needs one layout: rounded boxes are unindexed, so a mixed group is unindexed throughout
      const list = parts.some((g) => !g.index) ? parts.map((g) => (g.index ? g.toNonIndexed() : g)) : parts
      if (list !== parts) parts.forEach((g) => g.index && g.dispose())
      const mg = mergeGeometries(list, false)
      list.forEach((x) => x.dispose())
      if (mg) out.push({ key, mat, look, geo: mg })
    }
    // two surfaces in one plane (overlapping room floors, a paint skin meeting a tile skin, glass on a frame) fight for
    // the same depth and flicker as the view turns: the lesser one steps back 1.5 mm
    const holder = new THREE.Group()
    const meshes = out.map((o) => {
      const mesh = new THREE.Mesh(o.geo)
      mesh.name = o.mat === 'wall' && !o.look ? 'wall' : o.mat === 'floor' ? 'slab' : o.mat
      holder.add(mesh)
      return mesh
    })
    separateCoplanar(holder)
    meshes.forEach((mesh, i) => {
      if (mesh.geometry !== out[i].geo) {
        out[i].geo.dispose()
        out[i].geo = mesh.geometry
      }
    })
    return out
  }, [doll])

  useEffect(() => () => merged.forEach((x) => x.geo.dispose()), [merged])

  return <group>{merged.map((g) => <DollMesh key={g.key} group={g} />)}</group>
}

function DollMesh({ group: { mat, look, geo } }: { group: Group }) {
  const map = useSurfaceMap(look)
  if (!look) {
    const p = PALETTE[mat]
    return (
      <mesh geometry={geo} castShadow receiveShadow>
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
  }
  const see = look.opacity !== undefined && look.opacity < 1
  return (
    <mesh geometry={geo} castShadow={!see && !look.emissive} receiveShadow>
      <meshStandardMaterial
        key={map ? map.uuid : 'plain'}
        color={map ? '#ffffff' : look.color}
        map={map ?? null}
        roughness={look.rough}
        metalness={look.metal ?? 0}
        emissive={look.emissive ?? '#000000'}
        emissiveIntensity={look.glow ?? 0}
        transparent={see}
        opacity={look.opacity ?? 1}
        depthWrite={!see}
      />
    </mesh>
  )
}

/** a surface at real size: the product's own photograph when the catalogue has one, else its pattern drawn in its colour */
function useSurfaceMap(look?: Look) {
  const invalidate = useThree((s) => s.invalidate)
  const maxAniso = useThree((s) => s.gl.capabilities.getMaxAnisotropy())
  const surface = look?.surface
  const drawn = useMemo(() => (surface ? patternTexture(surface.pattern, look!.color, maxAniso) : null), [surface?.pattern, look?.color, maxAniso]) // eslint-disable-line react-hooks/exhaustive-deps
  const [photo, setPhoto] = useState<THREE.Texture | null>(null)
  const image = surface?.image
  useEffect(() => {
    setPhoto(null)
    if (!image) return
    let live = true
    const texture = new THREE.TextureLoader().load(image, () => {
      if (!live) return texture.dispose()
      setPhoto(texture)
      invalidate()
    })
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.anisotropy = maxAniso
    return () => {
      live = false
      texture.dispose()
    }
  }, [image, invalidate, maxAniso])
  useEffect(() => () => drawn?.dispose(), [drawn])
  return photo ?? drawn
}

/** one tile of the pattern, with its joints, as a repeating texture */
function patternTexture(pattern: string, color: string, aniso: number) {
  const n = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = n
  const g = canvas.getContext('2d')!
  const base = new THREE.Color(color)
  const tone = (k: number) => `#${base.clone().multiplyScalar(k).getHexString()}`
  g.fillStyle = color
  g.fillRect(0, 0, n, n)
  g.fillStyle = tone(0.62)
  if (pattern === 'plank') {
    // four boards across, staggered end joints, a little variation board to board
    for (let i = 0; i < 4; i++) {
      g.fillStyle = tone([1, 0.93, 1.05, 0.96][i])
      g.fillRect(0, (i * n) / 4, n, n / 4)
      g.fillStyle = tone(0.7)
      g.fillRect(0, (i * n) / 4, n, 2)
      g.fillRect(((i * 0.37) % 1) * n, (i * n) / 4, 2, n / 4)
    }
  } else if (pattern === 'subway') {
    for (let r = 0; r < 8; r++) {
      g.fillRect(0, (r * n) / 8, n, 2)
      for (let c = 0; c < 4; c++) g.fillRect(((c + (r % 2) * 0.5) * n) / 4, (r * n) / 8, 2, n / 8)
    }
  } else if (pattern === 'mosaic') {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      g.fillStyle = tone(0.9 + 0.2 * (((r * 7 + c * 13) % 5) / 4))
      g.fillRect((c * n) / 8 + 1, (r * n) / 8 + 1, n / 8 - 2, n / 8 - 2)
    }
  } else {
    // tiles and large-format slabs: one joint at the tile edge
    g.fillRect(0, 0, n, pattern === 'large' ? 1 : 3)
    g.fillRect(0, 0, pattern === 'large' ? 1 : 3, n)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = aniso
  return texture
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
