import { useMemo } from 'react'
import { Html } from '@react-three/drei'
import { Object3D, Vector3 } from 'three'
import type { UtilityFloor } from '@/lib/utilities/plan.ts'
import type { waterScene } from '@/lib/utilities/water3D.ts'
import type { ElectricalPoint3D } from '@/lib/utilities/electrical3D.ts'
import { UtilityInstances3D as Batch, type UtilityInstance3D as Instance } from './UtilityInstances3D.tsx'
import { translate as t } from '@/lib/i18n/index.ts'

export function WaterLayer3D({ model, scene, room, selected, labels, roomNames, onSelect }: { model: UtilityFloor; scene: ReturnType<typeof waterScene>; room: string; selected: string | null; labels: boolean; roomNames: boolean; onSelect: (id: string) => void }) {
  const instances = useMemo(() => {
    const pipes: Instance[] = [], fittings: Instance[] = [], fixtures: Instance[] = [], bowls: Instance[] = [], seen = new Set<string>()
    const up = new Vector3(0, 1, 0)
    const segment = (a: ElectricalPoint3D, b: ElectricalPoint3D, id: string, color: string, radius: number) => {
      const start = new Vector3(...a), end = new Vector3(...b), delta = end.clone().sub(start), length = delta.length(), selection = `water:${id}`
      const key = `${id}:${[a.join(','), b.join(',')].sort().join(':')}`
      if (length < .00001 || seen.has(key)) return
      seen.add(key); const q = new Object3D(); q.quaternion.setFromUnitVectors(up, delta.normalize())
      pipes.push({ position: start.add(end).multiplyScalar(.5).toArray() as ElectricalPoint3D, scale: [radius, length, radius], quaternion: q.quaternion.toArray() as [number, number, number, number], color, selection, faded: !!selected && selected !== selection })
    }
    for (const pipe of scene.pipes) {
      const n = model.waterNetworks.find(n => n.id === pipe.networkId)!
      for (let i = 1; i < pipe.points.length; i++) segment(pipe.points[i - 1], pipe.points[i], n.id, n.color, Math.max(.018, pipe.diameter / 2000))
    }
    for (const node of scene.nodes) {
      if (!node.world || !node.mount) continue
      const n = model.waterNetworks.find(n => n.id === node.networkId)!, selection = `water:${n.id}`, faded = !node.connected || !!selected && selected !== selection
      const rotation: ElectricalPoint3D = [0, Math.atan2(node.mount.normal.x, node.mount.normal.y), 0]
      fittings.push({ position: node.world, rotation, scale: node.type === 'water_outlet' ? [.12, .12, .09] : [.22, .22, .12], color: node.service === 'hot' ? '#f4d9e2' : '#d2e8f2', selection, faded })
      fittings.push({ position: [node.world[0] + node.mount.normal.x * .075, node.world[1], node.world[2] + node.mount.normal.y * .075], rotation, scale: [.13, .04, .04], color: n.color, selection, faded })
      if (node.type === 'supply_inlet') segment([node.world[0], .08, node.world[2]], [node.world[0], Math.max(1.5, ...model.wallSections.map(w => (w.base + w.height) / 1000)) - .25, node.world[2]], n.id, n.color, Math.max(.022, n.riserDiameterMm / 2000))
    }
    for (const f of scene.fixtures) {
      const outlets = scene.nodes.filter(n => n.fixtureId === f.id), selection = `water:${outlets[0].networkId}`, faded = !outlets.some(n => n.connected) || !!selected && !outlets.some(n => selected === `water:${n.networkId}`), x = f.position.x / 1000, z = f.position.y / 1000, w = f.width / 1000, d = f.depth / 1000
      if (f.type === 'shower') fixtures.push({ position: [x, .04, z], scale: [w, .08, d], color: '#e2e7e4', selection, faded })
      else if (f.type === 'toilet') { fixtures.push({ position: [x, .48, z - d * .3], scale: [w * .9, .5, d * .25], color: '#fffefa', selection, faded }); bowls.push({ position: [x, .28, z + d * .1], scale: [w * .46, .35, d * .4], color: '#f6f7f1', selection, faded }) }
      else { fixtures.push({ position: [x, .78, z], scale: [w, .12, d], color: '#f9faf6', selection, faded }); fixtures.push({ position: [x, .85, z], scale: [w * .7, .03, d * .65], color: '#b7ced7', selection, faded }) }
    }
    return { pipes, fittings, fixtures, bowls }
  }, [model, scene, selected])
  return <group name="utility-water-overlay">
    <Batch items={instances.pipes} round onSelect={onSelect} /><Batch items={instances.fittings} onSelect={onSelect} /><Batch items={instances.fixtures} onSelect={onSelect} /><Batch items={instances.bowls} round onSelect={onSelect} />
    {labels && roomNames && model.floor.rooms.filter(r => !r.outdoor && (room === 'all' || r.id === room)).map(r => <Html key={r.id} center position={[(r.rect.x + r.rect.w / 2) / 1000, .1, (r.rect.y + r.rect.h / 2) / 1000]} zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}><span className="whitespace-nowrap border border-line bg-bg/90 px-1.5 py-1 font-mono text-[9px] text-ink-dim">{t(r.name)}</span></Html>)}
    {labels && scene.nodes.filter(n => n.world && n.type === 'supply_inlet' && room === 'all').map(n => <Html key={n.id} center position={[n.world![0], n.world![1] + .25, n.world![2]]} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}><span className="whitespace-nowrap border border-line bg-bg/95 px-2 py-1 font-mono text-[9px] text-ink">{t('Cold supply inlet')} · CW</span></Html>)}
    {labels && room !== 'all' && scene.fixtures.map(f => {
      const ports = scene.nodes.filter(n => n.fixtureId === f.id && n.world), n = ports[0]
      if (!n?.world) return null
      return <Html key={`fixture:${f.id}`} center position={[f.position.x / 1000, n.world[1] + .24, f.position.y / 1000]} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}><span className="whitespace-nowrap border border-line bg-bg/95 px-2 py-1 font-mono text-[9px] text-ink">{t(f.type)} · {ports.map(p => p.service === 'cold' ? 'CW' : 'HW').join(' / ')}</span></Html>
    })}
  </group>
}
