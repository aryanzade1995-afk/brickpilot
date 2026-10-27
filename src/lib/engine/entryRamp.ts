import type { Design } from './types.ts'
import type { Point, Rect } from '../geometry.ts'
import { resolveSpecification } from '../cost/catalogue.ts'
import { quantityRules } from '../cost/data/quantityRules.ts'
import { sizeFloor } from './structuralSizing.ts'

export type RampPoint = Point & { z: number }
export type EntryRamp = { version: 1; status: 'ready' | 'needs-review'; doorId: string; gradeMm: number;
  siteGradeMm: number; approachSurfaceOffsetMm: number;
  riseMm: number; gradientRatio: number; clearWidthMm: number; issues: string[];
  landings: { id: string; rect: Rect; elevationMm: number }[];
  flights: { id: string; from: RampPoint; to: RampPoint; widthMm: number; rect: Rect }[];
  solids: { id: string; verticesMm: [number, number, number][]; indices: number[] }[];
  rails: { id: string; from: RampPoint; to: RampPoint; radiusMm: number }[] }
export const RAMP_BASIS = {
  source: 'https://www.cpwd.gov.in/Publication/Harmonisedguidelinesdreleasedon23rdMarch2016.pdf',
  edition: '2016', clauses: '7.2.2 Table 7-1; 7.2.5; 5.9.2', checked: '2026-10-27',
  currentGuidance: 'https://depwd.gov.in/en/document/harmonised-guidelines-standards-for-universal-accessibility-in-india-2021/',
  note: 'Conservative concept envelopes using verified published ramp guidance. Current local applicability, approach route, door manoeuvring, drainage, surface grip and structural design need professional review.',
}
const indices=[0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7]
const overlap=(a:Rect,b:Rect)=>a.x<b.x+b.w-1&&a.x+a.w>b.x+1&&a.y<b.y+b.h-1&&a.y+a.h>b.y+1
const cache=new WeakMap<Design,EntryRamp|null>()
export function entryRamp(design:Design):EntryRamp|null {
  if(cache.has(design))return cache.get(design)!
  const value=planRamp(design);cache.set(design,value);return value
}
function planRamp(design:Design):EntryRamp|null {
  if(!(design.model.brief.entry.ramp??design.model.brief.spaces.stepFree))return null
  const floor=design.floors[0],door=floor?.openings.find(d=>d.kind==='entry'&&!d.emergencyExit)
  const room=floor?.rooms.find(r=>r.id===door?.rooms?.[0])
  const plinth=quantityRules.plinthHeightsMm[resolveSpecification(design.model.brief,'plinth-height').id as keyof typeof quantityRules.plinthHeightsMm]
  // site.py models exterior paving at grade + 10 + 40 mm. Join its top,
  // not the buried soil plane. This is a model datum, not a surveyed level.
  const approachSurfaceOffsetMm=50,rise=plinth-approachSurfaceOffsetMm
  const ratio=rise>750?15:12,width=1800,deckWidth=width+200,landing=2000,maxFlight=rise>750?9000:5000
  const result:EntryRamp={version:1,status:'needs-review',doorId:door?.id??'entry',gradeMm:-rise,siteGradeMm:-plinth,approachSurfaceOffsetMm,riseMm:rise,gradientRatio:ratio,clearWidthMm:width,issues:[],landings:[],flights:[],solids:[],rails:[]}
  if(!door||!room||design.existingStructure){result.issues.push('A surveyed or unresolved entrance needs a site-reviewed ramp design.');return result}
  const horizontal=door.orient==='h',sign=(horizontal?Math.abs(door.at.y-room.rect.y)<5:Math.abs(door.at.x-room.rect.x)<5)?-1:1
  const normal={x:horizontal?0:sign,y:horizontal?sign:0},tangent={x:horizontal?1:0,y:horizontal?0:1}
  // Leave the structural column line before turning alongside the facade.
  const top={x:door.at.x+normal.x*(landing/2+400),y:door.at.y+normal.y*(landing/2+400),z:0}
  const square=(p:Point):Rect=>({x:p.x-landing/2,y:p.y-landing/2,w:landing,h:landing})
  const count=Math.ceil(rise*ratio/maxFlight),run=rise*ratio/count
  const porch=floor.rooms.find(r=>r.outdoor&&/^verandah/.test(r.id)&&door.at.x>=r.rect.x&&door.at.x<=r.rect.x+r.rect.w&&door.at.y>=r.rect.y&&door.at.y<=r.rect.y+r.rect.h)
  const blockers=[...floor.rooms.filter(r=>r.id!==porch?.id&&r.id!=='courtyard').map(r=>r.rect),...sizeFloor(floor,design.floors.length).columns.map(c=>({x:c.at.x-c.size/2-50,y:c.at.y-c.size/2-50,w:c.size+100,h:c.size+100})),...(design.siteFeatures??[]).filter(f=>['pool','parking','driveway','sitOut'].includes(f.kind)&&(!porch||f.roomId!==porch.id)).map(f=>f.rect)]
  const margin=design.model.brief.rooms.priorities.compoundWall?300:100
  const free=(r:Rect)=>r.x>=margin&&r.y>=margin&&r.x+r.w<=design.model.plot.width-margin&&r.y+r.h<=design.model.plot.depth-margin&&!blockers.some(b=>overlap(r,b))
  const candidates:[Point,boolean][]=[[normal,false],[tangent,false],[{x:-tangent.x,y:-tangent.y},false],[tangent,true],[{x:-tangent.x,y:-tangent.y},true]]
  for(const [axis,fold] of candidates){
    if(fold&&count!==2)continue
    const topRect=square(top)
    if(normal.x<0){topRect.w=door.at.x-topRect.x}else if(normal.x>0){topRect.w+=topRect.x-door.at.x;topRect.x=door.at.x}
    if(normal.y<0){topRect.h=door.at.y-topRect.y}else if(normal.y>0){topRect.h+=topRect.y-door.at.y;topRect.y=door.at.y}
    const landings=[{id:`${door.id}:ramp:top`,rect:topRect,elevationMm:0}],flights:EntryRamp['flights']=[]
    let start={x:top.x+axis.x*landing/2,y:top.y+axis.y*landing/2,z:0}
    for(let i=0;i<count;i++){
      const direction=fold&&i===1?{x:-axis.x,y:-axis.y}:axis
      const end={x:start.x+direction.x*run,y:start.y+direction.y*run,z:-rise*(i+1)/count}
      const rect={x:Math.min(start.x,end.x)-(direction.x?0:deckWidth/2),y:Math.min(start.y,end.y)-(direction.y?0:deckWidth/2),w:direction.x?run:deckWidth,h:direction.y?run:deckWidth}
      flights.push({id:`${door.id}:ramp:flight:${i}`,from:start,to:end,widthMm:deckWidth,rect})
      if(fold&&i===0){
        const next={x:end.x+normal.x*(landing+200),y:end.y+normal.y*(landing+200),z:end.z}
        const a=square({x:end.x+axis.x*landing/2,y:end.y+axis.y*landing/2}),b=square({x:next.x+axis.x*landing/2,y:next.y+axis.y*landing/2})
        landings.push({id:`${door.id}:ramp:turn`,rect:{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.max(a.x+a.w,b.x+b.w)-Math.min(a.x,b.x),h:Math.max(a.y+a.h,b.y+b.h)-Math.min(a.y,b.y)},elevationMm:end.z});start=next
      }else{
        const center={x:end.x+direction.x*landing/2,y:end.y+direction.y*landing/2}
        landings.push({id:`${door.id}:ramp:landing:${i}`,rect:square(center),elevationMm:end.z})
        start={x:end.x+direction.x*landing,y:end.y+direction.y*landing,z:end.z}
      }
    }
    const envelopes=[...landings.map(l=>l.rect),...flights.map(f=>f.rect)]
    if(!envelopes.every(free))continue
    result.landings=landings;result.flights=flights;result.status='ready'
    for(const l of landings){const r=l.rect,bottom=-plinth-120;result.solids.push({id:l.id,verticesMm:[[r.x,r.y,bottom],[r.x+r.w,r.y,bottom],[r.x+r.w,r.y+r.h,bottom],[r.x,r.y+r.h,bottom],[r.x,r.y,l.elevationMm],[r.x+r.w,r.y,l.elevationMm],[r.x+r.w,r.y+r.h,l.elevationMm],[r.x,r.y+r.h,l.elevationMm]],indices:[...indices]})}
    for(const f of flights){
      const dx=f.to.x-f.from.x,dy=f.to.y-f.from.y,length=Math.hypot(dx,dy),perp={x:-dy/length,y:dx/length},half=deckWidth/2,bottom=-plinth-120
      const corners=[{x:f.from.x+perp.x*half,y:f.from.y+perp.y*half,z:f.from.z},{x:f.to.x+perp.x*half,y:f.to.y+perp.y*half,z:f.to.z},{x:f.to.x-perp.x*half,y:f.to.y-perp.y*half,z:f.to.z},{x:f.from.x-perp.x*half,y:f.from.y-perp.y*half,z:f.from.z}]
      // Corner order is clockwise in plan; reverse the template to retain
      // outward normals on the wedge rather than double-sided hidden faces.
      result.solids.push({id:f.id,verticesMm:[...corners.map(p=>[p.x,p.y,bottom] as [number,number,number]),...corners.map(p=>[p.x,p.y,p.z] as [number,number,number])],indices:indices.map((_,i)=>indices[i-i%3+(i%3===1?2:i%3===2?1:0)])})
      for(const side of [-1,1]){
        const edge=(p:RampPoint,h:number)=>({x:p.x+perp.x*(half-60)*side,y:p.y+perp.y*(half-60)*side,z:p.z+h})
        for(const h of [760,900])result.rails.push({id:`${f.id}:rail:${side}:${h}`,from:edge(f.from,h),to:edge(f.to,h),radiusMm:20})
        result.rails.push({id:`${f.id}:edge:${side}`,from:edge(f.from,50),to:edge(f.to,50),radiusMm:40})
        const posts=Math.ceil(length/1200)
        for(let i=0;i<=posts;i++){const p={x:f.from.x+dx*i/posts,y:f.from.y+dy*i/posts,z:f.from.z+(f.to.z-f.from.z)*i/posts};result.rails.push({id:`${f.id}:post:${side}:${i}`,from:edge(p,0),to:edge(p,900),radiusMm:18})}
      }
    }
    // Guard landing edges while leaving real doorway/flight/approach gaps.
    for(const l of landings){
      const r=l.rect,last=l.id===landings.at(-1)!.id,final=flights.at(-1)!
      const openSide=final.to.x>final.from.x?'E':final.to.x<final.from.x?'W':final.to.y>final.from.y?'S':'N'
      for(const side of ['N','E','S','W'] as const){
        if(last&&side===openSide)continue
        const h=side==='N'||side==='S',fixed=h?(side==='N'?r.y:r.y+r.h):(side==='W'?r.x:r.x+r.w)
        const lo=h?r.x:r.y,hi=h?r.x+r.w:r.y+r.h,cuts:[number,number][]=[]
        for(const f of flights){const q=f.rect
          if(h&&(Math.abs(q.y-fixed)<2||Math.abs(q.y+q.h-fixed)<2))cuts.push([q.x,q.x+q.w])
          if(!h&&(Math.abs(q.x-fixed)<2||Math.abs(q.x+q.w-fixed)<2))cuts.push([q.y,q.y+q.h])
        }
        if(l===landings[0]&&Math.abs((h?door.at.y:door.at.x)-fixed)<2)cuts.push([(h?door.at.x:door.at.y)-door.width/2-80,(h?door.at.x:door.at.y)+door.width/2+80])
        let spans:[number,number][]=[[lo,hi]]
        for(const [a,b]of cuts)spans=spans.flatMap(([c,d])=>b<=c||a>=d?[[c,d] as [number,number]]:[...(a>c?[[c,a] as [number,number]]:[]),...(b<d?[[b,d] as [number,number]]:[])])
        const offset=side==='N'||side==='W'?60:-60
        for(const [i,[a,b]]of spans.entries())if(b-a>200){
          const point=(v:number,z:number):RampPoint=>({x:h?v:fixed+offset,y:h?fixed+offset:v,z:l.elevationMm+z})
          for(const z of [760,900])result.rails.push({id:`${l.id}:${side}:${i}:rail:${z}`,from:point(a,z),to:point(b,z),radiusMm:20})
          result.rails.push({id:`${l.id}:${side}:${i}:curb`,from:point(a,50),to:point(b,50),radiusMm:40})
          const posts=Math.ceil((b-a)/1200)
          for(let j=0;j<=posts;j++)result.rails.push({id:`${l.id}:${side}:${i}:post:${j}`,from:point(a+(b-a)*j/posts,0),to:point(a+(b-a)*j/posts,900),radiusMm:18})
        }
      }
    }
    result.issues.push('Concept ramp only. Verify approach to the gate, landing guards, door manoeuvring, surface drainage and local accessibility requirements. Ramp construction is not yet itemised in the estimate.')
    return result
  }
  result.issues.push('A clear ramp and level landings do not fit the recorded free site. Lower the chosen plinth or revise the entrance/site layout; no steep or obstructed ramp has been invented.')
  return result
}
