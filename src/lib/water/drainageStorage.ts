import type {BuildingModel} from '../engine/buildingModel.ts'
import type {Rect} from '../geometry.ts'
import {expandRect} from '../solar/regions.ts'
import {pipeCrossesStructure,plumbingSegments,type ServicePoint,type VillaPlumbing,type VillaPipe} from '../plumbing/villaPlumbing.ts'
import {routeDrain,drainLength} from '../utilities/drainage.ts'

export type DrainStorage={version:1;tank:{id:string;rect:Rect;center:ServicePoint;lengthMm:number;widthMm:number;depthMm:number;topMm:number;alongX:boolean;inlet:ServicePoint;outlet:ServicePoint}|null;layout:VillaPlumbing;reducers:{at:ServicePoint;fromMm:number;toMm:number}[];linkedStacks:string[];issues:string[];status:'concept-review-required'}
/** Tank local axes: +X towards outlet, +Y up, +Z towards cutaway front; metres. */
export function drainTankLocalPorts(tank:NonNullable<DrainStorage['tank']>) {
  const local=(p:ServicePoint)=>({x:(tank.alongX?p.x-tank.center.x:p.y-tank.center.y)/1000,y:(p.z-tank.topMm)/1000,z:(tank.alongX?-(p.y-tank.center.y):p.x-tank.center.x)/1000})
  return {inlet:local(tank.inlet),outlet:local(tank.outlet)}
}
const overlap=(a:Rect,b:Rect)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y
/** Underground visual coordination only. No capacity, slope, foundation clearance,
 * treatment approval or final effluent-disposal design is inferred. */
export function proposeDrainStorage(building:BuildingModel,home:VillaPlumbing,exclude:Rect[]=[]):DrainStorage {
  const empty:VillaPlumbing={...home,pipes:[],segments:[],assembly:undefined,tankPorts:[],signature:`drain-storage:${building.planId}`}
  const result:DrainStorage={version:1,tank:null,layout:empty,reducers:[],linkedStacks:[],issues:[],status:'concept-review-required'}
  const ground=[...building.floors].sort((a,b)=>a.elevationMm-b.elevationMm)[0]
  if(!ground){result.issues.push('Source ground floor unavailable.');return result}
  const stacks=home.pipes.filter(p=>p.system==='drain'&&p.floorId===ground.id&&p.id.startsWith('soil:'))
  if(!stacks.length){result.issues.push('No represented ground-floor drain stacks can connect to storage.');return result}
  const rampCuts=building.entryRamp?.status==='ready'?[...building.entryRamp.landings.map(l=>l.rect),...building.entryRamp.flights.map(f=>f.rect)]:[]
  const placementCuts=[...building.floors.flatMap(f=>f.footprint.map(r=>expandRect(r,750))),...building.floors.flatMap(f=>f.courtyard?[f.courtyard]:[]),...(building.siteFeatures??[]).filter(f=>!['lawn','utilityYard'].includes(f.kind)).map(f=>expandRect(f.rect,200)),...exclude.map(r=>expandRect(r,400)),...rampCuts.map(r=>expandRect(r,200))]
  const bases=stacks.map(p=>p.points.reduce((a,b)=>a.z<b.z?a:b)),mean={x:bases.reduce((n,p)=>n+p.x,0)/bases.length,y:bases.reduce((n,p)=>n+p.y,0)/bases.length}
  const candidates:Rect[]=[]
  for(const [w,h]of [[3000,1600],[1600,3000]])for(let x=400;x+w<=building.plot.widthMm-400;x+=400)for(let y=400;y+h<=building.plot.depthMm-400;y+=400){const r={x,y,w,h};if((w>=h?x:y)>=500&&!placementCuts.some(c=>overlap(r,c)))candidates.push(r)}
  candidates.sort((a,b)=>Math.hypot(a.x+a.w/2-mean.x,a.y+a.h/2-mean.y)-Math.hypot(b.x+b.w/2-mean.x,b.y+b.h/2-mean.y)||a.x-b.x||a.y-b.y)
  const rect=candidates[0]
  if(!rect){result.issues.push('No clear, accessible site area fits the underground tank concept outside the building and reserved areas.');return result}
  const alongX=rect.w>=rect.h,topMm=-120,depthMm=1800,center={x:rect.x+rect.w/2,y:rect.y+rect.h/2,z:topMm-depthMm/2}
  const inlet={x:alongX?rect.x:center.x,y:alongX?center.y:rect.y,z:-650},outlet={x:alongX?rect.x+rect.w:center.x,y:alongX?center.y:rect.y+rect.h,z:-750}
  const junction={...inlet,x:inlet.x-(alongX?350:0),y:inlet.y-(alongX?0:350)}
  result.tank={id:'drain:storage',rect,center,lengthMm:3000,widthMm:1600,depthMm,topMm,alongX,inlet,outlet}
  const routeCuts=[...building.columns.filter(c=>c.floorId===ground.id).map(c=>expandRect({x:c.at.x-c.size/2,y:c.at.y-c.size/2,w:c.size,h:c.size},60)),...(building.siteFeatures??[]).filter(f=>['pool'].includes(f.kind)).map(f=>expandRect(f.rect,150)),...exclude.map(r=>expandRect(r,150))]
  const collectorMm=Math.max(...stacks.map(p=>p.diameterMm))
  const pipes:VillaPipe[]=[],bounds={x:150,y:150,w:building.plot.widthMm-300,h:building.plot.depthMm-300}
  for(let i=0;i<stacks.length;i++){
    const source=stacks[i],base=bases[i]
    const local={x:Math.max(bounds.x,Math.min(base.x,junction.x)-1200),y:Math.max(bounds.y,Math.min(base.y,junction.y)-1200),w:0,h:0}
    local.w=Math.min(bounds.x+bounds.w,Math.max(base.x,junction.x)+1200)-local.x;local.h=Math.min(bounds.y+bounds.h,Math.max(base.y,junction.y)+1200)-local.y
    const path=routeDrain(base,junction,routeCuts.filter(r=>overlap(r,local)),local)??routeDrain(base,junction,routeCuts,bounds)
    const points=path?[base,{...base,z:inlet.z},...path.slice(1).map(p=>({...p,z:inlet.z}))]:[]
    const blocked=points.length?pipeCrossesStructure(building,points,collectorMm/2):'No route around represented obstructions'
    if(blocked){result.issues.push(`${source.id}: ${blocked}; connection not drawn.`);continue}
    if(drainLength(path!)>80000){result.issues.push(`${source.id}: proposed collector is too long for this preview.`);continue}
    pipes.push({...source,diameterMm:collectorMm,id:`drain:collector:${source.id}`,purpose:'Proposed underground collector; sizing, invert, gradient and foundation review required',points})
    if(source.diameterMm!==collectorMm)result.reducers.push({at:base,fromMm:source.diameterMm,toMm:collectorMm})
    result.linkedStacks.push(source.id)
  }
  if(pipes.length){
    const inletPipe:VillaPipe={...pipes[0],id:'drain:tank-inlet',shaftId:null,purpose:'Common collector tee and tank inlet connection',points:[junction,inlet]}
    const blocked=pipeCrossesStructure(building,inletPipe.points,collectorMm/2)
    if(blocked){result.issues.push(`Tank inlet connection blocked by ${blocked}.`);pipes.length=0;result.linkedStacks=[];result.reducers=[]}
    else pipes.push(inletPipe)
  }
  result.layout={...empty,pipes,segments:plumbingSegments({pipes})}
  result.issues.push('Illustrative RCC two-chamber septic tank, not a sized or approved drainage design. Confirm whether this property needs a septic system or a public-sewer connection.', 'Collector elevation is a visual coordination assumption. Surveyed inverts, gradient, foundations, groundwater, access and separation from water sources need professional review.', 'The common collector uses the largest selected stack diameter as a visual envelope, with reducers at smaller stacks. Discharge-based sizing is not verified.', 'Tank vent continuation to a safe roof-level terminal requires design; the tank connection stub is not an approved vent terminal.', 'Effluent outlet is intentionally unconnected: treatment and approved final disposal are not established. Roof rainwater remains separate.')
  return result
}
