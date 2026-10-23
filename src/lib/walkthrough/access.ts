import type { Design } from '../engine/types.ts'
import type { LayoutDoc } from '../plan/layout.ts'
import type { OpResult } from '../plan/ops.ts'

export const WALKTHROUGH_ACCESS_REVISION = 'walk-access-v7'
export const WALKTHROUGH_HALL_MM = 1800

/** An explicit source-plan edit, committed through the normal plan validator.
 * Existing courtyard galleries borrow only from their adjacent open courtyard;
 * bedrooms, stairs, columns and exterior walls are never shifted. Other narrow
 * layouts require a deliberate wall edit rather than an invisible runtime fix.
 * Rebuilding this layout also rehosts the wide, leaf-free stair portals and
 * relocates a legacy under-stair secondary exit through the shared placers.
 */
export function improveWalkingAccess(layout: LayoutDoc, plan: Design): OpResult {
  if (plan.existingStructure) return { ok: false, reason: 'This surveyed house needs an architect-reviewed access edit; its measured structure cannot be changed automatically.' }
  const next = structuredClone(layout), affected: string[] = []
  for (const floor of next.floors) {
    const court = floor.rooms.find(r => r.id === 'courtyard' && r.outdoor)
    for (const hall of floor.rooms.filter(r => r.kind === 'corridor')) {
      const r = hall.rect
      if (Math.min(r.w, r.h) >= WALKTHROUGH_HALL_MM) continue
      const c = court?.rect, horizontal = r.w > r.h, growth = WALKTHROUGH_HALL_MM - Math.min(r.w, r.h)
      if (!c || hall.locked || court!.locked) return { ok: false, reason: `${hall.name} needs a wider 2D wall edit; there is no unlocked courtyard beside it to borrow space from.` }
      if (horizontal && Math.abs(r.x - c.x) < 2 && Math.abs(r.w - c.w) < 2 && c.h - growth >= 3000) {
        if (Math.abs(r.y + r.h - c.y) < 2) { r.h += growth; c.y += growth; c.h -= growth }
        else if (Math.abs(c.y + c.h - r.y) < 2) { r.y -= growth; r.h += growth; c.h -= growth }
        else return { ok: false, reason: `${hall.name} needs a manual 2D wall edit to widen safely.` }
      } else if (!horizontal && Math.abs(r.y - c.y) < 2 && Math.abs(r.h - c.h) < 2 && c.w - growth >= 3000) {
        if (Math.abs(r.x + r.w - c.x) < 2) { r.w += growth; c.x += growth; c.w -= growth }
        else if (Math.abs(c.x + c.w - r.x) < 2) { r.x -= growth; r.w += growth; c.w -= growth }
        else return { ok: false, reason: `${hall.name} needs a manual 2D wall edit to widen safely.` }
      } else return { ok: false, reason: `${hall.name} cannot be widened without changing occupied rooms. Edit its shared wall in the 2D plan.` }
      affected.push(hall.id, court!.id)
    }
    affected.push(...floor.rooms.filter(r => r.kind === 'stair').map(r => r.id))
  }
  return { ok: true, layout: next, affected, notes: [], message: 'Walking access updated in the 2D plan. Stair portals are open across both flights; the secondary exit avoids the stair landing.' }
}
