import { Mesh, type Object3D, type Plane } from 'three'

/** Hide only explicitly tagged baked services. Geometry, furniture and source
 * bytes remain untouched; traverseVisible physics excludes the stale pipes. */
export function hideBakedPipelines(root: Object3D) {
  root.traverse(o => { if (o.userData.formstead_plumbing) o.visible = false })
}

/** Only the same accepted tank bodies replayed by ResizableRoofTanks. Stands,
 * roof furniture and unrecognised tanks are retained. */
export function hideReplacedRoofTanks(root: Object3D) {
  root.traverse(o => { if (/^Roof_WaterTank_\d+(?:_|$)/.test(o.name)) o.visible = false })
}

/** Applied only to the separate live pipeline layer's owned materials. Never
 * changes house finishes, collision, lighting or prepared building caches. */
export function stylePipelineOverlay(root: Object3D, xray: boolean, plane: Plane | null = null) {
  root.traverse(o => {
    o.userData.formstead_plumbing = true
    if (!(o instanceof Mesh)) return
    o.renderOrder = xray ? 35 : 0
    for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
      material.depthTest = !xray
      material.depthWrite = !xray
      material.clippingPlanes = plane ? [plane] : []
      material.clipShadows = !!plane
      material.needsUpdate = true
    }
  })
}
