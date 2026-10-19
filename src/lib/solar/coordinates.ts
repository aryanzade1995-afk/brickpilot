export type PlanPointMm = { x: number; y: number; z: number }
export type WorldPointM = { x: number; y: number; z: number }
function finite(...values: number[]) { if (!values.every(Number.isFinite)) throw new RangeError('Coordinate values must be finite') }
export const normalizeBearing = (degrees: number) => { finite(degrees); return ((degrees % 360) + 360) % 360 }

/** The plan's cardinal labels are local axes, not a surveyed geographic bearing. */
export function trueAzimuthToPlan(azimuthDeg: number, planNorthBearingDeg: number | null): number | null {
  if (planNorthBearingDeg === null) return null
  return normalizeBearing(azimuthDeg - planNorthBearingDeg)
}
export function planAzimuthToTrue(azimuthDeg: number, planNorthBearingDeg: number | null): number | null {
  if (planNorthBearingDeg === null) return null
  return normalizeBearing(azimuthDeg + planNorthBearingDeg)
}
/** Blender: unshifted millimetre plan x/y and elevation -> Z-up metres. */
export function planToBlender(p: PlanPointMm): WorldPointM {
  finite(p.x, p.y, p.z); return { x: p.x / 1000, y: p.y / 1000, z: p.z / 1000 }
}
export function blenderToPlan(p: WorldPointM): PlanPointMm {
  finite(p.x, p.y, p.z); return { x: p.x * 1000, y: p.y * 1000, z: p.z * 1000 }
}
/** Blender's glTF exporter rotates Z-up into Y-up: (x,y,z) -> (x,z,-y).
 * Use this in the accepted GLB viewer, not the separate centred study-model canvas. */
export function planToThreeGlb(p: PlanPointMm): WorldPointM {
  const b = planToBlender(p); return { x: b.x, y: b.z, z: -b.y }
}
export function threeGlbToPlan(p: WorldPointM): PlanPointMm {
  finite(p.x, p.y, p.z); return { x: p.x * 1000, y: -p.z * 1000, z: p.y * 1000 }
}
/** Bearing clockwise from local plan-up: 0=-y, 90=+x. No road-side inference. */
export function planAzimuthDirection(azimuthDeg: number): PlanPointMm {
  const angle = normalizeBearing(azimuthDeg) * Math.PI / 180
  return { x: Math.sin(angle), y: -Math.cos(angle), z: 0 }
}

/** Local true-north frame about the plan origin, not a latitude/longitude projection. */
export function planToTrueNorthFrame(p: PlanPointMm, planNorthBearingDeg: number | null): { eastMm: number; northMm: number; upMm: number } | null {
  if (planNorthBearingDeg === null) return null
  finite(p.x, p.y, p.z)
  const a = normalizeBearing(planNorthBearingDeg) * Math.PI / 180
  return { eastMm: p.x * Math.cos(a) - p.y * Math.sin(a), northMm: -p.x * Math.sin(a) - p.y * Math.cos(a), upMm: p.z }
}
export function trueNorthFrameToPlan(p: { eastMm: number; northMm: number; upMm: number }, planNorthBearingDeg: number | null): PlanPointMm | null {
  if (planNorthBearingDeg === null) return null
  finite(p.eastMm, p.northMm, p.upMm)
  const a = normalizeBearing(planNorthBearingDeg) * Math.PI / 180
  return { x: p.eastMm * Math.cos(a) - p.northMm * Math.sin(a), y: -p.eastMm * Math.sin(a) - p.northMm * Math.cos(a), z: p.upMm }
}
