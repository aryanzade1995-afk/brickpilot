import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import type { SolarLayoutV2, SolarConfiguration } from '../model/solar.ts'
import type { SolarRoofModel } from '../solar/roofModel.ts'
import { solarInstanceData, solarReservationLines, createPhotovoltaicTexture } from './solarGeometry.ts'

export function SolarLayer({ layout, roof, reservedAreas, selectedIds, onSelect }: {
  layout: SolarLayoutV2 | null; roof: SolarRoofModel; reservedAreas: SolarConfiguration['inputs']['reservedAreas']
  selectedIds: Set<string>; onSelect: (id: string) => void
}) {
  const frame = useRef<THREE.InstancedMesh>(null), face = useRef<THREE.InstancedMesh>(null), support = useRef<THREE.InstancedMesh>(null)
  const invalidate = useThree(s => s.invalidate)
  const texture = useMemo(() => createPhotovoltaicTexture(), [])
  const data = useMemo(() => layout ? solarInstanceData(layout) : { frames: [], faces: [], supports: [] }, [layout])
  const lines = useMemo(() => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(solarReservationLines(reservedAreas, roof), 3))
    return geometry
  }, [reservedAreas, roof])
  useEffect(() => () => texture.dispose(), [texture])
  useEffect(() => () => lines.dispose(), [lines])
  useLayoutEffect(() => {
    for (const [mesh, matrices] of [[frame.current, data.frames], [face.current, data.faces], [support.current, data.supports]] as const) {
      if (!mesh) continue
      matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix))
      mesh.count = matrices.length; mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingBox(); mesh.computeBoundingSphere()
    }
    if (frame.current) {
      layout?.panels.forEach((p, i) => frame.current!.setColorAt(i, new THREE.Color(selectedIds.has(p.id) ? '#c39a55' : '#a5adb5')))
      if (frame.current.instanceColor) frame.current.instanceColor.needsUpdate = true
    }
    invalidate()
  }, [data, layout, selectedIds, invalidate])
  const select = (e: ThreeEvent<MouseEvent>) => {
    if (e.instanceId === undefined || !layout?.panels[e.instanceId]) return
    e.stopPropagation(); onSelect(layout.panels[e.instanceId].id)
  }
  return <group name="Canonical_Rooftop_PV" userData={{ solarLayer: true }}>
    {layout && <>
      <instancedMesh name="PV_Module_Frames" ref={frame} args={[undefined, undefined, Math.max(1, data.frames.length)]} onClick={select} castShadow>
        <boxGeometry args={[1, 1, 1]}/><meshStandardMaterial color="#ffffff" roughness={.45} metalness={.65}/>
      </instancedMesh>
      <instancedMesh name="PV_Photovoltaic_Faces" ref={face} args={[undefined, undefined, Math.max(1, data.faces.length)]} onClick={select}>
        <planeGeometry args={[1, 1]}/><meshStandardMaterial map={texture} color="#ffffff" roughness={.34} metalness={.25}/>
      </instancedMesh>
      <instancedMesh name="PV_Mounting_Supports" ref={support} args={[undefined, undefined, Math.max(1, data.supports.length)]} castShadow>
        <boxGeometry args={[1, 1, 1]}/><meshStandardMaterial color="#6d747c" roughness={.65} metalness={.55}/>
      </instancedMesh>
    </>}
    <lineSegments name="Solar_KeepFree_Boundaries" geometry={lines} renderOrder={2}>
      <lineBasicMaterial color="#b58131" depthTest={false} toneMapped={false}/>
    </lineSegments>
  </group>
}
