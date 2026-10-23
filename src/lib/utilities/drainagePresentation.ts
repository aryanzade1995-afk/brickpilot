import type { Point, Rect } from '../geometry.ts'
import type { DrainageDesign, DrainageNode, DrainagePipe } from './drainage.ts'
import type { DrainageService } from './drainageRules.ts'
import { alongPath } from './routing.ts'

/** Presentation only. Never adjusts a canonical node, route, size or validation. */
export const DRAINAGE_DISPLAY: Record<DrainageService, { label: string; width: number; dash?: string }> = {
  soil: { label: 'Soil pipe', width: 3 }, waste: { label: 'Waste pipe', width: 2.5 },
  vent: { label: 'Vent pipe', width: 1.8, dash: '3 5' },
  stormwater: { label: 'Stormwater', width: 2.5, dash: '9 5' },
  building_drain: { label: 'Main building drain', width: 3.8 },
}
export const DRAINAGE_NODE_NAMES: Record<DrainageNode['kind'], string> = {
  fixture: 'Fixture connection', stack: 'Vertical stack', stack_base: 'Stack base',
  inspection_chamber: 'Inspection chamber', outlet: 'Discharge outlet', trap: 'Trap',
  cleanout: 'Cleanout', vent_terminal: 'Vent terminal',
}
const priority: Record<DrainageNode['kind'], number> = { stack: 0, outlet: 1, inspection_chamber: 2, stack_base: 3, vent_terminal: 4, cleanout: 5, trap: 6, fixture: 7 }
export type DrainageCluster = { id: string; anchor: DrainageNode; nodes: DrainageNode[] }
/** A counted symbol represents crowded components at this zoom, not a new
 * junction. Zooming separates them. Every member remains selectable in details. */
export function clusterDrainageNodes(nodes: DrainageNode[], scale: number): DrainageCluster[] {
  const result: DrainageCluster[] = [], sorted = nodes.filter(n => n.kind !== 'fixture').toSorted((a, b) => priority[a.kind] - priority[b.kind] || a.id.localeCompare(b.id))
  for (const node of sorted) {
    const group = result.find(g => Math.hypot(node.position.x - g.anchor.position.x, node.position.y - g.anchor.position.y) * scale < 25)
    if (group) group.nodes.push(node)
    else result.push({ id: node.id, anchor: node, nodes: [node] })
  }
  return result
}
export function drainageTrace(design: DrainageDesign | undefined, selected: string | null) {
  const pipes = new Set<string>(), nodes = new Set<string>()
  if (!design || !selected) return { pipes, nodes }
  const reference = selected.startsWith('trap:') ? selected.slice(5) : selected.startsWith('CO:') ? selected.slice(3) : selected
  const initial = design.pipes.filter(p => p.id === reference || p.from === reference || p.to === reference || p.id === selected || p.from === selected || p.to === selected), queue = [...initial]
  nodes.add(selected)
  while (queue.length) {
    const p = queue.shift()!
    if (pipes.has(p.id)) continue
    pipes.add(p.id); nodes.add(p.from); nodes.add(p.to)
    // Trace represented downstream connections only. A missing outlet or blocked
    // branch is never repaired by a display line. Vents stay a separate service.
    queue.push(...design.pipes.filter(next => next.from === p.to && (p.service === 'vent' ? next.service === 'vent' : next.service !== 'vent')))
  }
  return { pipes, nodes }
}
export function drainageFlowMarkers(path: Point[], scale: number) {
  const length = path.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - path[i].x, p.y - path[i].y), 0), pixels = length * scale
  if (pixels < 34) return []
  const count = Math.max(1, Math.floor(pixels / 110)), result = []
  for (let i = 0; i < count; i++) { const p = alongPath(path, length * (i + .5) / count); if (p) result.push(p) }
  return result
}
export type DrainageLabel = { pipeId: string; at: Point; center: Point; rect: Rect; text: string }
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
/** Screen-space collision avoidance: selected labels first; low zoom shows no
 * automatic specifications. Unknown data stays in the inspector, never '? ? ?'
 * repeated across the map. The geometry beneath labels remains unmodified. */
export function drainageLabels(pipes: DrainagePipe[], scale: number, selected: string | null, technical: boolean, protectedRects: Rect[], viewport: Rect): DrainageLabel[] {
  const labels: DrainageLabel[] = [], occupied = [...protectedRects]
  for (const p of pipes.toSorted((a, b) => Number(b.id === selected) - Number(a.id === selected) || a.id.localeCompare(b.id))) {
    if (p.vertical || p.path.length < 2 || p.id !== selected && (!technical || scale < .045 || p.diameterMm === null)) continue
    const text = [p.diameterMm === null ? 'Size pending' : `${p.diameterMm} mm`, p.gradientRatio ? `1:${p.gradientRatio}` : p.id === selected ? 'Fall pending' : ''].filter(Boolean).join(' · ')
    const w = Math.min(210, text.length * 6 + 18) / scale, h = 23 / scale
    const length = p.path.slice(1).reduce((n, b, i) => n + Math.hypot(b.x - p.path[i].x, b.y - p.path[i].y), 0)
    let placed = false
    for (const fraction of [.55, .3, .75]) {
      const at = alongPath(p.path, length * fraction)
      if (!at) continue
      for (const offset of [-25, 25, -48, 48]) {
        const center = { x: at.x, y: at.y + offset / scale }, rect = { x: center.x - w / 2, y: center.y - h / 2, w, h }
        if (rect.x < viewport.x || rect.y < viewport.y || rect.x + rect.w > viewport.x + viewport.w || rect.y + rect.h > viewport.y + viewport.h || occupied.some(r => overlap(r, rect))) continue
        labels.push({ pipeId: p.id, at, center, rect, text }); occupied.push({ x: rect.x - 5 / scale, y: rect.y - 5 / scale, w: rect.w + 10 / scale, h: rect.h + 10 / scale }); placed = true; break
      }
      if (placed) break
    }
  }
  return labels
}
/** Tooltip coordinates are local to the canvas. Prefer above near the bottom;
 * clamp both axes using the measured card, not a guessed fixed height. */
export function utilityTooltipPosition(anchor: Point, card: { w: number; h: number }, host: { w: number; h: number }) {
  const margin = 12, x = Math.max(margin, Math.min(host.w - card.w - margin, anchor.x + 16)), below = anchor.y + 16
  return { x, y: Math.max(margin, Math.min(host.h - card.h - margin, below + card.h <= host.h - margin ? below : anchor.y - card.h - 16)) }
}
