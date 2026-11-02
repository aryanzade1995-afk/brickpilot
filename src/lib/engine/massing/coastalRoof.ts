import type {BuildingModel} from '../buildingModel.ts'
import type {Mass} from './model.ts'
import {rectUnionBBox} from '../../geometry.ts'
import {subtractCourtyard} from './transforms.ts'

export const COASTAL_ROOF_REVISION='coastal-roof-union-v1'
/** One shared roof profile over the actual top plate; room divisions never
 * create independent caps. Existing stair/shaft/courtyard voids remain open. */
export function coastalRoof(building:BuildingModel,enclosed:Mass[]){
 const top=building.floors.at(-1)!,hosts=enclosed.filter(m=>m.sourceFloorId===top.id&&m.usage==='enclosed')
 const bounds=rectUnionBBox(top.footprint),thicknessMm=180
 const heightMm=Math.min(3200,Math.round(Math.min(bounds.w,bounds.h)/2*Math.tan(28*Math.PI/180))+thicknessMm)
 const holes=[...(top.courtyard?[top.courtyard]:[]),...building.shafts.filter(s=>s.floorId===top.id).map(s=>s.rect),...building.stairs.filter(s=>s.floorId===top.id).map(s=>s.rect)]
 let masses:Mass[]=top.footprint.map((r,i)=>({ ...hosts[0],id:`coastal-roof-${i}`,x:r.x,y:r.y,width:r.w,depth:r.h,height:heightMm,elevation:top.elevationMm+top.heightMm,usage:'roof',role:'upperVolume',parentId:null,shell:true,sourceRoomIds:[...new Set(hosts.flatMap(m=>m.sourceRoomIds))].sort()}))
 for(const hole of holes)masses=subtractCourtyard(masses,hole)
 const regions=masses.map(m=>({x:m.x,y:m.y,w:m.width,h:m.depth}))
 return {masses,model:{revision:COASTAL_ROOF_REVISION,bounds,regions,holes,elevationMm:top.elevationMm+top.heightMm,heightMm,thicknessMm,pitchDeg:28,sourceFloorId:top.id,massIds:masses.map(m=>m.id)}}
}
