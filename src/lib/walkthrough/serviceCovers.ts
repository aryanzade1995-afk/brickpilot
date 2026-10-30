import type {BuildingModel,BuildingRoom} from '../engine/buildingModel.ts'
import type {AssetBox} from './delivery.ts'

/** A removable floor-level access cover, not a filled or relocated service shaft.
 * The source shaft and its vertical service space remain intact underneath. */
export function bathroomServiceCovers(building:BuildingModel,room:BuildingRoom,roomKey:string,binding:string):AssetBox[]{
 if(!/bath|toilet|ensuite|washroom|wc/i.test(`${room.id} ${room.name}`))return []
 const floor=building.floors.find(f=>f.id===room.floorId)
 if(!floor)return []
 const r=room.rect
 return building.shafts.filter(s=>s.floorId===room.floorId&&s.roomId===room.id&&s.rect.w>0&&s.rect.h>0&&
  s.rect.x>=r.x&&s.rect.y>=r.y&&s.rect.x+s.rect.w<=r.x+r.w&&s.rect.y+s.rect.h<=r.y+r.h)
 .map(s=>({id:`shaft-access-cover:${s.id}`,floorId:room.floorId,roomId:roomKey,sourceIds:[s.id],kind:'furniture',binding,
  position:[(s.rect.x+s.rect.w/2)/1000,floor.elevationMm/1000-.038,-(s.rect.y+s.rect.h/2)/1000],
  size:[s.rect.w/1000,.08,s.rect.h/1000],rotation:0,shape:'box',bevelM:0}))
}
