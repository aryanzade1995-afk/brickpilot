import type { BuildingFloor, BuildingStair } from '../engine/buildingModel.ts'
import type { Point, Rect } from '../geometry.ts'
import type { StairGeometry } from './sceneTypes.ts'
import { sceneId } from './sceneTypes.ts'

/** Same interleaved dog-leg nosing interpretation as blender/geometry/stairs.py.
 * Thicknesses must be supplied from BuildingModel.quantityRules, not guessed.
 * Source-driven stepped waists replace Blender's display-only floor-filled steps.
 */
export function realizeSourceStair(stair: BuildingStair, floor: BuildingFloor, destinationFloorId: string | null,
  thickness: { waistMm: number; landingThicknessMm: number }): StairGeometry {
  const r = stair.rect, side = stair.startSide
  if (!side || stair.direction !== 'up') throw new Error('Stair direction/orientation is not explicitly supported')
  if (![r.x, r.y, r.w, r.h, floor.heightMm, floor.elevationMm, thickness.waistMm, thickness.landingThicknessMm].every(Number.isFinite) ||
    Math.min(r.w, r.h, floor.heightMm, thickness.waistMm, thickness.landingThicknessMm) <= 0) throw new Error('Invalid stair dimensions')
  const alongY = side === 'N' || side === 'S', across = alongY ? r.w : r.h, run = alongY ? r.h : r.w
  const local = (p: Point): [number, number] => {
    const x = p.x - r.x, y = p.y - r.y
    return side === 'N' ? [x, y] : side === 'S' ? [x, r.h - y] : side === 'W' ? [y, x] : [y, r.w - x]
  }
  const world = (a: number, b: number, w: number, d: number): Rect => side === 'N' ? { x: r.x + a, y: r.y + b, w, h: d } :
    side === 'S' ? { x: r.x + a, y: r.y + r.h - b - d, w, h: d } : side === 'W' ? { x: r.x + b, y: r.y + a, w: d, h: w } :
      { x: r.x + r.w - b - d, y: r.y + a, w: d, h: w }
  const flights: [number, number, number][][] = [[], []]
  for (const line of stair.treads) {
    if (line.length !== 2 || !line.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) throw new Error('Only two-endpoint source nosings are supported')
    const a = local(line[0]), b = local(line[1])
    if (Math.abs(a[1] - b[1]) > .001) throw new Error('Stair nosing is not across its flight')
    const lo = Math.min(a[0], b[0]), hi = Math.max(a[0], b[0]), flight = (lo + hi) / 2 < across / 2 ? 0 : 1
    if (lo < 0 || hi > across || hi <= lo || a[1] <= 0 || a[1] >= run) throw new Error('Source tread lies outside the stair')
    flights[flight].push([lo, hi, a[1]])
  }
  if (!flights[0].length || flights[0].length !== flights[1].length) throw new Error('Two matching source stair flights are required')
  flights.forEach(f => f.sort((a, b) => a[2] - b[2]))
  const positions = flights[0].map(p => p[2]), differences = [positions[0], ...positions.slice(1).map((v, i) => v - positions[i])].sort((a, b) => a - b)
  const going = differences.length % 2 ? differences[Math.floor(differences.length / 2)] : (differences[differences.length / 2 - 1] + differences[differences.length / 2]) / 2
  if (going <= 0 || differences.some(d => Math.abs(d - going) > .001) || flights.some(f => f.some((p, i) =>
    Math.abs(p[2] - positions[i]) > .001 || p[0] !== f[0][0] || p[1] !== f[0][1]))) throw new Error('Inconsistent source tread spacing or flight width')
  if (flights[0][0][1] > flights[1][0][0]) throw new Error('Source flights overlap')
  const count = positions.length + 1, travel = positions.at(-1)! + going, rise = floor.heightMm / (count * 2)
  if (run - travel < 500) throw new Error('Source stair has no usable turning landing')
  const id = sceneId('stair', stair.floorId, stair.id), base = floor.elevationMm
  const steps = flights.flatMap((lines, flight) => Array.from({ length: flight === 0 ? count : count - 1 }, (_, i) => {
    const topMm = base + rise * (i + 1 + flight * count)
    return { id: sceneId(id, 'step', flight, i), rectMm: world(lines[0][0], flight === 0 ? i * going : travel - (i + 1) * going, lines[0][1] - lines[0][0], going),
      topMm, bottomMm: Math.max(base, topMm - rise - thickness.waistMm) }
  }))
  return { id, floorId: floor.id, destinationFloorId, destinationElevationMm: base + floor.heightMm,
    openingMm: world(0, going, across, run - going), startLandingMm: world(0, 0, across, going), destinationLandingMm: world(0, 0, across, going),
    riseMm: rise, goingMm: going, stepCount: count * 2, steps,
    midLanding: { rectMm: world(0, travel, across, run - travel), topMm: base + count * rise, bottomMm: base + count * rise - thickness.landingThicknessMm }, headroom: [] }
}
