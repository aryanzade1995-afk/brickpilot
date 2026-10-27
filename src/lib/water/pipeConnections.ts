import type {ServicePoint,VillaPipe,PipeSegment} from '../plumbing/villaPlumbing.ts'

export type PipeConnectionPart={id:string;point:ServicePoint;direction:ServicePoint;diameterMm:number;lengthMm:number;system:VillaPipe['system'];kind:'socket'|'cap'}
/** Exact pipe endpoints, not screen-space decorations. Rings are placed on
 * actual legs beyond elbow bend envelopes. Duplicate/shared legs draw once. */
export function pipeConnectionParts(runs:Pick<VillaPipe,'system'|'diameterMm'|'points'>[],segments:PipeSegment[]=[]){
  const key=(p:ServicePoint)=>[p.x,p.y,p.z].map(v=>Math.round(v*100)/100).join(':')
  const nodes=new Map<string,{point:ServicePoint;system:VillaPipe['system'];legs:Map<string,{dir:ServicePoint;diameter:number;length:number}>}>()
  const add=(a:ServicePoint,b:ServicePoint,diameter:number,system:VillaPipe['system'])=>{
    const length=Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z);if(length<.01)return
    const dir={x:(b.x-a.x)/length,y:(b.y-a.y)/length,z:(b.z-a.z)/length},id=`${system}:${key(a)}`,node=nodes.get(id)??{point:a,system,legs:new Map()}
    const legKey=[dir.x,dir.y,dir.z].map(v=>Math.round(v*1000)).join(':')
    const old=node.legs.get(legKey)
    node.legs.set(legKey,{dir,diameter:Math.max(diameter,old?.diameter??0),length:Math.min(length,old?.length??Infinity)});nodes.set(id,node)
  }
  for(const r of runs)for(let i=1;i<r.points.length;i++){add(r.points[i-1],r.points[i],r.diameterMm,r.system);add(r.points[i],r.points[i-1],r.diameterMm,r.system)}
  for(const s of segments){add(s.from,s.to,s.diameterMm,s.system);add(s.to,s.from,s.diameterMm,s.system)}
  const parts:PipeConnectionPart[]=[]
  for(const [id,n]of nodes)for(const [legId,leg]of n.legs){
    const cap=n.legs.size===1&&n.system==='water',offset=cap?0:Math.min(leg.diameter*1.5,leg.length*.38)
    if(n.legs.size<2&&!cap)continue
    parts.push({id:`${id}:${legId}`,point:{x:n.point.x+leg.dir.x*offset,y:n.point.y+leg.dir.y*offset,z:n.point.z+leg.dir.z*offset},direction:leg.dir,diameterMm:leg.diameter*1.25,lengthMm:cap?Math.min(12,leg.diameter*.3):Math.min(leg.diameter*.45,leg.length*.2),system:n.system,kind:cap?'cap':'socket'})
  }
  return parts
}
