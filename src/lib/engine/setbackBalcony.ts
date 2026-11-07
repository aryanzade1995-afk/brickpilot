import {sharedEdge,rectArea,toSqm} from '../geometry.ts'
import type {Design} from './types.ts'
import {uncoveredRects} from './planner/projections.ts'
import {validate} from '../rules/index.ts'
import {createBuildingModel} from './buildingModel.ts'

/** Reuse a supported lower roof, with a real door and a source outdoor room. */
export function withSetbackBalcony(plan:Design):Design {
 for(let i=1;i<plan.floors.length;i++){
  const upper=plan.floors[i],lower=plan.floors[i-1]
  const blocked=[...upper.footprint,...upper.rooms.filter(r=>r.outdoor).map(r=>r.rect),
   ...(lower.courtyard?[lower.courtyard]:[]),...(lower.doubleHeightVoids??[]).map(v=>v.rect),...(upper.doubleHeightVoids??[]).map(v=>v.rect),...(lower.shafts??[]).map(s=>s.rect),...(upper.shafts??[]).map(s=>s.rect)]
  for(const rect of uncoveredRects(lower.footprint,blocked).filter(r=>Math.min(r.w,r.h)>=1200&&rectArea(r)>=2000000).sort((a,b)=>rectArea(b)-rectArea(a))){
   const hosts=upper.rooms.filter(r=>!r.outdoor&&!/bath|ensuite|stair|utility|kitchen/i.test(r.id))
   for(const host of hosts){
    const edge=sharedEdge(host.rect,rect)
    if(!edge||edge.length<1500)continue
    const orient=edge.seg.a.y===edge.seg.b.y?'h':'v'
    for(const fraction of [.5,.3,.7]){
     const at={x:edge.seg.a.x+(edge.seg.b.x-edge.seg.a.x)*fraction,y:edge.seg.a.y+(edge.seg.b.y-edge.seg.a.y)*fraction}
     const replaced=upper.openings.filter(o=>o.orient===orient&&Math.abs((orient==='h'?o.at.y:o.at.x)-(orient==='h'?at.y:at.x))<2&&Math.abs((orient==='h'?o.at.x:o.at.y)-(orient==='h'?at.x:at.y))<(o.width+1000)/2+150)
     if(replaced.some(o=>o.kind!=='window'))continue
     const count=upper.rooms.filter(r=>r.id.startsWith('balconySetback')).length
     const suffix=count?String(count+1):''
     const balcony={id:`balconySetback${suffix}`,semanticId:`${upper.prefix??'FF'}_SETBACK_BALCONY${suffix}`,name:'Setback balcony',zone:'outdoor' as const,rect,area:toSqm(rectArea(rect)),outdoor:true,wantsWindow:false}
     const floor={...upper,rooms:[...upper.rooms,balcony],openings:[...upper.openings.filter(o=>!replaced.includes(o)),{id:`${balcony.semanticId}_DOOR`,kind:'door' as const,at,orient:orient as 'h'|'v',width:1000,leaf:false,treatment:'glazed-slide' as const,rooms:[host.id,balcony.id] as [string,string]}]}
     const original=createBuildingModel(plan)
     const floors=plan.floors.map((f,n)=>n===i?floor:f)
     const openingCounts={doors:floors.reduce((n,f)=>n+f.openings.filter(o=>o.kind!=='window').length,0),windows:floors.reduce((n,f)=>n+f.openings.filter(o=>o.kind==='window').length,0)}
     const changed={...plan,exteriorIdentity:plan.exteriorIdentity??{planId:original.planId,compositionId:original.compositionId??original.planId},floors,openingCounts}
     if(validate(changed).hardChecksPass)return withSetbackBalcony(changed)
    }
   }
  }
 }
 return plan
}
