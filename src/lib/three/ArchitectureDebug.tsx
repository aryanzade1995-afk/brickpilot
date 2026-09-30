import type { Design, Opening } from '../engine/types.ts'
import { availableFacadeRegions, planFacade } from '../engine/facade/grammar.ts'

type DebugBox = { id: string; color: string; at: [number, number, number]; size: [number, number, number] }

/** Wireframe overlays are rendered only in development, on demand. */
export function ArchitectureDebug({ design }: { design: Design }) {
  const plan = planFacade(design)
  const plotW = design.model.plot.width
  const plotD = design.model.plot.depth
  const height = design.model.brief.levels.floorToFloor
  const x = (mm: number) => (mm - plotW / 2) / 1000
  const z = (mm: number) => (mm - plotD / 2) / 1000
  const boxes: DebugBox[] = []
  const protectedBox = (o: Opening, level: number) => {
    const sill = o.kind === 'window' ? (o.sill ?? 850) / 1000 : 0
    const head = o.kind === 'window' ? 2.6 : 2.5
    const centerY = 0.4 + level * height + (sill + head) / 2
    boxes.push({
      id: `${level}-${o.id}-protected`, color: '#2777ff',
      at: [x(o.at.x), centerY, z(o.at.y)],
      size: o.orient === 'h' ? [(o.width + 400) / 1000, head - sill, 0.46] : [0.46, head - sill, (o.width + 400) / 1000],
    })
  }
  for (const floor of design.floors) {
    for (const op of floor.openings.filter((o) => o.kind === 'entry' || o.kind === 'window')) protectedBox(op, floor.level)
    for (const wall of floor.walls.filter((w) => w.kind === 'exterior')) {
      const horizontal = Math.abs(wall.a.y - wall.b.y) < 2
      for (const [a, b] of availableFacadeRegions(floor, wall)) boxes.push({
        id: `${wall.id}-${a}-available`, color: '#21b86b',
        at: horizontal ? [x((a + b) / 2), 0.4 + floor.level * height + 0.15, z(wall.a.y)]
          : [x(wall.a.x), 0.4 + floor.level * height + 0.15, z((a + b) / 2)],
        size: horizontal ? [(b - a) / 1000, 0.08, 0.28] : [0.28, 0.08, (b - a) / 1000],
      })
    }
  }
  for (const f of plan.features) {
    const floor = design.floors.find((item) => item.prefix === f.hostFloorId)
    if (!floor) continue
    const base = 0.4 + floor.level * height + (f.bottom + f.height / 2) / 1000
    const outside = f.depth / 2000 + 0.12
    const at: [number, number, number] = f.orient === 'h'
      ? [x(f.at.x), base, z(f.at.y) + outside]
      : [x(f.at.x) + outside, base, z(f.at.y)]
    const size: [number, number, number] = f.orient === 'h'
      ? [f.width / 1000, f.height / 1000, f.depth / 1000]
      : [f.depth / 1000, f.height / 1000, f.width / 1000]
    const collision = plan.errors.some((error) => error.includes(f.id))
    boxes.push({ id: `${f.id}-feature`, color: collision ? '#ff3333' : '#dd36cf', at, size })
    boxes.push({ id: `${f.id}-clearance`, color: '#efc62f', at,
      size: size.map((n) => n + f.requiredClearance / 500) as [number, number, number] })
    boxes.push({ id: `${f.id}-anchor`, color: '#24d9e7', at: [x(f.at.x), base, z(f.at.y)], size: [0.12, 0.12, 0.12] })
  }
  return <group name="ARCHITECTURE_DEBUG">
    {boxes.map((box) => <mesh key={box.id} name={box.id} position={box.at}>
      <boxGeometry args={box.size} />
      <meshBasicMaterial color={box.color} wireframe transparent opacity={0.78} depthTest={false} />
    </mesh>)}
  </group>
}
