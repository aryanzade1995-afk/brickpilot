import { useEffect, useLayoutEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { Box3, PerspectiveCamera, Vector3, type Object3D } from 'three'
import type { SolarLayoutV2 } from '../model/solar.ts'
import { solarPanelGeometry } from '../solar/placement.ts'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { SolarRoofModel } from '../solar/roofModel.ts'
import { rectUnionBBox } from '../geometry.ts'
import { planToThreeGlb } from '../solar/coordinates.ts'

export type SolarCameraRequest = { view: 'exterior' | 'terrace' | 'top'; nonce: number } | null
/** Fit only when the cached building/control mounts. No lingering Bounds animation can override a solar preset. */
export function FitAcceptedVilla({ scene }: { scene: Object3D }) {
  const camera = useThree(s => s.camera), controls = useThree(s => s.controls), invalidate = useThree(s => s.invalidate)
  const box = useMemo(() => new Box3().setFromObject(scene), [scene])
  useLayoutEffect(() => {
    if (box.isEmpty()) return
    const center = box.getCenter(new Vector3()), size = box.getSize(new Vector3())
    const aspect = camera instanceof PerspectiveCamera ? camera.aspect : 1
    const distance = Math.max(size.x, size.y, size.z) * 1.9 / Math.min(1, aspect)
    camera.position.copy(center).addScaledVector(new Vector3(1, .8, -1).normalize(), distance)
    // Three.js camera clipping planes are imperative renderer state.
    // eslint-disable-next-line react/immutability
    camera.up.set(0, 1, 0); camera.near = Math.max(.05, distance / 300); camera.far = distance * 30
    camera.lookAt(center); camera.updateProjectionMatrix()
    if (controls) { (controls as OrbitControlsImpl).target.copy(center); (controls as OrbitControlsImpl).update() }
    invalidate()
  }, [box, camera, controls, invalidate])
  return null
}
export function SolarCamera({ request, roof, layout, selectedIds }: { request: SolarCameraRequest; roof: SolarRoofModel; layout: SolarLayoutV2 | null; selectedIds: Set<string> }) {
  const { camera, controls, invalidate } = useThree()
  useEffect(() => {
    if (!request) return
    const top = roof.surfaces.find(s => s.kind === 'flat-top-roof')
    if (!top?.grossRegionsMm.length) return
    let b = rectUnionBBox(top.grossRegionsMm)
    if (request.view === 'terrace' && layout?.panels.length) {
      const panels = layout.panels.filter(p => selectedIds.has(p.id)), points = (panels.length ? panels : layout.panels).flatMap(p => solarPanelGeometry(p, layout.placementPolicy).projectedFootprintMm)
      const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y))
      b = { x, y, w: Math.max(...points.map(p => p.x)) - x, h: Math.max(...points.map(p => p.y)) - y }
    }
    const span = Math.max(request.view === 'terrace' ? 6000 : 1, b.w, b.h) / 1000
    const target = planToThreeGlb({ x: b.x + b.w / 2, y: b.y + b.h / 2, z: request.view === 'exterior' ? top.elevationMm * .45 : top.elevationMm + 600 })
    const orbit = controls as OrbitControlsImpl | undefined
    camera.up.set(0, request.view === 'top' ? 0 : 1, request.view === 'top' ? 1 : 0)
    const distance = span / Math.max(.4, camera instanceof PerspectiveCamera ? camera.aspect : 1)
    if (request.view === 'top') camera.position.set(target.x, target.y + distance * 1.7 + 3, target.z + .001)
    else if (request.view === 'terrace') camera.position.set(target.x + distance * .65, target.y + distance * .85, target.z - distance * .9)
    else camera.position.set(target.x + distance * 1.1, target.y + distance * .85, target.z - distance * 1.2)
    camera.lookAt(target.x, target.y, target.z); camera.updateProjectionMatrix()
    // OrbitControls is an imperative Three.js controller, not immutable React state.
    // eslint-disable-next-line react/immutability
    if (orbit) { orbit.target.set(target.x, target.y, target.z); orbit.enableRotate = request.view !== 'top'; orbit.update() }
    invalidate()
  }, [request, roof, layout, selectedIds, camera, controls, invalidate])
  return null
}
