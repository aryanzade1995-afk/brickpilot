import { pipeAssembly, type PipeAssembly } from './assembly.ts'
import type { BuildingModel } from '../engine/buildingModel.ts'
import type { Brief } from '../model/brief.ts'
import { resolveSpecification } from '../cost/catalogue.ts'
import { tankBank } from '../engine/terrace.ts'
import type { Rect } from '../geometry.ts'
import { subtractRegions, expandRect, insetRegions } from '../solar/regions.ts'
import { realizedTerraceObjects } from '../solar/terraceObjects.ts'
import { roofAccess } from '../walkthrough/openingAssemblies.ts'
import { routeDrain } from '../utilities/drainage.ts'
import { segmentDistance } from '../utilities/clashGeometry.ts'

export type ServicePoint = { x: number; y: number; z: number }
export type VillaPipe = { id: string; system: 'water' | 'drain' | 'vent'; purpose: string; shaftId: string | null; floorId: string; diameterMm: number; sizeBasis: 'selected nominal' | 'selected outside diameter'; points: ServicePoint[] }
export type PipeSegment = { system: VillaPipe['system']; diameterMm: number; from: ServicePoint; to: ServicePoint }
export type VillaPlumbing = { assembly?: PipeAssembly; segments: PipeSegment[]; version: 'villa-plumbing-v1'; planId: string; signature: string; pipes: VillaPipe[]; tankPorts: { id: string; center: ServicePoint; port: ServicePoint; radiusMm: number }[]; issues: { id: string; reason: string }[]; notes: string[] }
export type PipeSizes = { waterMm: number; soilMm: number; wasteMm: number }
export const PLUMBING_CONCEPT = { tankStandMm: 800, trayMm: 60, tankHeightMm: 1000, outletAboveBaseMm: 200, roofHeaderMm: 150, roofMarginMm: 25, separationMm: 40, bottomStubMm: 100, ventAboveRoofMm: 1100 } as const
export function selectedPipeSizes(brief: Brief): PipeSizes {
  const size = (key: 'water-riser-size' | 'soil-pipe-size' | 'waste-pipe-size') => Number(resolveSpecification(brief, key).id.replace('mm', ''))
  return { waterMm: size('water-riser-size'), soilMm: size('soil-pipe-size'), wasteMm: size('waste-pipe-size') }
}
/** Union collinear runs, so shared roof headers are not drawn twice. */
export function plumbingSegments(layout: Pick<VillaPlumbing, 'pipes'>) {
  const groups=new Map<string,{axis:'x'|'y'|'z';system:VillaPipe['system'];diameterMm:number;point:ServicePoint;spans:[number,number][]}>()
  for(const pipe of layout.pipes)for(let i=1;i<pipe.points.length;i++){
    const a=pipe.points[i-1],b=pipe.points[i],axis=(['x','y','z'] as const).find(k=>a[k]!==b[k]);if(!axis)continue
    const fixed=(['x','y','z'] as const).filter(k=>k!==axis).map(k=>a[k]),key=JSON.stringify([pipe.system,pipe.diameterMm,axis,fixed])
    const g=groups.get(key)??{axis,system:pipe.system,diameterMm:pipe.diameterMm,point:a,spans:[]};g.spans.push([Math.min(a[axis],b[axis]),Math.max(a[axis],b[axis])]);groups.set(key,g)
  }
  return [...groups.values()].flatMap(g=>{
    const union:[number,number][]=[]
    for(const [lo,hi]of g.spans.sort((a,b)=>a[0]-b[0])){const last=union.at(-1);if(last&&lo<=last[1]+.001)last[1]=Math.max(last[1],hi);else union.push([lo,hi])}
    return union.map(([lo,hi])=>({system:g.system,diameterMm:g.diameterMm,from:{...g.point,[g.axis]:lo},to:{...g.point,[g.axis]:hi}}))
  })
}

const token = (v: unknown) => { let n = 2166136261; const s = JSON.stringify(v); for (let i = 0; i < s.length; i++) n = Math.imul(n ^ s.charCodeAt(i), 16777619); return (n >>> 0).toString(16) }
// Python round() tie behavior. Replay roof_services.py's realized cylinders,
// not the smaller one-tank planning slot or a guessed tank capacity.
const roundEven = (n: number) => n % 1 === .5 ? Math.round(n / 2) * 2 : Math.round(n)
export function realizedTankPorts(building: BuildingModel, diameterScale=1): VillaPlumbing['tankPorts'] {
  if(!Number.isFinite(diameterScale)||diameterScale<.5||diameterScale>1)throw new RangeError('Tank width must fit its existing stand.')
  const terrace = building.roofTerrace, top = [...building.floors].sort((a,b) => a.level-b.level).at(-1), bank = terrace ? tankBank(terrace) : null
  if (!bank || !top) return []
  const alongX = bank.w >= bank.h, span = alongX ? bank.w : bank.h, cross = alongX ? bank.h : bank.w, count = Math.max(1, roundEven(span / 1150)), pitch = span / count, radiusMm = (Math.min(pitch, cross) / 2 - 70)*diameterScale
  const roofZ = top.elevationMm + top.heightMm, z = roofZ + PLUMBING_CONCEPT.tankStandMm + PLUMBING_CONCEPT.trayMm + PLUMBING_CONCEPT.outletAboveBaseMm
  if (radiusMm <= 0) return []
  return Array.from({ length: count }, (_, i) => {
    const center = { x: bank.x + (alongX ? pitch * (i + .5) : bank.w / 2), y: bank.y + (alongX ? bank.h / 2 : pitch * (i + .5)), z }
    return { id: `Roof_WaterTank_${i+1}`, center, radiusMm, port: { ...center, x: center.x + (alongX ? 0 : radiusMm), y: center.y + (alongX ? radiusMm : 0) } }
  })
}
const pathRect = (a: ServicePoint, b: ServicePoint, radius: number): Rect => ({ x: Math.min(a.x,b.x)-radius, y: Math.min(a.y,b.y)-radius, w: Math.abs(a.x-b.x)+2*radius, h: Math.abs(a.y-b.y)+2*radius })
const overlap = (a: Rect, b: Rect) => a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y
/** A real shaft aperture is required at EVERY crossed slab. Stair/courtyard
 * voids are never borrowed for service risers. No new penetration is created. */
export function pipeCrossesStructure(building: BuildingModel, points: ServicePoint[], radius: number): string | null {
  for (let i=1;i<points.length;i++) {
    const a=points[i-1], b=points[i], low=Math.min(a.z,b.z)-radius, high=Math.max(a.z,b.z)+radius, envelope=pathRect(a,b,radius)
    for(const f of building.floors) {
      const holes=building.shafts.filter(s=>s.floorId===f.id).map(s=>s.rect)
      const slabSolid=subtractRegions(f.footprint, holes)
      const bottom=f.elevationMm-(f.slabThicknessMm??0), top=f.elevationMm
      if(low<top && high>bottom && slabSolid.some(r=>overlap(envelope,r))) return `${f.name}: solid floor slab`
      const cap=f.elevationMm+f.heightMm
      const above=building.floors.find(g=>g.level===f.level+1)
      // Exposed lower roofs currently do not cut shaft holes in Blender.
      const capRegions=above ? subtractRegions(f.footprint,above.footprint) : subtractRegions(f.footprint,holes)
      if(low<cap && high>cap-(f.slabThicknessMm??0) && capRegions.some(r=>overlap(envelope,r))) return `${f.name}: roof slab without a service opening`
      if(high<f.elevationMm || low>cap) continue
      for(const c of building.columns.filter(c=>c.floorId===f.id)) if(overlap(envelope,{x:c.at.x-c.size/2,y:c.at.y-c.size/2,w:c.size,h:c.size})) return `${f.name}: column ${c.id}`
      for(const beam of building.beams.filter(b=>b.floorId===f.id)) {
        if(beam.depthMm===undefined || beam.widthMm===undefined) continue
        if(high<cap-beam.depthMm || low>cap)continue
        const d=segmentDistance([a.x,a.y,0],[b.x,b.y,0],[beam.a.x,beam.a.y,0],[beam.b.x,beam.b.y,0]).distance
        if(d<beam.widthMm/2+radius) return `${f.name}: beam ${beam.id}`
      }
      for(const wall of building.walls.filter(w=>w.floorId===f.id)) {
        const d=segmentDistance([a.x,a.y,0],[b.x,b.y,0],[wall.a.x,wall.a.y,0],[wall.b.x,wall.b.y,0]).distance
        if(d<wall.thickness/2+radius) return `${f.name}: wall ${wall.id}`
      }
    }
  }
  return null
}
export function createVillaPlumbing(building: BuildingModel, sizes: PipeSizes, extraRoofObstacles: Rect[] = [], tankDiameterScale=1): VillaPlumbing {
  const pipes: VillaPipe[]=[], issues: VillaPlumbing['issues']=[], tanks=realizedTankPorts(building,tankDiameterScale), top=[...building.floors].sort((a,b)=>a.level-b.level).at(-1)
  const add=(pipe: VillaPipe) => {
    const points=pipe.points.filter((p,i,ps)=>!i||Math.hypot(p.x-ps[i-1].x,p.y-ps[i-1].y,p.z-ps[i-1].z)>.01)
    if(points.length<2)return false
    const blocked=pipeCrossesStructure(building,points,pipe.diameterMm/2)
    if(blocked){issues.push({id:pipe.id,reason:`Not drawn through ${blocked}. A reviewed service opening or external bypass is needed.`});return false}
    pipes.push({...pipe,points});return true
  }
  if(!top || !Object.values(sizes).every(n=>Number.isFinite(n)&&n>0&&n<=500)) return {version:'villa-plumbing-v1',planId:building.planId,signature:'invalid',segments:[],pipes,tankPorts:[],issues:[{id:'sizes',reason:'Source floors or selected pipe sizes are unavailable.'}],notes:[]}
  const roofZ=top.elevationMm+top.heightMm, headerZ=roofZ+PLUMBING_CONCEPT.roofHeaderMm, terrace=building.roofTerrace, bank=terrace?tankBank(terrace):null
  let main:ServicePoint|null=null
  if(tanks.length && bank && terrace) {
    const alongX=bank.w>=bank.h
    const joints=tanks.map(t=>({...t.port,x:alongX?t.port.x:bank.x+bank.w+100,y:alongX?bank.y+bank.h+100:t.port.y,z:headerZ}))
    const tankPaths=tanks.map((t,i)=>[t.port,{...joints[i],z:t.port.z},joints[i]])
    if(tankPaths.every(ps=>!pipeCrossesStructure(building,ps,sizes.waterMm/2))){
      tanks.forEach((t,i)=>add({id:`tank-port:${t.id}`,system:'water',purpose:'Tank outlet connection',shaftId:null,floorId:top.id,diameterMm:sizes.waterMm,sizeBasis:'selected nominal',points:tankPaths[i]}))
      if(joints.length>1)add({id:'tank-manifold',system:'water',purpose:'Common tank manifold',shaftId:null,floorId:top.id,diameterMm:sizes.waterMm,sizeBasis:'selected nominal',points:[joints[0],joints.at(-1)!]})
      main=joints[0]
    } else issues.push({id:'tank-manifold',reason:'The realized tank outlets have no clear manifold connection.'})
  } else issues.push({id:'tank',reason:'No supported flat-roof tank bank is represented. No tank connection is invented.'})
  const accessArea=roofAccess(building)?.protectedAreaMm
  const roofCuts=terrace ? [
    ...subtractRegions([terrace.outline],insetRegions(terrace.slab,120)),
    ...(terrace.mumty?[expandRect(terrace.mumty,160)]:[]),
    ...(accessArea?[accessArea]:[]),
    ...realizedTerraceObjects(building).filter(o=>o.heightMm>=PLUMBING_CONCEPT.roofHeaderMm-sizes.waterMm/2).map(o=>o.rectMm),
    ...extraRoofObstacles,
  ].map(r=>expandRect(r,sizes.waterMm/2+PLUMBING_CONCEPT.roofMarginMm)):[]
  if(!building.shafts.length)issues.push({id:'shafts',reason:'No source service shafts are represented. No holes are cut into the house.'})
  for(const shaft of building.shafts) {
    const f=building.floors.find(f=>f.id===shaft.floorId)
    if(!f)continue
    const room=building.rooms.find(r=>r.id===shaft.roomId && r.floorId===f.id), drainSize=room && /kitchen|utility|laundry/i.test(`${room.id} ${room.name}`)?sizes.wasteMm:sizes.soilMm
    const r=shaft.rect, water={x:r.x+r.w*.33,y:r.y+r.h/2}, drain={x:r.x+r.w*.60,y:r.y+r.h/2}
    if(r.w*.27<(sizes.waterMm+drainSize)/2+PLUMBING_CONCEPT.separationMm || drainSize/2>Math.min(r.w*.4,r.h/2)) {issues.push({id:shaft.id,reason:'The source shaft is too small for the selected pipe envelopes and concept separation.'});continue}
    const cap=f.elevationMm+f.heightMm, belowCap=cap-(f.slabThicknessMm??0)-100
    const base=f.elevationMm+PLUMBING_CONCEPT.bottomStubMm
    const at=(p:{x:number;y:number},z:number):ServicePoint=>({...p,z})
    const drainPoints=[at(drain,base),at(drain,belowCap)]
    add({id:`soil:${shaft.id}`,system:'drain',purpose:drainSize===sizes.wasteMm?'Waste stack in recorded shaft':'Soil stack in recorded shaft',shaftId:shaft.id,floorId:f.id,diameterMm:drainSize,sizeBasis:'selected outside diameter',points:drainPoints})
    const aboveShaft=building.shafts.filter(s=>{
      const level=building.floors.find(floor=>floor.id===s.floorId)?.level
      return level!==undefined && level>f.level && Math.hypot(s.rect.x+s.rect.w*.60-drain.x,s.rect.y+s.rect.h/2-drain.y)<.01
    }).sort((a,b)=>building.floors.find(f=>f.id===a.floorId)!.level-building.floors.find(f=>f.id===b.floorId)!.level)[0]
    if(aboveShaft){
      const aboveFloor=building.floors.find(f=>f.id===aboveShaft.floorId)!,aboveRoom=building.rooms.find(r=>r.floorId===aboveFloor.id&&r.id===aboveShaft.roomId)
      const aboveSize=aboveRoom&&/kitchen|utility|laundry/i.test(`${aboveRoom.id} ${aboveRoom.name}`)?sizes.wasteMm:sizes.soilMm
      if(aboveSize===drainSize)add({id:`stack-link:${shaft.id}`,system:'drain',purpose:'Stack continuation through aligned source apertures',shaftId:shaft.id,floorId:f.id,diameterMm:drainSize,sizeBasis:'selected outside diameter',points:[at(drain,belowCap),at(drain,aboveFloor.elevationMm+PLUMBING_CONCEPT.bottomStubMm)]})
      else issues.push({id:`stack-link:${shaft.id}`,reason:'Aligned stacks have different selected sizes. A reviewed sizing transition is required.'})
    }else if(!pipeCrossesStructure(building,[at(drain,belowCap),at(drain,roofZ+PLUMBING_CONCEPT.ventAboveRoofMm)],drainSize/2)) add({id:`vent:${shaft.id}`,system:'vent',purpose:'Proposed open vent continuation; terminal design unverified',shaftId:shaft.id,floorId:f.id,diameterMm:drainSize,sizeBasis:'selected outside diameter',points:[at(drain,belowCap),at(drain,roofZ+PLUMBING_CONCEPT.ventAboveRoofMm)]})
    else issues.push({id:`vent:${shaft.id}`,reason:'The shaft does not continue through all slabs to the roof. Vent continuation is not drawn.'})
    // Connect only when a complete clear vertical envelope and a continuous
    // supported roof path exist. No cross-courtyard/free-air shortcuts.
    const upper=at(water,headerZ), lower=at(water,base)
    const verticalBlocked=pipeCrossesStructure(building,[upper,lower],sizes.waterMm/2)
    const roofPath=main && terrace && !verticalBlocked ? routeDrain(main,upper,roofCuts,terrace.outline):null
    if(main && roofPath) {
      const header=roofPath.map(p=>({...p,z:headerZ}))
      if(add({id:`supply:${shaft.id}`,system:'water',purpose:'Tank-fed supply through recorded shaft openings',shaftId:shaft.id,floorId:f.id,diameterMm:sizes.waterMm,sizeBasis:'selected nominal',points:[...header,lower]})) continue
    }
    add({id:`water-stub:${shaft.id}`,system:'water',purpose:'Local supply riser; tank connection pending',shaftId:shaft.id,floorId:f.id,diameterMm:sizes.waterMm,sizeBasis:'selected nominal',points:[at(water,base),at(water,belowCap)]})
    issues.push({id:`supply:${shaft.id}`,reason:verticalBlocked?`Tank feed interrupted by ${verticalBlocked}; no penetration has been assumed.`:'No clear roof route from the tank to this shaft. Connection needs review.'})
  }
  issues.push({id:'discharge',reason:'Ground drain destination and invert levels are not established here. Stack ends are not represented as an approved sewer/septic connection.'})
  const notes=['Service coordination preview, not installation approval. Diameters follow Finishes & Cost; nominal supply sizes are shown as concept envelopes, not verified outside diameters.', 'Tank outlet heights, roof header height, pipe separation and vent terminal height are explicit visualization assumptions, not Indian code or hydraulic design.', 'Only recorded shafts are used. Floor-to-floor discontinuities, unknown fixture branches, traps, gradients, concealed penetrations and final discharge require a plumbing design. Architecture, floor openings and estimate quantities are unchanged.']
  const segments=plumbingSegments({pipes})
  return {assembly:pipeAssembly(segments),version:'villa-plumbing-v1',planId:building.planId,signature:`plumbing-${token([building.planId,sizes,pipes])}`,segments,pipes,tankPorts:tanks,issues,notes}
}
