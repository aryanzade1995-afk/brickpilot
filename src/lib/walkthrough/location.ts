import type {WalkthroughGeometryPayload} from './delivery.ts'

/** Pick the smallest containing room on the physical level, rather than the
 * first overlapping rectangle. Roof terraces have recorded, separate regions. */
export function walkthroughLocation(metadata:WalkthroughGeometryPayload['metadata'],feet:{x:number;y:number;z:number},floorId:string){
 const x=feet.x*1000,y=-feet.z*1000
 const contains=(r:{x:number;y:number;w:number;h:number})=>x>=r.x-.5&&x<=r.x+r.w+.5&&y>=r.y-.5&&y<=r.y+r.h+.5
 const roof=metadata.roofs?.find(r=>Math.abs(r.elevationM-feet.y)<.3&&r.regionsMm.some(contains))
 if(roof)return {roomId:roof.id,room:'Roof terrace',floor:(metadata.floors.find(f=>f.sourceId===roof.floorId)?.level??0)+1}
 const rooms=metadata.rooms.filter(r=>r.floorId===floorId&&contains(r.rectMm))
 rooms.sort((a,b)=>a.rectMm.w*a.rectMm.h-b.rectMm.w*b.rectMm.h)
 let room=rooms[0]
 if(!room){
  const stair=metadata.stairs.find(s=>feet.y>=Math.min(...s.steps.map(t=>t.bottomMm))/1000-.1&&feet.y<=s.destinationElevationMm/1000+.1&&[s.openingMm,s.startLandingMm].some(contains))
  if(stair)room=metadata.rooms.find(r=>r.floorId===stair.floorId&&/stair/i.test(r.name)&&contains(r.rectMm))!
 }
 return {roomId:room?.id,room:room?.name??'',floor:metadata.floors.find(f=>f.sourceId===(room?.floorId??floorId))?.level??0}
}
