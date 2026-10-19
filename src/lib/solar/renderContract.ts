import { z } from 'zod'
import { Matrix4 } from 'three'
import { solarConfigurationSignature, solarLayoutSignature, solarConfigurationSchema, type SolarConfiguration } from '../model/solar.ts'
import { solarPanelWorldMatrix, solarSupportMatrices, solarReservationLines } from '../three/solarGeometry.ts'
import { buildSolarRoofModel, type SolarRoofArchitecture } from './roofModel.ts'
import { reviewSolarLayout, solarLayoutTotals } from './placement.ts'
import type { Design } from '../engine/types.ts'
import { polygonFitsRegions, rectanglePolygon } from './polygons.ts'

export const SOLAR_RENDER_VERSION = 'canonical-pv-render-v1'
/** Financial questionnaires do not change geometry. Layout validity and reservations do. */
export function solarVisualSignature(solar: SolarConfiguration) {
  // Retain the complete versioned input/layout identities rather than compressing them to 32 bits.
  return `${SOLAR_RENDER_VERSION}|${solarConfigurationSignature(solar)}|${solar.calculated ? solarLayoutSignature(solar.calculated.layout) : 'none'}`
}
const matrix = z.array(z.number().finite()).length(16)
export const solarRenderContractSchema = z.strictObject({
  schemaVersion: z.literal(1), rendererVersion: z.literal(SOLAR_RENDER_VERSION),
  coordinates: z.literal('blender-x-right-y-down-z-up-metres'), matrixOrder: z.literal('column-major'),
  solarVisualSignature: z.string(), roofSignature: z.string(), layoutSignature: z.string().nullable(),
  intention: z.enum(['undecided', 'not-included', 'reserve-space', 'install-now']),
  panelCount: z.number().int().nonnegative(), capacityKwp: z.number().nonnegative(),
  panels: z.array(z.strictObject({ id: z.string(), roofSurfaceId: z.string(), specificationKey: z.string(),
    ratedPowerW: z.number().positive(), frame: matrix, face: matrix, supports: z.array(matrix).length(4) })).max(10000),
  reservationLines: z.array(z.number().finite()).max(4800), assumptions: z.array(z.string()),
}).superRefine((v, ctx) => {
  if (v.panelCount !== v.panels.length || Math.abs(v.capacityKwp - v.panels.reduce((n, p) => n + p.ratedPowerW, 0) / 1000) > 1e-9 ||
    (v.intention !== 'install-now' && v.panels.length)) ctx.addIssue({ code: 'custom', message: 'Solar render inventory mismatch' })
})
export type SolarRenderContract = z.infer<typeof solarRenderContractSchema>
// Exactly the live viewer matrices, left-multiplied by the inverse GLB axis conversion.
// Unit box/XY-plane primitives remain identical. No second placement implementation.
const toBlender = new Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1)
const converted = (m: Matrix4) => toBlender.clone().multiply(m).toArray()
export function createSolarRenderContract(design: Design, architecture: SolarRoofArchitecture, input: unknown): SolarRenderContract {
  const solar = solarConfigurationSchema.parse(input)
  const saved = solar.calculated?.layout
  const roof = buildSolarRoofModel(design, { architecture, inputs: solar.inputs,
    policy: saved?.schemaVersion === 2 ? saved.allocationPolicy : undefined })
  const layout = solar.intention === 'install-now' && saved?.schemaVersion === 2 ? saved : null
  if (solar.intention === 'reserve-space' || solar.intention === 'install-now') for (const area of solar.inputs.reservedAreas) {
    const surface = roof.surfaces.find(s => s.level === area.level && (!area.roofSurfaceId || s.id === area.roofSurfaceId || s.components.some(c => c.id === area.roofSurfaceId)))
    if (!surface || surface.kind !== 'flat-top-roof' || surface.access.status !== 'modeled' || !polygonFitsRegions(rectanglePolygon(area.rectMm), surface.regionsMm))
      throw new Error('A reserved area no longer matches an accessible supported roof. Review the solar layout before exporting.')
  }
  if (solar.intention === 'install-now' && (!layout || !layout.panels.length || layout.validity.state !== 'concept-valid' || reviewSolarLayout(layout, solar, roof).state !== 'concept-valid'))
    throw new Error('Apply a valid canonical solar layout against this accepted building before exporting.')
  const lines = solarReservationLines(solar.inputs.reservedAreas, roof), reservationLines: number[] = []
  if (solar.intention === 'reserve-space' || solar.intention === 'install-now')
    for (let i = 0; i < lines.length; i += 3) reservationLines.push(lines[i], -lines[i + 2], lines[i + 1])
  return solarRenderContractSchema.parse({ schemaVersion: 1, rendererVersion: SOLAR_RENDER_VERSION,
    coordinates: 'blender-x-right-y-down-z-up-metres', matrixOrder: 'column-major', solarVisualSignature: solarVisualSignature(solar),
    roofSignature: roof.roofSignature, layoutSignature: layout ? solarLayoutSignature(layout) : null, intention: solar.intention,
    panelCount: layout?.panels.length ?? 0, capacityKwp: layout ? solarLayoutTotals(layout).capacityKwp : 0,
    panels: (layout?.panels ?? []).map(p => ({ id: p.id, roofSurfaceId: p.roofSurfaceId, specificationKey: p.specificationKey,
      ratedPowerW: p.ratedPowerW, frame: converted(solarPanelWorldMatrix(p)), face: converted(solarPanelWorldMatrix(p, true)),
      supports: solarSupportMatrices(p).map(converted) })), reservationLines,
    assumptions: [...(layout?.resolved.assumptions ?? []), 'Concept PV supports; structural, wind, waterproofing and electrical design require installer review. Decorative roof shading is not photovoltaic equipment.'],
  })
}
