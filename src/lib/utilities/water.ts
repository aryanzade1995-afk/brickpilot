import type { FloorPlan, PlacedRoom } from '../engine/types.ts'
import type { Brief } from '../model/brief.ts'
import { rectCenter, type Rect, type Point } from '../geometry.ts'
import { resolveSpecification } from '../cost/catalogue.ts'
import { routeThroughDoors } from './electrical.ts'
import { wallMount } from './electricalMounts.ts'
import type { ElectricalSymbol, Fixture, UtilityFloor, WaterNetwork, WaterRun, WaterSymbol } from './plan.ts'

/** Bounding box of all rooms, fixtures, symbols, and pipe runs participating in water supply. */
export function waterBounds(model: UtilityFloor): Rect {
  const waterRuns = model.utilities.filter(u => u.layer === 'water_supply')
  const waterSymbols = model.symbols.filter(s => s.layer === 'water_supply')
  const waterRoomIds = new Set([
    ...waterSymbols.map(s => s.roomId),
    ...model.fixtures.filter(f => f.type !== 'floor_drain').map(f => f.roomId),
  ])
  const waterRooms = model.floor.rooms.filter(r => waterRoomIds.has(r.id))
  const rects: Rect[] = waterRooms.map(r => r.rect)
  const points: Point[] = [
    ...waterSymbols.map(s => s.position),
    ...waterRuns.flatMap(u => u.path),
  ]
  if (!rects.length && !points.length) return model.floor.outline
  const minX = Math.min(...rects.map(r => r.x), ...(points.length ? points.map(p => p.x) : [Infinity]))
  const minY = Math.min(...rects.map(r => r.y), ...(points.length ? points.map(p => p.y) : [Infinity]))
  const maxX = Math.max(...rects.map(r => r.x + r.w), ...(points.length ? points.map(p => p.x) : [-Infinity]))
  const maxY = Math.max(...rects.map(r => r.y + r.h), ...(points.length ? points.map(p => p.y) : [-Infinity]))
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** Read-only concept supply model. Reuses actual furnishing fixtures, source
 * walls/openings and the current branch/riser sizes. It neither prices these
 * route lengths nor invents an upstream tank, pump or heater installation. */
export function waterPlan(floor: FloorPlan, cuts: Rect[], fixtures: Fixture[], brief: Brief, electrical: ElectricalSymbol[] = []) {
  const symbols: WaterSymbol[] = [], utilities: WaterRun[] = [], networks: WaterNetwork[] = [], notes: string[] = []
  const served = fixtures.filter(f => f.type !== 'floor_drain'), rooms = floor.rooms.filter(r => !r.outdoor && served.some(f => f.roomId === r.id))
  if (!rooms.length) return { symbols, utilities, networks, notes }
  const branch = Number(resolveSpecification(brief, 'water-pipe-size').id.replace('mm', '')), riser = Number(resolveSpecification(brief, 'water-riser-size').id.replace('mm', ''))
  const cold: WaterNetwork = { id: `W:${floor.level}:CW`, name: 'Cold water', tag: 'CW', service: 'cold', color: '#287FAD', sourceIds: [], sourceBasis: 'unverified', branchDiameterMm: branch, riserDiameterMm: riser, material: resolveSpecification(brief, 'water-pipes').name, heatSource: null, unroutedFixtures: [] }
  const hot: WaterNetwork = { ...cold, id: `W:${floor.level}:HW`, name: 'Hot water', tag: 'HW', service: 'hot', color: '#BE5076', sourceIds: [], material: 'Hot-water material needs verification', heatSource: resolveSpecification(brief, 'water-heater').name, unroutedFixtures: [] }
  networks.push(cold, hot)
  const insideCut = (p: Point) => cuts.some(r => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h)
  const make = (room: PlacedRoom, type: WaterSymbol['type'], n: WaterNetwork, desired: Point, elevation: number, fixtureId: string | null = null) => {
    const candidates = [desired, ...[-300, 300, -600, 600].flatMap(offset => [{ x: desired.x + offset, y: desired.y }, { x: desired.x, y: desired.y + offset }])]
    const mounted = candidates.map(p => wallMount(floor, room, p, elevation, 130)).find(p => p && !insideCut(p.position) && symbols.every(s => Math.hypot(s.position.x - p.position.x, s.position.y - p.position.y) >= 150) && electrical.filter(s => s.mount?.kind === 'wall').every(s => Math.hypot(s.position.x - p.position.x, s.position.y - p.position.y) >= 300))
    if (!mounted || insideCut(mounted.position)) return null
    const s: WaterSymbol = { id: `${n.id}:${room.id}:${type}:${symbols.length}`, type, layer: 'water_supply', networkId: n.id, service: n.service, roomId: room.id, roomIds: [room.id], fixtureId, position: mounted.position, basis: 'proposed', label: type === 'supply_inlet' ? 'Cold supply inlet' : type === 'hot_supply_inlet' ? 'Hot supply inlet' : type === 'isolation_valve' ? 'Isolation valve' : 'Fixture water outlet', mount: { kind: 'wall', elevationMm: elevation, serviceElevationMm: n.service === 'cold' ? 600 : 760, normal: mounted.normal, wallIndex: mounted.wallIndex } }
    symbols.push(s); return s
  }
  const host = rooms.find(r => /utility|laundry/i.test(r.name)) ?? rooms.find(r => /kitchen/i.test(r.name)) ?? rooms[0]
  const inlet = make(host, 'supply_inlet', cold, rectCenter(host.rect), 1100)
  if (inlet) cold.sourceIds.push(inlet.id)
  else notes.push('Water supply inlet needs a represented solid wall.')
  const join = (from: WaterSymbol | null, to: WaterSymbol, n: WaterNetwork, fixtureId: string | null, main = false) => {
    const path = from ? routeThroughDoors(from.position, from.roomIds, to.position, to.roomId, floor, cuts, true, true, n.service === 'cold' ? 70 : 160) : null
    if (!from || !path || path.length < 2) { if (fixtureId) n.unroutedFixtures.push(fixtureId); return false }
    utilities.push({ id: `${n.id}:run:${utilities.length}`, layer: 'water_supply', networkId: n.id, service: n.service, fromSymbolId: from.id, toSymbolId: to.id, fixtureId, path, diameter: main ? riser : branch, material: n.material, roomId: to.roomId }); return true
  }
  for (const room of rooms) {
    const door = floor.openings.find(o => o.kind !== 'window' && o.rooms?.includes(room.id)), at = door ? { x: door.at.x + 450, y: door.at.y + 450 } : rectCenter(room.rect)
    const valve = make(room, 'isolation_valve', cold, at, 900)
    const valveFed = valve ? join(inlet, valve, cold, null, true) : false
    const hotFixtures = served.filter(f => f.roomId === room.id && f.type !== 'toilet' && f.type !== 'washing_machine')
    const f0 = hotFixtures[0]
    const hotAt = f0
      ? (Math.min(Math.abs(f0.position.x - room.rect.x), Math.abs(f0.position.x - (room.rect.x + room.rect.w))) < Math.min(Math.abs(f0.position.y - room.rect.y), Math.abs(f0.position.y - (room.rect.y + room.rect.h)))
        ? { x: f0.position.x, y: f0.position.y + 350 }
        : { x: f0.position.x + 350, y: f0.position.y })
      : rectCenter(room.rect)
    const hotInlet = hotFixtures.length ? make(room, 'hot_supply_inlet', hot, hotAt, 1700) : null
    if (hotInlet) hot.sourceIds.push(hotInlet.id)
    for (const f of served.filter(f => f.roomId === room.id)) for (const n of [cold, ...(['toilet', 'washing_machine'].includes(f.type) ? [] : [hot])]) {
      const r = room.rect
      const distLeft = Math.abs(f.position.x - r.x), distRight = Math.abs(f.position.x - (r.x + r.w))
      const distTop = Math.abs(f.position.y - r.y), distBottom = Math.abs(f.position.y - (r.y + r.h))
      const isVertical = Math.min(distLeft, distRight) < Math.min(distTop, distBottom)
      const offset = n.service === 'cold' ? -90 : 90
      const desired = isVertical ? { x: f.position.x, y: f.position.y + offset } : { x: f.position.x + offset, y: f.position.y }
      const height = f.type === 'toilet' ? 550 : f.type === 'shower' ? 1100 : 1000
      const outlet = make(room, 'water_outlet', n, desired, height, f.id)
      const source = n.service === 'cold' ? valveFed ? valve : null : hotInlet
      if (!outlet || !join(source, outlet, n, f.id)) { if (!n.unroutedFixtures.includes(f.id)) n.unroutedFixtures.push(f.id) }
    }
  }
  for (const n of networks) n.unroutedFixtures = [...new Set(n.unroutedFixtures)]
  return { symbols, utilities, networks, notes }
}
