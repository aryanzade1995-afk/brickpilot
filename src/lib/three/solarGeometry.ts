import * as THREE from 'three'
import type { SolarLayoutV2, SolarPanelPlacement, SolarConfiguration } from '../model/solar.ts'
import type { SolarRoofModel } from '../solar/roofModel.ts'
import { planToThreeGlb } from '../solar/coordinates.ts'

const point = (p: { x: number; y: number; z: number }) => { const w = planToThreeGlb(p); return new THREE.Vector3(w.x, w.y, w.z) }
/** Matches all eight corners of solarPanelGeometry, including tilt, thickness and real roof height. */
export function solarPanelWorldMatrix(panel: SolarPanelPlacement, face = false) {
  const a = panel.azimuthDeg * Math.PI / 180, t = panel.tiltDeg * Math.PI / 180
  const u = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a))
  const upslope = new THREE.Vector3(-Math.sin(a) * Math.cos(t), Math.sin(t), -Math.cos(a) * Math.cos(t))
  const normal = new THREE.Vector3(Math.sin(a) * Math.sin(t), Math.cos(t), Math.cos(a) * Math.sin(t))
  const center = point(panel.positionMm)
  if (face) center.addScaledVector(normal, panel.dimensionsMm.thickness / 2000 + .002)
  return new THREE.Matrix4().makeBasis(u, upslope, normal).setPosition(center).scale(new THREE.Vector3(
    Math.max(.001, panel.dimensionsMm.width / 1000 - (face ? .035 : 0)),
    Math.max(.001, panel.dimensionsMm.slopeLength / 1000 - (face ? .035 : 0)), face ? 1 : panel.dimensionsMm.thickness / 1000))
}
export function solarSupportMatrices(panel: SolarPanelPlacement) {
  const a = panel.azimuthDeg * Math.PI / 180, t = panel.tiltDeg * Math.PI / 180
  return [-1, 1].flatMap(x => [-1, 1].map(y => {
    const dx = x * panel.dimensionsMm.width * .36, slope = y * panel.dimensionsMm.slopeLength * .34
    const depth = slope * Math.cos(t) - panel.dimensionsMm.thickness * Math.sin(t) / 2
    const top = panel.positionMm.z - slope * Math.sin(t) - panel.dimensionsMm.thickness * Math.cos(t) / 2
    const height = Math.max(1, top - panel.baseElevationMm)
    const center = point({ x: panel.positionMm.x + Math.cos(a) * dx + Math.sin(a) * depth,
      y: panel.positionMm.y + Math.sin(a) * dx - Math.cos(a) * depth, z: panel.baseElevationMm + height / 2 })
    return new THREE.Matrix4().makeScale(.035, height / 1000, .035).setPosition(center)
  }))
}
export function solarInstanceData(layout: SolarLayoutV2) {
  return { frames: layout.panels.map(p => solarPanelWorldMatrix(p)), faces: layout.panels.map(p => solarPanelWorldMatrix(p, true)),
    supports: layout.panels.flatMap(solarSupportMatrices) }
}
export function solarReservationLines(areas: SolarConfiguration['inputs']['reservedAreas'], roof: SolarRoofModel) {
  const lines: number[] = []
  for (const area of areas) {
    const surface = roof.surfaces.find(s => s.kind === 'flat-top-roof' && s.level === area.level && (!area.roofSurfaceId || s.id === area.roofSurfaceId || s.components.some(c => c.id === area.roofSurfaceId)))
    if (!surface) continue
    const r = area.rectMm, corners = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]]
      .map(([x, y]) => point({ x, y, z: surface.elevationMm + 50 }))
    corners.forEach((p, i) => lines.push(...p.toArray(), ...corners[(i + 1) % 4].toArray()))
  }
  return lines
}
/** One shared mipmapped texture. Cell divisions add no meshes, materials or draw calls. */
export function createPhotovoltaicTexture() {
  const width = 128, height = 256, data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const line = x % 21 === 0 || y % 21 === 0, i = (y * width + x) * 4
    data.set(line ? [40, 51, 62, 255] : [15, 26, 39, 255], i)
  }
  const texture = new THREE.DataTexture(data, width, height)
  texture.colorSpace = THREE.SRGBColorSpace; texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter; texture.needsUpdate = true
  return texture
}
