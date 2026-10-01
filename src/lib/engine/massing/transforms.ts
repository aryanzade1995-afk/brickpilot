import type { Rect } from '../../geometry.ts'
import type { Mass, QuarterTurn } from './model.ts'

export type MassSide = 'N' | 'S' | 'E' | 'W'
export type MassCut = Rect & { elevation: number; height: number }
const finite = (...values: number[]) => {
  if (!values.every(Number.isFinite)) throw new RangeError('Mass dimensions must be finite')
}
export function assertMass(m: Mass): void {
  finite(m.x, m.y, m.width, m.depth, m.height, m.elevation, m.floor, m.rotation)
  if (Math.min(m.width, m.depth, m.height) <= 0 || !Number.isInteger(m.floor) ||
    ![0, 90, 180, 270].includes(m.rotation)) throw new RangeError('Invalid orthogonal mass')
}
export function massRect(m: Mass): Rect {
  const swapped = m.rotation === 90 || m.rotation === 270
  const w = swapped ? m.depth : m.width
  const h = swapped ? m.width : m.depth
  return { x: m.x + (m.width - w) / 2, y: m.y + (m.depth - h) / 2, w, h }
}
const copy = (m: Mass): Mass => ({ ...m, sourceRoomIds: [...m.sourceRoomIds] })
const baked = (m: Mass): Mass => {
  assertMass(m)
  const r = massRect(m)
  return { ...copy(m), x: r.x, y: r.y, width: r.w, depth: r.h, rotation: 0 }
}
const checked = (m: Mass): Mass => { assertMass(m); return m }

/** Pure operations. A changed occupied footprint must pass plan validation before use. */
export function splitMass(mass: Mass, axis: 'x' | 'y' | 'z', ratio = 0.5): [Mass, Mass] {
  if (!(ratio > 0 && ratio < 1)) throw new RangeError('Split ratio must be between 0 and 1')
  const a = baked(mass)
  const b = copy(a)
  a.id += '-a'; b.id += '-b'
  if (axis === 'x') { a.width *= ratio; b.width -= a.width; b.x += a.width }
  else if (axis === 'y') { a.depth *= ratio; b.depth -= a.depth; b.y += a.depth }
  else { a.height *= ratio; b.height -= a.height; b.elevation += a.height }
  return [checked(a), checked(b)]
}
export function shiftMass(m: Mass, dx: number, dy: number, dz = 0): Mass {
  finite(dx, dy, dz)
  return checked({ ...copy(m), x: m.x + dx, y: m.y + dy, elevation: m.elevation + dz })
}
export function scaleMass(mass: Mass, sx: number, sy: number, sz = 1): Mass {
  finite(sx, sy, sz)
  if (Math.min(sx, sy, sz) <= 0) throw new RangeError('Mass scale must be positive')
  const m = baked(mass)
  return checked({ ...m, x: m.x + m.width * (1 - sx) / 2, y: m.y + m.depth * (1 - sy) / 2,
    width: m.width * sx, depth: m.depth * sy, height: m.height * sz })
}
export function rotateMass(m: Mass, degrees: number): Mass {
  finite(degrees)
  if (degrees % 90 !== 0) throw new RangeError('The plan supports orthogonal rotations only')
  return checked({ ...copy(m), rotation: ((m.rotation + degrees) % 360 + 360) % 360 as QuarterTurn })
}
export function stackMass(m: Mass, height = m.height, gap = 0): Mass {
  finite(gap)
  return checked({ ...copy(m), id: `${m.id}-stack`, floor: m.floor + 1,
    elevation: m.elevation + m.height + gap, height, parentId: m.id, role: 'upperVolume' })
}
export function extendMass(mass: Mass, side: MassSide, amount: number): Mass {
  finite(amount)
  const m = baked(mass)
  if (side === 'N') { m.y -= amount; m.depth += amount }
  if (side === 'S') m.depth += amount
  if (side === 'W') { m.x -= amount; m.width += amount }
  if (side === 'E') m.width += amount
  return checked(m)
}
export function stepBackMass(m: Mass, side: MassSide, amount: number): Mass {
  if (amount < 0) throw new RangeError('Setback must be nonnegative')
  return extendMass(m, side, -amount)
}
export const recessMass = stepBackMass
export function cantileverMass(m: Mass, side: MassSide, amount: number): Mass {
  if (amount < 0) throw new RangeError('Cantilever must be nonnegative')
  return extendMass(m, side, amount)
}
export function createWing(mass: Mass, side: MassSide, length: number, depth: number): Mass {
  const m = baked(mass)
  const horizontal = side === 'N' || side === 'S'
  if (length > (horizontal ? m.width : m.depth)) throw new RangeError('Wing attachment exceeds its host')
  return checked({ ...m, id: `${m.id}-wing-${side}`, parentId: m.id, role: 'livingWing',
    x: horizontal ? m.x + (m.width - length) / 2 : side === 'W' ? m.x - depth : m.x + m.width,
    y: horizontal ? side === 'N' ? m.y - depth : m.y + m.depth : m.y + (m.depth - length) / 2,
    width: horizontal ? length : depth, depth: horizontal ? depth : length })
}
export function bridgeMasses(first: Mass, second: Mass, width: number): Mass {
  const a = baked(first), b = baked(second)
  if (a.floor !== b.floor || a.elevation !== b.elevation) throw new RangeError('Bridge hosts must share a floor and elevation')
  const y0 = Math.max(a.y, b.y), y1 = Math.min(a.y + a.depth, b.y + b.depth)
  const x0 = Math.max(a.x, b.x), x1 = Math.min(a.x + a.width, b.x + b.width)
  const base = { ...a, id: `${a.id}-bridge-${b.id}`, parentId: a.id, role: 'secondary' as const,
    height: Math.min(a.height, b.height), sourceRoomIds: [...new Set([...a.sourceRoomIds, ...b.sourceRoomIds])] }
  if (y1 - y0 >= width && (a.x + a.width < b.x || b.x + b.width < a.x)) {
    const left = a.x < b.x ? a : b, right = a.x < b.x ? b : a
    return checked({ ...base, x: left.x + left.width, y: (y0 + y1 - width) / 2,
      width: right.x - left.x - left.width, depth: width })
  }
  if (x1 - x0 >= width && (a.y + a.depth < b.y || b.y + b.depth < a.y)) {
    const north = a.y < b.y ? a : b, south = a.y < b.y ? b : a
    return checked({ ...base, x: (x0 + x1 - width) / 2, y: north.y + north.depth,
      width, depth: south.y - north.y - north.depth })
  }
  throw new RangeError('No aligned gap can contain this bridge')
}

/** Exact cuboid difference; the returned pieces are disjoint. */
export function cutMass(mass: Mass, cut: MassCut): Mass[] {
  const m = baked(mass)
  finite(cut.x, cut.y, cut.w, cut.h, cut.elevation, cut.height)
  if (Math.min(cut.w, cut.h, cut.height) <= 0) throw new RangeError('Void dimensions must be positive')
  const x0 = Math.max(m.x, cut.x), x1 = Math.min(m.x + m.width, cut.x + cut.w)
  const y0 = Math.max(m.y, cut.y), y1 = Math.min(m.y + m.depth, cut.y + cut.h)
  const z0 = Math.max(m.elevation, cut.elevation), z1 = Math.min(m.elevation + m.height, cut.elevation + cut.height)
  if (x1 <= x0 || y1 <= y0 || z1 <= z0) return [m]
  const pieces: Mass[] = []
  const add = (x: number, y: number, w: number, d: number, z: number, h: number) => {
    if (Math.min(w, d, h) > 0) pieces.push({ ...copy(m), id: `${m.id}-cut${pieces.length}`, x, y,
      width: w, depth: d, elevation: z, height: h })
  }
  add(m.x, m.y, m.width, m.depth, m.elevation, z0 - m.elevation)
  add(m.x, m.y, m.width, m.depth, z1, m.elevation + m.height - z1)
  add(m.x, m.y, x0 - m.x, m.depth, z0, z1 - z0)
  add(x1, m.y, m.x + m.width - x1, m.depth, z0, z1 - z0)
  add(x0, m.y, x1 - x0, y0 - m.y, z0, z1 - z0)
  add(x0, y1, x1 - x0, m.y + m.depth - y1, z0, z1 - z0)
  return pieces
}
export function subtractCourtyard(masses: Mass[], courtyard: Rect): Mass[] {
  return masses.flatMap((m) => cutMass(m, { ...courtyard, elevation: m.elevation, height: m.height }))
}
export function createEntranceVoid(m: Mass, opening: MassCut): Mass[] { return cutMass(m, opening) }
export function createDoubleHeightVoid(masses: Mass[], rect: Rect, elevation: number, height: number): Mass[] {
  return masses.flatMap((m) => cutMass(m, { ...rect, elevation, height }))
}
export function createTerraceCut(m: Mass, rect: Rect, depth: number): Mass[] {
  if (!(depth > 0 && depth <= m.height)) throw new RangeError('Terrace cut must lie within the mass height')
  return cutMass(m, { ...rect, elevation: m.elevation + m.height - depth, height: depth })
}
