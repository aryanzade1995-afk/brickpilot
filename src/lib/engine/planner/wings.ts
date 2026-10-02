import { rectArea, rectUnionBBox, rectUnionArea, toSqm, type Rect, type Point } from '../../geometry.ts'
import type { CanonicalModel, SpaceReq } from '../../model/canonical.ts'
import type { FloorPlan, Opening, PlacedRoom } from '../types.ts'
import { makeRng } from '../massing/rng.ts'
import { frontYard, placeBalcony, reachability, type PlanRequest, type PlanResult } from './index.ts'
import { placeUnits } from './layout.ts'
import { COLUMN, GOING, MAX_SPAN, normalizeBrief, programRequirements, roomWidths, siteModel, snap,
  stairGeometry, unitLength } from './program.ts'
import { beamsFor, occupy, placeDoors, placeWindows, planShafts, stairRun, supportZonesFor, wallGraph, type Occupancy } from './elements.ts'
import type { Column, LocalRoom, RoomReq, Unit } from './types.ts'
import { PLANNING_LIMITS } from './limits.ts'
import { createDoubleHeightGallery, DOUBLE_HEIGHT_LIMITS } from './doubleHeight.ts'

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
 const third=request.family!=='twin-wing', ring=request.family==='courtyard-ring'
 const choices=request.layoutChoices
 const sideDepth=third?(zone.w>=24000?3900:3000):0, rightWidth=ring?linkW:0
 const length=snap(zone.w-linkW-sideDepth-rightWidth)
 if(length<WING_LIMITS.minimumBarLengthMm) return null
 const rng=makeRng(request.order,`${model.seed.split('-')[0]}|wing-units`)
 const groups=reqs.map(f=>{
  const sideUnits=third?f.units.filter(u=>u.key!=='core' && !u.anchor && u.key!=='kitchen' &&
    ((u.key==='living'&&choices?.living==='side') || u.key==='pooja' || u.rooms.every(r=>r.kind==='study'||r.kind==='bath'))):[]
  const available=f.units.filter(u=>!sideUnits.includes(u))
  const publicUnits=available.filter(u=>u.key==='core'?choices?.stair!=='front':u.key==='kitchen'||u.key==='pooja'||u.key==='bedStaff'||
    (u.key==='living'&&choices?.living==='back') ||
    u.rooms.some(r=>r.space.autoExtra && r.zone!=='private' && r.kind!=='ensuite') ||
    (f.level>0&&!u.rooms.some(r=>r.kind==='bed'||r.kind==='ensuite')))
  const privateUnits=available.filter(u=>!publicUnits.includes(u))
  // Keep foyer/client office and family bedroom groups contiguous.
  const fixed=privateUnits.filter(u=>u.anchor||u.key==='living'||u.key==='lounge').sort((a,b)=>Number(b.key==='core')-Number(a.key==='core'))
  publicUnits.sort((a,b)=>choices?.kitchen==='service'?Number(a.key==='kitchen')-Number(b.key==='kitchen'):0)
  const free=privateUnits.filter(u=>!fixed.includes(u)).map(u=>({u,key:rng.next()})).sort((a,b)=>a.key-b.key).map(x=>x.u)
  return {north:publicUnits,south:[...fixed,...free],side:sideUnits}
 })
 const depths=Array.from({length:Math.floor((WING_LIMITS.maximumDepthMm-stair.depth)/300)+1},(_,i)=>stair.depth+i*300)
 const candidates=depths.filter(d=>zone.h-2*(d+s)>=WING_LIMITS.courtWidthMm &&
  (request.family!=='pavilion'||zone.h-2*d>=12000) && groups.every(g=>
  [g.north,g.south].every(us=>us.reduce((sum,u)=>sum+unitLength(u,d,'min'),0)<=length)))
 if(!candidates.length)return null
 const depthPool = nb.large ? [...candidates].reverse().slice(0,4) : candidates
 const d=depthPool[request.pick%depthPool.length]
 const courtH=snap(zone.h-2*(d+s)), x=zone.x+sideDepth+linkW, y=zone.y
 const southY=y+d+s+courtH
 const court:Rect={x,y:y+d+s,w:length,h:courtH}
 const northHall:Rect={x,y:y+d,w:length,h:s}
 const southHall:Rect={x,y:southY,w:length,h:s}
 const linkRect:Rect={x:zone.x+sideDepth,y:northHall.y,w:linkW,h:s+courtH+s}
 const sideLength = request.family==='pavilion' ? Math.min(22000,linkRect.h-6000) : linkRect.h
 const sideStart = linkRect.y + (request.family==='pavilion' ? snap((linkRect.h-sideLength)/2) : 0)
 if(third && (sideLength<6000 || groups.some(g=>g.side.reduce((n,u)=>n+unitLength(u,sideDepth,'min'),0)>sideLength)))return null
 const coreWidth=stair.slotWidth+(nb.lift?1800:0)
 const coreStart=choices?.stair==='centre'?snap((length-coreWidth)/2):0
 const stops=[...new Set([0,coreStart,coreStart+coreWidth,length])].sort((a,b)=>a-b),localAxes=[0]
 for(let j=1;j<stops.length;j++){
  const begin=stops[j-1],end=stops[j],bays=Math.ceil((end-begin)/MAX_SPAN)
  for(let i=1;i<=bays;i++)localAxes.push(i===bays?end:begin+snap((end-begin)*i/bays))
 }
 const ys=[y,y+d,y+d+s,southY,southY+s,southY+s+d]
 const galleryYs=[northHall.y]
 while(galleryYs.at(-1)!<southY+s)galleryYs.push(Math.min(southY+s,galleryYs.at(-1)!+MAX_SPAN))
 const axes=[...localAxes.map((u,i)=>({id:`WING_X${i}`,orient:'v' as const,at:x+u})),
  ...ys.map((at,i)=>({id:`WING_Y${i}`,orient:'h' as const,at}))]
 const points:Point[]=[]
 for(const u of localAxes)for(const at of ys)points.push({x:x+u,y:at})
 for(const at of galleryYs)for(const px of [linkRect.x,x])points.push({x:px,y:at})
 const sideAxes = [0,...galleryYs.map(at=>at-sideStart).filter(at=>at>0&&at<sideLength),sideLength]
 if(third)for(const u of sideAxes)points.push({x:zone.x,y:sideStart+u})
 if(ring)for(const at of galleryYs)for(const px of [x+length,x+length+rightWidth])points.push({x:px,y:at})
 const uniquePoints=[...new Map(points.map(p=>[`${p.x},${p.y}`,p])).values()]
 const floors:FloorPlan[]=[], kinds=new Map<string,string>(), parents=new Map<string,string>()
 for(const f of reqs)for(const r of [...f.rooms,...f.outdoor,f.spine]){kinds.set(r.id,r.kind);if(r.parent)parents.set(r.id,r.parent)}
 let maxSpan=0
 for(const [fi,f] of reqs.entries()){
  const rooms:PlacedRoom[]=[], subsets:PlacedRoom[][]=[]
  for(const [wi,units] of [groups[fi].north,groups[fi].south,...(third?[groups[fi].side]:[])].entries()){
   const runLength=wi===2?sideLength:length, runDepth=wi===2?sideDepth:d, runAxes=wi===2?sideAxes:localAxes
   const fill=(us:Unit[],lo:number,hi:number,serial:string):LocalRoom[]=>{
    const rs=us.flatMap(u=>u.rooms),span=hi-lo
    if(span<=0)return []
    const maxLength=rs.reduce((sum,r)=>sum+(r.fixedWidthMm??Math.max(roomWidths(r,runDepth).min,Math.min(r.maxSqm*1e6/runDepth*WING_LIMITS.maximumRoomGrowth,runDepth*3.3))),0)
    const list=[...us],extra=span-maxLength
    if(extra>0 || !rs.length){
     const filler=hallReq(`wingGallery${wi}${serial}`,f.prefix,'Daylit wing gallery')
     const start=runAxes.filter(a=>a>=lo&&a<=hi-Math.max(2200,extra)).at(-1)??lo
     filler.fixedWidthMm=hi-start
     if(rs.reduce((sum,r)=>sum+roomWidths(r,runDepth).min,0)+filler.fixedWidthMm>span)return []
     list.push({key:filler.id,rooms:[filler],band:'A',movable:false,anchor:false});kinds.set(filler.id,'lounge')
    }
    return placeUnits(list,[[lo,hi]],runDepth,'A',runAxes,WING_LIMITS.maximumRoomGrowth).rooms
   }
   const coreUnit=units.find(u=>u.key==='core'),other=units.filter(u=>u!==coreUnit)
   let local:LocalRoom[]
   if(coreUnit&&coreStart>0){
    const candidates=Array.from({length:other.length+1},(_,k)=>k).filter(k=>
     other.slice(0,k).reduce((n,u)=>n+unitLength(u,runDepth,'min'),0)<=coreStart &&
     other.slice(k).reduce((n,u)=>n+unitLength(u,runDepth,'min'),0)<=runLength-coreStart-coreWidth)
    const k=candidates.sort((a,b)=>Math.abs(a-other.length/2)-Math.abs(b-other.length/2))[0]
    if(k===undefined)return null
    local=[...fill(other.slice(0,k),0,coreStart,'L'),
     ...placeUnits([coreUnit],[[coreStart,coreStart+coreWidth]],runDepth,'A',runAxes,WING_LIMITS.maximumRoomGrowth).rooms,
     ...fill(other.slice(k),coreStart+coreWidth,runLength,'R')]
   }else local=fill(coreUnit?[coreUnit,...other]:units,0,runLength,'')
   if(!local.length || local.reduce((n,r)=>n+r.u1-r.u0,0)!==runLength)return null
   const subset=local.map(lr=>placed(lr.req,wi===2?{x:zone.x,y:sideStart+lr.u0,w:sideDepth,h:lr.u1-lr.u0}:
    {x:x+lr.u0,y:wi===0?y:southY+s,w:lr.u1-lr.u0,h:d}))
   const hall=wi===0?f.spine:hallReq(wi===1?'privateHall':'link',f.prefix,wi===1?'Private wing hall':'Connecting gallery')
   kinds.set(hall.id,hall.kind)
   rooms.push(...subset)
   subset.push(placed(hall,wi===0?northHall:wi===1?southHall:linkRect));subsets.push(subset)
   if(wi!==2)rooms.push(subset.at(-1)!)
  }
  const link=placed(hallReq('link',f.prefix,'Connecting gallery'),linkRect)
  kinds.set(link.id,'corridor');rooms.push(link)
  const rightLink=ring?placed(hallReq('rightLink',f.prefix,'Courtyard gallery'),{x:x+length,y:northHall.y,w:rightWidth,h:linkRect.h}):null
  if(rightLink){kinds.set(rightLink.id,'corridor');rooms.push(rightLink)}
  // Axis alignment may widen a small wet room: reject that plate rather than
  // allowing programme growth to inflate an existing room beyond its limit.
  if (rooms.some(room => {
    const req=f.rooms.find(r=>r.id===room.id)
    return req && req.zone !== 'circulation' && room.area > req.maxSqm * WING_LIMITS.maximumRoomGrowth + .05
  })) return null
  const doubleHeight=fi===1&&reqs.length===2&&choices?.doubleHeight?
   createDoubleHeightGallery(rooms,floors[0].rooms,uniquePoints.map((at,i)=>({id:String(i),at,size:COLUMN,grid:''})),f.prefix):null
  if(fi===1&&choices?.doubleHeight&&!doubleHeight)choices.doubleHeight=false
  if(fi===2&&choices?.doubleHeight)choices.doubleHeight=false
  const footprint=rooms.filter(r=>!r.outdoor).map(r=>r.rect), outline=rectUnionBBox(footprint)
  const outdoor=(r:RoomReq,rect:Rect)=>placed(r,rect)
  if(fi===0){
   if(choices?.verandah==='wrap'){
    const depth=1800
    if(court.w-depth<3000||court.h-depth<3000)return null
    const north=f.outdoor.find(r=>r.id==='verandahWingN')!,west=f.outdoor.find(r=>r.id==='verandahWingW')!
    rooms.push(outdoor(north,{x:court.x,y:court.y,w:court.w,h:depth}),
     outdoor(west,{x:court.x,y:court.y+depth,w:depth,h:court.h-depth}))
    court.x+=depth;court.y+=depth;court.w-=depth;court.h-=depth
   }
   const courtReq=f.outdoor.find(r=>r.kind==='courtyard')
   if(courtReq)rooms.push(outdoor(courtReq,court))
   frontYard(rooms,f.outdoor.filter(r=>r.kind!=='courtyard'&&!r.id.startsWith('verandahWing')),outline,site,nb.twoCar,nb.large,outdoor)
  }else for(const r of f.outdoor.filter(r=>r.kind==='balcony')){
   const rect=placeBalcony(rooms,outline,site,id=>kinds.get(id)??'',floors[fi-1].footprint)
   if(rect)rooms.push(outdoor(r,rect))
  }
  if(fi===0 && rectUnionArea([...footprint,...rooms.filter(r=>r.outdoor&&r.id!=='courtyard').map(r=>r.rect)])>
   site.plot.w*site.plot.h*PLANNING_LIMITS.maxCoverage)return null
  const onPlate=(p:Point)=>footprint.some(r=>p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h)
  const columns:Column[]=uniquePoints.filter(onPlate).map((at,i)=>({id:`${f.prefix}_COLUMN_C${String(i+1).padStart(2,'0')}`,at,size:COLUMN,grid:`WING_${i}`}))
  const beams=beamsFor(columns,onPlate,f.prefix);maxSpan=Math.max(maxSpan,...beams.map(b=>b.span))
  const walls=wallGraph(rooms.map(r=>r.id===doubleHeight?.roomId?{...r,outdoor:false}:r),f.prefix,axes.map(a=>({orient:a.orient,fixed:a.at,lo:-Infinity,hi:Infinity})))
  if(doubleHeight)for(const wall of walls){
   if(wall.kind==='interior'&&wall.rooms?.includes(doubleHeight.roomId)){
    wall.kind='parapet';wall.heightMm=DOUBLE_HEIGHT_LIMITS.guardHeightMm
   }
  }
  const occ:Occupancy=new Map(),doors:Opening[]=[],failed:string[]=[]
  const core=rooms.find(r=>r.id==='stair')!
  const target={x:core.rect.x+core.rect.w/2,y:core.rect.y+core.rect.h/2}
  for(const [wi,subset] of subsets.entries()){
   const spine=wi===0?f.spine.id:wi===1?'privateHall':'link'
   const result=placeDoors(subset,spine,f.prefix,columns,occ,id=>kinds.get(id)??'',id=>parents.get(id),
    fi===0&&subset.some(r=>r.id==='foyer')?{width:nb.mainDoorMm}:null,target,model.brief.lifestyle.kitchen)
   doors.push(...result.openings);failed.push(...result.failed)
   const hall=subset.find(r=>r.id===spine)!
   if(spine==='link')continue
   const joined=placeDoors([{...link,semanticId:`${f.prefix}_LINK_${wi}`},hall],spine,f.prefix,columns,occ,
    id=>id===link.id?'living':kinds.get(id)??'',()=>undefined,null,target)
   doors.push(...joined.openings);failed.push(...joined.failed)
   if(rightLink){
    const joinedRight=placeDoors([{...rightLink,semanticId:`${f.prefix}_RIGHT_LINK_${wi}`},hall],spine,f.prefix,columns,occ,
      id=>id===rightLink.id?'living':kinds.get(id)??'',()=>undefined,null,target)
    doors.push(...joinedRight.openings);failed.push(...joinedRight.failed)
   }
  }
  // Outdoor access reuses the same placer with only its adjacent host and spine.
  for(const out of rooms.filter(r=>r.outdoor&&(r.id==='courtyard'||r.id.startsWith('balcony')))){
   const subset=out.id==='courtyard'?subsets[0]:rooms.filter(r=>!r.outdoor)
   // A wrap verandah occupies the hall edge; the open court remains a garden,
   // reached through that verandah rather than an invented wall aperture.
   if(out.id==='courtyard'&&choices?.verandah==='wrap')continue
   const result=placeDoors([...subset,out],out.id==='courtyard'?f.spine.id:'privateHall',f.prefix,columns,occ,
    ()=>'',()=>undefined,null,target)
   for(const o of result.openings){if(!doors.some(d=>d.id===o.id)){doors.push(o);occupy(occ,o.orient,o.orient==='h'?o.at.y:o.at.x,o.orient==='h'?o.at.x:o.at.y,o.width)}}
  }
  const windows=placeWindows(rooms,walls,columns,occ,id=>kinds.get(id)??'',request.themeWindowMm,request.dna,floors.at(-1)?.openings??[])
  const openings=[...doors,...windows],unreachable=reachability(rooms,openings,fi)
  floors.push({level:fi,name:model.floors[fi].name,prefix:f.prefix,outline,footprint,rooms,walls,openings,
   ...(doubleHeight?{doubleHeightVoids:[doubleHeight]}:{}),
   courtyard:fi===0&&rooms.some(r=>r.id==='courtyard')?court:null,roof:request.roofFor(fi,fi===reqs.length-1),
   columns,beams,shafts:planShafts(rooms,walls,openings,id=>kinds.get(id)??'',floors.at(-1)?.rooms??[]),
   supportZones:supportZonesFor(footprint,f.prefix,[]),stair:stairRun(core.rect,choices?.stair==='front'?'N':'S',stair.perFlight,GOING),
   reachable:!failed.length&&!unreachable.length,unreachableRooms:[...new Set([...failed,...unreachable])]})
 }
 return {floors,site,candidates:candidates.length,structure:{orientation:'x',mirror:false,family:request.family,axes,maxBeamSpanMm:maxSpan}}
}
