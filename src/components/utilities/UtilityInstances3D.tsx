import { useLayoutEffect, useRef } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { Color, InstancedMesh, Object3D } from 'three'
import type { ElectricalPoint3D } from '@/lib/utilities/electrical3D.ts'

export type UtilityInstance3D = { position: ElectricalPoint3D; scale: ElectricalPoint3D; rotation?: ElectricalPoint3D; quaternion?: [number, number, number, number]; color: string; selection: string; faded: boolean }

/** Shared demand-rendered geometry and picking for all utility overlays. */
export function UtilityInstances3D({ items, round = false, sphere = false, onSelect }: { items: UtilityInstance3D[]; round?: boolean; sphere?: boolean; onSelect: (id: string) => void }) {
  const mesh = useRef<InstancedMesh>(null), { invalidate } = useThree()
  useLayoutEffect(() => {
    if (!mesh.current) return
    const dummy = new Object3D(), color = new Color()
    items.forEach((item, index) => {
      dummy.position.set(...item.position); dummy.scale.set(...item.scale)
      if (item.quaternion) dummy.quaternion.set(...item.quaternion)
      else dummy.rotation.set(...(item.rotation ?? [0, 0, 0]))
      dummy.updateMatrix(); mesh.current!.setMatrixAt(index, dummy.matrix)
      color.set(item.color); if (item.faded) color.lerp(new Color('#d3d1cb'), .84)
      mesh.current!.setColorAt(index, color)
    })
    mesh.current.instanceMatrix.needsUpdate = true
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true
    mesh.current.computeBoundingSphere(); invalidate()
  }, [items, invalidate])
  if (!items.length) return null
  const click = (e: ThreeEvent<MouseEvent>) => { const item = items[e.instanceId ?? -1]; if (item) { e.stopPropagation(); onSelect(item.selection) } }
  return <instancedMesh ref={mesh} args={[undefined, undefined, items.length]} onClick={click} frustumCulled={false}>
    {sphere ? <sphereGeometry args={[1, 12, 8]} /> : round ? <cylinderGeometry args={[1, 1, 1, 8]} /> : <boxGeometry args={[1, 1, 1]} />}
    <meshBasicMaterial toneMapped={false} />
  </instancedMesh>
}
