import type {BuildingModel} from '../engine/buildingModel.ts'
import type {Brief} from '../model/brief.ts'
import {selectedCurtain,type CurtainOption} from './catalogue.ts'

export type CurtainWindow={id:string;roomId:string;roomKey:string;roomName:string;floor:number;option:CurtainOption;
 position:[number,number,number];rotation:number;width:number;drop:number;area:number;
 roomBounds:{x:number;y:number;w:number;h:number};floorY:number}
/** One curtain per real source window. No invented apertures or wall changes. */
export function curtainLayout(building:BuildingModel,brief:Pick<Brief,'finish'|'specs'>):CurtainWindow[]{
 const windows:CurtainWindow[]=[]
 for(const opening of building.windows){
  const floor=building.floors.find(f=>f.id===opening.floorId)
  const room=building.rooms.find(r=>r.floorId===opening.floorId&&opening.rooms?.includes(r.id)&&!r.outdoor)
  if(!floor||!room||/bath|toilet|ensuite|washroom|kitchen|utility|store|shaft/i.test(`${room.id} ${room.name}`))continue
  const horizontal=opening.orient==='h',along=horizontal?opening.at.x:opening.at.y,fixed=horizontal?opening.at.y:opening.at.x
  const wall=building.walls.find(w=>w.floorId===floor.id&&(horizontal?Math.abs(w.a.y-fixed)<2&&Math.abs(w.b.y-fixed)<2:Math.abs(w.a.x-fixed)<2&&Math.abs(w.b.x-fixed)<2)&&along>=Math.min(horizontal?w.a.x:w.a.y,horizontal?w.b.x:w.b.y)&&along<=Math.max(horizontal?w.a.x:w.a.y,horizontal?w.b.x:w.b.y))
  const normal=(horizontal?room.rect.y+room.rect.h/2-fixed:room.rect.x+room.rect.w/2-fixed)>=0?1:-1
  const head=opening.head??floor.openingLimits?.windowHeadMm??2100
  const top=Math.min(head+90,floor.heightMm-200)/1000
  const roomId=`${floor.level}:${room.semanticId||room.id}`,option=selectedCurtain(brief,roomId,room.semanticId||room.id)
  // Centre above the aperture; cap the track to its actual host wall.
  let lo=wall?Math.min(horizontal?wall.a.x:wall.a.y,horizontal?wall.b.x:wall.b.y)/1000:along/1000-opening.width/2000-.18
  let hi=wall?Math.max(horizontal?wall.a.x:wall.a.y,horizontal?wall.b.x:wall.b.y)/1000:along/1000+opening.width/2000+.18
  for(const door of building.doors.filter(d=>d.floorId===floor.id&&d.orient===opening.orient&&Math.abs((horizontal?d.at.y:d.at.x)-fixed)<2)){
   const center=(horizontal?door.at.x:door.at.y)/1000
   if(center<along/1000)lo=Math.max(lo,center+door.width/2000+.08)
   else hi=Math.min(hi,center-door.width/2000-.08)
  }
  const width=Math.min(opening.width/1000+.36,hi-lo-.08)
  if(width<opening.width/1000||width<.35||top<.6)continue
  const center=Math.max(lo+width/2+.04,Math.min(hi-width/2-.04,along/1000))
  const inset=((wall?.thickness??230)/2+100)/1000
  windows.push({id:opening.id!,roomId,roomKey:JSON.stringify([floor.id,room.id]),roomName:room.name,floor:floor.level,option,
   position:horizontal?[center,floor.elevationMm/1000+top,-(fixed/1000+normal*inset)]:[fixed/1000+normal*inset,floor.elevationMm/1000+top,-center],
   rotation:horizontal?0:Math.PI/2,width,drop:top-.06,area:width*(top-.06),roomBounds:room.rect,floorY:floor.elevationMm/1000})
 }
 return windows
}
