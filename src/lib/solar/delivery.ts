import { z } from 'zod'
import { solarLayoutSignature, type SolarConfiguration, type SolarLayoutV2 } from '../model/solar.ts'
const number = z.number().finite().nonnegative(), text = z.string().max(12000)
export const solarDeliverySchema = z.object({
  schemaVersion: z.literal(1), layoutStatus: z.enum(['not-installed', 'needs-review', 'concept-valid']),
  roofSignature: text.nullable(), layoutSignature: text.nullable(), reservedAreaCount: number.int(),
  assumptions: z.array(text).max(200),
  arrays: z.array(z.object({ id: text, roofSurfaceId: text, roofComponentId: text, specificationKey: text,
    specificationId: text, specificationRevision: text.nullable(), specificationName: text, specificationSource: text, panelIds: z.array(text).min(1).max(10000), count: number.int().positive(),
    ratedPowerW: number.positive(), capacityKwp: number, widthMm: number.positive(), slopeLengthMm: number.positive(), thicknessMm: number.positive(),
    azimuthDeg: number.lt(360), tiltDeg: number.max(90), baseElevationMm: z.number().finite(), mountingHeightMm: number,
  })).max(10000),
}).superRefine((value, ctx) => {
  const ids = value.arrays.flatMap(a => a.panelIds)
  if (new Set(ids).size !== ids.length || value.layoutStatus !== 'concept-valid' && value.arrays.length ||
    value.layoutStatus === 'concept-valid' && (!ids.length || !value.roofSignature || !value.layoutSignature) ||
    value.arrays.some(a => a.count !== a.panelIds.length || Math.abs(a.capacityKwp - a.count * a.ratedPowerW / 1000) > 1e-9))
    ctx.addIssue({ code: 'custom', message: 'Canonical solar schedule arithmetic or validity mismatch' })
})
export type SolarDelivery = z.infer<typeof solarDeliverySchema>
/** No absolute room/site coordinates in the public cost schedule. IDs trace the canonical inventory. */
export function solarDelivery(solar: SolarConfiguration, applied: SolarLayoutV2 | null = null): SolarDelivery {
  const saved = solar.calculated?.layout, arrays: SolarDelivery['arrays'] = []
  for (const p of applied?.panels ?? []) {
    const key = JSON.stringify([p.roofSurfaceId, p.roofComponentId, p.specificationKey, p.dimensionsMm, p.azimuthDeg, p.tiltDeg, p.baseElevationMm, p.mountingHeightMm])
    let group = arrays.find(a => a.id === key)
    if (!group) { group = { id: key, roofSurfaceId: p.roofSurfaceId, roofComponentId: p.roofComponentId, specificationKey: p.specificationKey,
      specificationId: applied!.specification.id, specificationRevision: applied!.specification.revision,
      specificationName: applied!.specification.name, specificationSource: applied!.specification.source, panelIds: [], count: 0, ratedPowerW: p.ratedPowerW,
      capacityKwp: 0, widthMm: p.dimensionsMm.width, slopeLengthMm: p.dimensionsMm.slopeLength, thicknessMm: p.dimensionsMm.thickness,
      azimuthDeg: p.azimuthDeg, tiltDeg: p.tiltDeg, baseElevationMm: p.baseElevationMm, mountingHeightMm: p.mountingHeightMm }; arrays.push(group) }
    group.panelIds.push(p.id); group.count++; group.capacityKwp = group.count * group.ratedPowerW / 1000
  }
  arrays.forEach((a, i) => { a.id = `PV-array-${i + 1}`; a.panelIds.sort() })
  return solarDeliverySchema.parse({ schemaVersion: 1, layoutStatus: applied ? 'concept-valid' : solar.intention === 'install-now' ? 'needs-review' : 'not-installed',
    roofSignature: saved?.roofSignature ?? null, layoutSignature: saved ? solarLayoutSignature(saved) : null,
    reservedAreaCount: ['install-now', 'reserve-space'].includes(solar.intention) ? solar.inputs.reservedAreas.length : 0, arrays,
    assumptions: [...(applied?.resolved.assumptions ?? []),
      'Dimensions are physical module width × slope length × thickness in mm. Azimuth is clockwise from local plan-up; it is not geographic south.',
      'Concept layout and supports only; installer must verify roof structure, wind, waterproofing, electrical design and site access.',
      'Illustrative specifications are not evidence of approved equipment, domestic content or government eligibility. Decorative roof shade is not PV.',
      ...(solar.intention === 'reserve-space' ? ['Reservation only: no installed modules, installation cost or generation claim.'] : []),
    ],
  })
}
export function solarScheduleRows(delivery?: SolarDelivery): (string | number)[][] {
  return (delivery?.arrays ?? []).map(a => [a.id, a.roofSurfaceId, `${a.specificationId}@${a.specificationRevision ?? 'revision unknown'} · ${a.specificationKey}`, a.count, a.ratedPowerW, a.capacityKwp,
    `${a.widthMm} × ${a.slopeLengthMm} × ${a.thicknessMm}`, a.azimuthDeg, a.tiltDeg, a.baseElevationMm, a.mountingHeightMm, a.panelIds.join('; ')])
}
export const SOLAR_SCHEDULE_HEADERS = ['Array', 'Roof surface', 'Versioned specification', 'Panels', 'W / panel', 'DC kWp', 'Dimensions mm', 'Local azimuth °', 'Tilt °', 'Roof elevation mm', 'Mounting height mm', 'Canonical panel IDs']
