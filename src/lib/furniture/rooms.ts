import { MIN_DIM } from '../rules/roomLimits.ts'
import { geometryBrief, type Brief } from '../model/brief.ts'
import { compile, type SpaceReq } from '../model/canonical.ts'
import { FURNITURE_LIMITS, furnitureFor, type FurnitureKind } from './catalogue.ts'
import { placeFurniture, type FurnitureFit } from './place.ts'
export type RoomSize = 'compact'|'small'|'standard'|'large'
import { ROOM_SIZE } from './sizes.ts'
export const ROOM_MIN_DIM = { master:2.7,kids:2.7,bedroom:2.7,living:3,dining:2.7,kitchen:2.4,bathroom:1.5,study:2.4,other:1.2 } as const
export type BriefRoom = { id:string; spaceId:string; name:string; floor:string; kind:FurnitureKind; width:number; depth:number; size:RoomSize; starred:boolean; occupants:number; fit:FurnitureFit }
export function roomKind(s:SpaceReq):FurnitureKind {
 if(s.zone==='private')return s.role==='master'?'master':s.role==='child'?'kids':'bedroom'
 if(s.wet&&s.id.toLowerCase().includes('bath'))return 'bathroom'
 if(s.id.toLowerCase().includes('kitchen'))return 'kitchen'
 if(s.id==='dining')return 'dining'
 if(s.zone==='social')return 'living'
 if(s.zone==='work')return 'study'
 return 'other'
}
export function roomDimensions(s:SpaceReq,size:RoomSize):{width:number;depth:number} {
 const kind=roomKind(s),min=Math.max(ROOM_MIN_DIM[kind],(MIN_DIM[s.zone]??1200)/1000)
 const target=Math.max(s.min,Math.min(s.max,s.target*ROOM_SIZE[size]))
 const width=Math.max(min,Math.round(Math.sqrt(target*1.08)*10)/10)
 return {width,depth:Math.max(min,Math.ceil(target/width*10)/10)}
}
const cache=new Map<string,BriefRoom[]>()
export function briefRooms(brief:Brief):BriefRoom[] {
 const key=JSON.stringify({geometry:geometryBrief(brief),starred:brief.rooms.starred})
 const existing=cache.get(key);if(existing)return existing
 const floors=compile(brief).floors,spaces=floors.flatMap(f=>f.spaces).filter(s=>!s.outdoor)
 const children=brief.household.members.filter(m=>m.role==='child'||m.role==='teen').length
 const kidsRooms=Math.max(1,spaces.filter(s=>s.role==='child').length)
 const beds=Math.max(1,spaces.filter(s=>s.zone==='private'&&s.role!=='staff').length)
 const result=floors.flatMap(f=>f.spaces.filter(s=>!s.outdoor).map(s=>{
  const id=`${f.level}:${s.id}`,size=brief.rooms.sizes[id]??'standard',starred=brief.rooms.starred.includes(id),kind=roomKind(s)
  const occupants=kind==='kids'?Math.max(1,Math.ceil(children/kidsRooms)):kind==='master'?Math.min(2,brief.household.members.length):kind==='bedroom'?s.role==='guest'||s.role==='staff'?1:Math.max(1,Math.ceil((brief.household.members.length-children)/beds)):brief.household.members.length
  // Compile already applies explicit preferred sizes; use the original target to avoid applying twice.
  const source={...s,target:s.preferredTarget??s.target}
  const dims=roomDimensions(source,size)
  const fit=placeFurniture(id,dims.width,dims.depth,furnitureFor(kind,occupants,starred))
  if(!fit.placed.length&&!fit.dropped.length)fit.reason='No standard furniture is specified for this space.'
  return {id,spaceId:s.id,name:s.name,floor:f.name,kind,...dims,size,starred,occupants,fit}
 }))
 cache.set(key,result);if(cache.size>30)cache.delete(cache.keys().next().value!)
 return result
}
export const ROOM_PREVIEW_HEIGHT=FURNITURE_LIMITS.height
