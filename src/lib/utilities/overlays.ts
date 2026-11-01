import type { Point } from '../geometry.ts'
import type { UtilityRun } from './plan.ts'
import { segmentIntersection } from './electrical.ts'

/** Decoration only: canonical paths stay orthogonal. A different circuit
 * bridges a proper intersection; shared endpoints and same-circuit junctions
 * do not receive jumps. Deterministic ownership avoids double bridges. */
export function wiringPath(run: UtilityRun, visibleRuns: UtilityRun[], scale: number) {
  const radius = 5 / scale, jumps: { d: string; position: Point }[] = []
  let d = `M${run.path[0].x} ${run.path[0].y}`
  for (let i = 1; i < run.path.length; i++) {
    const a = run.path[i - 1], b = run.path[i], length = Math.hypot(b.x - a.x, b.y - a.y), dx = (b.x - a.x) / length, dy = (b.y - a.y) / length
    const positions: Point[] = []
    const isElectrical = run.layer === 'electrical'
    const isWaterHot = run.layer === 'water_supply' && 'service' in run && run.service === 'hot'
    if (isElectrical || isWaterHot) for (const other of visibleRuns) {
      if (isElectrical && (other.layer !== 'electrical' || other.circuitId === run.circuitId || other.id >= run.id)) continue
      if (isWaterHot && (other.layer !== 'water_supply' || !('service' in other) || other.service !== 'cold')) continue
      for (let j = 1; j < other.path.length; j++) {
        const c = other.path[j - 1], e = other.path[j], p = segmentIntersection(a, b, c, e)
        if (!p) continue
        const dA = Math.hypot(p.x - a.x, p.y - a.y), dB = Math.hypot(p.x - b.x, p.y - b.y)
        const dC = Math.hypot(p.x - c.x, p.y - c.y), dE = Math.hypot(p.x - e.x, p.y - e.y)
        const clearRun = isWaterHot ? 15 : radius * 1.7
        const clearOther = isWaterHot ? 15 : radius
        if (dA > clearRun && dB > clearRun && dC > clearOther && dE > clearOther && !positions.some(q => Math.hypot(p.x - q.x, p.y - q.y) < radius * 1.5)) positions.push(p)
      }
    }
    positions.sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y))
    for (const p of positions) {
      const dA = Math.hypot(p.x - a.x, p.y - a.y), dB = Math.hypot(p.x - b.x, p.y - b.y)
      const r = Math.min(radius, dA * 0.5, dB * 0.5)
      const before = { x: p.x - dx * r, y: p.y - dy * r }, after = { x: p.x + dx * r, y: p.y + dy * r }
      const control = { x: p.x + (dy ? r * 1.5 : 0), y: p.y - (dx ? r * 1.5 : 0) }
      const arc = `M${before.x} ${before.y}Q${control.x} ${control.y} ${after.x} ${after.y}`
      d += `L${before.x} ${before.y}Q${control.x} ${control.y} ${after.x} ${after.y}`; jumps.push({ d: arc, position: p })
    }
    d += `L${b.x} ${b.y}`
  }
  return { d, jumps }
}
