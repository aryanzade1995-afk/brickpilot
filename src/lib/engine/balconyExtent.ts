import { rectArea, rectBottom, rectRight, rectsOverlap, toSqm, type Rect } from '../geometry.ts'
import type { Design } from './types.ts'
import { createBuildingModel } from './buildingModel.ts'

/** Largest supported clear rectangle containing the existing balcony. A cell
 * prefix sum tests coverage across joined lower-floor slabs without bridging
 * an L-shaped hole, courtyard, occupied room or another balcony. */
export function fullBalconyRect(seed: Rect, support: Rect[], blocked: Rect[]): Rect {
  const xs = [...new Set([seed.x, rectRight(seed), ...[...support, ...blocked].flatMap(r => [r.x, rectRight(r)])])].sort((a,b)=>a-b)
  const ys = [...new Set([seed.y, rectBottom(seed), ...[...support, ...blocked].flatMap(r => [r.y, rectBottom(r)])])].sort((a,b)=>a-b)
  const prefix = Array.from({length:xs.length},()=>new Float64Array(ys.length))
  const inside = (r:Rect,x:number,y:number)=>x>r.x&&x<rectRight(r)&&y>r.y&&y<rectBottom(r)
  for(let x=1;x<xs.length;x++)for(let y=1;y<ys.length;y++){
    const cx=(xs[x-1]+xs[x])/2,cy=(ys[y-1]+ys[y])/2
    const free=support.some(r=>inside(r,cx,cy))&&!blocked.some(r=>inside(r,cx,cy))
    const area=free?(xs[x]-xs[x-1])*(ys[y]-ys[y-1]):0
    prefix[x][y]=area+prefix[x-1][y]+prefix[x][y-1]-prefix[x-1][y-1]
  }
  const sx=xs.indexOf(seed.x),ex=xs.indexOf(rectRight(seed)),sy=ys.indexOf(seed.y),ey=ys.indexOf(rectBottom(seed))
  const freeArea=(a:number,b:number,c:number,d:number)=>prefix[c][d]-prefix[a][d]-prefix[c][b]+prefix[a][b]
  if(Math.abs(freeArea(sx,sy,ex,ey)-rectArea(seed))>.5)return seed
  let best=seed,bestArea=rectArea(seed)
  for(let a=0;a<=sx;a++)for(let c=ex;c<xs.length;c++)
    for(let b=0;b<=sy;b++)for(let d=ey;d<ys.length;d++){
      const area=(xs[c]-xs[a])*(ys[d]-ys[b])
      if(area<=bestArea||Math.abs(freeArea(a,b,c,d)-area)>.5)continue
      best={x:xs[a],y:ys[b],w:xs[c]-xs[a],h:ys[d]-ys[b]};bestArea=area
    }
  return best
}

/** Expand outdoor source rooms only. Occupied plates, structure, doors and
 * windows retain their coordinates; 2D, quantities and the GLB share this room. */
export function expandBalconyArea(plan: Design): Design {
  let changed=false
  const floors=plan.floors.map((floor,index)=>{
    if(!index)return floor
    const lower=plan.floors[index-1],rooms=[...floor.rooms]
    for(let i=0;i<rooms.length;i++){
      const room=rooms[i]
      if(!room.outdoor||!room.id.startsWith('balcony')||!floor.openings.some(o=>o.kind==='door'&&o.rooms?.includes(room.id)))continue
      const blocked=[...floor.footprint,...rooms.filter(r=>r!==room).map(r=>r.rect),
        ...(floor.doubleHeightVoids??[]).map(v=>v.rect),...(lower.doubleHeightVoids??[]).map(v=>v.rect),
        ...[floor.courtyard,lower.courtyard].filter((r):r is Rect=>!!r)]
      const rect=fullBalconyRect(room.rect,lower.footprint,blocked)
      if(rect===room.rect||rooms.some((r,j)=>j!==i&&rectsOverlap(rect,r.rect)))continue
      rooms[i]={...room,rect,area:toSqm(rectArea(rect))};changed=true
    }
    return rooms.some((r,i)=>r!==floor.rooms[i])?{...floor,rooms}:floor
  })
  if(!changed)return plan
  const original=createBuildingModel(plan)
  return {...plan,id:`${plan.id}-full-balcony`,floors,balconyExtent:'full-slab',
    exteriorIdentity:plan.exteriorIdentity??{planId:original.planId,compositionId:original.compositionId??original.planId}}
}
