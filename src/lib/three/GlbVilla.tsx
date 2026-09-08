/* ------------------------------------------------------------------ *
 *  GlbVilla — renders a baked villa GLB (from the Blender generator).
 *  Preserves the viewer's layer toggles: the GLB keeps Blender
 *  collection names on its nodes (glTF export_extras), so hiding a
 *  layer just walks the tree by name prefix.
 * ------------------------------------------------------------------ */

import { useEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { layerOfNode } from './villaCatalog.ts'

export function GlbVilla({
  url,
  hidden,
  onBounds,
}: {
  url: string
  hidden?: Set<string>
  onBounds?: (b: { center: [number, number, number]; size: number }) => void
}) {
  const gltf = useGLTF(url)

  const scene = useMemo(() => {
    const s = gltf.scene.clone(true)
    s.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true
        o.receiveShadow = true
      }
    })
    return s
  }, [gltf])

  useEffect(() => {
    if (!onBounds) return
    const box = new THREE.Box3().setFromObject(scene)
    const c = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3()).length()
    onBounds({ center: [c.x, c.y, c.z], size })
  }, [scene, onBounds])

  useEffect(() => {
    const hide = hidden ?? new Set<string>()
    scene.traverse((o) => {
      const layer = layerOfNode(o.name)
      if (layer) o.visible = !hide.has(layer)
    })
  }, [scene, hidden])

  return <primitive object={scene} />
}
