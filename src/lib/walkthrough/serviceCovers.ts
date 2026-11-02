import type {BuildingModel,BuildingRoom} from '../engine/buildingModel.ts'
import type {AssetBox} from './delivery.ts'
import {intersectRegions,subtractRegions} from '../solar/regions.ts'
import {rectUnionEdges} from '../geometry.ts'

/** A removable floor-level access cover, not a filled or relocated service shaft.
 * The source shaft and its vertical service space remain intact underneath. */
export function bathroomServiceCovers(building:BuildingModel,room:BuildingRoom,roomKey:string,binding:string):AssetBox[]{
 if(room.outdoor)return []
 const floor=building.floors.find(f=>f.id===room.floorId)
 if(!floor)return []
 const r=room.rect
 const protectedVoids=[...(floor.courtyard?[floor.courtyard]:[]),...(floor.doubleHeightVoids??[]).map(v=>v.rect),...building.stairs.filter(s=>s.floorId===floor.id).map(s=>s.rect)]
 return building.shafts.filter(s=>s.floorId===room.floorId&&s.rect.w>0&&s.rect.h>0)
 .flatMap(s=>subtractRegions(intersectRegions([s.rect],[r]),protectedVoids).map((rect,i)=>({id:`shaft-access-cover:${s.id}:${room.id}:${i}`,floorId:room.floorId,roomId:roomKey,sourceIds:[s.id],kind:'furniture' as const,binding,
  position:[(rect.x+rect.w/2)/1000,floor.elevationMm/1000-.038,-(rect.y+rect.h/2)/1000] as [number,number,number],
  size:[rect.w/1000,.08,rect.h/1000] as [number,number,number],rotation:0,shape:'box' as const,bevelM:0})))
}

/** Vertical casing at shaft/perimeter intersections. The shaft remains open
 * behind the casing; no horizontal cap over a vent or courtyard is created. */
export function roofServiceClosures(building:BuildingModel){
 const roof=building.roofTerrace,top=[...building.floors].sort((a,b)=>a.level-b.level).at(-1)
 if(!roof||!top)return []
 const t=building.quantityRules?.roof.parapetThicknessMm??120,h=900
 const shafts=building.shafts.filter(s=>s.floorId===top.id)
 const protectedVoids=[...(top.courtyard?[top.courtyard]:[]),...building.stairs.filter(s=>s.floorId===top.id).map(s=>s.rect)]
 const result:{id:string;floorId:string;sourceId:string;boundsMm:{x:number;y:number;z:number;w:number;d:number;h:number}}[]=[]
 for(const [i,edge] of rectUnionEdges(roof.slab,top.courtyard).entries()){
  const horizontal=edge.side==='N'||edge.side==='S',positive=edge.side==='S'||edge.side==='E'
  const r=horizontal?{x:edge.a.x,y:edge.a.y-(positive?t:0),w:edge.b.x-edge.a.x,h:t}:{x:edge.a.x-(positive?t:0),y:edge.a.y,w:t,h:edge.b.y-edge.a.y}
  for(const s of shafts)for(const [j,p] of subtractRegions(intersectRegions([r],[s.rect]),protectedVoids).entries())
   result.push({id:`Roof_ServiceClosure_${i}_${s.id}_${j}`,floorId:top.id,sourceId:s.id,boundsMm:{x:p.x,y:p.y,z:top.elevationMm+top.heightMm,w:p.w,d:p.h,h}})
 }
 return result
}
