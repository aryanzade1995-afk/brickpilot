import type {BuildingModel} from '../engine/buildingModel.ts'
import type {Rect} from '../geometry.ts'
import type {ServicePoint,VillaPipe,VillaPlumbing} from '../plumbing/villaPlumbing.ts'
import {PLUMBING_CONCEPT,pipeCrossesStructure} from '../plumbing/villaPlumbing.ts'
import {routeDrain,drainLength} from '../utilities/drainage.ts'
import {expandRect} from '../solar/regions.ts'
import {segmentDistance} from '../utilities/clashGeometry.ts'
import {connectedDrainageNetwork} from './drainageNetwork.ts'
import type {DrainStorage} from './drainageStorage.ts'
import type {FixtureDrainageScene} from './fixtureDrainage.ts'

export type DrainageOpening={id:string;point:ServicePoint;kind:'wall-sleeve'|'fixture-drop'|'slab-sleeve';axis:'x'|'y'|'z';reason:string}
const distance=(a:ServicePoint,b:ServicePoint)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)
const clean=(ps:ServicePoint[])=>ps.filter((p,i)=>!i||distance(p,ps[i-1])>.01)

/** Continuous coordination proposal, not installation approval. Unknown pipe
 * levels use a declared underfloor service band below represented beams. No
 * building mesh, source opening or user-entered invert is changed. New wall
 * sleeves / fixture drops are explicitly listed, never treated as existing. */
export function coordinateDrainageContinuity(building:BuildingModel,home:VillaPlumbing,storage:DrainStorage,original:FixtureDrainageScene){
  const scene=structuredClone(original),pipes=[...home.pipes],openings:DrainageOpening[]=[],issues:string[]=[]
  if(scene.configuredDischarge||!storage.tank){
    for(const f of scene.fixtures)if(f.branch){f.branch.connected=false;f.branch.reason=scene.configuredDischarge?'Saved discharge routes are used instead of this tank proposal.':'No supported tank inlet is available.'}
    scene.branches=scene.fixtures.flatMap(f=>f.branch?[f.branch]:[])
    return {scene,network:connectedDrainageNetwork(building,home,storage),openings,issues}
  }
  const tank=storage.tank,ground=building.floors.toSorted((a,b)=>a.elevationMm-b.elevationMm)[0]
  const footprint=building.floors.flatMap(f=>f.footprint)
  const bounds={x:150,y:150,w:building.plot.widthMm-300,h:building.plot.depthMm-300}
  const junction=storage.layout.pipes.find(p=>p.id==='drain:tank-inlet')?.points[0]
  const add=(source:VillaPipe,id:string,points:ServicePoint[])=>{const pipe={...source,id,points:clean(points),purpose:'Continuous drainage coordination proposal; new openings and levels require review'};if(pipe.points.length>1)pipes.push(pipe)}
  const solidConflict=(points:ServicePoint[],radius:number)=>pipeCrossesStructure({...building,walls:[]},points,radius)
  const wallReviews=(id:string,points:ServicePoint[],radius:number)=>{
    for(const wall of building.walls){const f=building.floors.find(f=>f.id===wall.floorId);if(!f)continue
      for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i]
        if(Math.max(a.z,b.z)+radius<f.elevationMm||Math.min(a.z,b.z)-radius>f.elevationMm+f.heightMm)continue
        const hit=segmentDistance([a.x,a.y,0],[b.x,b.y,0],[wall.a.x,wall.a.y,0],[wall.b.x,wall.b.y,0])
        if(hit.distance<wall.thickness/2+radius){
          const {x,y}=hit.position
          openings.push({id:`${id}:sleeve:${wall.id}:${i}`,kind:'wall-sleeve',axis:Math.abs(wall.a.x-wall.b.x)<1?'x':'y',point:{x,y,z:(a.z+b.z)/2},reason:`Proposed service sleeve at ${f.name}, wall ${wall.id}. Structural permission is not established.`})
        }
      }
    }
  }
  const branchEntries=new Map<string,ServicePoint[]>()
  for(const f of scene.fixtures){
    const branch=f.branch,floor=building.floors.find(p=>p.id===f.floorId)
    if(!branch||!floor||branch.stackAligned===false)continue
    const soil=pipes.find(p=>p.id===`soil:${branch.shaftId}`)
    if(!soil){branch.connected=false;branch.reason='No compatible recorded stack exists for this fixture.';continue}
    const originalEnd=branch.points.at(-1)!
    const expected=soil.points[0]
    if(Math.hypot(originalEnd.x-expected.x,originalEnd.y-expected.y)>1){branch.connected=false;branch.reason='Saved stack position differs from the house shaft; review the stack location.';continue}
    const lower=building.floors.find(p=>p.level===floor.level-1)
    const beamDepth=lower?Math.max(0,...building.beams.filter(b=>b.floorId===lower.id).map(b=>b.depthMm??0)):0
    const depth=Math.max(250,(floor.slabThicknessMm??125)+branch.diameterMm/2+50,beamDepth+branch.diameterMm/2+75)
    if(!branch.levelsKnown)branch.points=clean(branch.points.map(p=>({...p,z:floor.elevationMm-depth})))
    const end=branch.points.at(-1)!
    // Do not reverse an entered fall, or lift a branch to a higher collector.
    if(branch.points[0].z<end.z-.01||end.z<tank.inlet.z-.01){branch.connected=false;branch.blocked=true;branch.reason='Entered branch levels cannot fall to this tank inlet; redesign or a reviewed pump arrangement is needed.';continue}
    const blocked=solidConflict(branch.points,branch.diameterMm/2)
    if(blocked){branch.connected=false;branch.blocked=true;branch.reason=`The proposed branch still meets ${blocked}; no structural cut was made.`;continue}
    branch.blocked=false
    branch.proposalReview=true
    branch.reason='Continuous proposed route to the tank. Fixture drops, wall sleeves, foundation clearance, pipe sizing and surveyed falls require review.'
    branchEntries.set(soil.id,[...(branchEntries.get(soil.id)??[]),end])
    wallReviews(branch.id,branch.points,branch.diameterMm/2)
    openings.push({id:`${f.key}:drop`,point:f.point,kind:'fixture-drop',axis:'z',reason:'Proposed fixture-to-underfloor connection. Slab sleeve, waterproofing and foundation clearance require review.'})
  }
  let network=connectedDrainageNetwork(building,{...home,pipes},storage)
  for(const [id,entries]of branchEntries){
    const soil=pipes.find(p=>p.id===id)!,base=soil.points.reduce((a,b)=>a.z<b.z?a:b),low=entries.reduce((a,b)=>a.z<b.z?a:b)
    // Existing ground collector already extends through the branch plane. Upper
    // stacks need a real downward extension, never an upward fixture elbow.
    if(low.z<base.z&&soil.floorId!==ground.id){
      const ps=[base,low],blocked=solidConflict(ps,soil.diameterMm/2)
      if(blocked){issues.push(`${id}: ${blocked}; downward extension cannot be proposed without redesign.`);continue}
      add(soil,`drain:extension:${soil.shaftId}`,ps);wallReviews(id,ps,soil.diameterMm/2)
    }
    if(network.layout.pipes.some(p=>p.id===id))continue
    if(!junction){issues.push(`${id}: tank collector junction is missing.`);continue}
    const start=low.z<base.z?low:base,radius=soil.diameterMm/2
    const margin=200+radius,minX=Math.min(...footprint.map(r=>r.x))-margin,maxX=Math.max(...footprint.map(r=>r.x+r.w))+margin,minY=Math.min(...footprint.map(r=>r.y))-margin,maxY=Math.max(...footprint.map(r=>r.y+r.h))+margin
    const candidates=[{x:minX,y:start.y},{x:maxX,y:start.y},{x:start.x,y:minY},{x:start.x,y:maxY}].filter(p=>p.x>bounds.x&&p.y>bounds.y&&p.x<bounds.x+bounds.w&&p.y<bounds.y+bounds.h)
    const columns:Rect[]=building.columns.map(c=>expandRect({x:c.at.x-c.size/2,y:c.at.y-c.size/2,w:c.size,h:c.size},radius+1))
    const otherCuts=[...(building.siteFeatures??[]).filter(s=>s.kind==='pool').map(s=>expandRect(s.rect,radius+100))]
    const routes=candidates.flatMap(p=>{
      const upper=routeDrain(start,p,columns,bounds),lower=routeDrain(p,junction,[...columns,...otherCuts],bounds)
      if(!upper||!lower)return []
      const ps=clean([...upper.map(q=>({...q,z:start.z})),{...p,z:junction.z},...lower.slice(1).map(q=>({...q,z:junction.z}))])
      if(solidConflict(ps,radius))return []
      return [{points:ps,length:drainLength(upper)+drainLength(lower)+start.z-junction.z}]
    }).sort((a,b)=>a.length-b.length)
    const route=routes[0]
    if(!route){issues.push(`${id}: no external bypass clears represented columns and slabs within the site.`);continue}
    add(soil,`drain:bypass:${soil.shaftId}`,route.points);wallReviews(id,route.points,radius)
  }
  // Close capped stacks with continuous roof vent proposals. A continuation
  // is not wastewater rising upwards: only ventilation extends above branches.
  // Preserve existing vent runs and explicitly record every new slab sleeve.
  const roofZ=Math.max(...building.floors.map(f=>f.elevationMm+f.heightMm))
  const existing=[...pipes]
  const seen=new Set<string>()
  for(const soil of existing.filter(p=>p.id.startsWith('soil:'))){
    const high=soil.points.reduce((a,b)=>a.z>b.z?a:b)
    const key=`${high.x}:${high.y}`,terminal={...high,z:roofZ+PLUMBING_CONCEPT.ventAboveRoofMm}
    if(seen.has(key))continue
    seen.add(key)
    const collinear=existing.filter(p=>p.points.every(q=>Math.hypot(q.x-high.x,q.y-high.y)<.01))
    const spans=collinear.map(p=>({pipe:p,low:Math.min(...p.points.map(q=>q.z)),high:Math.max(...p.points.map(q=>q.z))})).sort((a,b)=>a.low-b.low)
    let end=spans[0]?.high??high.z
    for(const span of spans.slice(1)){
      if(span.low>end+.01){
        const bridge=[{...high,z:end},{...high,z:span.low}]
        const blocked=pipeCrossesStructure({...building,walls:[]},bridge,soil.diameterMm/2,{slabSleeves:true})
        if(blocked)issues.push(`${soil.id}: inter-floor continuation meets ${blocked}.`)
        else {
          pipes.push({...soil,id:`drain:stack-continuation:${soil.shaftId}:${end}`,points:bridge,purpose:'Proposed inter-floor stack continuation; sleeves and size transitions require review'})
          openings.push({id:`${soil.id}:continuation:${end}`,kind:'slab-sleeve',axis:'z',point:bridge[0],reason:'Proposed inter-floor stack sleeve; structural and waterproofing approval required.'})
        }
      }
      end=Math.max(end,span.high)
    }
    const top=collinear.flatMap(p=>p.points).reduce((a,b)=>a.z>b.z?a:b,high)
    if(top.z>=terminal.z-.01)continue
    const points=[top,terminal]
    // Slabs and walls require declared sleeves; beams and columns stay blocking.
    const blocked=pipeCrossesStructure({...building,walls:[]},points,soil.diameterMm/2,{slabSleeves:true})
    if(blocked){issues.push(`${soil.id}: roof vent continuation meets ${blocked}; review the route.`);continue}
    pipes.push({...soil,id:`drain:roof-vent:${soil.shaftId}`,system:'vent',points,purpose:'Proposed continuous stack vent to roof; new slab sleeves and terminal arrangement require review'})
    for(const floor of building.floors){
      const z=floor.elevationMm+floor.heightMm
      if(z>top.z&&z<terminal.z)openings.push({id:`${soil.id}:vent-sleeve:${floor.id}`,kind:'slab-sleeve',axis:'z',point:{...high,z},reason:`Proposed vent sleeve at ${floor.name}. Structural and waterproofing review required; no slab opening is assumed approved.`})
    }
    wallReviews(soil.id,points,soil.diameterMm/2)
  }
  const ports=scene.fixtures.flatMap(f=>f.branch&&!f.branch.blocked?[f.branch.points.at(-1)!]:[])
  network=connectedDrainageNetwork(building,{...home,pipes},storage,ports)
  for(const f of scene.fixtures){const b=f.branch;if(!b||b.blocked)continue
    b.connected=!!b.proposalReview&&network.layout.pipes.some(p=>p.id===`soil:${b.shaftId}`)&&network.layout.segments.some(s=>pointOnDrainSegment(b.points.at(-1)!,s.from,s.to))
    if(!b.connected&&b.proposalReview)b.reason='No continuous route to the tank could be coordinated without a structural conflict.'
    f.issues=[...f.issues.filter(s=>!s.includes('2D route crosses')&&!s.includes('upper stack')),...(b.proposalReview?['Connected proposal only; new service connections are not approved openings.']:[])]
  }
  scene.branches=scene.fixtures.flatMap(f=>f.branch?[f.branch]:[])
  return {scene,network,openings:[...new Map(openings.map(o=>[o.id,o])).values()],issues}
}

export function pointOnDrainSegment(p:ServicePoint,a:ServicePoint,b:ServicePoint){
  const length=distance(a,b)
  return length>.01&&Math.abs(distance(a,p)+distance(p,b)-length)<.01
}
