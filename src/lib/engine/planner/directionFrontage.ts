import type {Design} from '../types.ts'
/** Plan coordinates are normalized to the entrance: front is drawing-bottom,
 * while model.entrySide retains the actual compass bearing. */
export function frontFacingPlan(plan:Design){
 const ground=plan.floors[0],entry=ground.openings.find(o=>o.kind==='entry')
 const host=ground.rooms.find(r=>r.id===entry?.rooms?.[0])
 return !!entry&&!!host&&entry.orient==='h'&&Math.abs(entry.at.y-host.rect.y-host.rect.h)<2
}
export function horizontalPlan(plan:Design){
 const outline=plan.floors[0].outline
 return frontFacingPlan(plan)&&outline.w>=outline.h
}
