import type {BuildingModel} from '../engine/buildingModel.ts'
import type {UtilityFloor} from '../utilities/plan.ts'
import {waterScene} from '../utilities/water3D.ts'
import {routeDrain,drainLength,segmentHitsRect} from '../utilities/drainage.ts'
import {perimeterRoutes} from '../utilities/routing.ts'
import {expandRect} from '../solar/regions.ts'
import {realizedTerraceObjects} from '../solar/terraceObjects.ts'
import {pipeCrossesStructure,type ServicePoint,type VillaPipe,type VillaPlumbing} from '../plumbing/villaPlumbing.ts'
import {pipeAssembly} from '../plumbing/assembly.ts'
import {drainNetworkSegments} from './drainageNetwork.ts'

const key=(p:ServicePoint)=>[p.x,p.y,p.z].map(v=>Math.round(v*100)/100).join(':')
const distance=(a:ServicePoint,b:ServicePoint)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)
const clean=(ps:ServicePoint[])=>ps.filter((p,i)=>!i||distance(p,ps[i-1])>.01)
const bridge=(a:ServicePoint,b:ServicePoint)=>clean([a,{...a,x:b.x},{...a,x:b.x,y:b.y},b])
export type SupplyFixture={id:string;key:string;floorId:string;roomId:string;point:ServicePoint;connected:boolean}

/** Place suitable wall runs on actual wall centre planes. Where embedding
 * would hit a represented column, retain the source service-side bypass.
 * Every concealed chase/threshold crossing remains an unapproved proposal. */
export function concealedWaterPath(points:ServicePoint[],model:UtilityFloor,diameterMm=25,preserveEnds=false){
  const snapped=points.map((p,i)=>{
    if(preserveEnds&&(i===0||i===points.length-1))return p
    const walls=model.floor.walls.flatMap(w=>{
      const h=Math.abs(w.a.y-w.b.y)<.01,v=Math.abs(w.a.x-w.b.x)<.01
      const d=h?Math.abs(p.y-w.a.y):Math.abs(p.x-w.a.x)
      const along=h?p.x:p.y,lo=Math.min(h?w.a.x:w.a.y,h?w.b.x:w.b.y),hi=Math.max(h?w.a.x:w.a.y,h?w.b.x:w.b.y)
      return (h||v)&&w.thickness>=diameterMm+40&&along>=lo&&along<=hi&&d<=w.thickness/2+65?[{p:{...p,...(h?{y:w.a.y}:{x:w.a.x})},d,h}]:[]
    }).sort((a,b)=>a.d-b.d)
    // Both centre planes are needed at a corner, not just the closest wall.
    const horizontal=walls.find(w=>w.h),vertical=walls.find(w=>!w.h)
    return {...p,...(horizontal?{y:horizontal.p.y}:{}),...(vertical?{x:vertical.p.x}:{})}
  })
  const result=clean(snapped.flatMap((p,i)=>i?bridge(snapped[i-1],p).slice(1):[p]))
  const columns=(model.floor.columns??[]).map(c=>expandRect({x:c.at.x-c.size/2,y:c.at.y-c.size/2,w:c.size,h:c.size},20))
  return result.some((p,i)=>i&&columns.some(r=>segmentHitsRect(result[i-1],p,r)))?points:result
}

/** Same cold-water drawing, one accepted-house transform, and one root-fed
 * network. Hot supply needs an actual heater and is deliberately separate. */
export function coordinateSupply(building:BuildingModel,source:VillaPlumbing,floors:UtilityFloor[]){
  const pipes=source.pipes.filter(p=>p.system==='water').map(p=>({...p,points:p.points.map(p=>({...p}))})),issues:string[]=[],fixtures:SupplyFixture[]=[],valves:ServicePoint[]=[]
  const top=building.floors.toSorted((a,b)=>a.elevationMm-b.elevationMm).at(-1)
  const roof=top?top.elevationMm+top.heightMm:0
  const roots=source.pipes.filter(p=>p.id.startsWith('tank-port:')).map(p=>p.points[0])
  if(!roots.length)issues.push('No recorded roof-tank outlet is available; no fixture is shown as supplied.')
  const bounds={x:150,y:150,w:building.plot.widthMm-300,h:building.plot.depthMm-300}
  const footprint=building.floors.flatMap(f=>f.footprint),margin=250
  const columns=building.columns.map(c=>expandRect({x:c.at.x-c.size/2,y:c.at.y-c.size/2,w:c.size,h:c.size},45))
  const clear=(points:ServicePoint[],radius:number)=>!pipeCrossesStructure({...building,walls:[]},points,radius)
  const pipe=(id:string,floorId:string,shaftId:string|null,diameterMm:number,points:ServicePoint[])=>({id,floorId,shaftId,diameterMm,points:clean(points),system:'water' as const,sizeBasis:'selected nominal' as const,purpose:'Proposed concealed cold-water connection; chases, sleeves and pressure require review'})
  // Feed orphan local risers via an exterior drop, below the local beam band.
  // The fallback has real endpoints at both ends, not floating riser stubs.
  for(const stub of pipes.filter(p=>p.id.startsWith('water-stub:'))){
    const f=building.floors.find(f=>f.id===stub.floorId);if(!f||!roots.length)continue
    const z=f.elevationMm+f.heightMm-Math.max(0,...building.beams.filter(b=>b.floorId===f.id).map(b=>b.depthMm??0))-200
    const end={...stub.points[0],z:Math.max(stub.points[0].z,Math.min(stub.points.at(-1)!.z,z))}
    const outside=[{x:Math.min(...footprint.map(r=>r.x))-margin,y:end.y},{x:Math.max(...footprint.map(r=>r.x+r.w))+margin,y:end.y},{x:end.x,y:Math.min(...footprint.map(r=>r.y))-margin},{x:end.x,y:Math.max(...footprint.map(r=>r.y+r.h))+margin}].filter(p=>p.x>bounds.x&&p.y>bounds.y&&p.x<bounds.x+bounds.w&&p.y<bounds.y+bounds.h)
    const starts=source.pipes.filter(p=>p.system==='water'&&!p.id.startsWith('water-stub:')).flatMap(p=>p.points).filter(p=>p.z>=roof+100&&p.z<roof+400)
    const roofCuts=realizedTerraceObjects(building).map(o=>expandRect(o.rectMm,40))
    const routes=outside.flatMap(out=>starts.flatMap(start=>{
      const upper=routeDrain(start,out,roofCuts,bounds),lower=routeDrain(out,end,columns,bounds)
      if(!upper||!lower)return []
      const ps=clean([...upper.map(p=>({...p,z:start.z})),{...out,z:end.z},...lower.slice(1).map(p=>({...p,z:end.z}))])
      return clear(ps,stub.diameterMm/2)?[{points:ps,length:drainLength(upper)+drainLength(lower)+start.z-end.z}]:[]
    })).sort((a,b)=>a.length-b.length)
    if(routes[0])pipes.push(pipe(`water:external-feed:${stub.shaftId}`,f.id,stub.shaftId,stub.diameterMm,routes[0].points))
    else issues.push(`${stub.id}: no exterior feed clears represented slabs, beams and columns.`)
  }
  for(const model of floors){
    const floor=building.floors.find(f=>f.level===model.floor.level);if(!floor)continue
    const scene=waterScene(model,'all','all',false),network=model.waterNetworks.find(n=>n.service==='cold')
    if(!network)continue
    const convert=(p:[number,number,number])=>({x:p[0]*1000,y:p[2]*1000,z:floor.elevationMm+p[1]*1000})
    for(const run of scene.pipes){
      const points=concealedWaterPath(run.points.map(convert),model,run.diameter)
      pipes.push(pipe(`water:drawing:${floor.id}:${run.id}`,floor.id,null,run.diameter,points))
    }
    for(const inlet of scene.nodes.filter(n=>n.type==='supply_inlet'&&n.world)){
      const point=concealedWaterPath([convert(inlet.world!)],model)[0]
      const risers=pipes.filter(p=>p.floorId===floor.id&&(p.id.startsWith('supply:')||p.id.startsWith('water-stub:'))).sort((a,b)=>{
        const sa=building.shafts.find(s=>s.id===a.shaftId),sb=building.shafts.find(s=>s.id===b.shaftId)
        return Number(sb?.roomId===inlet.roomId)-Number(sa?.roomId===inlet.roomId)||Math.hypot(a.points.at(-1)!.x-point.x,a.points.at(-1)!.y-point.y)-Math.hypot(b.points.at(-1)!.x-point.x,b.points.at(-1)!.y-point.y)
      })
      const riser=risers[0],room=model.floor.rooms.find(r=>r.id===inlet.roomId)
      if(!riser||!room){issues.push(`${inlet.id}: a recorded supply riser is missing.`);continue}
      const upper=riser.points.reduce((a,b)=>a.z>b.z?a:b),end={...riser.points.at(-1)!,z:Math.max(floor.elevationMm+100,Math.min(upper.z,point.z))}
      const roomColumns=(model.floor.columns??[]).map(c=>expandRect({x:c.at.x-c.size/2,y:c.at.y-c.size/2,w:c.size,h:c.size},network.riserDiameterMm/2+20))
      const candidates=perimeterRoutes(end,point,room.rect).filter(ps=>!ps.some((p,i)=>i&&roomColumns.some(r=>segmentHitsRect(ps[i-1],p,r))))
      const path=candidates.sort((a,b)=>drainLength(a)-drainLength(b))[0]??routeDrain(end,point,roomColumns,bounds)
      if(!path){issues.push(`${inlet.id}: no local feeder around columns.`);continue}
      const feed=clean([...path.map(p=>({...p,z:end.z})),point])
      const concealed=concealedWaterPath(feed,model,network.riserDiameterMm,true)
      pipes.push(pipe(`water:floor-feed:${floor.id}`,floor.id,riser.shaftId,network.riserDiameterMm,clear(concealed,network.riserDiameterMm/2)?concealed:feed))
    }
    for(const n of scene.nodes.filter(n=>n.type==='isolation_valve'&&n.world))valves.push(concealedWaterPath([convert(n.world!)],model)[0])
    for(const f of scene.fixtures){
      const last=scene.pipes.find(p=>p.id.endsWith(`${scene.nodes.find(n=>n.fixtureId===f.id)?.id}:fixture`))??scene.pipes.find(p=>p.id===`${scene.nodes.find(n=>n.fixtureId===f.id)?.id}:shower`)
      const node=scene.nodes.find(n=>n.fixtureId===f.id&&n.world),height=f.type==='toilet'?550:f.type==='washing_machine'?600:f.type==='shower'?2100:f.type==='bathtub'?550:700
      const point={...f.position,z:floor.elevationMm+height}
      if(last){const end=concealedWaterPath(last.points.map(convert),model).at(-1)!;pipes.push(pipe(`water:fixture-tail:${floor.id}:${f.id}`,floor.id,null,network.branchDiameterMm,bridge(end,point)))}
      else if(node?.world){const end=concealedWaterPath([convert(node.world)],model)[0];pipes.push(pipe(`water:fixture-tail:${floor.id}:${f.id}`,floor.id,null,network.branchDiameterMm,bridge(end,point)))}
      fixtures.push({id:f.id,key:`${floor.id}:${f.id}`,floorId:floor.id,roomId:f.roomId,point,connected:false})
    }
    issues.push(...network.unroutedFixtures.map(id=>`${floor.name}: ${id} has no connected cold-water route in the 2D drawing; manual design review is needed.`))
    issues.push(...scene.pending.map(id=>`${floor.name}: ${id} needs a reviewed water route.`))
  }
  const segments=drainNetworkSegments(pipes,fixtures.map(f=>f.point)),adj=new Map<string,Set<string>>()
  for(const s of segments){const a=key(s.from),b=key(s.to);adj.set(a,new Set([...(adj.get(a)??[]),b]));adj.set(b,new Set([...(adj.get(b)??[]),a]))}
  const reached=new Set<string>(),queue=roots.map(key)
  for(let i=0;i<queue.length;i++){if(reached.has(queue[i]))continue;reached.add(queue[i]);for(const n of adj.get(queue[i])??[])if(!reached.has(n))queue.push(n)}
  for(const f of fixtures)f.connected=reached.has(key(f.point))
  const connected=pipes.filter(p=>p.points.every(p=>reached.has(key(p)))),pending=pipes.filter(p=>!connected.includes(p))
  const compile=(ps:VillaPipe[]):VillaPlumbing=>{const segments=drainNetworkSegments(ps,fixtures.map(f=>f.point));let hash=2166136261;for(const ch of JSON.stringify(ps.map(p=>[p.id,p.points])))hash=Math.imul(hash^ch.charCodeAt(0),16777619);return {...source,pipes:ps,segments,assembly:pipeAssembly(segments),signature:`supply-concept:${source.planId}:${(hash>>>0).toString(16)}`}}
  if(pipes.some(p=>p.id.startsWith('water:external-feed:')))issues.push('Exterior feeds need reviewed wall sleeves and supports; they do not create openings in the accepted building.')
  issues.push('Concealed wall chases and threshold/slab connections are proposals. Pressure, pipe sizing, structure, waterproofing and hot-water equipment require professional review.')
  return {layout:compile(connected),pendingLayout:compile(pending),fixtures,valves,roots,issues}
}
export type SupplyNetwork=ReturnType<typeof coordinateSupply>

export function supplyFixtureTrace(network:SupplyNetwork,fixture:SupplyFixture|undefined){
  if(!fixture?.connected)return []
  const adj=new Map<string,{point:ServicePoint;from:ServicePoint}[]>()
  for(const s of network.layout.segments)for(const [from,to]of [[s.from,s.to],[s.to,s.from]])adj.set(key(from),[...(adj.get(key(from))??[]),{point:to,from}])
  const queue=network.roots.map(key),seen=new Set(queue),prev=new Map<string,{point:ServicePoint;from:ServicePoint}>(),goal=key(fixture.point)
  for(let i=0;i<queue.length&&!seen.has(goal);i++)for(const edge of adj.get(queue[i])??[]){const k=key(edge.point);if(!seen.has(k)){seen.add(k);prev.set(k,edge);queue.push(k)}}
  if(!seen.has(goal))return []
  const path:ServicePoint[][]=[];let at=goal
  while(prev.has(at)){const e=prev.get(at)!;path.unshift([e.from,e.point]);at=key(e.from)}
  return path
}
