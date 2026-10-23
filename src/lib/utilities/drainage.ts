import type { Point, Rect } from '../geometry.ts'
import { subtractRegions } from '../solar/regions.ts'
import type { UtilityFloor, Fixture, DrainageRun } from './plan.ts'
import { route, perimeterRoutes, simplifyPath, utilityObstacles } from './routing.ts'
import { drainageInputsSchema, type DrainageInputs, type DrainageFixtureKind } from './drainageInputs.ts'
import { BRANCH_CAPACITY, BUILDING_CAPACITY, FIXTURE_RULES, RULING_GRADIENTS, INSPECTION_SPACING, RULE_REFERENCES, type DrainageService } from './drainageRules.ts'
import { segmentDistance } from './clashGeometry.ts'

export type DrainageCheck = { id: string; status: 'Pass' | 'Warning' | 'Fail' | 'Not Checked'; category: string; itemId: string; position: Point | null; roomId: string | null; reason: string; correction: string; reference: string }
export type DrainageNode = { id: string; kind: 'fixture' | 'stack' | 'stack_base' | 'inspection_chamber' | 'outlet' | 'trap' | 'cleanout' | 'vent_terminal'; position: Point; elevationMm: number | null; roomId: string | null; service: DrainageService; basis: 'source' | 'proposal' | 'user-input' }
export type DrainagePipe = { id: string; from: string; to: string; service: DrainageService; path: Point[]; lengthMm: number; vertical: boolean; fixtureIds: string[]; dfu: number | null; diameterMm: number | null; candidateDiameterMm: number | null; gradientRatio: number | null; inletInvertMm: number | null; outletInvertMm: number | null; sizingBasis: string; state: 'proposed' | 'blocked'; roomId: string | null }
export type DrainageDesign = { version: 1; nodes: DrainageNode[]; pipes: DrainagePipe[]; checks: DrainageCheck[]; fixtures: { id: string; kind: DrainageFixtureKind; position: Point; roomId: string; ruleKey: string | null; dfu: number | null }[]; status: 'review-required'; input: DrainageInputs }
export const drainageCallout = (kind: DrainageNode['kind']): Point => ({ x: kind === 'cleanout' ? 24 : kind === 'trap' ? -16 : 0, y: kind === 'stack_base' ? 20 : kind === 'vent_terminal' ? -20 : 0 })
export const drainLength = (p: Point[]) => p.slice(1).reduce((n, b, i) => n + Math.hypot(b.x - p[i].x, b.y - p[i].y), 0)
/** Drawing bounds only. Never replaces the architectural footprint. */
export function drainageBounds(model: UtilityFloor): Rect {
  const r = model.floor.outline, points = [...(model.drainageDesign?.nodes.map(n => n.position) ?? []), ...(model.drainageDesign?.pipes.flatMap(p => p.path) ?? [])]
  const x = Math.min(r.x, ...points.map(p => p.x)), y = Math.min(r.y, ...points.map(p => p.y))
  return { x, y, w: Math.max(r.x + r.w, ...points.map(p => p.x)) - x, h: Math.max(r.y + r.h, ...points.map(p => p.y)) - y }
}
const same = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < .01
const inRect = (p: Point, r: Rect) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h
export function segmentHitsRect(a: Point, b: Point, r: Rect): boolean {
  if (inRect(a, r) || inRect(b, r)) return true
  if (a.x === b.x) return a.x > r.x && a.x < r.x + r.w && Math.max(a.y, b.y) > r.y && Math.min(a.y, b.y) < r.y + r.h
  if (a.y === b.y) return a.y > r.y && a.y < r.y + r.h && Math.max(a.x, b.x) > r.x && Math.min(a.x, b.x) < r.x + r.w
  return true // Unsupported diagonals never bypass obstacle checking.
}
const allowed = (path: Point[], cuts: Rect[]) => path.length >= 2 && !path.slice(1).some((b, i) => cuts.some(r => segmentHitsRect(path[i], b, r)))
const inflated = (r: Rect, n: number) => ({ x: r.x - n, y: r.y - n, w: r.w + 2 * n, h: r.h + 2 * n })
/** Manhattan visibility graph: deterministic, fewest developed mm then bends.
 * It never opens a door/wall or grants structural permission. Bounded work. */
export function routeDrain(from: Point, to: Point, cuts: Rect[], bounds: Rect): Point[] | null {
  if (cuts.some(r => inRect(from, r) || inRect(to, r))) return null
  const simple = [route(from, to), route(from, to, true), ...perimeterRoutes(from, to, bounds)].filter(p => allowed(p, cuts)).sort((a, b) => drainLength(a) - drainLength(b) || a.length - b.length)
  if (simple.length) return simplifyPath(simple[0])
  const xs = [...new Set([from.x, to.x, bounds.x, bounds.x + bounds.w, ...cuts.flatMap(r => [r.x, r.x + r.w])])].filter(x => x >= bounds.x && x <= bounds.x + bounds.w).sort((a, b) => a - b)
  const ys = [...new Set([from.y, to.y, bounds.y, bounds.y + bounds.h, ...cuts.flatMap(r => [r.y, r.y + r.h])])].filter(y => y >= bounds.y && y <= bounds.y + bounds.h).sort((a, b) => a - b)
  if (xs.length * ys.length > 12000) return null
  const points = xs.flatMap(x => ys.map(y => ({ x, y }))), count = ys.length, start = points.findIndex(p => same(p, from)), goal = points.findIndex(p => same(p, to))
  const dist = new Map([[start, 0]]), prev = new Map<number, number>(), open = new Set([start])
  while (open.size) {
    const u = [...open].sort((a, b) => dist.get(a)! - dist.get(b)! || a - b)[0]; open.delete(u)
    if (u === goal) { const path = [points[u]]; let k = u; while (prev.has(k)) { k = prev.get(k)!; path.unshift(points[k]) } return simplifyPath(path) }
    for (const v of [u - count, u + count, ...(u % count > 0 ? [u - 1] : []), ...(u % count < count - 1 ? [u + 1] : [])]) {
      if (v < 0 || v >= points.length || !allowed([points[u], points[v]], cuts)) continue
      const d = dist.get(u)! + drainLength([points[u], points[v]])
      if (d < (dist.get(v) ?? Infinity)) { dist.set(v, d); prev.set(v, u); open.add(v) }
    }
  }
  return null
}
export function fixtureKind(f: Fixture, model: UtilityFloor): DrainageFixtureKind {
  if (f.drainageKind) return f.drainageKind
  if (f.type !== 'sink') return f.type === 'toilet' ? 'toilet' : f.type
  if (/-basin$/.test(f.id)) return 'washbasin'
  return /kitchen/i.test(model.floor.rooms.find(r => r.id === f.roomId)?.name ?? '') ? 'kitchen_sink' : 'unknown_sink'
}
export function sizeBranch(dfu: number, minimum: number) { return BRANCH_CAPACITY.find(([d, cap]) => d >= minimum && cap >= dfu)?.[0] ?? null }
export function sizeBuildingDrain(dfu: number, minimum: number, ratio: number) {
  const column = ratio <= 25 ? 3 : ratio <= 50 ? 2 : ratio <= 100 ? 1 : null
  return column ? BUILDING_CAPACITY.find(row => row[0] >= Math.max(100, minimum) && row[column] >= dfu)?.[0] ?? null : null
}
/** Explicit shared-datum arithmetic. No level is inferred from room names. */
export function invertCalculation(lengthMm: number, ratio: number | null, inlet: number | null, outlet: number | null) {
  const dropMm = ratio === null ? null : lengthMm / ratio
  return { inlet: inlet ?? (outlet !== null && dropMm !== null ? outlet + dropMm : null), outlet: outlet ?? (inlet !== null && dropMm !== null ? inlet - dropMm : null), dropMm,
    residualMm: inlet !== null && outlet !== null && dropMm !== null ? inlet - outlet - dropMm : null }
}

export function designDrainage(model: UtilityFloor, raw: DrainageInputs): DrainageDesign {
  const input = drainageInputsSchema.parse(raw), nodes: DrainageNode[] = [], pipes: DrainagePipe[] = [], checks: DrainageCheck[] = []
  const check = (category: string, itemId: string, status: DrainageCheck['status'], reason: string, correction: string, position: Point | null = null, roomId: string | null = null, reference = RULE_REFERENCES.connectivity as string) => checks.push({ id: `DR:${category}:${itemId}:${checks.length}`, category, itemId, status, reason, correction, position, roomId, reference })
  const floor = model.floor, original = model.fixtures.map(f => ({ id: f.id, kind: fixtureKind(f, model), position: f.position, roomId: f.roomId, source: true }))
  const existingIds = new Set(original.map(f => f.id))
  const fixtures = [...original, ...input.fixtures.filter(f => !existingIds.has(f.id)).map(f => ({ ...f, source: false }))].map(f => {
    const key = input.fixtureChoices[f.id] ? input.fixtureChoices[f.id].ruleKey || null : f.kind !== 'toilet' && f.kind !== 'unknown_sink' ? f.kind : null
    const rule = key ? FIXTURE_RULES[key] : null
    const kind = f.kind === 'unknown_sink' && rule && ['washbasin', 'kitchen_sink'].includes(rule.kind) ? rule.kind : f.kind
    return { ...f, kind, ruleKey: rule?.kind === kind ? key : null, dfu: rule?.kind === kind ? rule.dfu : null }
  })
  const validFixtures = fixtures.filter(f => {
    const room = floor.rooms.find(r => r.id === f.roomId)
    if (!room || !inRect(f.position, room.rect) || utilityObstacles(floor).some(r => inRect(f.position, r))) { check('Fixture location', f.id, 'Fail', 'Fixture is outside its source room or inside a restricted area.', 'Move the proposed fixture to a clear, represented room.', f.position, f.roomId); return false }
    return true
  })
  for (const f of input.fixtures.filter(f => existingIds.has(f.id))) check('Fixture inventory', f.id, 'Fail', 'Proposed fixture ID duplicates a source fixture; the duplicate was not applied.', 'Use a unique identifier for the additional fixture.', f.position, f.roomId)
  const beams = floor.structuralSizing?.beams?.map(b => ({ x: Math.min(b.a.x, b.b.x) - b.widthMm / 2, y: Math.min(b.a.y, b.b.y) - b.widthMm / 2, w: Math.abs(b.a.x - b.b.x) + b.widthMm, h: Math.abs(b.a.y - b.b.y) + b.widthMm })) ?? []
  const baseCuts = [...utilityObstacles(floor), ...input.reserved.map(x => x.rect)]
  const walls = floor.walls.map(w => ({ x: Math.min(w.a.x, w.b.x) - w.thickness / 2, y: Math.min(w.a.y, w.b.y) - w.thickness / 2, w: Math.abs(w.a.x - w.b.x) + w.thickness, h: Math.abs(w.a.y - w.b.y) + w.thickness }))
  // Footing footprints stay protected at every level until a reviewed 3D route
  // establishes otherwise. Beam plans are reported separately when levels absent.
  const footings = floor.structuralSizing?.footings?.map(f => f.rect) ?? []
  const node = (id: string, kind: DrainageNode['kind'], position: Point, service: DrainageService, elevationMm: number | null = null, roomId: string | null = null, basis: DrainageNode['basis'] = 'proposal') => { const n = { id, kind, position: { ...position }, service, elevationMm, roomId, basis }; nodes.push(n); return n }
  const sourceStacks = model.symbols.filter(s => s.layer === 'drainage')
  const assigned = new Map<string, string>()
  for (const f of validFixtures) {
    const choice = input.fixtureChoices[f.id], rule = f.ruleKey ? FIXTURE_RULES[f.ruleKey] : null
    const start = node(f.id, 'fixture', f.position, f.kind === 'toilet' ? 'soil' : 'waste', input.datum ? choice?.invertMm ?? null : null, f.roomId, f.source ? 'source' : 'user-input')
    node(`trap:${f.id}`, 'trap', f.position, start.service, start.elevationMm, f.roomId)
    check('Fixture loading', f.id, rule ? 'Pass' : 'Not Checked', rule ? `${rule.dfu} DFU; minimum outlet/branch basis ${rule.minimumMm} mm. Private residential use.` : 'Fixture type / flushing arrangement is not sufficiently specified.', 'Confirm the fixture specification and private residential use.', f.position, f.roomId, rule ? `NBC 2016 P9/S2 ${rule.clause}` : RULE_REFERENCES.sizing)
    check('Trap', f.id, choice?.trapConfirmed ? 'Pass' : 'Not Checked', choice?.trapConfirmed ? 'User confirms an accessible liquid-seal trap; seal depth still requires review.' : 'A liquid-seal trap is required; integrated versus attached trap and seal depth are unverified.', 'Verify the actual fixture trap, seal and access. Do not add a second trap to an integral WC trap.', f.position, f.roomId, RULE_REFERENCES.traps)
    let stack = sourceStacks.find(s => s.roomIds.includes(f.roomId))
    if (!stack) { check('Connectivity', f.id, 'Fail', 'No supported stack location is represented for this room.', 'Provide a reviewed stack/service shaft location.', f.position, f.roomId); continue }
    assigned.set(f.id, stack.id)
    if (!nodes.some(n => n.id === stack.id)) node(stack.id, 'stack', stack.position, 'soil', null, f.roomId)
    const legacy = model.utilities.find(u => u.layer === 'drainage' && u.fixtureId === f.id)
    const radius = (rule?.minimumMm ?? (legacy?.layer === 'drainage' ? legacy.diameter : 0)) / 2 + input.conceptClearanceMm
    const room = floor.rooms.find(r => r.id === f.roomId)!
    const candidates = [route(f.position, stack.position), route(f.position, stack.position, true), ...perimeterRoutes(f.position, stack.position, room.rect)].filter(p => allowed(p, baseCuts.map(r => inflated(r, radius)))).sort((a, b) => drainLength(a) - drainLength(b) || a.length - b.length)
    const path = candidates[0] ?? routeDrain(f.position, stack.position, baseCuts.map(r => inflated(r, radius)), room.rect)
    if (!path) { check('Connectivity', f.id, 'Fail', 'No clear fixture branch can reach its stack.', 'Move fixture/stack or provide a reviewed service route; no line was drawn through structure.', f.position, f.roomId); continue }
    pipes.push({ id: legacy?.id ?? `D:${f.id}`, from: f.id, to: stack.id, service: start.service, path, lengthMm: drainLength(path), vertical: false, fixtureIds: [f.id], dfu: f.dfu, diameterMm: null, candidateDiameterMm: legacy?.layer === 'drainage' ? legacy.diameter : null, gradientRatio: null, inletInvertMm: start.elevationMm, outletInvertMm: null, sizingBasis: '', state: 'proposed', roomId: f.roomId })
  }
  const outlet = input.outlet.position ? node('drainage:outlet', 'outlet', input.outlet.position, 'building_drain', input.datum ? input.outlet.invertMm : null, null, 'user-input') : null
  const chamber = input.inspectionChamber ? node('drainage:chamber', 'inspection_chamber', input.inspectionChamber, 'building_drain', null, null, 'user-input') : null
  const r = floor.outline, bounds = { x: Math.min(r.x, outlet?.position.x ?? r.x, chamber?.position.x ?? r.x) - 1000, y: Math.min(r.y, outlet?.position.y ?? r.y, chamber?.position.y ?? r.y) - 1000, w: Math.max(r.x + r.w, outlet?.position.x ?? 0, chamber?.position.x ?? 0) - Math.min(r.x, outlet?.position.x ?? r.x, chamber?.position.x ?? r.x) + 2000, h: Math.max(r.y + r.h, outlet?.position.y ?? 0, chamber?.position.y ?? 0) - Math.min(r.y, outlet?.position.y ?? r.y, chamber?.position.y ?? r.y) + 2000 }
  const total = (ids: string[]) => ids.every(id => fixtures.find(f => f.id === id)?.dfu !== null) ? ids.reduce((n, id) => n + (fixtures.find(f => f.id === id)?.dfu ?? 0), 0) : null
  const addCollector = (from: DrainageNode, to: DrainageNode, ids: string[]) => {
    const id = `D:${from.id}->${to.id}`, spec = input.pipes[id], hasLevels = !!input.datum && spec?.inletInvertMm != null && spec?.outletInvertMm != null
    const permitted = hasLevels ? input.penetrations.filter(p => Math.min(spec.inletInvertMm!, spec.outletInvertMm!) >= p.minElevationMm && Math.max(spec.inletInvertMm!, spec.outletInvertMm!) + (spec.diameterMm ?? 0) <= p.maxElevationMm).map(p => p.rect) : []
    const cuts = [...baseCuts, ...footings, ...subtractRegions(walls, permitted)].map(r => inflated(r, (spec?.diameterMm ?? 100) / 2 + input.conceptClearanceMm))
    const routed = routeDrain(from.position, to.position, cuts, bounds)
    if (!routed) check('Connectivity', id, 'Fail', 'No route to the next drainage node without crossing a protected wall, column, footing or reservation.', 'Provide surveyed external routing and level-specific approved sleeves. Structural penetrations are never assumed. The blocked candidate is shown for review only.', from.position, from.roomId)
    const path = routed ?? route(from.position, to.position)
    pipes.push({ id, from: from.id, to: to.id, service: 'building_drain', path, lengthMm: drainLength(path), vertical: false, fixtureIds: ids, dfu: total(ids), diameterMm: null, candidateDiameterMm: spec?.diameterMm ?? null, gradientRatio: null, inletInvertMm: from.elevationMm, outletInvertMm: to.elevationMm, sizingBasis: '', state: routed ? 'proposed' : 'blocked', roomId: from.roomId })
    path.slice(1, -1).forEach((p, i) => node(`${id}:IC:${i}`, 'inspection_chamber', p, 'building_drain'))
  }
  for (const stack of nodes.filter(n => n.kind === 'stack')) {
    const ids = validFixtures.filter(f => assigned.get(f.id) === stack.id).map(f => f.id), b = input.stackBases[stack.id]
    stack.service = validFixtures.some(f => ids.includes(f.id) && f.kind === 'toilet') ? 'soil' : 'waste'
    const base = node(`${stack.id}:base`, 'stack_base', b?.position ?? stack.position, stack.service, input.datum ? b?.invertMm ?? null : null, stack.roomId, b ? 'user-input' : 'proposal')
    node(`CO:${stack.id}`, 'cleanout', base.position, stack.service, base.elevationMm, stack.roomId)
    if (!same(stack.position, base.position)) check('Stack continuity', stack.id, 'Fail', 'Stack base is offset from the floor stack; no horizontal offset was invented.', 'Provide a reviewed offset and fittings or align the surveyed base.', base.position, stack.roomId)
    else pipes.push({ id: `D:${stack.id}:vertical`, from: stack.id, to: base.id, service: stack.service, path: [stack.position, base.position], lengthMm: 0, vertical: true, fixtureIds: ids, dfu: total(ids), diameterMm: null, candidateDiameterMm: null, gradientRatio: null, inletInvertMm: null, outletInvertMm: base.elevationMm, sizingBasis: 'Stack totals across every floor / branch interval not verified.', state: 'proposed', roomId: stack.roomId })
    const terminal = input.ventTerminals[stack.id], vent = node(`V:${stack.id}`, 'vent_terminal', stack.position, 'vent', input.datum ? terminal?.elevationMm ?? null : null, stack.roomId)
    pipes.push({ id: `V:${stack.id}:pipe`, from: stack.id, to: vent.id, service: 'vent', path: [stack.position, vent.position], lengthMm: 0, vertical: true, fixtureIds: ids, dfu: total(ids), diameterMm: terminal?.diameterMm ?? null, candidateDiameterMm: null, gradientRatio: null, inletInvertMm: null, outletInvertMm: vent.elevationMm, sizingBasis: 'Vent proposal only; developed length, sizing, trap arms and terminal separation require professional review.', state: 'proposed', roomId: stack.roomId })
    check('Ventilation', stack.id, 'Not Checked', 'A vent continuation is proposed. Vent diameter, developed length, trap-arm protection, roof termination, cowl and separation from openings are not validated.', 'Provide the complete section and verify NBC Table 17 / vent provisions.', vent.position, stack.roomId, RULE_REFERENCES.vent)
    if (base.elevationMm === null) check('Stack base', base.id, 'Not Checked', 'Stack base position/level is a proposal, not a surveyed ground connection.', 'Enter a reviewed base and shared-datum invert.', base.position, stack.roomId)
    if (chamber) addCollector(base, chamber, ids)
  }
  if (chamber && outlet) addCollector(chamber, outlet, validFixtures.map(f => f.id))
  check('Outlet', 'outlet', !outlet || input.outlet.kind === 'unknown' ? 'Fail' : input.outlet.approvalReference ? 'Warning' : 'Not Checked', !outlet ? 'No explicit discharge point. The system has no complete outlet path.' : input.outlet.kind === 'unknown' ? 'Discharge destination type is unknown.' : input.outlet.approvalReference ? 'An approval reference was entered by the user; official validity is not independently verified.' : 'Discharge point is user-proposed; approval evidence is missing.', 'Confirm sewer availability or an approved septic/treatment design, position, connection level and authority permission.', outlet?.position ?? null)
  if (!chamber) check('Inspection access', 'chamber', 'Fail', 'No reviewed main inspection chamber is defined.', 'Enter its actual position and provide access, cover loading and invert details.', null, null, RULE_REFERENCES.access)
  check('Local authority', 'authority', 'Not Checked', `${input.city || 'City unknown'} / ${input.authority}. Current local amendments, authority boundary and connection conditions are unverified.`, 'Have the applicable Pune authority / licensed professional review the drainage submission.', null, null, 'PMC-hosted UDCPR 2020 (updated 2022), 12.5–12.6; current local adoption unverified')
  check('Stormwater', 'separate', 'Not Checked', 'Sanitary graph contains no stormwater connections. Roof/site runoff inputs, rainfall, roof outlets and an approved stormwater destination are not represented.', 'Design a separate roof/site network; never discharge sanitary wastewater to a storm drain.', null, null, RULE_REFERENCES.separation)
  check('Survey datum', 'datum', input.datum && input.floorElevationMm !== null && input.groundElevationMm !== null ? 'Pass' : 'Not Checked', 'Floor, ground and all inverts must share the stated survey datum. Architectural storey height is not an outlet level.', 'Provide datum, floor level and ground level in mm.', null)
  check('Structure completeness', 'structure', 'Not Checked', 'Foundation, slab sleeves, beam elevations, cover depths and waterproofing require a reviewed section. Plan-only clearance is insufficient.', 'Confirm foundation/beam geometry, pipe cover and authorised penetrations; no structural opening is granted.', null, null, RULE_REFERENCES.structure)
  check('Site boundary', 'boundary', 'Not Checked', 'Exterior collector candidates are not checked against a surveyed property boundary, easements or public-road excavation permission.', 'Survey the site route and verify authority permission before accepting any external collector.', null, null, RULE_REFERENCES.structure)
  const index = new Map(nodes.map(n => [n.id, n]))
  for (const pipe of pipes) {
    if (pipe.service === 'vent') continue
    const minimum = Math.max(0, ...pipe.fixtureIds.map(id => { const f = fixtures.find(f => f.id === id); return f?.ruleKey ? FIXTURE_RULES[f.ruleKey].minimumMm : 0 }))
    const spec = input.pipes[pipe.id], main = pipe.service === 'building_drain'
    let diameter = pipe.dfu === null || pipe.vertical ? null : main ? sizeBuildingDrain(pipe.dfu, minimum, spec?.gradientRatio ?? 57) : sizeBranch(pipe.dfu, minimum)
    // A suggested diameter is still a calculation basis, not approval of a
    // catalogue nominal size. User overrides are checked, never trusted blindly.
    const selected = spec?.diameterMm ?? diameter
    const ratio = pipe.vertical ? null : spec?.gradientRatio ?? (main && selected ? RULING_GRADIENTS[selected]?.ratio ?? null : null)
    if (main && pipe.dfu !== null && ratio !== null) diameter = sizeBuildingDrain(pipe.dfu, minimum, ratio)
    pipe.diameterMm = selected; pipe.gradientRatio = ratio
    pipe.sizingBasis = pipe.vertical ? pipe.sizingBasis : `${RULE_REFERENCES.sizing}; ${main ? 'Table 21, conservative flatter tabulated slope' : 'Table 20 horizontal branch'}; minimum fixture outlet applied.`
    check('Sizing', pipe.id, pipe.dfu === null || pipe.vertical || main && model.sourceFloorLevels?.length !== 1 ? 'Not Checked' : diameter === null || selected === null || selected < diameter ? 'Fail' : 'Pass', pipe.vertical ? 'Current-floor loading is insufficient to size a complete multi-floor stack.' : pipe.dfu === null ? 'Connected fixture load is unknown; pipe size is not verified.' : `${pipe.dfu} current-floor DFU${main && model.sourceFloorLevels?.length !== 1 ? "; complete multi-floor accumulation unverified" : ""}; calculated minimum ${diameter ?? 'outside supported tables'} mm; proposed ${selected ?? 'unknown'} mm.`, 'Confirm actual internal bore, fixture specifications, all connected floors and applicable pipe table.', pipe.path[0], pipe.roomId, RULE_REFERENCES.sizing)
    check('Peak discharge', pipe.id, 'Not Checked', 'DFU is a drainage loading factor, not litres/second. Actual peak discharge and partial-depth hydraulic performance are not calculated.', 'Have the designer verify NBC Fig. 6 peak-flow conversion, simultaneous use and the actual pipe hydraulic model.', pipe.path[0], pipe.roomId, 'NBC 2016 P9/S2 4.5.3.5.1(a)(4), Fig. 6')
    if (pipe.vertical) {
      const incoming = pipes.filter(p => p.to === pipe.from && p.service !== 'vent')
      if (incoming.length && incoming.every(p => p.outletInvertMm !== null)) pipe.inletInvertMm = Math.min(...incoming.map(p => p.outletInvertMm!))
    }
    const calc = invertCalculation(pipe.lengthMm, ratio, input.datum ? spec?.inletInvertMm ?? pipe.inletInvertMm : null, input.datum ? spec?.outletInvertMm ?? pipe.outletInvertMm : null)
    pipe.inletInvertMm = calc.inlet; pipe.outletInvertMm = calc.outlet
    if (pipe.vertical && calc.inlet !== null && calc.outlet !== null) pipe.lengthMm = Math.abs(calc.inlet - calc.outlet)
    const gravityStatus = calc.inlet === null || calc.outlet === null || !pipe.vertical && ratio === null ? 'Not Checked' : calc.inlet <= calc.outlet || calc.residualMm !== null && Math.abs(calc.residualMm) > 1 ? 'Fail' : 'Pass'
    check('Gravity / inverts', pipe.id, gravityStatus, `${pipe.lengthMm / 1000} m; ${ratio ? `gradient 1:${ratio}; required fall ${(pipe.lengthMm / ratio).toFixed(1)} mm` : 'gradient unknown'}; inlet ${calc.inlet ?? 'unknown'}, outlet ${calc.outlet ?? 'unknown'} mm. ${gravityStatus === 'Fail' ? 'Gravity fall is inconsistent or uphill.' : 'Calculated endpoints are not surveyed levels.'}`, gravityStatus === 'Fail' ? 'Revise route/levels; have an engineer assess a pumped system if gravity is impossible. No pump is automatically specified.' : 'Provide surveyed invert(s), floor/ground datum and a reviewed gradient.', pipe.path[0], pipe.roomId, RULE_REFERENCES.gradient)
    if (!pipe.vertical && selected && ratio) {
      const v = (1 / .015) * Math.pow(selected / 4000, 2 / 3) * Math.sqrt(1 / ratio)
      check('Hydraulic screening', pipe.id, main ? v < .75 || v > 2.4 ? 'Warning' : 'Pass' : 'Not Checked', `Half-full Manning screening: ${v.toFixed(2)} m/s, n=0.015. This is not predicted actual flow or a peak-flow validation.`, 'Verify peak flow (NBC Fig. 6), actual material, partial depth, intermittent discharge and self-cleansing. Branch trap-arm slope still requires review.', pipe.path[0], pipe.roomId, RULE_REFERENCES.gradient)
    }
    // All walls (including windows/door apertures) are protected until reviewed
    // level-specific permission spans the complete pipe envelope.
    if (!pipe.vertical) {
      const permitted = pipe.inletInvertMm !== null && pipe.outletInvertMm !== null && selected !== null ? input.penetrations.filter(p => Math.min(pipe.inletInvertMm!, pipe.outletInvertMm!) >= p.minElevationMm && Math.max(pipe.inletInvertMm!, pipe.outletInvertMm!) + selected <= p.maxElevationMm).map(p => p.rect) : []
      const protectedAreas = [...baseCuts, ...footings, ...subtractRegions(walls, permitted)].map(r => inflated(r, (selected ?? pipe.candidateDiameterMm ?? 0) / 2 + input.conceptClearanceMm))
      const blocked = !allowed(pipe.path, protectedAreas)
      pipe.state = blocked || pipe.state === 'blocked' ? 'blocked' : 'proposed'
      check('Structure / route', pipe.id, blocked ? 'Fail' : selected === null ? 'Not Checked' : 'Pass', blocked ? 'Pipe envelope intersects a protected wall, column, footing, void or reserved area. This line is an unresolved proposal.' : selected === null ? 'No centreline obstruction found, but the pipe diameter/envelope is unknown.' : 'No overlap with represented protected plan areas at the selected concept envelope.', 'Reroute around structure or enter a referenced, level-specific approved sleeve; verify unrepresented beam/slab/foundation details separately.', pipe.path[0], pipe.roomId, RULE_REFERENCES.structure)
      if (!allowed(pipe.path, beams)) check('Beam section', pipe.id, 'Not Checked', 'The pipe crosses a represented beam in plan. Its vertical relation to the beam is not established; no beam penetration is permitted.', 'Check the source beam section and pipe envelope at the shared survey datum; reroute if they intersect.', pipe.path[0], pipe.roomId, RULE_REFERENCES.structure)
    }
    if (main && !nodes.some(n => n.kind === 'cleanout' && same(n.position, pipe.path[0]))) node(`CO:${pipe.id}`, 'cleanout', pipe.path[0], pipe.service, pipe.inletInvertMm, pipe.roomId)
    const bends = pipe.path.length - 2
    check('Junction / fittings', pipe.id, 'Not Checked', `${bends} plan bends. Flow is ${pipe.from} → ${pipe.to}; fitting angles, entry heights and swept junctions are not represented by orthogonal linework.`, 'Specify swept drainage fittings and access at changes. Do not treat a plan corner as a square elbow.', pipe.path.at(-1)!, pipe.roomId, RULE_REFERENCES.connectivity)
    // Shared-datum joins must agree. Never fix level mismatches silently.
    for (const [id, level] of [[pipe.from, pipe.inletInvertMm], [pipe.to, pipe.outletInvertMm]] as const) {
      const n = index.get(id)!
      if (n.kind === 'stack') continue // Multiple entries may join a vertical stack at different elevations.
      if (n.elevationMm !== null && level !== null && Math.abs(n.elevationMm - level) > 1) check('Junction level', pipe.id, 'Fail', `Pipe invert ${level} mm disagrees with node ${id} at ${n.elevationMm} mm.`, 'Correct the common junction invert or document a designed drop.', n.position, pipe.roomId)
      else if (level !== null && n.elevationMm === null) n.elevationMm = level
    }
  }
  for (const n of nodes.filter(n => n.kind === 'stack' || n.kind === 'inspection_chamber')) {
    const incoming = pipes.filter(p => p.to === n.id && p.service !== 'vent'), outgoing = pipes.find(p => p.from === n.id && p.service !== 'vent')
    if (outgoing && incoming.length) check('Downstream bore', n.id, outgoing.diameterMm === null || incoming.some(p => p.diameterMm === null) ? 'Not Checked' : incoming.some(p => p.diameterMm! > outgoing.diameterMm!) ? 'Fail' : 'Pass', 'Sanitary pipe diameter must not decrease in the direction of flow.', 'Size the stack and downstream drain for all upstream fixtures before confirming this junction.', n.position, n.roomId, RULE_REFERENCES.sizing)
  }
  for (const p of pipes.filter(p => p.service === 'building_drain')) check('Ground / cover', p.id, input.groundElevationMm === null || p.inletInvertMm === null || p.diameterMm === null ? 'Not Checked' : p.inletInvertMm + p.diameterMm >= input.groundElevationMm ? 'Fail' : 'Not Checked', 'Buried building drain crown and required cover need a surveyed longitudinal ground profile, bedding and loading design. A single ground point cannot verify the full route.', 'Provide site levels along the route and verify cover / foundations; do not hide an above-ground crown.', p.path[0], p.roomId, RULE_REFERENCES.structure)
  for (const p of pipes.filter(p => p.service === 'building_drain')) if (p.path.slice(1).some((b, i) => drainLength([p.path[i], b]) > INSPECTION_SPACING.maximumMm)) check('Inspection spacing', p.id, 'Fail', 'A straight building-drain segment exceeds 45 m without a represented intermediate inspection point (NBC spacing subset: pipe up to 300 mm).', 'Provide reviewed intermediate inspection access and split the drain into maintainable segments.', p.path[0], p.roomId, INSPECTION_SPACING.reference)
  for (const room of floor.rooms.filter(r => !r.outdoor && /kitchen|laundry|utility/i.test(r.name))) if (!validFixtures.some(f => f.roomId === room.id && ['kitchen_sink', 'washing_machine'].includes(f.kind))) check('Fixture inventory', room.id, 'Warning', 'No represented kitchen sink / washing machine in this room. A floor drain does not substitute for an appliance connection.', 'Confirm intended appliances and add their actual proposed positions; no fixture is invented.', { x: room.rect.x + room.rect.w / 2, y: room.rect.y + room.rect.h / 2 }, room.id)
  const connected = (start: string) => { const seen = new Set<string>(); let id = start; while (!seen.has(id)) { if (id === outlet?.id) return true; seen.add(id); const edges = pipes.filter(p => p.from === id && p.service !== 'vent' && p.state !== 'blocked'); if (edges.length !== 1) return false; id = edges[0].to } return false }
  for (const f of validFixtures) check('Outlet connectivity', f.id, connected(f.id) ? 'Pass' : 'Fail', connected(f.id) ? 'One directed current-floor sanitary route reaches the specified outlet (approval and elevations remain separate checks).' : 'No complete unblocked directed route reaches the final outlet.', 'Resolve the indicated missing/blocked branch, stack base, collector or outlet; no discharge is assumed.', f.position, f.roomId)
  for (const n of nodes.filter(n => ['cleanout', 'inspection_chamber'].includes(n.kind))) check('Maintenance access', n.id, input.maintenanceConfirmed.includes(n.id) ? 'Warning' : 'Not Checked', input.maintenanceConfirmed.includes(n.id) ? 'Access confirmed by user; dimensions, cover loading and rodding reach require professional verification.' : 'Proposed access point; clear working space, cover and rodding access are unverified.', 'Verify physical access and chamber spacing/size at changes of direction, grade and size.', n.position, n.roomId, RULE_REFERENCES.access)
  const horizontals = pipes.filter(p => !p.vertical && p.service !== 'vent')
  for (let a = 0; a < horizontals.length; a++) for (let b = a + 1; b < horizontals.length; b++) {
    const p = horizontals[a], q = horizontals[b], common = [p.from, p.to].filter(id => id === q.from || id === q.to).map(id => index.get(id)!.position)
    let at: Point | null = null, physicalDistance = Infinity, beforeP = 0
    const radius = (p.diameterMm ?? 0) / 2 + (q.diameterMm ?? 0) / 2 + input.conceptClearanceMm
    for (let i = 1; i < p.path.length; i++) {
      let beforeQ = 0
      for (let j = 1; j < q.path.length; j++) {
        const u = p.path[i - 1], v = p.path[i], w = q.path[j - 1], x = q.path[j], flat = segmentDistance([u.x, u.y, 0], [v.x, v.y, 0], [w.x, w.y, 0], [x.x, x.y, 0])
        let position = flat.position, overlap = false
        if (u.x === v.x && w.x === x.x && u.x === w.x) { const lo = Math.max(Math.min(u.y, v.y), Math.min(w.y, x.y)), hi = Math.min(Math.max(u.y, v.y), Math.max(w.y, x.y)); if (hi - lo > .01) { position = { x: u.x, y: (lo + hi) / 2 }; overlap = true } }
        if (u.y === v.y && w.y === x.y && u.y === w.y) { const lo = Math.max(Math.min(u.x, v.x), Math.min(w.x, x.x)), hi = Math.min(Math.max(u.x, v.x), Math.max(w.x, x.x)); if (hi - lo > .01) { position = { x: (lo + hi) / 2, y: u.y }; overlap = true } }
        if (flat.distance <= radius + .01 && (overlap || !common.some(c => same(c, position)))) {
          at = position
          if ([p.inletInvertMm, p.outletInvertMm, q.inletInvertMm, q.outletInvertMm, p.diameterMm, q.diameterMm].every(n => n !== null)) {
            const z = (pipe: DrainagePipe, point: Point, start: Point, before: number) => pipe.inletInvertMm! + (pipe.outletInvertMm! - pipe.inletInvertMm!) * (before + Math.hypot(point.x - start.x, point.y - start.y)) / (pipe.lengthMm || 1) + pipe.diameterMm! / 2
            physicalDistance = Math.min(physicalDistance, segmentDistance([u.x, u.y, z(p, u, u, beforeP)], [v.x, v.y, z(p, v, u, beforeP)], [w.x, w.y, z(q, w, w, beforeQ)], [x.x, x.y, z(q, x, w, beforeQ)]).distance)
          }
        }
        beforeQ += drainLength([w, x])
      }
      beforeP += drainLength([p.path[i - 1], p.path[i]])
    }
    if (at) check('Drain crossing / junction', `${p.id}/${q.id}`, physicalDistance === Infinity ? 'Not Checked' : physicalDistance < radius ? 'Fail' : 'Pass', `Separate drainage runs cross / overlap away from a common graph node. ${physicalDistance === Infinity ? 'Level/envelope information is missing.' : `3D centreline separation ${physicalDistance.toFixed(1)} mm.`} No automatic junction or pipe bridge was inserted.`, 'Reroute or specify a reviewed swept junction/common branch with aggregated loading and consistent inverts; do not leave coincident separate pipes.', at, p.roomId, RULE_REFERENCES.connectivity)
  }
  // Cross-service proximity remains a drainage-review result, not the retired
  // global clash UI. Unknown service levels cannot be reported as clear.
  for (const p of pipes.filter(p => !p.vertical && p.service !== 'vent')) for (const other of model.utilities.filter(u => u.layer !== 'drainage')) {
    const radius = input.conceptClearanceMm + (p.diameterMm ?? p.candidateDiameterMm ?? 0) / 2 + ('diameter' in other ? other.diameter / 2 : 0)
    let at: Point | null = null, distance = Infinity, before = 0
    for (let i = 1; i < p.path.length; i++) {
      for (let j = 1; j < other.path.length; j++) {
        const a = p.path[i - 1], b = p.path[i], c = other.path[j - 1], d = other.path[j], flat = segmentDistance([a.x, a.y, 0], [b.x, b.y, 0], [c.x, c.y, 0], [d.x, d.y, 0])
        if (flat.distance > radius + .01) continue
        at = flat.position
        if (input.datum && p.inletInvertMm !== null && p.outletInvertMm !== null && p.diameterMm !== null && input.serviceLevels[other.id] !== undefined) {
          const z = (point: Point) => p.inletInvertMm! + (p.outletInvertMm! - p.inletInvertMm!) * (before + Math.hypot(point.x - a.x, point.y - a.y)) / (p.lengthMm || 1) + p.diameterMm! / 2
          distance = Math.min(distance, segmentDistance([a.x, a.y, z(a)], [b.x, b.y, z(b)], [c.x, c.y, input.serviceLevels[other.id]], [d.x, d.y, input.serviceLevels[other.id]]).distance)
        }
      }
      before += drainLength([p.path[i - 1], p.path[i]])
    }
    if (at) check('Utility coordination', `${p.id}/${other.id}`, distance === Infinity ? 'Not Checked' : distance < radius ? 'Fail' : 'Pass', `Near ${other.layer} ${other.id}. ${distance === Infinity ? 'Surveyed service centre levels / pipe envelope missing.' : `Closest centreline separation ${distance.toFixed(1)} mm; concept envelope ${radius} mm.`}`, 'Verify both service sections, conduit envelopes, protective separation and applicable MEP rules. Concept clearance is not a code value.', at, p.roomId, 'Project concept clearance policy; user-supplied service centre levels, shared datum')
  }
  for (const id of Object.keys(input.fixtureChoices)) if (!fixtures.some(f => f.id === id)) check('Stale input', id, 'Warning', 'A saved fixture specification no longer matches the current source layout.', 'Review the changed plan and remove/reassign obsolete drainage inputs.')
  for (const id of Object.keys(input.pipes)) if (!pipes.some(p => p.id === id)) check('Stale input', id, 'Warning', 'A saved pipe override does not match a generated pipe in the current layout.', 'Review the outlet/stack settings and remove or reassign this override.')
  return { version: 1, input, nodes, pipes, checks, fixtures: fixtures.map(({ id, kind, position, roomId, ruleKey, dfu }) => ({ id, kind, position, roomId, ruleKey, dfu })), status: 'review-required' }
}

/** Renderer adapter: one canonical result for the live plan and all sheet exports.
 * Inputs/raw source stay separate; this projection must not enter BOQ quantities. */
export function withDrainageDesign(model: UtilityFloor, input: DrainageInputs): UtilityFloor {
  const drainageDesign = designDrainage(model, input)
  const material = model.utilities.find((u): u is DrainageRun => u.layer === 'drainage')?.material ?? 'Material unverified'
  const utilities: DrainageRun[] = drainageDesign.pipes.map(p => ({ id: p.id, layer: 'drainage', fixtureId: p.fixtureIds[0] ?? p.from, path: p.path, diameter: p.diameterMm ?? p.candidateDiameterMm ?? 0, material, flowDirection: 'forward', roomId: p.roomId ?? '', stackId: p.to, drainagePipe: p }))
  return { ...model, utilities: [...utilities, ...model.utilities.filter(u => u.layer !== 'drainage')], drainageDesign }
}
