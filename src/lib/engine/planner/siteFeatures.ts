import type { Rect } from '../../geometry.ts'
import type { CanonicalModel } from '../../model/canonical.ts'
import type { FloorPlan, SiteFeature } from '../types.ts'
import { SITE_LIMITS } from './limits.ts'

export const overlapsSite = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

/** Partition the free plot into disjoint rectangles, using the real room edges. */
export function freeSiteRects(plot: Rect, occupied: Rect[]): Rect[] {
  let free = [plot]
  for (const b of occupied) free = free.flatMap(a => {
    if (!overlapsSite(a, b)) return [a]
    const x0 = Math.max(a.x, b.x), x1 = Math.min(a.x + a.w, b.x + b.w)
    const y0 = Math.max(a.y, b.y), y1 = Math.min(a.y + a.h, b.y + b.h)
    return [{ x: a.x, y: a.y, w: a.w, h: y0 - a.y },
      { x: a.x, y: y1, w: a.w, h: a.y + a.h - y1 },
      { x: a.x, y: y0, w: x0 - a.x, h: y1 - y0 },
      { x: x1, y: y0, w: a.x + a.w - x1, h: y1 - y0 }].filter(r => r.w > 0 && r.h > 0)
  })
  // Rejoin adjacent fragments so a long side yard remains a usable parking/pool strip.
  let changed = true
  while (changed) {
    changed = false
    outer: for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) {
      const a = free[i], b = free[j]
      const vertical = a.x === b.x && a.w === b.w && (a.y + a.h === b.y || b.y + b.h === a.y)
      const horizontal = a.y === b.y && a.h === b.h && (a.x + a.w === b.x || b.x + b.w === a.x)
      if (!vertical && !horizontal) continue
      free[i] = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: horizontal ? a.w + b.w : a.w, h: vertical ? a.h + b.h : a.h }
      free.splice(j, 1); changed = true; break outer
    }
  }
  return free
}

export function placeSiteFeatures(model: CanonicalModel, ground: FloorPlan): { features: SiteFeature[]; notes: string[] } {
  const plot = { x: 0, y: 0, w: model.plot.width, h: model.plot.depth }
  const taken = ground.rooms.filter(r => r.id !== 'courtyard').map(r => r.rect)
  const features: SiteFeature[] = [], notes: string[] = []
  const add = (kind: SiteFeature['kind'], rect: Rect, covered = false, roomId?: string) => {
    features.push({ id: `SITE_${kind.toUpperCase()}_${features.length + 1}`, kind, rect: { ...rect }, covered, ...(roomId ? { roomId } : {}) })
  }
  const available = () => freeSiteRects(plot, taken).sort((a, b) => b.w * b.h - a.w * a.h)
  const allocate = (kind: SiteFeature['kind'], w: number, h: number, near?: Rect) => {
    const candidates = available().filter(r => r.w >= w && r.h >= h)
      .sort((a, b) => near ? Math.hypot(a.x - near.x, a.y - near.y) - Math.hypot(b.x - near.x, b.y - near.y) : b.y + b.h - a.y - a.h)
    const at = (kind === 'parking' ? candidates.find(r => r.h >= h + SITE_LIMITS.pathWidthMm) : undefined) ?? candidates[0]
    if (!at) return null
    const rect = { x: near ? Math.max(at.x, Math.min(near.x, at.x + at.w - w)) : at.x, y: near ? Math.max(at.y, Math.min(near.y, at.y + at.h - h)) : Math.max(at.y, at.y + at.h - h - (kind === 'parking' ? SITE_LIMITS.pathWidthMm : 0)), w, h }
    add(kind, rect); taken.push(rect)
    return rect
  }
  const parkingRoom = ground.rooms.find(r => r.id === 'parking')
  if (parkingRoom) add('parking', parkingRoom.rect, true, parkingRoom.id)
  const parking = parkingRoom?.rect ?? allocate('parking', 3000, 5000)
  if (!parking) notes.push('A 3 × 5 m parking bay cannot fit in the remaining open space. Increase the road-side open margin or request covered parking.')
  if (parking) {
    const drive = { x: parking.x, y: parking.y + parking.h, w: parking.w, h: plot.h - parking.y - parking.h }
    if (drive.h > 0 && !taken.some(r => overlapsSite(r, drive))) { add('driveway', drive); taken.push(drive) }
    else if (drive.h > 0) notes.push('Parking needs a clear route from the road; the current open-space choice blocks a straight driveway.')
  }
  // Preserve the actual main door and its clear approach, even without a porch.
  const door = ground.openings.find(o => o.kind === 'entry')
  if (door && door.orient === 'h') {
    const path = { x: Math.max(0, door.at.x - SITE_LIMITS.pathWidthMm / 2), y: door.at.y,
      w: SITE_LIMITS.pathWidthMm, h: plot.h - door.at.y }
    for (const r of freeSiteRects(path, taken)) if (r.w >= 900 && r.h > 0) { add('path', r); taken.push(r) }
  }
  const porch = ground.rooms.find(r => r.id === 'verandah')
  if (porch) add('sitOut', porch.rect, true, porch.id)
  else allocate('sitOut', 2000, 1600)
  const utility = ground.rooms.find(r => r.id === 'utility')
  if (utility) allocate('utilityYard', 1500, 1800, utility.rect)
  if (model.brief.rooms.pool) {
    if (!allocate('pool', SITE_LIMITS.poolWidthMm, SITE_LIMITS.poolDepthMm)) notes.push('The selected open space cannot fit a 2.5 × 5 m pool. Increase an open margin.')
  }
  if (model.brief.rooms.priorities.garden) for (const r of available()) if (r.w >= 500 && r.h >= 500) add('lawn', r)
  return { features, notes }
}

export function validateSiteFeatures(model: CanonicalModel, ground: FloorPlan, features: SiteFeature[]): string[] {
  const errors: string[] = []
  for (let i = 0; i < features.length; i++) {
    const f = features[i], r = f.rect
    if (r.w <= 0 || r.h <= 0 || r.x < 0 || r.y < 0 || r.x + r.w > model.plot.width || r.y + r.h > model.plot.depth) errors.push(`${f.id} is outside the plot.`)
    if (ground.rooms.some(room => room.id !== f.roomId && room.id !== 'courtyard' && overlapsSite(room.rect, r))) errors.push(`${f.id} intersects a room.`)
    if (features.slice(0, i).some(other => overlapsSite(other.rect, r))) errors.push(`${f.id} intersects another site feature.`)
  }
  return errors
}
