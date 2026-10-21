import type { WaterRun, WaterSymbol, UtilityFloor } from './plan.ts'
import { electricalWorldPoint, liftSurfaceRun, type ElectricalPoint3D } from './electrical3D.ts'
import { routeThroughDoors } from './electrical.ts'

export function waterScene(model: UtilityFloor, room = 'all', network = 'all', hot = true) {
  const symbols = model.symbols.filter((s): s is WaterSymbol => s.layer === 'water_supply' && (network === 'all' || s.networkId === network) && (hot || s.service === 'cold'))
  const runs = model.utilities.filter((u): u is WaterRun => u.layer === 'water_supply' && (room === 'all' || u.roomId === room) && (network === 'all' || u.networkId === network) && (hot || u.service === 'cold'))
  const pipes: { id: string; networkId: string; diameter: number; points: ElectricalPoint3D[] }[] = [], pending: string[] = []
  const needed = new Set<string>(), cuts = [...(model.floor.courtyard ? [model.floor.courtyard] : []), ...(model.floor.doubleHeightVoids ?? []).map(v => v.rect)]
  for (const run of runs) {
    const from = symbols.find(s => s.id === run.fromSymbolId), to = symbols.find(s => s.id === run.toSymbolId)
    const band = run.service === 'cold' ? 600 : 760
    const points = from && to ? liftSurfaceRun(model, run, from, to, band, -80) : null
    if (!points) { pending.push(run.id); continue }
    pipes.push({ id: run.id, networkId: run.networkId, diameter: run.diameter, points }); needed.add(from!.id); needed.add(to!.id)
  }
  const reachable = new Set(model.waterNetworks.flatMap(n => n.sourceIds).filter(id => symbols.some(s => s.id === id && s.mount)))
  let changed = true
  while (changed) { changed = false; for (const run of runs) if (reachable.has(run.fromSymbolId) && !reachable.has(run.toSymbolId)) { reachable.add(run.toSymbolId); changed = true } }
  const nodes = symbols.filter(s => needed.has(s.id) || room === 'all' || s.roomId === room).map(s => ({ ...s, world: s.mount ? electricalWorldPoint(s.position, s.mount.elevationMm) : null, connected: reachable.has(s.id) }))
  const fixtures = model.fixtures.filter(f => f.type !== 'floor_drain' && (room === 'all' || f.roomId === room) && nodes.some(n => n.fixtureId === f.id))
  for (const node of nodes.filter(s => s.fixtureId && s.mount && s.connected)) {
    const f = fixtures.find(f => f.id === node.fixtureId)
    if (!f) continue
    if (f.type === 'shower') {
      pipes.push({ id: `${node.id}:shower`, networkId: node.networkId, diameter: model.waterNetworks.find(n => n.id === node.networkId)!.branchDiameterMm, points: [node.world!, electricalWorldPoint(node.position, 2100)] })
    } else {
      const path = routeThroughDoors(node.position, [node.roomId], f.position, node.roomId, model.floor, cuts)
      if (!path) { pending.push(`${node.id}:fixture`); continue }
      pipes.push({ id: `${node.id}:fixture`, networkId: node.networkId, diameter: model.waterNetworks.find(n => n.id === node.networkId)!.branchDiameterMm, points: path.map(p => electricalWorldPoint(p, node.mount!.elevationMm)) })
    }
  }
  return { pipes, nodes, fixtures, pending }
}
