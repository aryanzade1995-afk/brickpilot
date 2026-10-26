import type { PipeSegment, ServicePoint, VillaPipe } from './villaPlumbing.ts'

export type PipeFitting = { id: string; kind: 'elbow' | 'tee' | 'coupler'; system: VillaPipe['system']; diameterMm: number; position: ServicePoint; basis: [ServicePoint,ServicePoint,ServicePoint] }
export type PipeAssembly = { version: 'pipe-kit-v1'; source: 'polyhaven-modular-pipes'; tubes: PipeSegment[]; fittings: PipeFitting[] }
const axes = ['x','y','z'] as const
const add=(a:ServicePoint,b:ServicePoint,s=1):ServicePoint=>({x:a.x+b.x*s,y:a.y+b.y*s,z:a.z+b.z*s})
const sub=(a:ServicePoint,b:ServicePoint):ServicePoint=>add(a,b,-1)
const dot=(a:ServicePoint,b:ServicePoint)=>a.x*b.x+a.y*b.y+a.z*b.z
const cross=(a:ServicePoint,b:ServicePoint):ServicePoint=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x})
const length=(a:ServicePoint)=>Math.hypot(a.x,a.y,a.z)
const unit=(a:ServicePoint)=>{const n=length(a);return {x:a.x/n,y:a.y/n,z:a.z/n}}
const key=(p:ServicePoint,system:string)=>JSON.stringify([system,...axes.map(a=>Math.round(p[a]*1000)/1000)])
const frame=(x:ServicePoint,z:ServicePoint):PipeFitting['basis']=>[x,cross(z,x),z]
const along=(z:ServicePoint)=>frame(Math.abs(z.z)<.9?unit(cross({x:0,y:0,z:1},z)):{x:1,y:0,z:0},z)

/** Presentation assembly only. Split existing canonical runs at real junctions;
 * never reroute a service or infer a new tank/discharge connection. Native CC0
 * part ports lie one diameter away from their intersection, so tubes terminate
 * at those ports rather than passing through the elbows/tees. */
export function pipeAssembly(segments: PipeSegment[]): PipeAssembly {
  const points=segments.flatMap(s=>[s.from,s.to]), edges:PipeSegment[]=[]
  for(const s of segments){
    const delta=sub(s.to,s.from),n=length(delta);if(n<.01)continue
    const axis=axes.find(a=>Math.abs(delta[a])>.01)!,fixed=axes.filter(a=>a!==axis)
    const stops=[...new Set(points.filter(p=>fixed.every(a=>Math.abs(p[a]-s.from[a])<.01)&&p[axis]>=Math.min(s.from[axis],s.to[axis])-.01&&p[axis]<=Math.max(s.from[axis],s.to[axis])+.01).map(p=>p[axis]))].sort((a,b)=>a-b)
    for(let i=1;i<stops.length;i++)if(stops[i]-stops[i-1]>.01)edges.push({...s,from:{...s.from,[axis]:stops[i-1]},to:{...s.from,[axis]:stops[i]}})
  }
  const nodes=new Map<string,{p:ServicePoint;system:VillaPipe['system'];legs:{edge:number;dir:ServicePoint;diameter:number;length:number}[]}>()
  edges.forEach((e,i)=>{for(const [a,b]of [[e.from,e.to],[e.to,e.from]]){const k=key(a,e.system),node=nodes.get(k)??{p:a,system:e.system,legs:[]};node.legs.push({edge:i,dir:unit(sub(b,a)),diameter:e.diameterMm,length:length(sub(b,a))});nodes.set(k,node)}})
  const fittings:PipeFitting[]=[],trim=new Map<string,number>()
  const part=(kind:PipeFitting['kind'],node:{p:ServicePoint;system:VillaPipe['system']},diameter:number,basis:PipeFitting['basis'],p=node.p)=>fittings.push({id:`${kind}:${fittings.length}`,kind,system:node.system,position:p,diameterMm:diameter,basis})
  for(const node of nodes.values()){
    const legs=node.legs,D=Math.max(...legs.map(l=>l.diameter)),same=legs.every(l=>Math.abs(l.diameter-D)<.01),fit=same&&legs.every(l=>l.length>D*2.25)
    let joined=false
    if(fit&&legs.length===2&&Math.abs(dot(legs[0].dir,legs[1].dir))<.01){
      part('elbow',node,D,frame(legs[0].dir,add({x:0,y:0,z:0},legs[1].dir,-1)));joined=true
    }else if(fit&&legs.length===3){
      const pair=legs.flatMap((a,i)=>legs.slice(i+1).map(b=>[a,b])).find(([a,b])=>dot(a.dir,b.dir)<-.99)
      const branch=pair&&legs.find(l=>!pair.includes(l))
      if(pair&&branch){part('tee',node,D,frame(pair[0].dir,add({x:0,y:0,z:0},branch.dir,-1)));joined=true}
    }
    for(const leg of legs){
      if(joined)trim.set(`${leg.edge}:${key(node.p,node.system)}`,D)
      const p=add(node.p,leg.dir,joined?D:Math.min(leg.length/4,leg.diameter*.3))
      part('coupler',node,leg.diameter*1.06,along(leg.dir),p)
    }
  }
  const tubes=edges.flatMap((e,i)=>{
    const dir=unit(sub(e.to,e.from)),from=add(e.from,dir,trim.get(`${i}:${key(e.from,e.system)}`)??0),to=add(e.to,dir,-(trim.get(`${i}:${key(e.to,e.system)}`)??0))
    return length(sub(to,from))>.01?[{...e,from,to}]:[]
  })
  return {version:'pipe-kit-v1',source:'polyhaven-modular-pipes',tubes,fittings}
}
