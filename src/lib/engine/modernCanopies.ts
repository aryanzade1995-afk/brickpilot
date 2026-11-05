import type { BuildingModel } from './buildingModel.ts'
import type { Rect } from '../geometry.ts'
import type { ModernComposition } from '../model/modernCompositions.ts'
import { sharedEdge } from '../geometry.ts'

export type CompositionCanopy={id:string;floorId:string;sourceRoomId:string;sourceWindowId:string;rect:Rect;bottomMm:number;thicknessMm:number;framePosts?:Rect[];baseMm?:number}
const overlap=(a:Rect,b:Rect)=>Math.min(a.x+a.w,b.x+b.w)>Math.max(a.x,b.x)&&Math.min(a.y+a.h,b.y+b.h)>Math.max(a.y,b.y)

/** Roof planes attach to real glazed wall bays. They stay in the envelope and
 * leave every serialized courtyard open; the exporter does not invent hosts. */
export function modernCanopies(b:Pick<BuildingModel,'floors'|'rooms'|'walls'|'windows'|'plot'>,composition:ModernComposition):CompositionCanopy[]{
 const result:CompositionCanopy[]=[],env=b.plot.buildable
 if(composition==='framed-balcony')for(const floor of b.floors.filter(f=>f.level>0)) {
  const terrace=b.rooms.find(r=>r.floorId===floor.id&&r.outdoor&&r.id.startsWith('balcony')&&Math.max(r.rect.w,r.rect.h)>=2400&&Math.min(r.rect.w,r.rect.h)>=1200)
  if(!terrace)continue
  const r=terrace.rect,host=b.rooms.find(room=>room.floorId===floor.id&&!room.outdoor&&(sharedEdge(room.rect,r)?.length??0)>=900)
  if(!host)continue
  const window=b.windows.filter(w=>w.floorId===floor.id&&w.head!==undefined&&w.rooms?.includes(host.id))
   .sort((a,c)=>Math.hypot(a.at.x-r.x-r.w/2,a.at.y-r.y-r.h/2)-Math.hypot(c.at.x-r.x-r.w/2,c.at.y-r.y-r.h/2))[0]
  if(!window||r.x<env.x||r.y<env.y||r.x+r.w>env.x+env.w||r.y+r.h>env.y+env.h||floor.courtyard&&overlap(r,floor.courtyard))continue
  // The outside edge is opposite the host room, leaving the access wall clear.
  const horizontal=r.w>=r.h,positive=horizontal?host.rect.y+host.rect.h/2<r.y+r.h/2:host.rect.x+host.rect.w/2<r.x+r.w/2
  const posts=horizontal?[{x:r.x,y:positive?r.y+r.h-180:r.y,w:180,h:180},{x:r.x+r.w-180,y:positive?r.y+r.h-180:r.y,w:180,h:180}]:
   [{x:positive?r.x+r.w-180:r.x,y:r.y,w:180,h:180},{x:positive?r.x+r.w-180:r.x,y:r.y+r.h-180,w:180,h:180}]
  result.push({id:`${floor.id}_BALCONY_FRAME`,floorId:floor.id,sourceRoomId:terrace.semanticId,sourceWindowId:window.id!,rect:{...r},
   bottomMm:floor.elevationMm+floor.heightMm-190,thicknessMm:190,framePosts:posts,baseMm:floor.elevationMm})
 }
 for(const floor of b.floors){
  const candidates=b.windows.filter(w=>w.floorId===floor.id&&w.head!==undefined&&w.head>=floor.heightMm-1000)
   .sort((a,c)=>Number(c.rooms?.includes('stair'))-Number(a.rooms?.includes('stair'))||c.at.y-a.at.y)
  let count=0
  for(const window of candidates){
   const room=b.rooms.find(r=>r.floorId===floor.id&&r.id===window.rooms?.[0])
   if(!room||room.outdoor)continue
   const horizontal=window.orient==='h',fixed=horizontal?window.at.y:window.at.x
   const wall=b.walls.find(w=>w.floorId===floor.id&&w.kind==='exterior'&&w.rooms?.[0]===room.id&&
    (Math.abs(w.a.y-w.b.y)<2)===horizontal&&Math.abs((horizontal?w.a.y:w.a.x)-fixed)<2&&
    (horizontal?window.at.x:window.at.y)>=Math.min(horizontal?w.a.x:w.a.y,horizontal?w.b.x:w.b.y)&&
    (horizontal?window.at.x:window.at.y)<=Math.max(horizontal?w.a.x:w.a.y,horizontal?w.b.x:w.b.y))
   if(!wall)continue
   const positive=horizontal?fixed>room.rect.y+room.rect.h/2:fixed>room.rect.x+room.rect.w/2
   const available=horizontal?positive?env.y+env.h-fixed:fixed-env.y:positive?env.x+env.w-fixed:fixed-env.x
   const depth=Math.min(composition==='glazed-bay'?1100:900,available-100)
   const start=Math.min(horizontal?wall.a.x:wall.a.y,horizontal?wall.b.x:wall.b.y)+100
   const end=Math.max(horizontal?wall.a.x:wall.a.y,horizontal?wall.b.x:wall.b.y)-100
   const length=Math.min(6000,end-start)
   if(depth<450||length<1800)continue
   const rect=horizontal?{x:start,y:positive?fixed-160:fixed-depth,w:length,h:depth+160}:
    {x:positive?fixed-160:fixed-depth,y:start,w:depth+160,h:length}
   if(floor.courtyard&&overlap(rect,floor.courtyard)||result.some(c=>c.floorId===floor.id&&overlap(c.rect,rect)))continue
   result.push({id:`${floor.id}_COMPOSITION_CANOPY_${++count}`,floorId:floor.id,sourceRoomId:room.semanticId,sourceWindowId:window.id!,
    rect,bottomMm:floor.elevationMm+floor.heightMm-190,thicknessMm:170})
   if(count===3)break
  }
 }
 return result
}
