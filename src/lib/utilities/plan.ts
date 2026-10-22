import type { Design, FloorPlan, PlacedRoom } from '../engine/types.ts'
import type { Brief } from '../model/brief.ts'
import { rectCenter, sharedEdge, type Point, type Rect } from '../geometry.ts'
import { subtractRegions } from '../solar/regions.ts'
import { furnishSingleRoom } from '../three/buildDollhouse.ts'
import { doorZones } from '../draw/furniture.ts'
import { resolveSpecification } from '../cost/catalogue.ts'
import { route, perimeterRoutes, utilityObstacles, utilityVoids } from './routing.ts'
import { electricalPlan } from './electrical.ts'
import { fireSafetyPlan } from './fireSafety.ts'
import { waterPlan } from './water.ts'
export { route, orthogonal, alongPath } from './routing.ts'

export const UTILITY_LAYERS = {
  drainage: { label: 'Drainage', color: '#8B5A2B', dash: '8 4', width: 3, visible: false, disabled: false },
  electrical: { label: 'Electrical Wiring', color: '#D32F2F', dash: null, width: 2, visible: false, disabled: false, showConductors: false },
  fire_alarm: { label: 'Fire Alarm & Safety', color: '#F57C00', dash: '2 4', width: 2, visible: false, disabled: false, detectorRadiusMm: { smoke_detector: 7500, heat_detector: 5000 } },
  water_supply: { label: 'Water supply', color: '#287FAD', dash: null, width: 2.5, visible: false, disabled: false },
  hvac: { label: 'HVAC', color: '#678776', dash: '12 4', width: 3, visible: false, disabled: true },
}
// Add a layer config and its UtilityRun data. The controls, legend, SVG layer
// renderer, filtering, selection and exports all consume this shared contract.
export type UtilityLayer = keyof typeof UTILITY_LAYERS
export const UTILITY_SYMBOLS = {
  vertical_stack: { label: 'Stack', layer: 'drainage' }, floor_drain: { label: 'Drain point', layer: 'drainage' }, flow_arrow: { label: 'Flow direction', layer: 'drainage' },
  db_panel: { label: 'DB panel', layer: 'electrical' }, switch: { label: 'Switch', layer: 'electrical' },
  socket: { label: 'Socket', layer: 'electrical' }, light: { label: 'Light', layer: 'electrical' }, exhaust_fan: { label: 'Exhaust fan', layer: 'electrical' },
  fire_panel: { label: 'Fire panel', layer: 'fire_alarm' }, smoke_detector: { label: 'Smoke detector', layer: 'fire_alarm' }, heat_detector: { label: 'Heat detector', layer: 'fire_alarm' },
  manual_call_point: { label: 'Manual call point', layer: 'fire_alarm' }, sounder: { label: 'Sounder', layer: 'fire_alarm' }, sprinkler: { label: 'Sprinkler', layer: 'fire_alarm' },
  extinguisher: { label: 'Extinguisher', layer: 'fire_alarm' }, exit_sign: { label: 'Exit sign', layer: 'fire_alarm' }, evacuation_route: { label: 'Evacuation route', layer: 'fire_alarm' },
  detector_coverage: { label: 'Concept detector coverage', layer: 'fire_alarm' }, uncovered_area: { label: 'No / partial concept coverage', layer: 'fire_alarm' },
  supply_inlet: { label: 'Cold supply inlet', layer: 'water_supply' }, hot_supply_inlet: { label: 'Hot supply inlet', layer: 'water_supply' }, isolation_valve: { label: 'Isolation valve', layer: 'water_supply' }, water_outlet: { label: 'Fixture water outlet', layer: 'water_supply' },
  clearance_warning: { label: 'Clearance review', layer: 'review' },
} as const
export type Fixture = { id: string; type: 'sink' | 'toilet' | 'shower' | 'floor_drain'; position: Point; roomId: string; basis: 'furnishing' | 'proposed'; width: number; depth: number }
export type DrainageRun = { id: string; layer: 'drainage'; fixtureId: string; path: Point[]; diameter: number; material: string; flowDirection: 'forward' | 'reverse'; roomId: string; stackId: string }
export type ElectricalRun = { id: string; layer: 'electrical'; circuitId: string; fromSymbolId: string; toSymbolId: string; path: Point[]; wireSize: '1.5mm2' | '2.5mm2'; roomId: string; conductors: number }
export type FireRun = { id: string; layer: 'fire_alarm'; zoneId: string; fromSymbolId: string; toSymbolId: string; path: Point[]; cableType: 'FRLS 2C'; roomId: string }
export type WaterRun = { id: string; layer: 'water_supply'; networkId: string; service: 'cold' | 'hot'; fromSymbolId: string; toSymbolId: string; fixtureId: string | null; path: Point[]; diameter: number; material: string; roomId: string }
export type UtilityRun = DrainageRun | ElectricalRun | FireRun | WaterRun
export type StackSymbol = { id: string; type: 'vertical_stack'; position: Point; layer: 'drainage'; roomIds: string[]; basis: 'proposed' }
export type ElectricalSymbolType = 'db_panel' | 'switch' | 'socket' | 'light' | 'exhaust_fan'
export type ElectricalMount = { kind: 'wall' | 'ceiling'; elevationMm: number; serviceElevationMm: number; normal: Point; wallIndex: number | null }
export type ElectricalSymbol = { id: string; type: ElectricalSymbolType; position: Point; layer: 'electrical'; roomId: string; roomIds: string[]; circuitIds: string[]; label: string; basis: 'proposed'; mount?: ElectricalMount }
export type FireSymbolType = 'fire_panel' | 'smoke_detector' | 'heat_detector' | 'manual_call_point' | 'sounder' | 'sprinkler' | 'extinguisher' | 'exit_sign'
export type FireSymbol = { id: string; type: FireSymbolType; position: Point; layer: 'fire_alarm'; roomId: string; roomIds: string[]; zoneId: string; label: string; coverageRadiusMm: number | null; connection: 'alarm-loop' | 'standalone'; basis: 'proposed' }
export type WaterSymbol = { id: string; type: 'supply_inlet' | 'hot_supply_inlet' | 'isolation_valve' | 'water_outlet'; layer: 'water_supply'; service: 'cold' | 'hot'; networkId: string; label: string; roomId: string; roomIds: string[]; position: Point; fixtureId: string | null; mount?: ElectricalMount; basis: 'proposed' }
export type WaterNetwork = { id: string; name: string; tag: 'CW' | 'HW'; color: string; service: 'cold' | 'hot'; sourceIds: string[]; sourceBasis: 'unverified'; branchDiameterMm: number; riserDiameterMm: number; material: string; heatSource: string | null; unroutedFixtures: string[] }
export type UtilitySymbol = StackSymbol | ElectricalSymbol | FireSymbol | WaterSymbol
export type UtilityZone = { id: string; name: string; tag: string; color: string; panelId: string; devices: string[]; cableType: 'FRLS 2C'; loopStatus: 'closed' | 'incomplete'; missingLinks: { from: string; to: string }[] }
export type ExitRoute = { id: string; path: Point[]; fromRoomId: string; exitId: string | null; status: 'concept' | 'blocked' | 'no-exit'; reason: string | null }
export type FireCoverage = { roomId: string; status: 'covered' | 'partial' | 'not-covered' | 'exempt'; detectorIds: string[] }
export type UtilityCircuit = { id: string; name: 'Lighting 1' | 'Power 1'; tag: 'L1' | 'P1'; color: string; panelId: string; loads: string[]; controls: string[]; wireSize: '1.5mm2' | '2.5mm2'; breaker: '10A' | '16A'; status: 'concept' | 'needs-review'; unroutedLoads: string[] }
export type UtilityWall = { id: string; a: Point; b: Point; thickness: number; height: number; base: number }
export type UtilityFloor = { sourcePlanId: string; floor: FloorPlan; slabs: Rect[]; wallSections: UtilityWall[]; fixtures: Fixture[]; utilities: UtilityRun[]; symbols: UtilitySymbol[]; circuits: UtilityCircuit[]; waterNetworks: WaterNetwork[]; zones: UtilityZone[]; exitRoutes: ExitRoute[]; coverage: FireCoverage[]; notes: string[] }
export const selectionForRun = (run: UtilityRun) => run.layer === 'electrical' ? `circuit:${run.circuitId}` : run.layer === 'fire_alarm' ? `zone:${run.zoneId}` : run.layer === 'water_supply' ? `water:${run.networkId}` : run.id
export function displayedRuns(model: UtilityFloor, visible: Record<UtilityLayer, boolean>, room = 'all', circuit = 'all', zone = 'all', water = 'all') {
  return model.utilities.filter(u => visible[u.layer] && !UTILITY_LAYERS[u.layer].disabled && (room === 'all' || u.roomId === room) && (u.layer !== 'electrical' || circuit === 'all' || u.circuitId === circuit) && (u.layer !== 'fire_alarm' || zone === 'all' || u.zoneId === zone) && (u.layer !== 'water_supply' || water === 'all' || u.networkId === water))
}
export function displayedSymbols(model: UtilityFloor, visible: Record<UtilityLayer, boolean>, room = 'all', circuit = 'all', zone = 'all', water = 'all') {
  return model.symbols.filter(s => visible[s.layer] && (room === 'all' || s.roomIds.includes(room)) && (s.layer !== 'electrical' || circuit === 'all' || s.circuitIds.includes(circuit)) && (s.layer !== 'fire_alarm' || zone === 'all' || s.zoneId === zone) && (s.layer !== 'water_supply' || water === 'all' || s.networkId === water))
}
export function connectedLoads(model: UtilityFloor, circuit: UtilityCircuit) {
  const reachable = new Set([circuit.panelId]), wires = model.utilities.filter((u): u is ElectricalRun => u.layer === 'electrical' && u.circuitId === circuit.id)
  let changed = true
  while (changed) { changed = false; for (const wire of wires) if (reachable.has(wire.fromSymbolId) && !reachable.has(wire.toSymbolId)) { reachable.add(wire.toSymbolId); changed = true } }
  return circuit.loads.filter(id => reachable.has(id))
}
export function utilityLegend(model: UtilityFloor, visible: Record<UtilityLayer, boolean>, circuit = 'all', _legacyWarnings = false, zone = 'all', evacuation = true, coverage = false, water = 'all') {
  const entries: { label: string; color: string; dash?: string | null; symbol?: keyof typeof UTILITY_SYMBOLS }[] = []
  for (const [key, layer] of Object.entries(UTILITY_LAYERS)) {
    if (layer.disabled || !visible[key as UtilityLayer]) continue
    entries.push({ label: layer.label, color: layer.color, dash: layer.dash })
    if (key === 'electrical') for (const c of model.circuits.filter(c => circuit === 'all' || circuit === c.id)) entries.push({ label: `${c.tag} · ${c.name}`, color: c.color })
    if (key === 'fire_alarm') for (const z of model.zones.filter(z => zone === 'all' || zone === z.id)) entries.push({ label: `${z.tag} · ${z.name}`, color: z.color, dash: layer.dash })
    if (key === 'water_supply') for (const n of model.waterNetworks.filter(n => water === 'all' || water === n.id)) entries.push({ label: `${n.tag} · ${n.name}`, color: n.color })
    for (const [type, item] of Object.entries(UTILITY_SYMBOLS)) if (item.layer === key && (type !== 'evacuation_route' || evacuation) && (!['detector_coverage', 'uncovered_area'].includes(type) || coverage)) entries.push({ label: item.label, color: type === 'uncovered_area' ? '#c56363' : type === 'exit_sign' || type === 'evacuation_route' ? '#258454' : layer.color, symbol: type as keyof typeof UTILITY_SYMBOLS })
  }
  return entries
}

const inside = (r: Rect, p: Point) => p.x >= r.x - 1 && p.x <= r.x + r.w + 1 && p.y >= r.y - 1 && p.y <= r.y + r.h + 1
const wet = (r: PlacedRoom) => !r.outdoor && /bath|toilet|washroom|kitchen|utility|laundry|powder/i.test(`${r.id} ${r.name} ${r.semanticId}`)
function clearPath(path: Point[], room: PlacedRoom, cuts: Rect[]) {
  return path.every(p => inside(room.rect, p)) && !cuts.some(r => path.some((p, i) => {
    if (!i) return false
    const a = path[i - 1]
    return Math.max(a.x, p.x) > r.x && Math.min(a.x, p.x) < r.x + r.w && Math.max(a.y, p.y) > r.y && Math.min(a.y, p.y) < r.y + r.h
  }))
}
function freeStack(a: Point, b: Point, floor: FloorPlan, cuts: Rect[]): Point | null {
  for (const fraction of [.5, .25, .75, .12, .88]) {
    const p = { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction }
    if (!cuts.some(c => inside(c, p)) && !floor.openings.some(o => Math.abs(o.orient === 'h' ? p.y - o.at.y : p.x - o.at.x) < 200 && Math.abs(o.orient === 'h' ? p.x - o.at.x : p.y - o.at.y) < o.width / 2 + 200)) return p
  }
  return null
}
/** Same source walls and opening positions in both views. Window sills and
 * door/window heads remain; no whole-room rectangle substitutes for the plan. */
export function utilityWallSections(floor: FloorPlan, height: number): UtilityWall[] {
  return floor.walls.flatMap((wall, index) => {
    if (Math.abs(wall.a.y - wall.b.y) > 1 && Math.abs(wall.a.x - wall.b.x) > 1)
      return [{ id: wall.id ?? `angled:${index}`, a: { ...wall.a }, b: { ...wall.b }, thickness: wall.thickness, height: wall.heightMm ?? height, base: 0 }]
    const horizontal = Math.abs(wall.a.y - wall.b.y) < 1
    const lo = Math.min(horizontal ? wall.a.x : wall.a.y, horizontal ? wall.b.x : wall.b.y)
    const hi = Math.max(horizontal ? wall.a.x : wall.a.y, horizontal ? wall.b.x : wall.b.y)
    const openings = floor.openings.filter(o => (o.orient === 'h') === horizontal && Math.abs(horizontal ? o.at.y - wall.a.y : o.at.x - wall.a.x) < 20)
    const cuts = [...new Set([lo, hi, ...openings.flatMap(o => [Math.max(lo, Math.min(hi, (horizontal ? o.at.x : o.at.y) - o.width / 2)), Math.max(lo, Math.min(hi, (horizontal ? o.at.x : o.at.y) + o.width / 2))])])].sort((a, b) => a - b)
    return cuts.slice(1).flatMap((end, i) => {
      const start = cuts[i], mid = (start + end) / 2, opening = openings.find(o => Math.abs(mid - (horizontal ? o.at.x : o.at.y)) < o.width / 2)
      const point = (v: number) => horizontal ? { x: v, y: wall.a.y } : { x: wall.a.x, y: v }
      const common = { id: `${wall.id ?? index}:${i}`, a: point(start), b: point(end), thickness: wall.thickness }
      if (!opening) return [{ ...common, height: wall.heightMm ?? height, base: 0 }]
      const head = Math.min(height, opening.head ?? 2100), result: UtilityWall[] = []
      if (opening.kind === 'window') result.push({ ...common, id: common.id + ':sill', height: Math.min(opening.sill ?? 900, head), base: 0 })
      if (head < height) result.push({ ...common, id: common.id + ':head', height: height - head, base: head })
      return result
    })
  })
}

/** Read-only projection. Never calls a studio update, changes the architectural
 * seed, persists illustrative routing as surveyed data, or replaces BOQ lengths. */
export function utilityFloor(design: Design, level: number, brief: Brief = design.model.brief): UtilityFloor {
  const floor = design.floors.find(f => f.level === level)
  if (!floor) throw new Error('This floor is not present in the source plan.')
  const cuts = utilityObstacles(floor)
  const rooms = floor.rooms.filter(wet), fixtures: Fixture[] = [], utilities: DrainageRun[] = [], symbols: StackSymbol[] = [], notes: string[] = []
  for (const room of rooms) {
    // Reuse the actual fitted-fixture placement used by Formstead's interior
    // model. These are proposed furnishings, never measurements of an existing home.
    const pieces = furnishSingleRoom(design, level, room.id), center = rectCenter(room.rect)
    for (const piece of pieces) {
      const type: Fixture['type'] | null = /-wc$/.test(piece.id) ? 'toilet' : /-(basin|sink)$/.test(piece.id) ? 'sink' : /-shower-tray$/.test(piece.id) ? 'shower' : null
      if (!type) continue
      const position = { x: Math.round(center.x + piece.pos[0] * 1000), y: Math.round(center.y + piece.pos[2] * 1000) }
      if (!inside(room.rect, position) || cuts.some(c => inside(c, position))) continue
      fixtures.push({ id: `${level}:${piece.id}`, type, position, roomId: room.id, basis: 'furnishing', width: piece.size[0] * 1000, depth: piece.size[2] * 1000 })
    }
    const blocked = [...doorZones(room, floor.openings), ...cuts, ...fixtures.filter(f => f.roomId === room.id).map(f => ({ x: f.position.x - f.width / 2 - 120, y: f.position.y - f.depth / 2 - 120, w: f.width + 240, h: f.depth + 240 }))]
    // Never place a drain in a blocked doorway, fixture or source void.
    const candidate = [.2, .35, .5, .65, .8].flatMap(x => [.2, .35, .5, .65, .8].map(y => ({ x: room.rect.x + room.rect.w * x, y: room.rect.y + room.rect.h * y }))).find(p => !blocked.some(b => inside(b, p)))
    if (candidate) fixtures.push({ id: `${level}:${room.id}:floor-drain`, type: 'floor_drain', roomId: room.id, position: candidate, basis: 'proposed', width: 150, depth: 150 })
    else notes.push(`Floor drain placement requires a clear supported area in ${room.name}.`)
  }
  const assigned = new Map<string, StackSymbol>()
  for (const room of rooms) {
    if (assigned.has(room.id)) continue
    let position: Point | null = null, shared: PlacedRoom | undefined
    for (const other of rooms.filter(r => r.id !== room.id && !assigned.has(r.id))) {
      const edge = sharedEdge(room.rect, other.rect)
      if (edge && edge.length >= 500) { position = freeStack(edge.seg.a, edge.seg.b, floor, cuts); if (position) { shared = other; break } }
    }
    if (!position) {
      const r = room.rect
      const edges = [[{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }], [{ x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }], [{ x: r.x, y: r.y + r.h }, { x: r.x + r.w, y: r.y + r.h }], [{ x: r.x, y: r.y }, { x: r.x, y: r.y + r.h }]]
      for (const [a, b] of edges) { position = freeStack(a, b, floor, cuts); if (position) break }
    }
    if (!position || cuts.some(c => inside(c, position!))) { notes.push(`No clear stack proposal for ${room.name}.`); continue }
    const symbol: StackSymbol = { id: `${level}:stack:${room.semanticId || room.id}`, type: 'vertical_stack', layer: 'drainage', position, roomIds: [room.id, ...(shared ? [shared.id] : [])], basis: 'proposed' }
    symbols.push(symbol); for (const id of symbol.roomIds) assigned.set(id, symbol)
  }
  const material = resolveSpecification(brief, 'drain-pipes').name
  const allDrainRooms = rooms
  for (const fixture of fixtures) {
    const room = allDrainRooms.find(r => r.id === fixture.roomId)
    if (!room) continue
    const stack = assigned.get(room.id)
    if (!stack) continue
    const path = [...perimeterRoutes(fixture.position, stack.position, room.rect), route(fixture.position, stack.position), route(fixture.position, stack.position, true)].find(p => p.length > 1 && clearPath(p, room, cuts))
    if (!path) { notes.push(`No supported drainage branch for ${fixture.id}.`); continue }
    const diameter = Number(resolveSpecification(brief, fixture.type === 'toilet' ? 'soil-pipe-size' : 'waste-pipe-size').id.replace('mm', ''))
    utilities.push({ id: `D:${fixture.id}`, layer: 'drainage', fixtureId: fixture.id, path, diameter, material, flowDirection: 'forward', roomId: room.id, stackId: stack.id })
  }
  const electrical = electricalPlan(floor, cuts, fixtures, brief.levels.floorToFloor * 1000)
  const water = waterPlan(floor, cuts, fixtures, brief, electrical.symbols)
  const fire = fireSafetyPlan(floor, cuts, UTILITY_LAYERS.fire_alarm.detectorRadiusMm, [...electrical.symbols, ...water.symbols])
  return { sourcePlanId: design.id, floor, circuits: electrical.circuits, waterNetworks: water.networks, zones: fire.zones, exitRoutes: fire.exitRoutes, coverage: fire.coverage, slabs: subtractRegions(floor.footprint, utilityVoids(floor)), wallSections: utilityWallSections(floor, brief.levels.floorToFloor * 1000), fixtures, utilities: [...utilities, ...electrical.utilities, ...fire.utilities, ...water.utilities], symbols: [...symbols, ...electrical.symbols, ...fire.symbols, ...water.symbols], notes: [...notes, ...electrical.notes, ...fire.notes, ...water.notes] }
}
