import type { Design } from '../engine/types.ts'
import { solarConfigurationSchema, solarConfigurationSignature, solarSignature, type SolarConfiguration } from '../model/solar.ts'
import { buildSolarRoofModel, type SolarRoofArchitecture } from './roofModel.ts'
import { proposeSolarPlacement, reviewSolarLayout, type SolarPlacementOptions } from './placement.ts'
import { polygonFitsRegions, rectanglePolygon } from './polygons.ts'

export type ManualSolarPanel = NonNullable<SolarPlacementOptions['manualPanels']>[number]
export type SolarLayoutDraft = {
  baseSolarSignature: string; roofSignature: string
  panels: ManualSolarPanel[]; reservedAreas: SolarConfiguration['inputs']['reservedAreas']
}
export function createSolarLayoutDraft(solar: SolarConfiguration, roofSignature: string): SolarLayoutDraft {
  const layout = solar.calculated?.layout
  return { baseSolarSignature: solarSignature(solar), roofSignature,
    panels: layout?.schemaVersion === 2 ? layout.panels.map(p => ({ id: p.id, roofSurfaceId: p.roofSurfaceId,
      positionMm: { x: p.positionMm.x, y: p.positionMm.y }, azimuthDeg: p.azimuthDeg, moduleOrientation: p.moduleOrientation })) : [],
    reservedAreas: structuredClone(solar.inputs.reservedAreas) }
}
/** Plan bearings are clockwise in the +y-down drawing. Rotate a group about its centroid. */
export function transformSolarSelection(panels: ManualSolarPanel[], ids: Set<string>, dx: number, dy: number, angleDeg: number) {
  if (![dx, dy, angleDeg].every(Number.isFinite)) throw new Error('INVALID_SOLAR_EDIT')
  const selected = panels.filter(p => p.id && ids.has(p.id))
  if (!selected.length) return panels
  const cx = selected.reduce((s, p) => s + p.positionMm.x, 0) / selected.length
  const cy = selected.reduce((s, p) => s + p.positionMm.y, 0) / selected.length
  const a = angleDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a)
  return panels.map(p => !p.id || !ids.has(p.id) ? p : { ...p,
    positionMm: { x: cx + (p.positionMm.x - cx) * c - (p.positionMm.y - cy) * s + dx,
      y: cy + (p.positionMm.x - cx) * s + (p.positionMm.y - cy) * c + dy },
    azimuthDeg: ((p.azimuthDeg + angleDeg) % 360 + 360) % 360 })
}

/** Reject partial manual proposals. An edit cannot silently drop, repack or move another module. */
export function previewSolarLayoutDraft(design: Design, solar: SolarConfiguration, architecture: SolarRoofArchitecture | undefined, draft: SolarLayoutDraft) {
  if (draft.baseSolarSignature !== solarSignature(solar)) throw new Error('SOLAR_EDIT_STALE')
  const saved = solar.calculated?.layout
  const next = solarConfigurationSchema.parse({ ...solar, calculated: null, inputs: { ...solar.inputs,
    placement: { ...solar.inputs.placement, mode: saved?.schemaVersion === 2 ? 'manual' : solar.inputs.placement.mode }, reservedAreas: draft.reservedAreas } })
  const roof = buildSolarRoofModel(design, { architecture, inputs: next.inputs, policy: saved?.schemaVersion === 2 ? saved.allocationPolicy : undefined })
  if (roof.roofSignature !== draft.roofSignature) throw new Error('SOLAR_EDIT_STALE')
  for (const area of next.inputs.reservedAreas) {
    const surface = roof.surfaces.find(s => s.level === area.level && (!area.roofSurfaceId || s.id === area.roofSurfaceId || s.components.some(c => c.id === area.roofSurfaceId)))
    if (!surface || surface.kind !== 'flat-top-roof' || !polygonFitsRegions(rectanglePolygon(area.rectMm), surface.regionsMm)) throw new Error('KEEP_FREE_OUTSIDE_ROOF')
    if (surface.access.status !== 'modeled') throw new Error('KEEP_FREE_BLOCKS_ACCESS')
  }
  if (solar.intention === 'install-now') {
    if (saved?.schemaVersion !== 2 || !saved.panels.length) throw new Error('SOLAR_LAYOUT_REQUIRED')
    if (draft.panels.length !== saved.panels.length || new Set(draft.panels.map(p => p.id)).size !== saved.panels.length || draft.panels.some(p => !saved.panels.some(o => o.id === p.id))) throw new Error('INVALID_SOLAR_EDIT')
    const proposal = proposeSolarPlacement(next, roof, { manualPanels: draft.panels, policy: saved.placementPolicy })
    if (!proposal.layout || proposal.layout.panels.length !== draft.panels.length) return { configuration: null, roof, issues: proposal.issues }
    const validity = reviewSolarLayout(proposal.layout, next, roof)
    if (validity.state !== 'concept-valid') throw new Error('INVALID_SOLAR_EDIT')
    next.calculated = { configurationSignature: solarConfigurationSignature(next), layout: { ...proposal.layout, validity } }
  } else {
    if (draft.panels.length) throw new Error('INVALID_SOLAR_EDIT')
    if (next.intention === 'undecided' && next.inputs.reservedAreas.length) next.intention = 'reserve-space'
  }
  return { configuration: solarConfigurationSchema.parse(next), roof, issues: [] }
}

/** Recheck the source and every canonical envelope at commit time, without rebuilding architecture. */
export function validateSolarLayoutCommit(design: Design, current: SolarConfiguration, architecture: SolarRoofArchitecture | undefined,
  value: unknown, expectedSolarSignature: string, expectedRoofSignature: string): SolarConfiguration {
  if (solarSignature(current) !== expectedSolarSignature) throw new Error('SOLAR_EDIT_STALE')
  const next = solarConfigurationSchema.parse(value), layout = next.calculated?.layout
  const previous = current.calculated?.layout
  const expected = { ...current, calculated: null, intention: current.intention === 'undecided' && next.inputs.reservedAreas.length ? 'reserve-space' : current.intention,
    inputs: { ...current.inputs, reservedAreas: next.inputs.reservedAreas, placement: { ...current.inputs.placement, mode: previous?.schemaVersion === 2 ? 'manual' : current.inputs.placement.mode } } }
  if (solarConfigurationSignature(next) !== solarConfigurationSignature(expected as SolarConfiguration) ||
    JSON.stringify(next.assessmentInputs) !== JSON.stringify(current.assessmentInputs)) throw new Error('INVALID_SOLAR_EDIT')
  if (current.intention === 'install-now' && (previous?.schemaVersion !== 2 || layout?.schemaVersion !== 2 ||
    previous.panels.length !== layout.panels.length || previous.panels.some(p => !layout.panels.some(n => n.id === p.id)))) throw new Error('INVALID_SOLAR_EDIT')
  const roof = buildSolarRoofModel(design, { architecture, inputs: next.inputs, policy: layout?.schemaVersion === 2 ? layout.allocationPolicy : undefined })
  if (roof.roofSignature !== expectedRoofSignature) throw new Error('SOLAR_EDIT_STALE')
  // Re-run the same reservation/manual validation; never trust a preview's valid flag.
  const draft = createSolarLayoutDraft(next, roof.roofSignature)
  const checked = previewSolarLayoutDraft(design, next, architecture, draft)
  if (!checked.configuration) throw new Error('INVALID_SOLAR_EDIT')
  if (next.intention === 'install-now' && (!layout || reviewSolarLayout(layout, next, roof).state !== 'concept-valid')) throw new Error('INVALID_SOLAR_EDIT')
  return next
}
