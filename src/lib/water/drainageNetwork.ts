import type {BuildingModel} from '../engine/buildingModel.ts'
import {pipeAssembly} from '../plumbing/assembly.ts'
import {plumbingSegments,type PipeSegment,type ServicePoint,type VillaPipe,type VillaPlumbing} from '../plumbing/villaPlumbing.ts'
import type {DrainStorage} from './drainageStorage.ts'

const axes=['x','y','z'] as const
const key=(p:ServicePoint)=>axes.map(a=>Math.round(p[a]*100)/100).join(':')
const axis=(s:PipeSegment)=>axes.find(a=>Math.abs(s.from[a]-s.to[a])>.01)
const on=(p:ServicePoint,s:PipeSegment)=>axes.every(a=>p[a]>=Math.min(s.from[a],s.to[a])-.01&&p[a]<=Math.max(s.from[a],s.to[a])+.01)

/** Split at real endpoints AND mid-run intersections so fitting nodes and the
 * connectivity graph agree. Parallel overlaps are already unioned by size. */
export function drainNetworkSegments(pipes:VillaPipe[],ports:ServicePoint[]=[]) {
  const spans=plumbingSegments({pipes}),points=[...pipes.flatMap(p=>p.points),...ports]
  for(let i=0;i<spans.length;i++)for(let j=i+1;j<spans.length;j++){
    const a=spans[i],b=spans[j],aa=axis(a),bb=axis(b)
    if(!aa||!bb||aa===bb)continue
    const p={...a.from,[aa]:b.from[aa]}
    if(on(p,a)&&on(p,b))points.push(p)
  }
  return spans.flatMap(s=>{
    const a=axis(s);if(!a)return []
    const cuts=[...new Set(points.filter(p=>on(p,s)).map(p=>p[a]))].sort((a,b)=>a-b)
    return cuts.slice(1).flatMap((v,i)=>v-cuts[i]>.01?[{...s,from:{...s.from,[a]:cuts[i]},to:{...s.to,[a]:v}}]:[])
  })
}

export function connectedDrainageNetwork(building:BuildingModel,home:VillaPlumbing,storage:DrainStorage,ports:ServicePoint[]=[]) {
  const pipes=[...home.pipes.filter(p=>p.system!=='water'),...storage.layout.pipes],segments=drainNetworkSegments(pipes,ports),adj=new Map<string,Set<string>>()
  for(const s of segments){const a=key(s.from),b=key(s.to);if(!adj.has(a))adj.set(a,new Set());if(!adj.has(b))adj.set(b,new Set());adj.get(a)!.add(b);adj.get(b)!.add(a)}
  const reachable=new Set<string>(),queue=storage.tank?[key(storage.tank.inlet)]:[]
  for(let i=0;i<queue.length;i++){const at=queue[i];if(reachable.has(at))continue;reachable.add(at);for(const next of adj.get(at)??[])if(!reachable.has(next))queue.push(next)}
  const connected=pipes.filter(p=>p.points.every(p=>reachable.has(key(p)))),pending=pipes.filter(p=>!connected.includes(p))
  const rendered=drainNetworkSegments(connected,ports)
  let identity=2166136261
  for(const ch of JSON.stringify([connected.map(p=>[p.id,p.diameterMm,p.points]),ports]))identity=Math.imul(identity^ch.charCodeAt(0),16777619)
  const layout:VillaPlumbing={...storage.layout,pipes:connected,segments:rendered,assembly:pipeAssembly(rendered),signature:`connected-drain:${building.planId}:${(identity>>>0).toString(16)}`}
  const pendingStacks=pending.filter(p=>p.id.startsWith('soil:'))
  const labels=home.pipes.filter(p=>p.id.startsWith('soil:')).map(pipe=>{
    const shaft=building.shafts.find(s=>s.id===pipe.shaftId),room=building.rooms.find(r=>r.floorId===pipe.floorId&&r.id===shaft?.roomId)
    const a=pipe.points[0],b=pipe.points.at(-1)!,waiting=pending.includes(pipe)
    return {id:pipe.id,point:{x:a.x,y:a.y,z:(a.z+b.z)/2},name:`${room?.name??'Drain stack'}${waiting?' · continuation needed':''}`,pending:waiting}
  })
  return {layout,pending,pendingStacks,labels,issues:pendingStacks.map(p=>`${p.id}: no continuous represented route to the tank. A reviewed service opening or bypass is needed; this run is dashed and not animated.`)}
}
export type ConnectedDrainage=ReturnType<typeof connectedDrainageNetwork>

/** Fit the entire house, vents and underground tank, including narrow screens. */
export function drainageOverviewPose(building:BuildingModel,storage:DrainStorage|undefined,fovDeg:number,aspect:number) {
  const width=building.plot.widthMm/1000,depth=building.plot.depthMm/1000
  const bottom=storage?.tank?(storage.tank.topMm-storage.tank.depthMm)/1000:0
  const top=Math.max(0,...building.floors.map(f=>(f.elevationMm+f.heightMm)/1000))+3
  const target:[number,number,number]=[width/2,(bottom+top)/2,-depth/2]
  const norm=Math.hypot(1,.65,-1),direction=[1/norm,.65/norm,-1/norm]
  const right=[-Math.SQRT1_2,0,-Math.SQRT1_2]
  const up=[direction[1]*right[2],direction[2]*right[0]-direction[0]*right[2],-direction[1]*right[0]]
  const tanV=Math.tan(fovDeg*Math.PI/360),tanH=tanV*Math.max(.1,aspect)
  let distance=1
  for(const x of [-width/2,width/2])for(const y of [-(top-bottom)/2,(top-bottom)/2])for(const z of [-depth/2,depth/2]){
    const near=x*direction[0]+y*direction[1]+z*direction[2]
    const horizontal=Math.abs(x*right[0]+z*right[2]),vertical=Math.abs(x*up[0]+y*up[1]+z*up[2])
    distance=Math.max(distance,near+Math.max(horizontal/tanH,vertical/tanV)*1.12+.25)
  }
  const position:[number,number,number]=[target[0]+distance*direction[0],target[1]+distance*direction[1],target[2]+distance*direction[2]]
  return {target,position,bottom,top}
}
