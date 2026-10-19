import { z } from 'zod'
import { fnv } from '../engine/massing/rng.ts'
import { solarConfigurationSchema, solarConfigurationSignature, solarLayoutV2Schema, solarPanelSpecificationKey,
  type SolarConfiguration, type SolarLayout, type SolarLayoutV2, type SolarPanelPlacement } from '../model/solar.ts'
import { solarPlacementPolicySchema, type SolarPlacementPolicy } from './policy.ts'
import { solarRoofInputsSignature, type SolarRoofModel, type SolarRoofSurface } from './roofModel.ts'
import { trueAzimuthToPlan } from './coordinates.ts'
import { expandRect } from './regions.ts'
import { polygonBounds, polygonFitsRegions, polygonsOverlap, rectanglePolygon, type P2 } from './polygons.ts'

export type PlacementIssue = { code: string; message: string }
export type SolarPlacementProposal = {
  status: 'proposed' | 'limited' | 'needs-input' | 'reservation-only' | 'not-included' | 'undecided'
  requestedPanelCount: number | null; requestedCapacityKwp: number | null
  achievablePanelCount: number; achievableCapacityKwp: number; layout: SolarLayoutV2 | null
  reservations: SolarConfiguration['inputs']['reservedAreas']; issues: PlacementIssue[]
  search: { candidateChecks: number; limitReached: boolean; provesMaximum: false }
}
const manualSchema = z.array(z.strictObject({
  id: z.string().min(1).max(160).optional(), roofSurfaceId: z.string().min(1).max(160),
  positionMm: z.strictObject({ x: z.number().finite(), y: z.number().finite() }),
  azimuthDeg: z.number().finite().min(0).lt(360), moduleOrientation: z.enum(['portrait', 'landscape']).optional(),
})).max(10000).refine(values => new Set(values.flatMap(v => v.id ? [v.id] : [])).size === values.filter(v => v.id).length, 'Manual panel IDs must be unique')
export type SolarPlacementOptions = { policy?: z.input<typeof solarPlacementPolicySchema>; manualPanels?: z.input<typeof manualSchema> }
export type LayoutReview = { state: 'concept-valid' | 'needs-review' | 'invalid'; reasonCodes: string[] }
const round = (v: number) => Math.round(v * 1e6) / 1e6
function decimalParts(value: number) {
  const [text, exponent = '0'] = value.toString().toLowerCase().split('e')
  const [whole, fraction = ''] = text.split('.')
  return { coefficient: BigInt(whole + fraction), exponent: Number(exponent) - fraction.length }
}
function capacityForCount(count: number, watts: number) {
  const p = decimalParts(watts)
  return Number(`${p.coefficient * BigInt(count)}e${p.exponent - 3}`)
}
function capacityPanelCount(kwp: number, watts: number) {
  // Decimal inputs are exact inventory quantities. Avoid a floating-point ceil
  // inventing a fourth module for e.g. 2.1 W / 0.7 W, or rounding a shortfall away.
  const a = decimalParts(kwp), b = decimalParts(watts), shift = a.exponent + 3 - b.exponent
  const numerator = a.coefficient * 10n ** BigInt(Math.max(0, shift))
  const denominator = b.coefficient * 10n ** BigInt(Math.max(0, -shift))
  return Number((numerator + denominator - 1n) / denominator)
}
const issue = (code: string, message: string): PlacementIssue => ({ code, message })
function basis(angle: number) { const a = angle * Math.PI / 180; return { u: { x: Math.cos(a), y: Math.sin(a) }, v: { x: Math.sin(a), y: -Math.cos(a) } } }
function orientedRect(center: P2, width: number, depth: number, angle: number): P2[] {
  const { u, v } = basis(angle)
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => ({ x: center.x + u.x * x * width / 2 + v.x * y * depth / 2, y: center.y + u.y * x * width / 2 + v.y * y * depth / 2 }))
}
export function solarPanelGeometry(panel: SolarPanelPlacement, policy: SolarPlacementPolicy, spacing: { rowGapMm: number; moduleGapMm: number } = policy) {
  const { width, slopeLength: length, thickness } = panel.dimensionsMm
  const t = panel.tiltDeg * Math.PI / 180, sin = Math.sin(t), cos = Math.cos(t), b = basis(panel.azimuthDeg)
  const projectedDepth = length * cos + thickness * sin
  const supportWidth = width + 2 * policy.supportOverhangMm
  const supportDepth = Math.max(projectedDepth, policy.minSupportDepthMm) + 2 * policy.supportOverhangMm
  const physicalCornersMm = [-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => ({
    x: panel.positionMm.x + b.u.x * x * width / 2 + b.v.x * (y * length * cos / 2 + z * thickness * sin / 2),
    y: panel.positionMm.y + b.u.y * x * width / 2 + b.v.y * (y * length * cos / 2 + z * thickness * sin / 2),
    z: panel.positionMm.z - y * length * sin / 2 + z * thickness * cos / 2,
  }))))
  return { physicalCornersMm, projectedFootprintMm: orientedRect(panel.positionMm, width, projectedDepth, panel.azimuthDeg),
    support: { footprintMm: orientedRect(panel.positionMm, supportWidth, supportDepth, panel.azimuthDeg),
      bottomMm: panel.baseElevationMm, topMm: Math.max(...physicalCornersMm.map(p => p.z)) },
    maintenanceEnvelopeMm: orientedRect(panel.positionMm, supportWidth + 2 * policy.maintenanceSideMm, supportDepth + 2 * policy.maintenanceRowMm, panel.azimuthDeg),
    rowSpacingEnvelopeMm: orientedRect(panel.positionMm, supportWidth, supportDepth + 2 * spacing.rowGapMm, panel.azimuthDeg),
    sideSpacingEnvelopeMm: orientedRect(panel.positionMm, supportWidth + 2 * spacing.moduleGapMm, supportDepth, panel.azimuthDeg),
    neighbourEnvelopeMm: orientedRect(panel.positionMm, supportWidth + 2 * Math.max(policy.maintenanceSideMm, spacing.moduleGapMm), supportDepth + 2 * Math.max(policy.maintenanceRowMm, spacing.rowGapMm), panel.azimuthDeg),
    supportWidthMm: supportWidth, supportDepthMm: supportDepth, supportAreaM2: supportWidth * supportDepth / 1e6 }
}
type Geometry = ReturnType<typeof solarPanelGeometry>
/** Spatial buckets bound neighbour checks for large requests without changing ordering. */
class PanelIndex {
  buckets = new Map<string, Set<number>>()
  geometries: Geometry[] = []
  cellMm: number
  constructor(cellMm: number) { this.cellMm = Math.max(1, cellMm) }
  keys(polygon: P2[]) {
    const r = polygonBounds(polygon), keys: string[] = []
    for (let x = Math.floor(r.x / this.cellMm); x <= Math.floor((r.x + r.w) / this.cellMm); x++)
      for (let y = Math.floor(r.y / this.cellMm); y <= Math.floor((r.y + r.h) / this.cellMm); y++) keys.push(`${x}:${y}`)
    return keys
  }
  collides(g: Geometry) {
    const nearby = new Set(this.keys(g.neighbourEnvelopeMm).flatMap(key => [...(this.buckets.get(key) ?? [])]))
    return [...nearby].some(i => {
      const other = this.geometries[i]
      return [g.maintenanceEnvelopeMm, g.rowSpacingEnvelopeMm, g.sideSpacingEnvelopeMm].some(p => polygonsOverlap(p, other.support.footprintMm)) ||
        [other.maintenanceEnvelopeMm, other.rowSpacingEnvelopeMm, other.sideSpacingEnvelopeMm].some(p => polygonsOverlap(p, g.support.footprintMm))
    })
  }
  add(g: Geometry) {
    const index = this.geometries.length; this.geometries.push(g)
    for (const key of this.keys(g.neighbourEnvelopeMm)) { const group = this.buckets.get(key) ?? new Set<number>(); group.add(index); this.buckets.set(key, group) }
  }
}
function resolve(config: SolarConfiguration, roof: SolarRoofModel, policy: SolarPlacementPolicy): SolarLayoutV2['resolved'] | null {
  const inputs = config.inputs, assumptions: string[] = []
  const tilt = inputs.placement.tiltDeg ?? policy.tiltDeg
  const height = inputs.placement.mountingHeightMm ?? (inputs.mounting === 'raised-frame' ? 1500 : policy.mountingHeightMm)
  const requestedGap = inputs.placement.rowGapMm ?? policy.rowGapMm
  const rowGap = Math.max(requestedGap, policy.maintenanceRowMm)
  const moduleGap = Math.max(policy.moduleGapMm, policy.maintenanceSideMm)
  let rotation = inputs.placement.arrayRotationDeg
  if (rotation === null && inputs.orientation.preferredPanelAzimuthDeg !== null) {
    rotation = trueAzimuthToPlan(inputs.orientation.preferredPanelAzimuthDeg, roof.orientation.planNorthBearingDeg)
    if (rotation === null) return null
  }
  if (rotation === null) { rotation = 0; assumptions.push('Local plan-up orientation assumed; no geographic/energy optimum is claimed.') }
  if (inputs.placement.tiltDeg === null) assumptions.push(`Concept tilt ${tilt}° assumed.`)
  if (inputs.placement.mountingHeightMm === null) assumptions.push(`Concept lower-panel clearance ${height} mm assumed.`)
  if (inputs.mounting === 'unknown') assumptions.push('Concept support frame assumed; mounting system remains unverified.')
  if (inputs.placement.rowGapMm === null) assumptions.push(`Concept row gap ${rowGap} mm assumed; not a shading calculation.`)
  if (rowGap !== requestedGap) assumptions.push(`Row gap increased from ${requestedGap} to ${rowGap} mm to preserve the concept maintenance envelope.`)
  if (moduleGap !== policy.moduleGapMm) assumptions.push(`Module gap increased to ${moduleGap} mm for the concept side maintenance envelope.`)
  return { tiltDeg: tilt, mountingHeightMm: height, arrayRotationDeg: rotation, rowGapMm: rowGap, moduleGapMm: moduleGap, assumptions }
}
function makePanel(surface: SolarRoofSurface, config: SolarConfiguration, resolved: SolarLayoutV2['resolved'], orientation: 'portrait' | 'landscape', center: P2, angle = resolved.arrayRotationDeg, manualId?: string): SolarPanelPlacement {
  const spec = config.inputs.panel!, portrait = orientation === 'portrait'
  const dimensionsMm = { width: portrait ? spec.dimensionsMm.width : spec.dimensionsMm.height,
    slopeLength: portrait ? spec.dimensionsMm.height : spec.dimensionsMm.width, thickness: spec.dimensionsMm.thickness }
  const t = resolved.tiltDeg * Math.PI / 180
  const positionMm = { x: round(center.x), y: round(center.y), z: round(surface.elevationMm + resolved.mountingHeightMm + (dimensionsMm.slopeLength * Math.sin(t) + dimensionsMm.thickness * Math.cos(t)) / 2) }
  const specificationKey = solarPanelSpecificationKey(spec)
  const key = JSON.stringify([surface.id, positionMm, orientation, angle, specificationKey])
  return { id: manualId ?? `pv-${fnv(key).toString(16)}-${fnv(`panel|${key}`).toString(16)}`, roofSurfaceId: surface.id,
    roofComponentId: '', specificationKey, moduleOrientation: orientation, dimensionsMm, ratedPowerW: spec.ratedPowerW,
    positionMm, baseElevationMm: surface.elevationMm, mountingHeightMm: resolved.mountingHeightMm, azimuthDeg: angle, tiltDeg: resolved.tiltDeg }
}
function fitReason(g: Geometry, surface: SolarRoofSurface): string | null {
  if (!polygonFitsRegions(g.maintenanceEnvelopeMm, surface.regionsMm)) return 'ROOF_BOUNDARY_OR_OPENING'
  if (!polygonFitsRegions(g.maintenanceEnvelopeMm, surface.usableRegionsMm)) {
    for (const e of surface.exclusions) if (e.regionsMm.some(r => polygonsOverlap(g.maintenanceEnvelopeMm, rectanglePolygon(expandRect(r, e.clearanceMm))))) {
      if (e.kind === 'reserved-area') return 'RESERVED_AREA'
      if (e.kind === 'protected-access' || e.kind === 'access-unreachable') return 'PROTECTED_ACCESS'
      if (e.kind === 'edge-clearance') return 'EDGE_CLEARANCE'
      return 'ROOF_OBSTACLE_CLEARANCE'
    }
    return 'USABLE_ROOF_GEOMETRY'
  }
  return null
}
function target(config: SolarConfiguration) {
  const request = config.inputs.request, watts = config.inputs.panel?.ratedPowerW
  if (!watts || request.kind === 'unknown') return { count: null, capacity: null }
  if (request.kind === 'panel-count') return { count: request.panelCount, capacity: capacityForCount(request.panelCount, watts) }
  // Capacity requests mean at least that nameplate capacity; six 550 W panels stay 3.3 kWp.
  return { count: capacityPanelCount(request.capacityKwp, watts), capacity: request.capacityKwp }
}
export function solarLayoutTotals(layout: SolarLayoutV2) {
  return { panelCount: layout.panels.length, ratedPowerW: layout.specification.ratedPowerW,
    capacityKwp: capacityForCount(layout.panels.length, layout.specification.ratedPowerW) }
}

export function proposeSolarPlacement(value: SolarConfiguration, roof: SolarRoofModel, options: SolarPlacementOptions = {}): SolarPlacementProposal {
  const config = solarConfigurationSchema.parse(value), policy = solarPlacementPolicySchema.parse(options.policy ?? {})
  const requested = target(config)
  const result: SolarPlacementProposal = { status: 'needs-input', requestedPanelCount: requested.count, requestedCapacityKwp: requested.capacity,
    achievablePanelCount: 0, achievableCapacityKwp: 0, layout: null, reservations: structuredClone(config.inputs.reservedAreas), issues: [],
    search: { candidateChecks: 0, limitReached: false, provesMaximum: false } }
  if (config.intention !== 'install-now') {
    result.status = config.intention === 'reserve-space' ? 'reservation-only' : config.intention
    if (config.intention === 'reserve-space' && !result.reservations.length)
      result.issues.push(issue('RESERVATION_AREA_REQUIRED', 'The intention to reserve space is saved; select an actual roof area before treating space as reserved.'))
    return result
  }
  if (roof.allocationInputsSignature !== solarRoofInputsSignature(config.inputs)) { result.issues.push(issue('ROOF_INPUTS_STALE', 'Rebuild the roof allocation using the current reservations, edge clearance and north bearing.')); return result }
  if (!config.inputs.panel) { result.issues.push(issue('PANEL_SPECIFICATION_REQUIRED', 'Choose a physical panel specification before placing modules.')); return result }
  if (!requested.count) { result.issues.push(issue('REQUEST_REQUIRED', 'Choose a panel count or requested capacity.')); return result }
  if (requested.count > 10000) { result.issues.push(issue('REQUEST_TOO_LARGE', 'This concept engine supports at most 10,000 panels in one layout.')); return result }
  const resolved = resolve(config, roof, policy)
  if (!resolved) { result.issues.push(issue('TRUE_NORTH_REQUIRED', 'Supply the plan true-north bearing or choose an explicit local array rotation.')); return result }
  const surfaces = roof.surfaces.filter(s => s.kind === 'flat-top-roof' && s.status === 'concept-usable' && s.maxSolarFootprintAreaM2 > 0).sort((a, b) => a.id.localeCompare(b.id))
  const configurationSignature = solarConfigurationSignature(config)
  const buildLayout = (panels: SolarPanelPlacement[]): SolarLayoutV2 => solarLayoutV2Schema.parse({ schemaVersion: 2, engineVersion: 'solar-placement-v1',
    roofSignature: roof.roofSignature, allocationSignature: roof.allocationSignature, configurationSignature,
    coordinates: roof.coordinates, units: roof.units, specification: config.inputs.panel, specificationKey: solarPanelSpecificationKey(config.inputs.panel!),
    allocationPolicy: roof.policy, placementPolicy: policy, resolved, validity: { state: 'concept-valid', reasonCodes: [] }, panels })
  if (!surfaces.length) {
    result.status = 'limited'; result.layout = buildLayout([])
    result.issues.push(issue('NO_USABLE_ROOF', 'The current roof has no supported, accessible solar allocation.'))
    result.issues.push(...roof.issues, ...roof.surfaces.flatMap(s => s.issues)); return result
  }
  const orientations: ('portrait' | 'landscape')[] = config.inputs.placement.moduleOrientation === 'auto' ? ['portrait', 'landscape'] : [config.inputs.placement.moduleOrientation]
  const rejected = new Map<string, number>(), reject = (reason: string) => rejected.set(reason, (rejected.get(reason) ?? 0) + 1)
  const manual = options.manualPanels === undefined ? undefined : manualSchema.parse(options.manualPanels)
  if (manual && config.inputs.placement.mode !== 'manual') { result.issues.push(issue('MANUAL_MODE_REQUIRED', 'Choose manual placement before supplying individual panel positions.')); return result }
  if (config.inputs.placement.mode === 'manual' && !manual) { result.issues.push(issue('MANUAL_POSITIONS_REQUIRED', 'Supply panel positions for manual placement.')); return result }
  if (manual && manual.length > requested.count) { result.issues.push(issue('MANUAL_COUNT_EXCEEDS_REQUEST', 'Manual positions exceed the requested panel count.')); return result }
  let best: SolarPanelPlacement[] = []
  const patterns = manual ? [[orientations[0], 0, 0] as const] : orientations.flatMap(o => [[o, 0, 0], [o, .5, 0], [o, 0, .5], [o, .5, .5]] as const)
  for (const [orientation, offsetU, offsetV] of patterns) {
    const panels: SolarPanelPlacement[] = []
    for (const surface of surfaces) {
      let usedArea = 0
      const prototype = makePanel(surface, config, resolved, orientation, { x: 0, y: 0 }), prototypeGeometry = solarPanelGeometry(prototype, policy, resolved)
      const index = new PanelIndex(Math.max(prototypeGeometry.supportWidthMm + 2 * Math.max(policy.maintenanceSideMm, resolved.moduleGapMm), prototypeGeometry.supportDepthMm + 2 * Math.max(policy.maintenanceRowMm, resolved.rowGapMm)))
      const consider = (panel: SolarPanelPlacement) => {
        result.search.candidateChecks++
        const g = solarPanelGeometry(panel, policy, resolved), reason = fitReason(g, surface)
        if (reason) { reject(reason); return }
        const component = surface.components.find(c => c.access === 'modeled' && polygonFitsRegions(g.maintenanceEnvelopeMm, c.regionsMm))
        if (!component) { reject('ROOF_COMPONENT_ACCESS'); return }
        if (usedArea + g.supportAreaM2 > surface.maxSolarFootprintAreaM2 + 1e-9) { reject('ALLOCATION_BUDGET'); return }
        if (index.collides(g)) { reject('PANEL_MAINTENANCE_CONFLICT'); return }
        panel.roofComponentId = component.id; panels.push(panel); usedArea += g.supportAreaM2; index.add(g)
      }
      if (manual) {
        for (const candidate of manual.filter(p => p.roofSurfaceId === surface.id).sort((a, b) => a.positionMm.x - b.positionMm.x || a.positionMm.y - b.positionMm.y || (a.id ?? '').localeCompare(b.id ?? ''))) {
          if (result.search.candidateChecks >= policy.maxCandidateChecks) { result.search.limitReached = true; break }
          const o = candidate.moduleOrientation ?? orientation
          if (!orientations.includes(o)) { reject('MODULE_ORIENTATION_CONFLICT'); continue }
          consider(makePanel(surface, config, resolved, o, candidate.positionMm, candidate.azimuthDeg, candidate.id))
        }
      } else {
        const b = basis(resolved.arrayRotationDeg), vertices = surface.usableRegionsMm.flatMap(rectanglePolygon)
        const us = vertices.map(p => p.x * b.u.x + p.y * b.u.y), vs = vertices.map(p => p.x * b.v.x + p.y * b.v.y)
        const envelopeW = prototypeGeometry.supportWidthMm + 2 * policy.maintenanceSideMm, envelopeD = prototypeGeometry.supportDepthMm + 2 * policy.maintenanceRowMm
        const pitchU = prototypeGeometry.supportWidthMm + resolved.moduleGapMm, pitchV = prototypeGeometry.supportDepthMm + resolved.rowGapMm
        const startU = Math.min(...us) + envelopeW / 2 + offsetU * pitchU, startV = Math.min(...vs) + envelopeD / 2 + offsetV * pitchV
        outer: for (let v = startV; v <= Math.max(...vs) - envelopeD / 2 + 1e-6; v += pitchV) for (let u = startU; u <= Math.max(...us) - envelopeW / 2 + 1e-6; u += pitchU) {
          if (panels.length >= requested.count) break outer
          if (result.search.candidateChecks >= policy.maxCandidateChecks) { result.search.limitReached = true; break outer }
          consider(makePanel(surface, config, resolved, orientation, { x: b.u.x * u + b.v.x * v, y: b.u.y * u + b.v.y * v }))
        }
      }
      if (panels.length >= requested.count || result.search.limitReached) break
    }
    if (panels.length > best.length) best = panels
    if (best.length >= requested.count || result.search.limitReached || manual) break
  }
  if (manual?.some(p => !surfaces.some(s => s.id === p.roofSurfaceId))) reject('UNSUPPORTED_SURFACE')
  result.layout = buildLayout(best)
  const totals = solarLayoutTotals(result.layout)
  result.achievablePanelCount = totals.panelCount; result.achievableCapacityKwp = totals.capacityKwp
  result.status = best.length >= requested.count ? 'proposed' : 'limited'
  if (result.status === 'limited') {
    result.issues.push(issue('REQUEST_NOT_MET', `Requested ${requested.count} panels; this validated proposal fits ${best.length}.`))
    for (const [code, count] of [...rejected].sort(([a], [b]) => a.localeCompare(b))) result.issues.push(issue(code, `${count} candidate positions rejected by ${code.toLowerCase().replaceAll('_', ' ')}.`))
    result.issues.push(issue('CONSERVATIVE_SEARCH', 'A bounded deterministic grid search is used; this result is not proof of the mathematical maximum.'))
    if (!result.search.candidateChecks) result.issues.push(issue('MODULE_ENVELOPE_DOES_NOT_FIT', 'No grid position fits the full module, support and maintenance dimensions at this rotation.'))
  }
  if (result.search.limitReached) result.issues.push(issue('SEARCH_LIMIT_REACHED', 'The concept search limit was reached; the best checked arrangement is returned.'))
  return result
}

/** Revalidate every persisted measurement/envelope. A valid flag is never trusted. */
export function reviewSolarLayout(layout: SolarLayout, config: SolarConfiguration, roof: SolarRoofModel): LayoutReview {
  if (layout.schemaVersion !== 2) return { state: 'needs-review', reasonCodes: ['LEGACY_LAYOUT_NEEDS_SPECIFICATION'] }
  const parsed = solarLayoutV2Schema.safeParse(layout)
  if (!parsed.success) return { state: 'invalid', reasonCodes: ['LAYOUT_SCHEMA_INVALID'] }
  layout = parsed.data
  const codes: string[] = []
  if (roof.allocationInputsSignature !== solarRoofInputsSignature(config.inputs)) codes.push('ROOF_INPUTS_STALE')
  if (layout.configurationSignature !== solarConfigurationSignature(config)) codes.push('SOLAR_INPUTS_CHANGED')
  if (layout.roofSignature !== roof.roofSignature) codes.push('ROOF_CHANGED')
  if (layout.allocationSignature !== roof.allocationSignature) codes.push('ROOF_ALLOCATION_CHANGED')
  if (JSON.stringify(layout.allocationPolicy) !== JSON.stringify(roof.policy)) codes.push('ALLOCATION_POLICY_CHANGED')
  if (codes.length) return { state: 'needs-review', reasonCodes: codes }
  if (config.intention !== 'install-now') codes.push('INSTALLATION_NOT_SELECTED')
  if (!config.inputs.panel || layout.specificationKey !== solarPanelSpecificationKey(config.inputs.panel) || layout.specificationKey !== solarPanelSpecificationKey(layout.specification)) codes.push('SPECIFICATION_CHANGED')
  if (!config.inputs.panel) return { state: 'invalid', reasonCodes: codes }
  const requested = target(config)
  if (requested.count === null || layout.panels.length > requested.count) codes.push('INVALID_PANEL_COUNT')
  const resolved = resolve(config, roof, layout.placementPolicy)
  if (!resolved || JSON.stringify(resolved) !== JSON.stringify(layout.resolved)) codes.push('RESOLVED_INPUTS_CHANGED')
  const indexes = new Map<string, PanelIndex>(), areas = new Map<string, number>()
  for (const p of layout.panels) {
    const surface = roof.surfaces.find(s => s.id === p.roofSurfaceId)
    if (!surface || surface.kind !== 'flat-top-roof' || surface.status !== 'concept-usable') { codes.push('UNSUPPORTED_SURFACE'); continue }
    const expected = makePanel(surface, config, layout.resolved, p.moduleOrientation, p.positionMm, p.azimuthDeg, p.id)
    if (p.specificationKey !== expected.specificationKey || JSON.stringify(p.dimensionsMm) !== JSON.stringify(expected.dimensionsMm) || p.ratedPowerW !== expected.ratedPowerW ||
      p.baseElevationMm !== expected.baseElevationMm || Math.abs(p.positionMm.z - expected.positionMm.z) > 1e-5 || p.mountingHeightMm !== expected.mountingHeightMm || p.tiltDeg !== expected.tiltDeg) { codes.push('PANEL_GEOMETRY_CHANGED'); continue }
    if (config.inputs.placement.moduleOrientation !== 'auto' && p.moduleOrientation !== config.inputs.placement.moduleOrientation) codes.push('MODULE_ORIENTATION_CONFLICT')
    if (config.inputs.placement.mode !== 'manual' && Math.abs(p.azimuthDeg - layout.resolved.arrayRotationDeg) > 1e-6) codes.push('ARRAY_ROTATION_CHANGED')
    const g = solarPanelGeometry(p, layout.placementPolicy, layout.resolved), fit = fitReason(g, surface)
    if (fit) codes.push(fit)
    const component = surface.components.find(c => c.id === p.roofComponentId && c.access === 'modeled')
    if (!component || !polygonFitsRegions(g.maintenanceEnvelopeMm, component.regionsMm)) codes.push('ROOF_COMPONENT_CHANGED')
    const index = indexes.get(surface.id) ?? new PanelIndex(Math.max(g.supportWidthMm + 2 * Math.max(layout.placementPolicy.maintenanceSideMm, layout.resolved.moduleGapMm), g.supportDepthMm + 2 * Math.max(layout.placementPolicy.maintenanceRowMm, layout.resolved.rowGapMm)))
    if (index.collides(g)) codes.push('PANEL_MAINTENANCE_CONFLICT')
    index.add(g); indexes.set(surface.id, index)
    areas.set(surface.id, (areas.get(surface.id) ?? 0) + g.supportAreaM2)
  }
  for (const [id, area] of areas) if (area > roof.surfaces.find(s => s.id === id)!.maxSolarFootprintAreaM2 + 1e-9) codes.push('ALLOCATION_BUDGET')
  return { state: codes.length ? 'invalid' : 'concept-valid', reasonCodes: [...new Set(codes)].sort() }
}
