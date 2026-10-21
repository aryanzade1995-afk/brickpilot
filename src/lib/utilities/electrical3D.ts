import type { Point } from '../geometry.ts'
import type { ElectricalRun, ElectricalSymbol, UtilityFloor } from './plan.ts'
import { electricalPathAllowed, segmentIntersection } from './electrical.ts'
import { alongPath } from './routing.ts'

export type ElectricalPoint3D = [number, number, number]
export type ElectricalBoard3D = { id: string; type: ElectricalSymbol['type']; label: string; roomId: string; position: ElectricalPoint3D; rotationY: number; mount: 'wall' | 'ceiling'; circuitIds: string[]; connected: boolean }
export type ElectricalWire3D = { id: string; circuitId: string; fromSymbolId: string; toSymbolId: string; points: ElectricalPoint3D[] }

/** Explicit coordinate contract: source x/y/height are millimetres; viewer
 * x/y/z are metres with source plan y on world z. No road/north inference. */
export const electricalWorldPoint = (p: Point, elevationMm: number): ElectricalPoint3D => [p.x / 1000, elevationMm / 1000, p.y / 1000]

/** Lift the SAME canonical wiring path into 3D. Wall risers connect boards
 * to a high-level surface conduit. Ceiling branches reach the light points.
 * At a real doorway the conduit drops below the represented door head,
 * crosses the opening and rises on the other wall face; it cannot disappear
 * through an opaque lintel. Heights remain explicit concept assumptions. */
export function liftSurfaceRun(model: UtilityFloor, run: { path: Point[] }, from: Pick<ElectricalSymbol, 'position' | 'mount'>, to: Pick<ElectricalSymbol, 'position' | 'mount'>, band: number, doorCrossingMm?: number): ElectricalPoint3D[] | null {
  if (!from.mount || !to.mount || run.path.length < 2) return null
  const cuts = [...(model.floor.courtyard ? [model.floor.courtyard] : []), ...(model.floor.doubleHeightVoids ?? []).map(v => v.rect)]
  if (!electricalPathAllowed(run.path, model.floor, cuts)) return null
  const distances = [0]
  for (let i = 1; i < run.path.length; i++) distances.push(distances[i - 1] + Math.hypot(run.path[i].x - run.path[i - 1].x, run.path[i].y - run.path[i - 1].y))
  const total = distances.at(-1)!, bridges: { before: number; after: number; elevation: number }[] = []
  for (let i = 1; i < run.path.length; i++) for (const wall of model.floor.walls) {
    const p = segmentIntersection(run.path[i - 1], run.path[i], wall.a, wall.b)
    if (!p) continue
    const d = distances[i - 1] + Math.hypot(p.x - run.path[i - 1].x, p.y - run.path[i - 1].y)
    if (d < .1 || total - d < .1) continue
    const door = model.floor.openings.find(o => o.kind !== 'window' && Math.abs(o.orient === 'h' ? p.y - o.at.y : p.x - o.at.x) < 25 && Math.abs(o.orient === 'h' ? p.x - o.at.x : p.y - o.at.y) <= o.width / 2 - 20)
    if (!door) return null
    const before = Math.max(0, d - wall.thickness / 2 - 45), after = Math.min(total, d + wall.thickness / 2 + 45)
    if (!bridges.some(b => Math.abs(b.before - before) < .1 && Math.abs(b.after - after) < .1)) bridges.push({ before, after, elevation: doorCrossingMm ?? Math.max(200, Math.min(band, (door.head ?? 2100) - 100)) })
  }
  const samples = [...new Set([...distances, ...bridges.flatMap(b => [b.before, b.after])])].sort((a, b) => a - b)
  const points: ElectricalPoint3D[] = [], push = (p: ElectricalPoint3D) => { if (!points.length || points.at(-1)!.some((v, i) => Math.abs(v - p[i]) > .00001)) points.push(p) }
  push(electricalWorldPoint(from.position, from.mount.elevationMm))
  for (const d of samples) {
    const p = alongPath(run.path, d)
    if (!p) continue
    const before = bridges.filter(b => d > b.before + .01 && d <= b.after + .01), after = bridges.filter(b => d >= b.before - .01 && d < b.after - .01)
    const incoming = Math.min(band, ...before.map(b => b.elevation)), outgoing = Math.min(band, ...after.map(b => b.elevation))
    push(electricalWorldPoint(p, incoming)); push(electricalWorldPoint(p, outgoing))
  }
  push(electricalWorldPoint(to.position, to.mount.elevationMm))
  return points
}

export function liftElectricalRun(model: UtilityFloor, run: ElectricalRun, from: ElectricalSymbol, to: ElectricalSymbol): ElectricalPoint3D[] | null {
  if (!from.mount || !to.mount) return null
  const index = Math.max(0, model.circuits.findIndex(c => c.id === run.circuitId))
  return liftSurfaceRun(model, run, from, to, Math.min(from.mount.serviceElevationMm, to.mount.serviceElevationMm) - index * 80)
}

export function electricalScene(model: UtilityFloor, room = 'all', circuit = 'all') {
  const symbols = model.symbols.filter((s): s is ElectricalSymbol => s.layer === 'electrical')
  const runs = model.utilities.filter((u): u is ElectricalRun => u.layer === 'electrical' && (room === 'all' || u.roomId === room) && (circuit === 'all' || circuit === u.circuitId))
  const wires: ElectricalWire3D[] = [], pending: string[] = []
  for (const run of runs) {
    const from = symbols.find(s => s.id === run.fromSymbolId), to = symbols.find(s => s.id === run.toSymbolId)
    const points = from && to ? liftElectricalRun(model, run, from, to) : null
    if (points) wires.push({ id: run.id, circuitId: run.circuitId, fromSymbolId: run.fromSymbolId, toSymbolId: run.toSymbolId, points })
    else pending.push(run.id)
  }
  const needed = new Set(wires.flatMap(w => [w.fromSymbolId, w.toSymbolId]))
  const reachable = new Set(symbols.filter(s => s.type === 'db_panel' && s.mount).map(s => s.id))
  let changed = true
  while (changed) { changed = false; for (const wire of wires) if (reachable.has(wire.fromSymbolId) && !reachable.has(wire.toSymbolId)) { reachable.add(wire.toSymbolId); changed = true } }
  const boards: ElectricalBoard3D[] = [], unmounted: string[] = []
  for (const s of symbols.filter(s => (needed.has(s.id) || room === 'all' || s.roomIds.includes(room)) && (circuit === 'all' || s.circuitIds.includes(circuit)))) {
    if (!s.mount) { unmounted.push(s.id); continue }
    boards.push({ id: s.id, type: s.type, label: s.label, roomId: s.roomId, circuitIds: s.circuitIds, position: electricalWorldPoint(s.position, s.mount.elevationMm), rotationY: Math.atan2(s.mount.normal.x, s.mount.normal.y), mount: s.mount.kind, connected: reachable.has(s.id) })
  }
  return { boards, wires, pending, unmounted, unrouted: boards.filter(s => !s.connected).map(s => s.id) }
}
