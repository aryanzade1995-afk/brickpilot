import * as THREE from 'three'

/**
 * A hipped roof solid: a rectangular eave (w × d) at y = 0 rising to a ridge at
 * y = rise. The ridge is inset by the short half-span so the hips fall at 45° in
 * plan. When w === d it degenerates cleanly to a pyramid. Fixed vertex math +
 * computeVertexNormals — fully deterministic, no mergeVertices.
 */
export function hipRoofGeometry(
  w: number,
  rise: number,
  d: number,
  ridgeAxis: 'x' | 'z',
): THREE.BufferGeometry {
  const hw = w / 2
  const hd = d / 2
  // eave corners, seen from above: 0 = NW(-x,-z) 1 = NE(+x,-z) 2 = SE(+x,+z) 3 = SW(-x,+z)
  const pos = [-hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd]
  const r0 = 4
  const r1 = 5
  let idx: number[]

  const base = [0, 1, 2, 0, 2, 3] // eave-level base, faces down — closes the solid

  if (ridgeAxis === 'x') {
    const rx = Math.max(hw - hd, 0)
    pos.push(-rx, rise, 0, rx, rise, 0) // r0 = west end, r1 = east end
    idx = [
      0, r1, 1, 0, r0, r1, // north slope
      2, r0, 3, 2, r1, r0, // south slope
      1, r1, 2, // east hip
      3, r0, 0, // west hip
      ...base,
    ]
  } else {
    const rz = Math.max(hd - hw, 0)
    pos.push(0, rise, -rz, 0, rise, rz) // r0 = north end, r1 = south end
    idx = [
      3, r0, 0, 3, r1, r0, // west slope
      2, 1, r0, 2, r0, r1, // east slope
      0, r0, 1, // north hip
      2, r1, 3, // south hip
      ...base,
    ]
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}
