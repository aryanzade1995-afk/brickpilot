import type {SceneOpening,WalkthroughScene} from './sceneTypes.ts'

/** Prefer the adjoining private room and its nearest wall return. This changes
 * runtime leaf motion only, never the recorded opening or room geometry. */
export function wallSideDoorSwing(opening:SceneOpening,rooms:Pick<WalkthroughScene['rooms'][number],'id'|'floorId'|'name'|'rectMm'|'outdoor'>[]){
 const fallback={hinge:opening.hinge??'a' as 'a'|'b',swing:opening.swing??1 as 1|-1}
 if(opening.operation==='sliding'||opening.operation==='open'||opening.sourceId==='ROOF_STAIR_EXIT')return fallback
 const linked=rooms.filter(r=>r.floorId===opening.floorId&&!r.outdoor&&opening.rooms?.includes(r.id))
 const priority=(r:typeof linked[number])=>/bath|toilet|bed|study|kitchen/i.test(r.name)?0:/stair|corridor|foyer|lobby/i.test(r.name)?2:1
 linked.sort((a,b)=>priority(a)-priority(b)||a.rectMm.w*a.rectMm.h-b.rectMm.w*b.rectMm.h)
 const room=linked[0];if(!room)return fallback
 const a=opening.apertureMm,r=room.rectMm,h=opening.orient==='h'
 const lo=h?a.x:a.y,width=h?a.w:a.d,start=h?r.x:r.y,length=h?r.w:r.h
 const hinge=lo-start<=start+length-lo-width?'a':'b'
 const delta=h?r.y+r.h/2-(a.y+a.d/2):r.x+r.w/2-(a.x+a.w/2)
 return {hinge:hinge as 'a'|'b',swing:(delta>=0?1:-1) as 1|-1}
}
