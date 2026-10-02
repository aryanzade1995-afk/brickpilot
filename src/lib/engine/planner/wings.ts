import { rectArea, rectUnionBBox, rectUnionArea, toSqm, type Rect, type Point } from '../../geometry.ts'
import type { CanonicalModel, SpaceReq } from '../../model/canonical.ts'
import type { FloorPlan, Opening, PlacedRoom } from '../types.ts'
import { makeRng } from '../massing/rng.ts'
import { frontYard, placeBalcony, reachability, type PlanRequest, type PlanResult } from './index.ts'
import { placeUnits } from './layout.ts'
import { COLUMN, GOING, MAX_SPAN, normalizeBrief, programRequirements, roomWidths, siteModel, snap,
  stairGeometry, unitLength } from './program.ts'
import { beamsFor, occupy, placeDoors, placeWindows, planShafts, stairRun, supportZonesFor, wallGraph, type Occupancy } from './elements.ts'
import type { Column, RoomReq, Unit } from './types.ts'
import { PLANNING_LIMITS } from './limits.ts'

export const WING_LIMITS = { linkWidthMm: 1800, courtWidthMm: 3000, maximumDepthMm: 5400,
  maximumRoomGrowth: 1.5, minimumBarLengthMm: 6000 } as const

const placed = (r: RoomReq, rect: Rect): PlacedRoom => ({ id:r.id,semanticId:r.semanticId,name:r.name,
 zone:r.zone,rect,area:toSqm(rectArea(rect)),outdoor:r.outdoor,wantsWindow:r.space.wantsWindow })
const hallReq = (id: string, prefix: string, name: string): RoomReq => {
 const space: SpaceReq = {id,name,zone:'circulation',min:0,target:8,max:999,wantsWindow:false,wet:false,outdoor:false}
 return {id,semanticId:`${prefix}_${id.toUpperCase()}`,name,zone:'circulation',kind:'corridor',
  minSqm:0,targetSqm:8,maxSqm:999,minWidthMm:0,wet:false,habitable:false,outdoor:false,space}
}

/** Two independently sized single-loaded bars, joined at their spines. Groups
 * remain intact; no room coordinate or source opening is copied from a 3D mass. */
export function planWings(model: CanonicalModel, request: PlanRequest): PlanResult | null {
 const nb=normalizeBrief(model), stair=stairGeometry(nb), site=siteModel(model)
 // Covered outdoor rooms may abut a wing: they need their depth, no spare yard gap.
 if (site.frontStripMm >= 5300) site.houseZone.h += 300
 const reqs=programRequirements(nb,stair.slotWidth), zone=site.houseZone
 const s=nb.large?1500:1200, linkW=WING_LIMITS.linkWidthMm
 const length=snap(zone.w-linkW)
 if(length<WING_LIMITS.minimumBarLengthMm) return null
 const rng=makeRng(request.order,`${model.seed.split('-')[0]}|wing-units`)
 const groups=reqs.map(f=>{
  const publicUnits=f.units.filter(u=>u.key==='core'||u.key==='kitchen'||u.key==='pooja'||u.key==='bedStaff'||
    u.rooms.some(r=>r.space.autoExtra && r.zone!=='private' && r.kind!=='ensuite') ||
    (f.level>0&&!u.rooms.some(r=>r.kind==='bed'||r.kind==='ensuite')))
  const privateUnits=f.units.filter(u=>!publicUnits.includes(u))
  // Keep foyer/client office and family bedroom groups contiguous.
  const fixed=privateUnits.filter(u=>u.anchor||u.key==='living'||u.key==='lounge')
  const free=privateUnits.filter(u=>!fixed.includes(u)).map(u=>({u,key:rng.next()})).sort((a,b)=>a.key-b.key).map(x=>x.u)
  return {north:publicUnits,south:[...fixed,...free]}
 })
 const depths=Array.from({length:Math.floor((WING_LIMITS.maximumDepthMm-stair.depth)/300)+1},(_,i)=>stair.depth+i*300)
 const candidates=depths.filter(d=>zone.h-2*(d+s)>=WING_LIMITS.courtWidthMm && groups.every(g=>
  [g.north,g.south].every(us=>us.reduce((sum,u)=>sum+unitLength(u,d,'min'),0)<=length)))
 if(!candidates.length)return null
 const depthPool = nb.large ? [...candidates].reverse().slice(0,4) : candidates
 const d=depthPool[request.pick%depthPool.length]
 const courtH=snap(zone.h-2*(d+s)), x=zone.x+linkW, y=zone.y
 const southY=y+d+s+courtH
 const court:Rect={x,y:y+d+s,w:length,h:courtH}
 const northHall:Rect={x,y:y+d,w:length,h:s}
 const southHall:Rect={x,y:southY,w:length,h:s}
 const linkRect:Rect={x:zone.x,y:northHall.y,w:linkW,h:s+courtH+s}
 const localAxes=[0,stair.slotWidth]
 const bays=Math.ceil((length-stair.slotWidth)/MAX_SPAN)
 for(let i=1;i<=bays;i++)localAxes.push(i===bays?length:stair.slotWidth+snap((length-stair.slotWidth)*i/bays))
 const ys=[y,y+d,y+d+s,southY,southY+s,southY+s+d]
 const galleryYs=[northHall.y]
 while(galleryYs.at(-1)!<southY+s)galleryYs.push(Math.min(southY+s,galleryYs.at(-1)!+MAX_SPAN))
 const axes=[...localAxes.map((u,i)=>({id:`WING_X${i}`,orient:'v' as const,at:x+u})),
  ...ys.map((at,i)=>({id:`WING_Y${i}`,orient:'h' as const,at}))]
 const points:Point[]=[]
 for(const u of localAxes)for(const at of ys)points.push({x:x+u,y:at})
 for(const at of galleryYs)for(const px of [zone.x,x])points.push({x:px,y:at})
 const uniquePoints=[...new Map(points.map(p=>[`${p.x},${p.y}`,p])).values()]
 const floors:FloorPlan[]=[], kinds=new Map<string,string>(), parents=new Map<string,string>()
 for(const f of reqs)for(const r of [...f.rooms,...f.outdoor,f.spine]){kinds.set(r.id,r.kind);if(r.parent)parents.set(r.id,r.parent)}
 let maxSpan=0
 for(const [fi,f] of reqs.entries()){
  const rooms:PlacedRoom[]=[], subsets:PlacedRoom[][]=[]
  for(const [wi,units] of [groups[fi].north,groups[fi].south].entries()){
   const rs=units.flatMap(u=>u.rooms)
   const maxLength=rs.reduce((sum,r)=>sum+(r.fixedWidthMm??Math.max(roomWidths(r,d).min,Math.min(r.maxSqm*1e6/d*WING_LIMITS.maximumRoomGrowth,d*3.3))),0)
   const filler=hallReq(`wingGallery${wi}`,f.prefix,'Daylit wing gallery')
   const extra=length-maxLength
   const list:Unit[]=[...units]
   if(extra>0 || !rs.length){
    const start=localAxes.filter(a=>a<=length-Math.max(2200,extra)).at(-1)??0
    filler.fixedWidthMm=length-start
    if(rs.reduce((sum,r)=>sum+roomWidths(r,d).min,0)+filler.fixedWidthMm>length)return null
    list.push({key:filler.id,rooms:[filler],band:'A',movable:false,anchor:false});kinds.set(filler.id,'lounge')
   }
   // Reuse distribution and narrow-room/column alignment from the bar planner.
   const local=placeUnits(list,[[0,length]],d,'A',localAxes,WING_LIMITS.maximumRoomGrowth).rooms
   if (!local.length || local.at(-1)!.u1 !== length) return null
   const subset=local.map(lr=>placed(lr.req,{x:x+lr.u0,y:wi===0?y:southY+s,w:lr.u1-lr.u0,h:d}))
   const hall=wi===0?f.spine:hallReq('privateHall',f.prefix,'Private wing hall')
   kinds.set(hall.id,hall.kind)
   subset.push(placed(hall,wi===0?northHall:southHall));subsets.push(subset);rooms.push(...subset)
  }
  const link=placed(hallReq('link',f.prefix,'Connecting gallery'),linkRect)
  kinds.set(link.id,'corridor');rooms.push(link)
  // Axis alignment may widen a small wet room: reject that plate rather than
  // allowing programme growth to inflate an existing room beyond its limit.
  if (rooms.some(room => {
    const req=f.rooms.find(r=>r.id===room.id)
    return req && req.zone !== 'circulation' && room.area > req.maxSqm * WING_LIMITS.maximumRoomGrowth + .05
  })) return null
  const footprint=rooms.map(r=>r.rect), outline=rectUnionBBox(footprint)
  const outdoor=(r:RoomReq,rect:Rect)=>placed(r,rect)
  if(fi===0){
   const courtReq=f.outdoor.find(r=>r.kind==='courtyard')
   if(courtReq)rooms.push(outdoor(courtReq,court))
   frontYard(rooms,f.outdoor.filter(r=>r.kind!=='courtyard'),outline,site,nb.twoCar,nb.large,outdoor)
  }else for(const r of f.outdoor.filter(r=>r.kind==='balcony')){
   const rect=placeBalcony(rooms,outline,site,id=>kinds.get(id)??'',floors[fi-1].footprint)
   if(rect)rooms.push(outdoor(r,rect))
  }
  if(fi===0 && rectUnionArea([...footprint,...rooms.filter(r=>r.outdoor&&r.id!=='courtyard').map(r=>r.rect)])>
   site.plot.w*site.plot.h*PLANNING_LIMITS.maxCoverage)return null
  const columns:Column[]=uniquePoints.map((at,i)=>({id:`${f.prefix}_COLUMN_C${String(i+1).padStart(2,'0')}`,at,size:COLUMN,grid:`WING_${i}`}))
  const onPlate=(p:Point)=>footprint.some(r=>p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h)
  const beams=beamsFor(columns,onPlate,f.prefix);maxSpan=Math.max(maxSpan,...beams.map(b=>b.span))
  const walls=wallGraph(rooms,f.prefix,axes.map(a=>({orient:a.orient,fixed:a.at,lo:-Infinity,hi:Infinity})))
  const occ:Occupancy=new Map(),doors:Opening[]=[],failed:string[]=[]
  const core=rooms.find(r=>r.id==='stair')!
  const target={x:core.rect.x+core.rect.w/2,y:core.rect.y+core.rect.h/2}
  for(const [wi,subset] of subsets.entries()){
   const spine=wi===0?f.spine.id:'privateHall'
   const result=placeDoors(subset,spine,f.prefix,columns,occ,id=>kinds.get(id)??'',id=>parents.get(id),
    fi===0&&subset.some(r=>r.id==='foyer')?{width:nb.mainDoorMm}:null,target,model.brief.lifestyle.kitchen)
   doors.push(...result.openings);failed.push(...result.failed)
   const hall=subset.find(r=>r.id===spine)!
   const joined=placeDoors([{...link,semanticId:`${f.prefix}_LINK_${wi}`},hall],spine,f.prefix,columns,occ,
    id=>id===link.id?'living':kinds.get(id)??'',()=>undefined,null,target)
   doors.push(...joined.openings);failed.push(...joined.failed)
  }
  // Outdoor access reuses the same placer with only its adjacent host and spine.
  for(const out of rooms.filter(r=>r.outdoor&&(r.id==='courtyard'||r.id.startsWith('balcony')))){
   const subset=out.id==='courtyard'?subsets[0]:rooms.filter(r=>!r.outdoor)
   const result=placeDoors([...subset,out],out.id==='courtyard'?f.spine.id:'privateHall',f.prefix,columns,occ,
    ()=>'',()=>undefined,null,target)
   for(const o of result.openings){if(!doors.some(d=>d.id===o.id)){doors.push(o);occupy(occ,o.orient,o.orient==='h'?o.at.y:o.at.x,o.orient==='h'?o.at.x:o.at.y,o.width)}}
  }
  const windows=placeWindows(rooms,walls,columns,occ,id=>kinds.get(id)??'',request.themeWindowMm,request.dna,floors.at(-1)?.openings??[])
  const openings=[...doors,...windows],unreachable=reachability(rooms,openings,fi)
  floors.push({level:fi,name:model.floors[fi].name,prefix:f.prefix,outline,footprint,rooms,walls,openings,
   courtyard:fi===0&&rooms.some(r=>r.id==='courtyard')?court:null,roof:request.roofFor(fi,fi===reqs.length-1),
   columns,beams,shafts:planShafts(rooms,walls,openings,id=>kinds.get(id)??'',floors.at(-1)?.rooms??[]),
   supportZones:supportZonesFor(footprint,f.prefix,[]),stair:stairRun(core.rect,'S',stair.perFlight,GOING),
   reachable:!failed.length&&!unreachable.length,unreachableRooms:[...new Set([...failed,...unreachable])]})
 }
 return {floors,site,candidates:candidates.length,structure:{orientation:'x',mirror:false,family:'twin-wing',axes,maxBeamSpanMm:maxSpan}}
}
