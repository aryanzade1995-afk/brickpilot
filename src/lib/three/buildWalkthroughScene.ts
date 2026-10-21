import * as THREE from 'three'
import type { WalkthroughScene, SceneRole } from '../walkthrough/sceneTypes.ts'

/** GPU-ready, one-root representation. Every vertex is already in global
 * metres; floor groups have identity transforms, never exploded offsets.
 * This adapter creates no Canvas, controls, animation or architectural data.
 */
export function createWalkthroughSceneGroup(scene: WalkthroughScene) {
  if (scene.status === 'unsupported') throw new Error('Unsupported walkthrough geometry must be reviewed before rendering')
  const group = new THREE.Group(), geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = []
  group.name = 'Formstead_Walkthrough'; group.userData = { sourcePlanId: scene.planId, geometryVersion: scene.version, coordinates: scene.coordinates }
  const colors: Record<SceneRole, string> = { wall: '#eeeae2', slab: '#d5ccba', stair: '#d0c4af', column: '#e3e0d8', beam: '#e3e0d8', parapet: '#eeeae2', glass: '#c6dce4' }
  const floorGroups = new Map<string, THREE.Group>()
  for (const floor of scene.floors) { const item = new THREE.Group(); item.name = floor.id; item.userData = { floorId: floor.sourceId }; group.add(item); floorGroups.set(floor.sourceId, item) }
  for (const floorId of floorGroups.keys()) for (const role of Object.keys(colors) as SceneRole[]) {
    const surfaces = scene.surfaces.filter(s => s.floorId === floorId && s.role === role)
    if (!surfaces.length) continue
    const positions: number[] = [], normals: number[] = [], indices: number[] = []
    const ranges: { surfaceId: string; sourceIds: string[]; start: number; count: number }[] = []
    for (const face of surfaces) {
      const offset = positions.length / 3, start = indices.length
      face.vertices.forEach(p => { positions.push(...p); normals.push(...face.normal) })
      indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3)
      ranges.push({ surfaceId: face.id, sourceIds: [...face.sourceIds], start, count: 6 })
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3)); geometry.setIndex(indices)
    geometry.computeBoundingBox(); geometry.computeBoundingSphere(); geometries.push(geometry)
    const material = new THREE.MeshStandardMaterial({ color: colors[role], roughness: role === 'glass' ? .12 : .8,
      transparent: role === 'glass', opacity: role === 'glass' ? .28 : 1, depthWrite: role !== 'glass', side: role === 'glass' ? THREE.DoubleSide : THREE.FrontSide })
    materials.push(material)
    const mesh = new THREE.Mesh(geometry, material); mesh.name = `${floorId}:${role}`; mesh.castShadow = role !== 'glass'; mesh.receiveShadow = true
    mesh.userData = { sourcePlanId: scene.planId, floorId, role, surfaceRanges: ranges }
    floorGroups.get(floorId)!.add(mesh)
  }
  let disposed = false
  return { group, dispose: () => { if (disposed) return; disposed = true; geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); group.clear() } }
}
