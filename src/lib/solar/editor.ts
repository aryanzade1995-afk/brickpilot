import type { Brief } from '../model/brief.ts'
import type { Design } from '../engine/types.ts'
import { solarConfigurationSchema, solarConfigurationSignature, type SolarConfiguration } from '../model/solar.ts'
import { buildSolarRoofModel, type SolarRoofArchitecture, type SolarRoofModel } from './roofModel.ts'
import { proposeSolarPlacement, reviewSolarLayout, solarLayoutTotals, type SolarPlacementProposal } from './placement.ts'

export const SOLAR_SECTION = 'rooftop-solar'
export const SOLAR_URL = `/workspace/finishes?tab=specifications&section=${SOLAR_SECTION}`
export type SolarEditorPreview = { configuration: SolarConfiguration; roof: SolarRoofModel; proposal: SolarPlacementProposal }
export function previewSolarEditor(design: Design, value: unknown, architecture?: SolarRoofArchitecture): SolarEditorPreview {
  const configuration = solarConfigurationSchema.parse({ ...(value as SolarConfiguration), calculated: null })
  const old = (value as SolarConfiguration).calculated?.layout
  const roof = buildSolarRoofModel(design, { architecture, inputs: configuration.inputs, policy: old?.schemaVersion === 2 ? old.allocationPolicy : undefined })
  const proposal = proposeSolarPlacement(configuration, roof, { policy: old?.schemaVersion === 2 ? old.placementPolicy : undefined,
    manualPanels: configuration.inputs.placement.mode === 'manual' && old?.schemaVersion === 2 ? old.panels.map(p => ({ id: p.id, roofSurfaceId: p.roofSurfaceId, positionMm: { x: p.positionMm.x, y: p.positionMm.y }, azimuthDeg: p.azimuthDeg, moduleOrientation: p.moduleOrientation })) : undefined })
  // Assessment-only edits retain the exact canonical layout, including manually edited positions.
  if (old?.schemaVersion === 2 && old.configurationSignature === solarConfigurationSignature(configuration) &&
    reviewSolarLayout(old, configuration, roof).state === 'concept-valid') {
    proposal.layout = structuredClone(old)
    const totals = solarLayoutTotals(old)
    proposal.achievablePanelCount = totals.panelCount
    proposal.achievableCapacityKwp = totals.capacityKwp
  }
  return { configuration, roof, proposal }
}
/** Atomic commit: stale previews never regenerate or move panels while applying. */
export function applySolarEditor(brief: Brief, preview: SolarEditorPreview, currentRoof: SolarRoofModel): Brief {
  if (preview.roof.roofSignature !== currentRoof.roofSignature || preview.roof.allocationSignature !== currentRoof.allocationSignature)
    throw new Error('SOLAR_PREVIEW_STALE')
  let solar = preview.configuration
  const layout = preview.proposal.layout
  if (solar.intention === 'install-now' && layout?.panels.length) {
    const validity = reviewSolarLayout(layout, solar, currentRoof)
    if (validity.state !== 'concept-valid') throw new Error('SOLAR_PREVIEW_STALE')
    solar = solarConfigurationSchema.parse({ ...solar, calculated: { configurationSignature: solarConfigurationSignature(solar), layout: { ...layout, validity } } })
  } else if (solar.intention === 'install-now' && brief.solar.calculated && solarConfigurationSignature(solar) === solarConfigurationSignature(brief.solar)) {
    // An unavailable/partial source must not erase a previously saved arrangement.
    solar = { ...solar, calculated: brief.solar.calculated }
  }
  return { ...brief, solar }
}
/** Solar is not a finish level. Preserve both structured preferences and the legacy allowance. */
export function resetFinishSpecifications(brief: Brief, finish: Brief['finish'] = brief.finish): Brief {
  return { ...brief, finish, specs: { overrides: Object.fromEntries(Object.entries(brief.specs.overrides).filter(([id]) => ['solar','plinth-height'].includes(id.split('@')[0]))) } }
}

/** Friendly presentation keys; technical engine codes stay out of the product UI. */
export function solarIssueLabel(code: string): string {
  const labels: Record<string, string> = {
    PANEL_SPECIFICATION_REQUIRED: 'Choose a panel specification to preview a layout.', REQUEST_REQUIRED: 'Choose a panel count or capacity target.',
    TRUE_NORTH_REQUIRED: 'Enter the north bearing or choose a local array rotation.', ROOF_INPUTS_STALE: 'Roof settings changed. Preview again.',
    NO_USABLE_ROOF: 'No suitable accessible roof area is available.', REQUEST_NOT_MET: 'Fewer panels fit than requested.',
    ALLOCATION_BUDGET: 'The terrace free-space allowance limits this arrangement.', PROTECTED_ACCESS: 'Maintenance routes are kept clear.',
    RESERVED_AREA: 'Your reserved terrace space is kept clear.', EDGE_CLEARANCE: 'Roof-edge clearances limit this arrangement.',
    ROOF_OBSTACLE_CLEARANCE: 'Tanks, roof features and their clearances limit this arrangement.',
    ROOF_BOUNDARY_OR_OPENING: 'Panels must stay on the roof and clear of openings.',
    MODULE_ENVELOPE_DOES_NOT_FIT: 'The full panel and support envelope does not fit.',
    CONSERVATIVE_SEARCH: 'This is a checked concept arrangement, not the maximum possible system.',
    SEARCH_LIMIT_REACHED: 'The search limit was reached. An installer may find another arrangement.',
    RESERVATION_AREA_REQUIRED: 'Choose a roof area before treating space as reserved.',
    ARCHITECTURE_DETAILS_REQUIRED: 'Open the accepted villa before previewing solar placement.',
    MANUAL_POSITIONS_REQUIRED: 'Manual panel positions need the layout editor. Choose automatic placement here.',
    DISCONNECTED_ROOF_REGION: 'Roof areas without a continuous access route are excluded.',
    PANEL_MAINTENANCE_CONFLICT: 'Panel spacing and maintenance access limit this arrangement.',
  }
  return labels[code] ?? 'The roof or settings need review before placement.'
}
