import type { BuildingModel } from '../engine/buildingModel.ts'
import { rectUnionEdges, type Point, type Rect, type BoundaryEdge } from '../geometry.ts'
import { pipeCrossesStructure, type ServicePoint, type VillaPlumbing, type VillaPipe, plumbingSegments } from '../plumbing/villaPlumbing.ts'
import { subtractRegions } from '../solar/regions.ts'
import type { WaterConfig } from './schema.ts'

export const SIMPLE_WATER_DEFAULTS:NonNullable<WaterConfig['simple']>={version:1,rainwater:false,tankLitres:'1000',roofDiameterScale:1,roofHeightScale:1,purpose:'garden',rainfallMm:null}
export type RainCollection={
  version:'rain-visual-v1';planId:string;gutters:ServicePoint[][];downpipes:VillaPlumbing;
  collector:ServicePoint|null;firstFlush:ServicePoint|null;filter:ServicePoint|null;
  tank:{center:ServicePoint;radiusMm:number;heightMm:number;capacityLitres:number;inlet:ServicePoint;outlet:ServicePoint}|null;
  overflow:ServicePoint[];areaM2:number;notes:string[];ready:boolean;
  treatment:{version:'rain-treatment-v1';potable:false;bypassToTank:false;performance:'unverified';stages:{id:string;kind:'leaf-screen'|'first-flush'|'coarse-filter'|'sediment-cartridge';position:ServicePoint}[]}|null;
}
const same=(a:Point,b:Point)=>Math.abs(a.x-b.x)<.01&&Math.abs(a.y-b.y)<.01
const normal=(side:BoundaryEdge['side']):Point=>({N:{x:0,y:-1},S:{x:0,y:1},E:{x:1,y:0},W:{x:-1,y:0}}[side])
const intersects=(a:Rect,b:Rect)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y
/** Trace union boundaries instead of drawing gutters across a courtyard or a
 * bounding rectangle. Hole rings are excluded by containment, not guessed away. */
export function outerRoofLoops(regions:Rect[]) {
  const remaining=[...rectUnionEdges(regions)],rings:{vertices:Point[];edges:BoundaryEdge[]}[]=[]
  while(remaining.length){const first=remaining.shift()!,edges=[first],vertices=[first.a,first.b];let closed=false
    while(edges.length<1000){const at=vertices.at(-1)!
      if(same(at,vertices[0])){closed=true;break}
      const i=remaining.findIndex(e=>same(e.a,at)||same(e.b,at));if(i<0)break
      const edge=remaining.splice(i,1)[0];edges.push(edge);vertices.push(same(edge.a,at)?edge.b:edge.a)
    }
    if(closed)rings.push({vertices:vertices.slice(0,-1),edges})
  }
  const inside=(p:Point,vs:Point[])=>{let yes=false;for(let i=0,j=vs.length-1;i<vs.length;j=i++)if((vs[i].y>p.y)!==(vs[j].y>p.y)&&p.x<(vs[j].x-vs[i].x)*(p.y-vs[i].y)/(vs[j].y-vs[i].y)+vs[i].x)yes=!yes;return yes}
  return rings.filter((ring,i)=>!rings.some((other,j)=>j!==i&&inside(ring.vertices[0],other.vertices)))
}
/** A conservative exterior proposal, not automatic indoor routing. Every pipe
 * envelope must clear the source structure. No wall or slab is cut or hidden. */
export function proposeRainCollection(building:BuildingModel,capacityLitres=1000):RainCollection {
  if(!Number.isInteger(capacityLitres)||capacityLitres<500||capacityLitres>5000||capacityLitres%100!==0)throw new RangeError('Choose 500–5,000 litres in steps of 100')
  const empty:VillaPlumbing={version:'villa-plumbing-v1',planId:building.planId,signature:'rain-empty',pipes:[],segments:[],tankPorts:[],issues:[],notes:[]}
  const result:RainCollection={version:'rain-visual-v1',planId:building.planId,gutters:[],downpipes:empty,collector:null,firstFlush:null,filter:null,tank:null,overflow:[],areaM2:0,notes:[],ready:false,treatment:null}
  const top=[...building.floors].sort((a,b)=>a.level-b.level).at(-1)
  if(!top){result.notes.push('A represented roof is needed.');return result}
  if(!building.roofTerrace){result.notes.push('This roof needs a measured gutter and outlet design before a rainwater route can be shown.');return result}
  const regions=subtractRegions(top.footprint,[...(top.courtyard?[top.courtyard]:[]),...(top.doubleHeightVoids??[]).map(v=>v.rect),...building.shafts.filter(s=>s.floorId===top.id).map(s=>s.rect)])
  result.areaM2=regions.reduce((sum,r)=>sum+r.w*r.h/1e6,0)
  if(!regions.length){result.notes.push('No collecting roof surface is represented.');return result}
  // Apertures affect collection area, not the outside fascia line. A shaft
  // opening meeting an edge must not pull a gutter into the source wall.
  const loops=outerRoofLoops(top.footprint),roofZ=top.elevationMm+top.heightMm+80,offset=260
  const obstacles=[...building.floors.flatMap(f=>f.footprint),...(building.siteFeatures??[]).filter(f=>f.kind!=='lawn'&&f.kind!=='utilityYard').map(f=>f.rect),...(building.entryRamp?.status==='ready'?[...building.entryRamp.landings.map(l=>l.rect),...building.entryRamp.flights.map(f=>f.rect)]:[])]
  const radiusMm=Math.min(950,Math.max(420,Math.cbrt(capacityLitres/1000)*550)),heightMm=capacityLitres*1e6/(Math.PI*(radiusMm-25)**2)
  const insidePlot=(r:Rect)=>r.x>=200&&r.y>=200&&r.x+r.w<=building.plot.widthMm-200&&r.y+r.h<=building.plot.depthMm-200
  if(roofZ<heightMm+1500){result.notes.push('The available roof height does not support this gravity-fed preview.');return result}
  // One connected roof island is supported. Separate roof islands stay explicit.
  if(loops.length!==1){result.notes.push('Separate roof sections need their own collection outlets. A plumber should connect these roofs.');return result}
  const loop=loops[0],vertices=loop.vertices.map((p,i)=>{const a=normal(loop.edges[(i+loop.edges.length-1)%loop.edges.length].side),b=normal(loop.edges[i].side);return {x:p.x+(a.x+b.x)*offset,y:p.y+(a.y+b.y)*offset,z:roofZ}})
  if(vertices.some(p=>!insidePlot({x:p.x-90,y:p.y-90,w:180,h:180}))){result.notes.push('This roof is too close to the property boundary for this exterior gutter proposal.');return result}
  const positions=vertices.map((p,i)=>({p,i})).filter(({p})=>insidePlot({x:p.x-100,y:p.y-100,w:200,h:200})).sort((a,b)=>b.p.y-a.p.y||a.p.x-b.p.x)
  for(const {p:collector,i}of positions){
    const before=normal(loop.edges[(i+loop.edges.length-1)%loop.edges.length].side),after=normal(loop.edges[i].side),away={x:Math.sign(before.x+after.x),y:Math.sign(before.y+after.y)}
    if(!away.x||!away.y)continue
    const center={x:collector.x+away.x*(radiusMm+400),y:collector.y+away.y*(radiusMm+400),z:heightMm/2+80},tankRect={x:center.x-radiusMm-200,y:center.y-radiusMm-200,w:2*(radiusMm+200),h:2*(radiusMm+200)}
    if(!insidePlot(tankRect)||obstacles.some(r=>intersects(tankRect,r)))continue
    const inlet={x:center.x-away.x*radiusMm,y:center.y,z:heightMm+20},outlet={x:center.x+away.x*radiusMm,y:center.y,z:280}
    // Leave straight socket lengths above and below the filter heads so the
    // existing fitting kit can seat real elbows instead of intersecting cut tubes.
    const firstFlush={...collector,z:heightMm+1250},filter={x:inlet.x,y:collector.y,z:heightMm+700}
    const feed:ServicePoint[]=[collector,firstFlush,{x:filter.x,y:collector.y,z:firstFlush.z},{x:filter.x,y:collector.y,z:filter.z},filter,{...filter,z:inlet.z},{x:inlet.x,y:inlet.y,z:inlet.z}]
    const cleaned=feed.filter((p,j,ps)=>!j||!same(p,ps[j-1])||p.z!==ps[j-1].z)
    const flushDrain=[firstFlush,{...firstFlush,z:300}]
    const allGutters=vertices.map((v,j)=>[v,vertices[(j+1)%vertices.length]])
    // Filter heads are 140 mm radius; include a 5 mm visual fitting margin.
    if(pipeCrossesStructure(building,cleaned,45)||pipeCrossesStructure(building,flushDrain,45)||pipeCrossesStructure(building,[{...filter,z:filter.z-450},{...filter,z:filter.z+350}],145)||allGutters.some(g=>pipeCrossesStructure(building,g,90)))continue
    const pipes:VillaPipe[]=[{id:'rain:downpipe',system:'water',purpose:'Proposed rainwater downpipe and filter feed',shaftId:null,floorId:top.id,diameterMm:90,sizeBasis:'selected outside diameter',points:cleaned},{id:'rain:first-flush',system:'water',purpose:'First-flush diversion leg; outlet needs review',shaftId:null,floorId:top.id,diameterMm:90,sizeBasis:'selected outside diameter',points:flushDrain}]
    const overflow=[{x:center.x+away.x*radiusMm,y:center.y,z:heightMm-100},{x:center.x+away.x*(radiusMm+300),y:center.y,z:heightMm-100},{x:center.x+away.x*(radiusMm+300),y:center.y,z:250}]
    if(!pipeCrossesStructure(building,overflow,45))pipes.push({id:'rain:overflow',system:'water',purpose:'Overflow stub — final discharge not established',shaftId:null,floorId:top.id,diameterMm:90,sizeBasis:'selected outside diameter',points:overflow})
    result.gutters=allGutters;result.collector=collector;result.firstFlush=firstFlush;result.filter=filter;result.tank={center,radiusMm,heightMm,capacityLitres,inlet,outlet};result.overflow=overflow
    result.treatment={version:'rain-treatment-v1',potable:false,bypassToTank:false,performance:'unverified',stages:[
      {id:'rain:leaf-screen',kind:'leaf-screen',position:collector},
      {id:'rain:first-flush',kind:'first-flush',position:firstFlush},
      {id:'rain:coarse-filter',kind:'coarse-filter',position:{...filter,z:filter.z+150}},
      {id:'rain:sediment-cartridge',kind:'sediment-cartridge',position:{...filter,z:filter.z-250}},
    ]}
    result.downpipes={...empty,signature:`rain-${building.planId}-${capacityLitres}-treatment-fittings-v2`,pipes,segments:plumbingSegments({pipes})};result.ready=true
    result.notes.push('Roof screen → first-flush diversion → coarse filter → sediment cartridge → separate non-potable tank. Filter performance and water quality are unverified; drinking water requires a tested treatment design.', 'Gutters, 90 mm pipes and tank shell are planning geometry; roof falls, fittings, maintenance and final discharge need review.')
    return result
  }
  result.notes.push('No clear location beside this house fits the selected tank and an exterior downpipe. Try a smaller tank or have a plumber choose the route.')
  return result
}
