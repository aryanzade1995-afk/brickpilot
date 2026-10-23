import type { Point } from '../geometry.ts'
import { connectedLoads, type UtilityFloor, type UtilityCircuit, type ElectricalRun, type ElectricalSymbol } from './plan.ts'
import { electricalInputsSchema, emptyCircuitInput, emptyLoadInput, type ElectricalInputs, type ElectricalLoadInput, type ElectricalCircuitInput } from './electricalInputs.ts'
import { ELECTRICAL_RULES, ELECTRICAL_COMMISSIONING } from './electricalRules.ts'
import { liftElectricalRun } from './electrical3D.ts'
import { electricalPathAllowed } from './electrical.ts'
import { utilityObstacles } from './routing.ts'
import { segmentDistance } from './clashGeometry.ts'
import { segmentHitsRect } from './drainage.ts'
import { hash } from './clashes.ts'

export type ElectricalCheck = { id: string; status: 'Pass' | 'Warning' | 'Fail' | 'Not Checked'; category: string; itemId: string; roomId: string | null; position: Point | null; reason: string; correction: string; reference: string }
export type ElectricalLoad = ElectricalLoadInput & { id: string; name: string; roomId: string; position: Point | null; endpointId: string | null }
export type ElectricalCircuitDesign = { id: string; panelId: string; tag: string; loadIds: string[]; routeIds: string[]; connectedWatts: number | null; knownWatts: number; designWatts: number | null; currentA: number | null; deratedAmpacityA: number | null; planRouteM: number; developedRouteM: number | null; longestM: number | null; voltageDropPercent: number | null; totalDropPercent: number | null; input: ElectricalCircuitInput }
export type ElectricalDesign = { version: 1; sourceSignature: string; status: 'review-required'; input: ElectricalInputs; loads: ElectricalLoad[]; circuits: ElectricalCircuitDesign[]; checks: ElectricalCheck[]; knownWatts: number; connectedWatts: number | null; assumptions: string[] }
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const lengthM = (p: Point[]) => sum(p.slice(1).map((b, i) => Math.hypot(b.x - p[i].x, b.y - p[i].y))) / 1000
const wet = (name: string) => /bath|toilet|shower|kitchen|utility|laundry|balcony/i.test(name)
const kindFor = (s: ElectricalSymbol): ElectricalLoadInput['kind'] => /geyser/i.test(s.label) ? 'geyser' : s.type === 'light' ? 'light' : s.type === 'exhaust_fan' ? 'fan' : 'socket'
const dedicatedKinds = new Set(['ac', 'geyser', 'cooking', 'pump', 'washing_machine'])
const ref = ELECTRICAL_RULES.sizing.reference
const ordered = (v: unknown): unknown => Array.isArray(v) ? v.map(ordered) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, ordered(x)])) : v

/** Derive a reviewable design from the existing canonical routes, without moving
 * symbols, changing architecture or performing automatic rerouting. Shared lighting
 * feeds are retained per room; dedicated appliance branches retain their exact paths.
 * An added appliance without a represented endpoint stays explicitly disconnected. */
export function withElectricalDesign(source: UtilityFloor, raw: ElectricalInputs): UtilityFloor {
  const input = electricalInputsSchema.parse(raw), symbols = source.symbols.filter((s): s is ElectricalSymbol => s.layer === 'electrical')
  const loads: ElectricalLoad[] = symbols.filter(s => s.type !== 'db_panel' && s.type !== 'switch').map(s => {
    const entered = input.loads[s.id], additional = input.additionalLoads.find(a => a.endpointId === s.id && a.roomId === s.roomId)
    const v = additional ?? entered ?? { ...emptyLoadInput(), kind: kindFor(s), dedicated: dedicatedKinds.has(kindFor(s)) }
    return { ...v, id: s.id, name: additional?.name ?? s.label.replace(/\s*·\s*16A/, ''), roomId: s.roomId, position: s.position, endpointId: s.id }
  })
  loads.push(...input.additionalLoads.filter(a => !loads.some(l => l.endpointId === a.endpointId && l.roomId === a.roomId)).map(a => ({ ...a, endpointId: null, position: null })))
  const signature = hash(ordered([source.sourcePlanId, source.floor, source.circuits, source.utilities.filter(r => r.layer === 'electrical'), symbols]))
  const stale = !!input.planSignature && input.planSignature !== signature
  const circuits: UtilityCircuit[] = [], runs: ElectricalRun[] = [], checks: ElectricalCheck[] = []
  const check = (category: string, itemId: string, status: ElectricalCheck['status'], reason: string, correction: string, reference: string = ref, position: Point | null = null, roomId: string | null = null) => checks.push({ id: `EL:${category}:${itemId}`, category, itemId, status, reason, correction, reference, position, roomId })
  const represented = new Set<string>()
  for (const original of source.circuits) {
    const grouped = new Map<string, string[]>()
    for (const id of original.loads) {
      const load = loads.find(l => l.id === id)
      if (!load) { check('Inventory', id, 'Fail', 'Circuit refers to a missing load.', 'Restore or remove the missing endpoint.'); continue }
      if (represented.has(id)) { check('Duplicate load', id, 'Fail', 'Load is assigned to more than one source circuit.', 'Assign it to a single final circuit.'); continue }
      represented.add(id)
      const key = load.dedicated || dedicatedKinds.has(load.kind) ? `dedicated:${id}` : `room:${load.roomId}`
      grouped.set(key, [...(grouped.get(key) ?? []), id])
    }
    for (const [key, ids] of grouped) {
      const first = loads.find(l => l.id === ids[0])!, dedicated = key.startsWith('dedicated:'), id = `${original.id}:${key}`
      const controls = original.controls.filter(s => source.utilities.some(r => r.layer === 'electrical' && r.circuitId === original.id && r.fromSymbolId === s && ids.includes(r.toSymbolId)))
      const selected = input.circuits[id] ?? emptyCircuitInput(), n = circuits.length + 1
      circuits.push({ ...original, id, tag: `${dedicated ? 'D' : original.tag.startsWith('L') ? 'L' : 'P'}${n}`, name: dedicated ? first.name : `${original.tag.startsWith('L') ? 'Lighting & fans' : 'General sockets'} · ${source.floor.rooms.find(r => r.id === first.roomId)?.name ?? first.roomId}`, loads: ids, controls, wireSize: selected.areaMm2 ? `${selected.areaMm2}mm2` : 'Unspecified', breaker: selected.breakerA ? `${selected.breakerType} ${selected.breakerA}A` : 'Unspecified', status: 'needs-review', unroutedLoads: [] })
      runs.push(...source.utilities.filter((r): r is ElectricalRun => r.layer === 'electrical' && r.circuitId === original.id && (ids.includes(r.toSymbolId) || controls.includes(r.toSymbolId))).map(r => ({ ...r, circuitId: id, serviceBandIndex: source.circuits.indexOf(original), wireSize: selected.areaMm2 ? `${selected.areaMm2}mm2` : 'Unspecified' })))
    }
  }
  for (const l of loads.filter(l => !represented.has(l.id))) {
    check('Inventory', l.id, 'Fail', 'Appliance has no represented connection to a distribution board.', 'Add/review its endpoint and dedicated branch; no route was invented.', ref, l.position, l.roomId)
  }
  for (const l of loads) {
    check('Load rating', l.id, l.watts === null || l.basis === 'unknown' || !l.reference ? 'Not Checked' : l.basis === 'estimate' ? 'Warning' : 'Pass', l.watts === null ? 'Nameplate or explicitly estimated watts are missing.' : `${l.watts} W / ${l.basis}; ${l.reference || 'basis missing'}`, 'Confirm appliance input power, not cooling capacity or socket maximum.', 'Nameplate / documented load assessment; NBC P8/S2 4, 5.4.4', l.position, l.roomId)
    const room = source.floor.rooms.find(r => r.id === l.roomId)
    check('Placement', l.id, input.placementReview[l.id] ? 'Warning' : 'Not Checked', input.placementReview[l.id] ? `Recorded placement review: ${input.placementReview[l.id]}` : 'Furniture, door swing, appliance and accessibility suitability not confirmed.', 'Review actual furniture, working space and manufacturer instructions.', 'NBC P8/S2 4 and 6; equipment instructions', l.position, l.roomId)
    if (room && (wet(room.name) || room.outdoor)) check('Wet location', l.id, input.wetReview[l.id] ? 'Warning' : 'Not Checked', input.wetReview[l.id] ? `Review supplied: ${input.wetReview[l.id]}; not independently verified.` : 'Wet-zone boundaries, IP rating and permitted equipment are unverified.', 'Specify bathroom zones, IP/equipment class and protective measures against the applicable IS 732 requirements.', 'IS 732:2019 special-location requirements: clause/table to be confirmed', l.position, l.roomId)
  }
  const model: UtilityFloor = { ...source, circuits, utilities: [...source.utilities.filter(r => r.layer !== 'electrical'), ...runs], symbols: source.symbols.map(s => s.layer === 'electrical' ? { ...s, label: s.label.replace(/\s*·\s*16A/, ''), circuitIds: circuits.filter(c => c.panelId === s.id || c.loads.includes(s.id) || c.controls.includes(s.id)).map(c => c.id) } : s) }
  const records: ElectricalCircuitDesign[] = []
  for (const c of circuits) {
    const cfg = input.circuits[c.id] ?? emptyCircuitInput(), cs = loads.filter(l => c.loads.includes(l.id)), cr = runs.filter(r => r.circuitId === c.id), panel = symbols.find(s => s.id === c.panelId), roomId = cs[0]?.roomId ?? null, at = panel?.position ?? null
    const add = (category: string, status: ElectricalCheck['status'], why: string, fix: string, reference: string = ref) => check(category, c.id, status, why, fix, reference, at, roomId)
    const reachable = connectedLoads(model, c), missing = c.loads.filter(id => !reachable.includes(id))
    c.unroutedLoads = missing
    add('Connectivity', panel && !missing.length ? 'Pass' : 'Fail', panel && !missing.length ? 'All represented loads connect to the named DB through the source routes.' : `${missing.length} loads lack a complete DB connection.`, 'Restore source connections; do not bridge missing walls or doors.')
    const complete = cs.every(l => l.watts !== null && l.basis !== 'unknown' && !!l.reference), knownWatts = sum(cs.map(l => l.watts ?? 0)), watts = complete ? knownWatts : null
    const demand = watts !== null && cfg.demandFactor !== null && cfg.demandReference ? watts * cfg.demandFactor : null
    const validPhase = input.supply === 'single-phase' && (cfg.phase === 'unknown' || cfg.phase === 'L1') || input.supply === 'three-phase' && cfg.phase !== 'unknown'
    const current = demand !== null && input.voltageLn !== null && cfg.powerFactor !== null && validPhase && input.supplyReference ? demand / (input.voltageLn * cfg.powerFactor) : null
    const ampacityBasis = cfg.conductor !== 'unknown' && cfg.areaMm2 !== null && cfg.insulation && cfg.installation && cfg.ambientC !== null && cfg.grouping !== null && cfg.tableReference
    const iz = ampacityBasis && cfg.baseAmpacityA !== null && cfg.temperatureFactor !== null && cfg.groupingFactor !== null && cfg.otherFactor !== null ? cfg.baseAmpacityA * cfg.temperatureFactor * cfg.groupingFactor * cfg.otherFactor : null
    const lengths = new Map<string, number>(), lifted = new Map<string, ReturnType<typeof liftElectricalRun>>()
    for (const r of cr) { const from = symbols.find(s => s.id === r.fromSymbolId), to = symbols.find(s => s.id === r.toSymbolId), p = from && to ? liftElectricalRun(model, r, from, to) : null; lifted.set(r.id, p); if (p) lengths.set(r.id, sum(p.slice(1).map((b, i) => Math.hypot(...b.map((v, j) => v - p[i][j]))))) }
    // Radial graph: exactly one feed per non-root node, no cycles, all loads reachable.
    const incoming = new Map<string, ElectricalRun[]>(); for (const r of cr) incoming.set(r.toSymbolId, [...(incoming.get(r.toSymbolId) ?? []), r])
    let radial = !!panel && !incoming.has(c.panelId) && [...incoming.values()].every(xs => xs.length === 1) && !missing.length
    const paths = new Map<string, ElectricalRun[]>()
    for (const load of cs) { let node = load.id; const seen = new Set<string>(), path: ElectricalRun[] = []; while (node !== c.panelId) { if (seen.has(node) || incoming.get(node)?.length !== 1) { radial = false; break } seen.add(node); const r = incoming.get(node)![0]; path.unshift(r); node = r.fromSymbolId } paths.set(load.id, path) }
    add('Radial topology', radial ? 'Pass' : 'Fail', radial ? 'Each load has one source path; no duplicate feeds.' : 'Missing feed, cycle or multiple feeds prevents a valid radial calculation.', 'Correct the source topology before sizing.')
    const allLifted = cr.length > 0 && lengths.size === cr.length, developedRouteM = allLifted ? sum([...lengths.values()]) : null
    const longest = radial && allLifted ? Math.max(0, ...[...paths.values()].map(p => sum(p.map(r => lengths.get(r.id)!)))) : null
    // A supplied single-phase mV/A/m coefficient INCLUDES the line/return loop.
    // Sum segment drops using downstream demand; never apply total current to a short branch.
    let drop: number | null = null
    if (radial && allLifted && current !== null && cfg.voltageDropMvAm !== null && cfg.dropReference && input.voltageLn !== null && demand !== null && cfg.powerFactor !== null && cfg.demandFactor !== null) {
      const drops = cs.map(l => sum((paths.get(l.id) ?? []).map(r => {
        const downstream = cs.filter(x => paths.get(x.id)?.some(p => p.id === r.id)), amps = sum(downstream.map(x => x.watts!)) * cfg.demandFactor! / (input.voltageLn! * cfg.powerFactor!)
        return cfg.voltageDropMvAm! * amps * lengths.get(r.id)! / 1000
      })))
      drop = Math.max(0, ...drops) / input.voltageLn * 100
      if (cfg.measuredLongestM !== null && cfg.lengthReference && longest !== null && cfg.measuredLongestM > longest && current !== null) drop += cfg.voltageDropMvAm * current * (cfg.measuredLongestM - longest) / 1000 / input.voltageLn * 100
    }
    const totalDrop = drop !== null && cfg.upstreamDropPercent !== null ? drop + cfg.upstreamDropPercent : null
    records.push({ id: c.id, panelId: c.panelId, tag: c.tag, loadIds: c.loads, routeIds: cr.map(r => r.id), connectedWatts: watts, knownWatts, designWatts: demand, currentA: current, deratedAmpacityA: iz, planRouteM: sum(cr.map(r => lengthM(r.path))), developedRouteM, longestM: longest, voltageDropPercent: drop, totalDropPercent: totalDrop, input: cfg })
    add('Demand/current', current === null ? 'Not Checked' : 'Pass', current === null ? 'Load basis, demand method, voltage, power factor or phase is missing.' : `${demand!.toFixed(1)} W demand; Ib ${current.toFixed(2)} A = W / (V line-neutral × PF).`, 'Supply a documented demand factor, power factor and supplier-confirmed voltage/phase.')
    const lighting = cs.every(l => l.kind === 'light' || l.kind === 'fan')
    if (lighting) {
      const rule = cs.every(l => l.kind === 'light') ? ELECTRICAL_RULES.lightsOnly : ELECTRICAL_RULES.mixedLighting
      add('Circuit loading', input.nbcApplicabilityReference && watts !== null ? cs.length <= ELECTRICAL_RULES.mixedLighting.maxPoints && watts <= rule.maxWatts ? 'Pass' : 'Fail' : 'Not Checked', `${cs.length} light/fan points; ${watts ?? 'unknown'} W. Reference limit ${rule.maxWatts} W for this classification; mixed circuit point limit 10.`, 'Confirm circuit classification/applicability; split excessive loads with reviewed branches.', rule.reference)
    }
    const minimum = lighting ? ELECTRICAL_RULES.minimumCopper.lightingMm2 : cs.some(l => l.watts !== null && l.watts > 1000) ? ELECTRICAL_RULES.minimumCopper.equipmentOver1KwMm2 : ELECTRICAL_RULES.minimumCopper.powerMm2
    add('Conductor minimum', !input.nbcApplicabilityReference || cfg.conductor === 'unknown' || cfg.areaMm2 === null ? 'Not Checked' : cfg.conductor !== 'copper' ? 'Warning' : cfg.areaMm2 >= minimum ? 'Pass' : 'Fail', `Conditional fixed internal copper conductor minimum ${minimum} mm²; selected ${cfg.areaMm2 ?? '?'} mm² ${cfg.conductor}. This is a minimum-size check, not cable sizing.`, 'Confirm use/classification and the applicable standard; current capacity, voltage drop and protection still control final selection. Existing aluminium needs separate assessment.', ELECTRICAL_RULES.minimumCopper.reference)
    add('Cable capacity', current === null || iz === null || cfg.breakerA === null || cfg.breakerType === 'unknown' ? 'Not Checked' : current <= cfg.breakerA && cfg.breakerA <= iz ? 'Pass' : 'Fail', `Ib ${current?.toFixed(2) ?? '?'} A; In ${cfg.breakerA ?? '?'} A; corrected Iz ${iz?.toFixed(2) ?? '?'} A. Required Ib ≤ In ≤ Iz.`, 'Enter the applicable cable-table row, installation conditions and correction factors; choose a compatible protective device.')
    add('Overload trip', iz === null || cfg.conventionalTripA === null || cfg.breakerA === null || cfg.breakerType === 'unknown' || !cfg.curve ? 'Not Checked' : cfg.conventionalTripA >= cfg.breakerA && cfg.conventionalTripA <= ELECTRICAL_RULES.overload.izMultiplier * iz ? 'Pass' : 'Fail', 'Check I2 ≤ 1.45 Iz using the selected device characteristic; I2 below In is inconsistent.', 'Obtain conventional operating current from the actual protective-device data. This is not a full discrimination study.', ELECTRICAL_RULES.overload.reference)
    add('Voltage drop', stale || totalDrop === null || !input.nbcApplicabilityReference || !cfg.routeReview ? 'Not Checked' : totalDrop <= ELECTRICAL_RULES.voltageDrop.maxTotalPercent ? 'Pass' : 'Fail', `Circuit ${drop?.toFixed(2) ?? '?'}%; upstream ${cfg.upstreamDropPercent ?? '?'}%; total ${totalDrop?.toFixed(2) ?? '?'}%.`, 'Confirm developed route/riser lengths, single-phase loop mV/A/m at design conditions, upstream drop and NBC applicability.', ELECTRICAL_RULES.voltageDrop.reference)
    if (cfg.measuredLongestM !== null && longest !== null && cfg.measuredLongestM < longest) add('Measured length', 'Fail', 'Entered longest length is shorter than the represented developed route.', 'Resolve the survey/model discrepancy; voltage-drop calculation retains the longer model path.')
    add('Fault protection', !input.supplyReference || input.prospectiveFaultKa === null || cfg.breakingCapacityKa === null ? 'Not Checked' : cfg.breakingCapacityKa >= input.prospectiveFaultKa ? 'Pass' : 'Fail', `Prospective fault ${input.prospectiveFaultKa ?? '?'} kA; breaking capacity ${cfg.breakingCapacityKa ?? '?'} kA.`, 'Confirm fault current and manufacturer breaking capacity at the system voltage.')
    add('Disconnection/short circuit', 'Not Checked', cfg.shortCircuitReference ? `External calculation recorded: ${cfg.shortCircuitReference}; not evaluated by this engine.` : 'Cable withstand, disconnection time, loop impedance and selectivity not calculated.', 'Engineer must verify short-circuit thermal withstand, automatic disconnection and coordination using tested device characteristics.')
    add('Earthing', cfg.peAreaMm2 && cfg.peReference && input.earthingSystem && input.bondingReference ? 'Warning' : 'Not Checked', `PE ${cfg.peAreaMm2 ?? '?'} mm²; earthing ${input.earthingSystem || 'unknown'}; bonding ${input.bondingReference || 'unknown'}.`, 'Confirm PE sizing, circuit continuity, bonding and disconnection tests; drawing three conductors does not prove an earth connection.', 'NBC P8/S2 8; IS 732 applicable earthing/verification provisions')
    add('Residual protection', cfg.breakerType === 'RCBO' && (!cfg.residualMa || !cfg.residualType) ? 'Not Checked' : 'Warning', `Device ${cfg.breakerType}; residual setting ${cfg.residualMa ?? '?'} mA; type ${cfg.residualType || '?'}.`, 'Coordinate RCD/RCBO type, rating and upstream device; an RCCB alone is not overload protection.', ELECTRICAL_RULES.residualCurrent.reference)
    if (cs.some(l => l.dedicated || dedicatedKinds.has(l.kind))) add('Dedicated isolation', c.controls.length || cs.length > 1 ? 'Fail' : 'Not Checked', c.controls.length ? 'Appliance branch uses a source lighting control; the existing control is not a verified appliance isolator.' : 'Separate branch proposed; appliance-rated isolation and starting current are not verified.', 'Specify manufacturer-rated connection, isolation and protective devices. Existing geometry has not been rerouted.')
    for (const r of cr) {
      const bad = !electricalPathAllowed(r.path, source.floor, utilityObstacles(source.floor)), p = lifted.get(r.id)
      check('Route', r.id, bad || !p ? 'Fail' : 'Warning', bad || !p ? 'Route conflicts with source walls, voids, columns or valid opening/head geometry.' : 'Canonical concept route retained. Doorway passage is not permission to cut a wall, beam or foundation.', 'Review buildable conduit pathway and accessible junctions; obtain structural approval for any penetration.', ELECTRICAL_RULES.coordination.reference, r.path[0], r.roomId)
      if (source.floor.columns?.some(col => r.path.slice(1).some((b, i) => segmentHitsRect(r.path[i], b, { x: col.at.x - col.size / 2, y: col.at.y - col.size / 2, w: col.size, h: col.size })))) check('Structure', r.id, 'Fail', 'Route overlaps a represented column.', 'Relocate the proposed pathway through a reviewed service zone; no drilling assumed.', ELECTRICAL_RULES.coordination.reference, r.path[0], r.roomId)
      check('Junction access', r.id, input.junctionReview[r.id] ? 'Warning' : 'Not Checked', input.junctionReview[r.id] || 'Junction-box locations and maintenance access are not represented.', 'Specify accessible boxes/conduit bends and structural coordination.', ELECTRICAL_RULES.coordination.reference, r.path[0], r.roomId)
      for (const beam of source.floor.beams ?? []) if (r.path.slice(1).some((b, i) => segmentDistance([r.path[i].x, r.path[i].y, 0], [b.x, b.y, 0], [beam.a.x, beam.a.y, 0], [beam.b.x, beam.b.y, 0]).distance <= input.conceptClearanceMm)) check('Beam coordination', `${r.id}|${beam.id}`, 'Not Checked', `Conduit approaches beam ${beam.id} in plan; a centreline crossing is not a permitted penetration.`, 'Review full beam dimensions/elevation, conduit section and approved service details.', ELECTRICAL_RULES.coordination.reference, r.path[0], r.roomId)
      // Broad phase avoids quadratic segment work for far-away water/drain runs.
      for (const other of source.utilities.filter(x => x.layer === 'drainage' || x.layer === 'water_supply')) {
        let closest: ReturnType<typeof segmentDistance> | null = null
        const zA = input.serviceElevationsMm[r.id], zB = input.serviceElevationsMm[other.id]
        for (let i = 1; i < r.path.length; i++) for (let j = 1; j < other.path.length; j++) {
          const a = r.path[i - 1], b = r.path[i], x = other.path[j - 1], y = other.path[j], gap = input.conceptClearanceMm
          if (Math.max(a.x, b.x) + gap < Math.min(x.x, y.x) || Math.min(a.x, b.x) - gap > Math.max(x.x, y.x) || Math.max(a.y, b.y) + gap < Math.min(x.y, y.y) || Math.min(a.y, b.y) - gap > Math.max(x.y, y.y)) continue
          const d = segmentDistance([a.x, a.y, zA ?? 0], [b.x, b.y, zA ?? 0], [x.x, x.y, zB ?? 0], [y.x, y.y, zB ?? 0]); if (!closest || d.distance < closest.distance) closest = d
        }
        if (closest && closest.distance <= input.conceptClearanceMm) check('Service coordination', `${r.id}|${other.id}`, zA === undefined || zB === undefined ? 'Not Checked' : 'Warning', `${other.id}: ${closest.distance.toFixed(0)} mm ${zA === undefined || zB === undefined ? 'plan proximity; true elevations unknown' : 'separation using entered constant elevations'}.`, 'Review leak exposure, full riser profiles and permitted separation in section. The entered clearance is a concept screening distance.', ELECTRICAL_RULES.coordination.reference, closest.position, r.roomId)
      }
    }
  }
  for (const s of symbols.filter(s => s.type === 'db_panel')) check('DB position', s.id, !s.mount || wet(source.floor.rooms.find(r => r.id === s.roomId)?.name ?? '') ? 'Warning' : input.db.accessReference ? 'Warning' : 'Not Checked', input.db.accessReference || 'DB dry position, clear working space and accessibility require site review.', 'Confirm a dry accessible enclosure and incoming main switch/protection.', 'NBC P8/S2 5.4.4.1; installation/site review', s.position, s.roomId)
  const multi = (source.sourceFloorLevels?.length ?? 1) > 1
  check('DB capacity', 'supply', multi || !records.length || loads.some(l => !represented.has(l.id)) || records.some(c => c.currentA === null) || !input.db.ratingA || !input.db.incomerA || !input.db.feederReference ? 'Not Checked' : sum(records.map(c => c.currentA!)) <= Math.min(input.db.ratingA, input.db.incomerA) ? 'Pass' : 'Fail', multi ? 'This schedule covers one floor; a whole-house feeder/phase-balance study is required.' : 'Conservative sum of circuit design currents against entered DB/incomer ratings; unassigned loads block this check.', 'Review all floors, feeder cable, phase balance, main isolation and supply capacity.')
  check('DB ways', 'supply', input.db.ways === null || input.db.spareWays === null ? 'Not Checked' : input.db.ways >= circuits.length + input.db.spareWays ? 'Warning' : 'Fail', `${circuits.length} final circuits; ${input.db.ways ?? '?'} entered ways; ${input.db.spareWays ?? '?'} reserved. Device module widths/poles not checked.`, 'Select a DB with sufficient poles/modules, spare circuits and accessible neutral/earth bars.', 'NBC P8/S2 5.4.4.1; manufacturer module schedule')
  check('DB RCD', 'supply', !input.nbcApplicabilityReference || input.db.residualMa === null ? 'Not Checked' : input.db.residualMa <= ELECTRICAL_RULES.residualCurrent.maxMa ? 'Warning' : 'Fail', `Residential incomer residual setting ${input.db.residualMa ?? '?'} mA. Type, selectivity and current rating still require verification.`, 'Specify coordinated residual-current protection; verify against applicable amended regulations.', ELECTRICAL_RULES.residualCurrent.reference)
  check('Local supply', 'supply', 'Not Checked', `${input.city || 'City unknown'}; ${input.supplier || 'supplier unknown'}; ${input.supply}; sanctioned ${input.sanctionedKw ?? '?'} kW.`, 'Confirm supplier conditions and applicable authority requirements; Pune alone does not establish the supply arrangement.', 'MSEDCL/supplier conditions; CEA 2023 with 2026 amendment review pending')
  check('Unrepresented work', 'design', 'Not Checked', 'Concealed reinforcement, foundations, existing services, wet-zone volumes, socket ratings and safety-supply circuits are not fully specified in the source plan.', 'Survey concealed constraints, classify outlets and specify safety services and independent supplies where required. No structural penetration or emergency-power capacity is assumed.', ELECTRICAL_RULES.coordination.reference)
  if (!loads.length || !symbols.some(s => s.type === 'db_panel')) check('Missing source', 'design', 'Fail', 'No complete electrical inventory and source DB are represented.', 'Add a reviewed inventory and distribution board before design calculations.')
  for (const s of symbols.filter(s => s.type !== 'db_panel')) if (circuits.filter(c => c.loads.includes(s.id) || c.controls.includes(s.id)).length > 1) check('Shared terminal', s.id, 'Fail', 'One represented load/control terminal is assigned to different final circuits.', 'Specify separate rated devices/terminals and reviewed independent feeds. A single lighting switch cannot become an appliance isolator.', ref, s.position, s.roomId)
  const total = loads.every(l => l.watts !== null && l.basis !== 'unknown' && !!l.reference) ? sum(loads.map(l => l.watts!)) : null
  if (input.sanctionedKw !== null && total !== null) check('Sanctioned load', 'supply', multi ? 'Not Checked' : total / 1000 > input.sanctionedKw ? 'Warning' : 'Pass', `Known connected load ${(total / 1000).toFixed(2)} kW; sanctioned ${input.sanctionedKw} kW. Connected load is not maximum demand.`, 'Check permitted supply capacity against whole-home demand and supplier method.')
  for (const test of ELECTRICAL_COMMISSIONING) { const v = input.commissioning[test]; check('Commissioning', test, v?.result === 'fail' ? 'Fail' : v?.result === 'pass' && v.reference ? 'Warning' : 'Not Checked', v?.result === 'pass' && v.reference ? `External test recorded: ${v.reference}; not independently verified.` : 'No satisfactory test evidence recorded.', 'Licensed electrical contractor to perform and document testing before energising.', 'NBC P8/S2 9; supplier contractor test report') }
  const duplicates = input.additionalLoads.filter(a => a.endpointId && input.additionalLoads.some(b => b.id !== a.id && b.endpointId === a.endpointId))
  for (const a of duplicates) check('Duplicate appliance', a.id, 'Fail', 'Two appliance records share one endpoint.', 'Provide independent reviewed connections; one socket is not two dedicated branches.')
  for (const id of Object.keys(input.circuits).filter(id => !circuits.some(c => c.id === id))) check('Stale input', id, 'Warning', 'Saved circuit settings no longer match a current circuit.', 'Review changed plan/circuit allocation. Old settings were retained but not applied.')
  if (stale) {
    for (const c of checks) if (c.status === 'Pass') c.status = 'Not Checked'
    check('Changed source', 'design', 'Warning', 'Saved evidence refers to a different plan or route revision.', 'Review all retained inputs and apply them deliberately to the current design before accepting any numerical check.')
  }
  return { ...model, electricalDesign: { version: 1, sourceSignature: signature, status: 'review-required', input, loads, circuits: records, checks, knownWatts: sum(loads.map(l => l.watts ?? 0)), connectedWatts: total, assumptions: ['Per-floor concept schedule; incoming feeders and whole-house phase balance are not generated.', 'Existing paths and symbols remain fixed. Added appliances without endpoints remain unrouted.', 'Displayed route lengths include represented surface risers; concealed installation and conduit fill are unverified.', 'Cable-table values are designer inputs, never built-in default sizes. No procurement or BOQ quantities are changed.', 'Only supported radial line-neutral circuits are calculated. Three-phase appliances, motors/inrush and nonlinear harmonics need external design.', 'No automated code-compliance or commissioning certificate is issued.'] } }
}

export function electricalScheduleRows(d: ElectricalDesign) {
  return d.circuits.map(c => `${c.tag} / ${c.id} | DB ${c.panelId} | ${c.loadIds.length} loads | ${c.connectedWatts ?? '?'} W connected / ${c.designWatts ?? '?'} W design | Ib ${c.currentA?.toFixed(2) ?? '?'} A | ${c.input.areaMm2 ?? '?'} mm² ${c.input.conductor} | ${c.input.breakerType} ${c.input.breakerA ?? '?'} A | route ${c.planRouteM.toFixed(2)} m plan / ${c.developedRouteM?.toFixed(2) ?? '?'} m developed | total drop ${c.totalDropPercent?.toFixed(2) ?? '?'}% | review required`)
}
export function electricalReviewCsv(d: ElectricalDesign) {
  const rows = [['Record', 'ID', 'Status', 'Room', 'X mm', 'Y mm', 'Details', 'Correction', 'Reference'], ...d.checks.map(c => ['Check', c.id, c.status, c.roomId ?? '', c.position?.x ?? '', c.position?.y ?? '', c.reason, c.correction, c.reference]), ...electricalScheduleRows(d).map((row, i) => ['Circuit', d.circuits[i].id, 'Review required', '', '', '', row, '', ref]), ...d.loads.map(l => ['Load', l.id, l.basis, l.roomId, l.position?.x ?? '', l.position?.y ?? '', `${l.name}: ${l.watts ?? '?'} W`, '', l.reference]), ...d.assumptions.map(a => ['Qualification', '', '', '', '', '', a, '', ''])]
  return '\uFEFF' + rows.map(row => row.map(v => `"${String(v).replace(/^[=+@-]/, "' $&").replaceAll('"', '""')}"`).join(',')).join('\r\n')
}
