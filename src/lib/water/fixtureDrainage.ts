import type {BuildingModel} from '../engine/buildingModel.ts'
import type {Brief} from '../model/brief.ts'
import type {UtilityFloor} from '../utilities/plan.ts'
import type {DrainageFixtureKind} from '../utilities/drainageInputs.ts'
import type {ServicePoint,VillaPlumbing} from '../plumbing/villaPlumbing.ts'
import type {ConnectedDrainage} from './drainageNetwork.ts'
import {interiorAsset,selectedInteriorModel,type ModelCategory} from '../interior-assets/catalogue.ts'
import type {InteriorModelInstance} from '../interior-assets/placements.ts'
import {planToThreeGlb} from '../solar/coordinates.ts'
import {segmentHitsRect} from '../utilities/drainage.ts'

export const FIXTURE_NAMES:Record<DrainageFixtureKind,string>={toilet:'Toilet',washbasin:'Washbasin',shower:'Shower',bathtub:'Bath',kitchen_sink:'Kitchen sink',washing_machine:'Washing machine',floor_drain:'Floor drain',unknown_sink:'Sink'}
const categories:Partial<Record<DrainageFixtureKind,ModelCategory>>={toilet:'toilet',washbasin:'basin',bathtub:'bathtub',kitchen_sink:'kitchen-sink',washing_machine:'washing-machine',unknown_sink:'basin'}
const heights:Record<DrainageFixtureKind,number>={toilet:800,washbasin:850,shower:70,bathtub:550,kitchen_sink:380,washing_machine:850,floor_drain:20,unknown_sink:850}
export type DrainFixture3D={wasteConnection?:ServicePoint[];key:string;id:string;roomId:string;roomName:string;floorId:string;floorName:string;level:number;kind:DrainageFixtureKind;point:ServicePoint;widthMm:number;depthMm:number;rotation:number;basis:string;model:InteriorModelInstance|null;branch:DrainBranch3D|null;issues:string[]}
export type DrainBranch3D={proposalReview?:boolean;stackAligned?:boolean;id:string;fixtureId:string;points:ServicePoint[];diameterMm:number;sizeKnown:boolean;levelsKnown:boolean;blocked:boolean;shaftId:string|null;connected:boolean;reason:string}
export type DrainCollector3D={id:string;points:ServicePoint[];diameterMm:number;blocked:boolean;levelsKnown:boolean}

/** Architecture is read only. XY is the resolved 2D plan, never a second router.
 * Surveyed inverts become pipe centres using the same floor datum. Unknown Z
 * is explicitly a 75 mm illustrative underfloor band, not an engineered fall. */
export function fixtureDrainageScene(floors:UtilityFloor[],building:BuildingModel,home:VillaPlumbing,network:ConnectedDrainage|null,brief:Brief){
  const fixtures:DrainFixture3D[]=[],issues:string[]=[],collectors:DrainCollector3D[]=[],destinations:{id:string;point:ServicePoint;name:string}[]=[]
  const configuredDischarge=floors.some(f=>!!f.drainageDesign?.input.outlet.position)
  for(const plan of floors){
    const floor=building.floors.find(f=>f.level===plan.floor.level),design=plan.drainageDesign
    if(!floor||!design||JSON.stringify(plan.floor.outline)!==JSON.stringify(floor.outline)||plan.floor.rooms.some(r=>!building.rooms.some(b=>b.floorId===floor.id&&b.id===r.id&&JSON.stringify(b.rect)===JSON.stringify(r.rect)))){issues.push(`${plan.floor.name}: the 2D drainage drawing does not match the accepted house geometry.`);continue}
    for(const fixture of design.fixtures){
      const room=plan.floor.rooms.find(r=>r.id===fixture.roomId)
      if(!room)continue
      const source=plan.fixtures.find(f=>f.id===fixture.id),kind=fixture.kind
      const fallback=kind==='toilet'?[420,700]:kind==='floor_drain'?[150,150]:kind==='washing_machine'?[600,600]:kind==='bathtub'?[1600,700]:[600,600]
      const widthMm=source?.width??fallback[0],depthMm=source?.depth??fallback[1]
      const p=fixture.position,r=room.rect
      const nearest=[{d:p.y-r.y,rotation:Math.PI},{d:r.y+r.h-p.y,rotation:0},{d:p.x-r.x,rotation:Math.PI/2},{d:r.x+r.w-p.x,rotation:-Math.PI/2}].sort((a,b)=>a.d-b.d)[0]
      const point={...p,z:floor.elevationMm},category=categories[kind],choice=category?selectedInteriorModel(brief,category,room.semanticId??room.id):'procedural'
      const asset=category&&choice!=='procedural'?interiorAsset(choice==='auto'?kind==='toilet'?'toilet-modern':category:choice):undefined
      let model:InteriorModelInstance|null=null
      if(asset){
        const turn=Math.abs(Math.sin(nearest.rotation))>.5
        const s=Math.min((turn?depthMm:widthMm)/1000/asset.sizeM[0],(turn?widthMm:depthMm)/1000/asset.sizeM[2],heights[kind]/1000/asset.sizeM[1])
        const world=planToThreeGlb(point)
        model={id:`drain-fixture:${fixture.id}`,assetId:asset.id,assetRevision:asset.sha256,roomId:room.id,floorId:floor.id,position:[world.x,world.y+(kind==='kitchen_sink'?.70:kind==='washbasin'||kind==='unknown_sink'?.65:0),world.z],rotation:nearest.rotation,size:asset.sizeM.map(n=>n*s) as [number,number,number],scale:[s,s,s],replaces:[],color:'#EEEAE1',hardwareColor:'#A6AAA7'}
      }
      const pipe=design.pipes.find(p=>p.from===fixture.id&&!p.vertical&&p.service!=='vent')
      const issues:string[]=[]
      let branch:DrainBranch3D|null=null
      if(pipe){
        const stack=design.nodes.find(n=>n.id===pipe.to),shaft=stack?building.shafts.find(s=>s.floorId===floor.id&&Math.hypot(s.rect.x+s.rect.w*.6-stack.position.x,s.rect.y+s.rect.h*.5-stack.position.y)<1):undefined
        const soil=shaft?home.pipes.find(p=>p.id===`soil:${shaft.id}`):undefined
        const diameterMm=pipe.diameterMm??pipe.candidateDiameterMm??(kind==='toilet'?110:50)
        const levelsKnown=!!design.input.datum&&design.input.floorElevationMm!==null&&pipe.inletInvertMm!==null&&pipe.outletInvertMm!==null
        const offset=floor.elevationMm-(design.input.floorElevationMm??0)
        const start=levelsKnown?pipe.inletInvertMm!+offset+diameterMm/2:floor.elevationMm-75
        const end=levelsKnown?pipe.outletInvertMm!+offset+diameterMm/2:start
        let distance=0
        const points=pipe.path.map((p,i)=>{if(i)distance+=Math.hypot(p.x-pipe.path[i-1].x,p.y-pipe.path[i-1].y);return {...p,z:start+(end-start)*(pipe.lengthMm?distance/pipe.lengthMm:0)}})
        const span=soil?soil.points.map(p=>p.z):[]
        // The visual 25mm join is confined to the existing shaft aperture. A
        // surveyed branch outside its represented stack span stays pending.
        const base=design.nodes.find(n=>n.id===`${pipe.to}:base`)
        const baseAligned=!base||!!stack&&Math.hypot(base.position.x-stack.position.x,base.position.y-stack.position.y)<1
        const reaches=baseAligned&&!!soil&&(!levelsKnown||end>=Math.min(...span)&&end<=Math.max(...span))
        if(reaches&&soil&&points.length){const last=points.at(-1)!;const z=Math.max(Math.min(...span),Math.min(Math.max(...span),end));if(z!==end)points.push({...last,z})}
        const connected=!configuredDischarge&&pipe.state!=='blocked'&&reaches&&!!network?.layout.pipes.some(p=>p.id===soil?.id)
        const reason=pipe.state==='blocked'?'The 2D route crosses a protected area; a reviewed sleeve or revised route is needed.':!baseAligned?'The saved stack base is offset; its continuation is unresolved.':!shaft?'The 2D stack does not match a recorded house shaft.':!reaches?'The branch level does not meet the represented stack.':configuredDischarge?'The saved 2D discharge routes are shown. Stack-to-collector levels need coordination; the separate tank concept is hidden.':!connected?'The upper stack needs a reviewed continuation to the tank.':'Connected in the concept network; sizing, levels and fittings still need review.'
        branch={stackAligned:baseAligned,id:pipe.id,fixtureId:fixture.id,points,diameterMm,sizeKnown:pipe.diameterMm!==null,levelsKnown,blocked:pipe.state==='blocked',shaftId:shaft?.id??null,connected,reason}
        if(!connected)issues.push(reason)
        if(!levelsKnown)issues.push('Branch height is illustrative; surveyed invert levels are missing.')
        if(pipe.diameterMm===null)issues.push('Pipe diameter is an illustrative envelope, not a verified size.')
      }else issues.push('No routed branch in the 2D design. Provide a reviewed service route in the 2D plan.')
      fixtures.push({key:`${floor.id}:${fixture.id}`,id:fixture.id,kind,roomId:room.id,roomName:room.name,floorId:floor.id,floorName:floor.name,level:floor.level,point,widthMm,depthMm,rotation:nearest.rotation,basis:source?.basis==='furnishing'?'Existing furnishing position':'Proposed fixture position',model,branch,issues})
    }
    for(const pipe of design.pipes.filter(p=>p.service==='building_drain'&&!p.vertical)){
      const known=!!design.input.datum&&design.input.floorElevationMm!==null&&pipe.inletInvertMm!==null&&pipe.outletInvertMm!==null
      const offset=floor.elevationMm-(design.input.floorElevationMm??0),diameter=pipe.diameterMm??pipe.candidateDiameterMm??110
      let length=0
      collectors.push({id:`${floor.id}:${pipe.id}`,diameterMm:diameter,blocked:pipe.state==='blocked',levelsKnown:known,points:pipe.path.map((p,i)=>{
        if(i)length+=Math.hypot(p.x-pipe.path[i-1].x,p.y-pipe.path[i-1].y)
        const z=known?offset+pipe.inletInvertMm!+(pipe.outletInvertMm!-pipe.inletInvertMm!)*(pipe.lengthMm?length/pipe.lengthMm:0)+diameter/2:floor.elevationMm-650
        return {...p,z}
      })})
    }
    for(const node of design.nodes.filter(n=>n.kind==='outlet'||n.kind==='inspection_chamber'))destinations.push({id:`${floor.id}:${node.id}`,point:{...node.position,z:node.elevationMm!==null&&design.input.datum&&design.input.floorElevationMm!==null?node.elevationMm+floor.elevationMm-design.input.floorElevationMm:floor.elevationMm-650},name:node.kind==='outlet'?`${design.input.outlet.kind} outlet · review`:'Inspection chamber · proposal'})
  }
  if(configuredDischarge)issues.push('Saved 2D outlet and collector routes replace the separate tank concept in this view. Complete multi-floor stack junction levels, disposal approval and component sizing remain for professional review.')
  return {fixtures,branches:fixtures.flatMap(f=>f.branch?[f.branch]:[]),collectors,destinations,configuredDischarge,issues}
}
export type FixtureDrainageScene=ReturnType<typeof fixtureDrainageScene>

/** Trace a physical route, not every room sharing a collector. */
export function fixtureTankTrace(fixture:DrainFixture3D|undefined,network:ConnectedDrainage,tankInlet:ServicePoint|undefined){
  if(!fixture?.branch?.connected||!tankInlet)return []
  const soil=network.layout.pipes.find(p=>p.id===`soil:${fixture.branch!.shaftId}`)
  if(!soil)return []
  const key=(p:ServicePoint)=>[p.x,p.y,p.z].map(v=>Math.round(v*100)/100).join(':')
  const start=fixture.branch.points.at(-1)!,goal=key(tankInlet),adj=new Map<string,{next:ServicePoint;segment:number}[]>()
  network.layout.segments.forEach((s,i)=>{for(const [a,b] of [[s.from,s.to],[s.to,s.from]]){const k=key(a);adj.set(k,[...(adj.get(k)??[]),{next:b,segment:i}])}})
  const queue=[key(start)],prev=new Map<string,{at:string;segment:number}>(),seen=new Set(queue)
  for(let i=0;i<queue.length&& !seen.has(goal);i++)for(const edge of adj.get(queue[i])??[]){const k=key(edge.next);if(!seen.has(k)){seen.add(k);prev.set(k,{at:queue[i],segment:edge.segment});queue.push(k)}}
  if(!seen.has(goal))return []
  const result:ServicePoint[][]=[];let at=goal
  while(prev.has(at)){const step=prev.get(at)!,s=network.layout.segments[step.segment];result.unshift(key(s.from)===step.at?[s.from,s.to]:[s.to,s.from]);at=step.at}
  return result
}

/** One canonical visible fixture outlet/trap path for rendering and joint QA. */
export function fixtureWasteConnection(f:DrainFixture3D):ServicePoint[]{
  if(f.wasteConnection)return f.wasteConnection
  const start=f.branch?.points[0];if(!start)return []
  const outlet=f.kind==='kitchen_sink'?720:f.kind==='washbasin'||f.kind==='unknown_sink'?650:f.kind==='washing_machine'?350:f.kind==='toilet'?180:20
  return ['washbasin','unknown_sink','kitchen_sink'].includes(f.kind)?[{...f.point,z:f.point.z+outlet},{...f.point,z:f.point.z+outlet-130},{...f.point,x:f.point.x+70,z:f.point.z+outlet-130},{...f.point,x:f.point.x+70,z:f.point.z+outlet-60},{...f.point,x:f.point.x+140,z:f.point.z+outlet-60},{...f.point,x:f.point.x+140,z:start.z},{...start,y:f.point.y},start]:[{...f.point,z:f.point.z+outlet},{...f.point,z:start.z},{...start,y:f.point.y},start].filter((p,i,all)=>!i||Math.hypot(p.x-all[i-1].x,p.y-all[i-1].y,p.z-all[i-1].z)>.01)
}

/** Keep the trap accessible, embed only its drop in a sufficiently thick
 * source wall, and meet the unchanged 2D underfloor branch at its real start.
 * 20 mm each side is a concept envelope, not permission to chase a wall. */
export function concealedFixtureWaste(f:DrainFixture3D,building:BuildingModel):ServicePoint[]{
  const source=fixtureWasteConnection(f),start=f.branch?.points[0]
  if(!start||!['washbasin','unknown_sink','kitchen_sink','washing_machine'].includes(f.kind))return source
  const diameter=Math.min(f.branch!.diameterMm,50),room=building.rooms.find(r=>r.floorId===f.floorId&&r.id===f.roomId)
  if(!room)return source
  const r=room.rect,candidates=building.walls.filter(w=>w.floorId===f.floorId&&w.thickness>=diameter+40).flatMap(w=>{
    const h=Math.abs(w.a.y-w.b.y)<1,v=Math.abs(w.a.x-w.b.x)<1
    if(!h&&!v)return []
    const along=h?f.point.x:f.point.y,lo=Math.min(h?w.a.x:w.a.y,h?w.b.x:w.b.y),hi=Math.max(h?w.a.x:w.a.y,h?w.b.x:w.b.y)
    const fixed=h?w.a.y:w.a.x,edge=h?Math.min(Math.abs(fixed-r.y),Math.abs(fixed-r.y-r.h)):Math.min(Math.abs(fixed-r.x),Math.abs(fixed-r.x-r.w))
    const point={...f.point,...(h?{y:fixed}:{x:fixed})},distance=Math.hypot(point.x-f.point.x,point.y-f.point.y)
    if(edge>150||along<lo+diameter||along>hi-diameter||distance>Math.max(f.widthMm,f.depthMm)/2+250)return []
    if(building.columns.some(c=>c.floorId===f.floorId&&segmentHitsRect(f.point,point,{x:c.at.x-c.size/2-diameter/2,y:c.at.y-c.size/2-diameter/2,w:c.size+diameter,h:c.size+diameter})))return []
    return [{point,distance}]
  }).sort((a,b)=>a.distance-b.distance)
  const wall=candidates[0];if(!wall||wall.distance<1)return source
  const outlet=source[0],drop=outlet.z-130,exit=outlet.z-60
  const at=(distance:number,z:number)=>({...outlet,x:outlet.x+(wall.point.x-outlet.x)*distance/wall.distance,y:outlet.y+(wall.point.y-outlet.y)*distance/wall.distance,z})
  const leg=Math.min(70,wall.distance/3)
  return [outlet,{...outlet,z:drop},at(leg,drop),at(leg,exit),at(wall.distance,exit),{...wall.point,z:start.z},start]
}
