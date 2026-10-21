import { useMemo } from 'react'
import { Html } from '@react-three/drei'
import { Object3D, Vector3 } from 'three'
import { electricalScene, type ElectricalPoint3D } from '@/lib/utilities/electrical3D.ts'
import type { UtilityFloor } from '@/lib/utilities/plan.ts'
import { translate as t } from '@/lib/i18n/index.ts'
import { UtilityInstances3D as Batch, type UtilityInstance3D as Instance } from './UtilityInstances3D.tsx'

export function ElectricalLayer3D({ model, scene, room, circuit, selected, labels, onSelect }: { model: UtilityFloor; scene: ReturnType<typeof electricalScene>; room: string; circuit: string; selected: string | null; labels: boolean; onSelect: (id: string) => void }) {
  const instances = useMemo(() => {
    const conduits: Instance[] = [], plates: Instance[] = [], details: Instance[] = [], lamps: Instance[] = [], seen = new Set<string>()
    const up = new Vector3(0, 1, 0)
    for (const wire of scene.wires) {
      const c = model.circuits.find(c => c.id === wire.circuitId)!, selection = `circuit:${c.id}`, faded = !!selected && selected !== selection
      for (let i = 1; i < wire.points.length; i++) {
        const a = new Vector3(...wire.points[i - 1]), b = new Vector3(...wire.points[i]), direction = b.clone().sub(a), length = direction.length()
        const key = `${c.id}:${[a.toArray().map(v => v.toFixed(4)).join(','), b.toArray().map(v => v.toFixed(4)).join(',')].sort().join(':')}`
        if (length < .0001 || seen.has(key)) continue
        seen.add(key)
        const q = new Object3D(); q.quaternion.setFromUnitVectors(up, direction.normalize())
        conduits.push({ position: a.add(b).multiplyScalar(.5).toArray() as ElectricalPoint3D, scale: [selected === selection ? .029 : .022, length, selected === selection ? .029 : .022], quaternion: q.quaternion.toArray() as [number, number, number, number], color: c.color, selection, faded })
      }
    }
    for (const board of scene.boards) {
      const c = model.circuits.find(c => c.id === (board.circuitIds.includes(circuit) ? circuit : selected?.startsWith('circuit:') && board.circuitIds.includes(selected.slice(8)) ? selected.slice(8) : board.circuitIds[0]))!
      const selection = `circuit:${c.id}`, faded = !board.connected || !!selected && selected !== selection, rotation: ElectricalPoint3D = [0, board.rotationY, 0]
      const panel = board.type === 'db_panel', lamp = board.type === 'light', fan = board.type === 'exhaust_fan'
      if (lamp) { lamps.push({ position: board.position, scale: [.16, .045, .16], color: faded ? '#ddddcf' : '#fff0b2', selection, faded }); continue }
      plates.push({ position: board.position, rotation, scale: panel ? [.36, .5, .08] : fan ? [.26, .26, .055] : [.16, .22, .045], color: selected === selection ? '#fff1d7' : '#faf9f3', selection, faded })
      const detail = (x: number, y: number, w: number, h: number, color = '#292b2b') => {
        const sin = Math.sin(board.rotationY), cos = Math.cos(board.rotationY)
        details.push({ position: [board.position[0] + x * cos + .048 * sin, board.position[1] + y, board.position[2] - x * sin + .048 * cos], rotation, scale: [w, h, .012], color, selection, faded })
      }
      if (panel) { for (let i = 0; i < 4; i++) detail(-.105 + i * .07, 0, .038, .14); detail(0, .17, .25, .025, c.color) }
      else if (board.type === 'socket') { detail(-.033, .02, .018, .055); detail(.033, .02, .018, .055); detail(0, -.045, .018, .025) }
      else if (fan) { detail(0, 0, .18, .025); detail(0, 0, .025, .18) }
      else detail(0, 0, .08, .11, c.color)
    }
    return { conduits, plates, details, lamps }
  }, [scene, model, circuit, selected])
  return <group name="utility-electrical-overlay">
    <Batch items={instances.conduits} round onSelect={onSelect} /><Batch items={instances.plates} onSelect={onSelect} /><Batch items={instances.details} onSelect={onSelect} /><Batch items={instances.lamps} round onSelect={onSelect} />
    {labels && model.floor.rooms.filter(r => !r.outdoor && (room === 'all' || r.id === room)).map(r => <Html key={r.id} center position={[(r.rect.x + r.rect.w / 2) / 1000, .12, (r.rect.y + r.rect.h / 2) / 1000]} zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}><span className="whitespace-nowrap border border-line bg-bg/90 px-1.5 py-1 font-mono text-[9px] text-ink-dim">{t(r.name)}</span></Html>)}
    {scene.boards.filter(b => b.type === 'db_panel').map(b => <Html key={b.id} center position={[b.position[0], b.position[1] + .4, b.position[2]]} zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}><span className="border border-line bg-bg px-2 py-1 font-mono text-[10px] text-ink">DB</span></Html>)}
    {labels && room !== 'all' && scene.boards.filter(b => b.roomId === room && b.type !== 'db_panel').map(b => <Html key={`label:${b.id}`} center position={[b.position[0], b.position[1] + .25, b.position[2]]} zIndexRange={[5, 0]}><button type="button" className="min-h-11 whitespace-nowrap border border-line bg-bg/95 px-2 py-1 font-mono text-[9px] text-ink shadow-sm" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onSelect(`circuit:${b.circuitIds.includes(circuit) ? circuit : b.circuitIds[0]}`) }} aria-label={`${t(b.label)} · ${t(model.floor.rooms.find(r => r.id === b.roomId)?.name)}`}>
      {t(b.type === 'switch' ? 'Switch' : b.type === 'socket' ? 'Socket' : b.type === 'light' ? 'Light' : 'Exhaust fan')}{!b.connected && ` · ${t('Routing pending')}`}
    </button></Html>)}
  </group>
}
