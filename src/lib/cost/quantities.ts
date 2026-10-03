import type { Design, Opening, Wall } from '../engine/types.ts'
import { rectUnionArea, rectUnionEdges, segLength, type Rect } from '../geometry.ts'
import { fnv } from '../engine/massing/rng.ts'
import { validatedPunePolicy as policy } from './data/validated.ts'
import { quantityRules as rules } from './data/quantityRules.ts'
import { sizeStructure, type StructuralSizing } from '../engine/structuralSizing.ts'
import { resolveSpecification } from './catalogue.ts'
import { occupantCount } from '../model/brief.ts'

export type RoomQuantity = { id: string; floor: string; name: string; area: number }
type EnvelopeQuantities = {
  geometryKey: string; floorArea: number; groundArea: number; wallArea: number; paintArea: number
  doorArea: number; windowArea: number; roofArea: number; pavingArea: number; lawnArea: number; poolArea: number
  doorCount: number; windowCount: number; rooms: RoomQuantity[]; assumptions: string[]
}
function intersection(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y)
  const w = Math.min(a.x + a.w, b.x + b.w) - x, h = Math.min(a.y + a.h, b.y + b.h) - y
  return w > 0 && h > 0 ? { x, y, w, h } : null
}
/** Exact union minus the intersecting hole union: holes outside plates never reduce area. */
export function measuredArea(rects: Rect[], holes: Rect[] = []): number {
  const cuts = rects.flatMap(a => holes.flatMap(b => { const r = intersection(a, b); return r ? [r] : [] }))
  return (rectUnionArea(rects) - rectUnionArea(cuts)) / 1e6
}
export function geometryCostKey(design: Design): string {
  const geometry = JSON.stringify({ floors: design.floors.map(f => ({ level: f.level, footprint: f.footprint,
    courtyard: f.courtyard, voids: f.doubleHeightVoids, walls: f.walls, openings: f.openings,
    rooms: f.rooms.map(r => ({ id: r.semanticId || r.id, rect: r.rect, outdoor: r.outdoor })) })),
    site: design.siteFeatures ?? [], height: design.model.brief.levels.floorToFloor })
  return `cost-${fnv(geometry).toString(16)}-${fnv(`quantities|${geometry}`).toString(16)}`
}
function openingHeight(o: Opening): number {
  const m = rules.openingLimits
  return Math.max(0, (o.head ?? m[`${o.kind}HeadMm`]) -
    (o.kind === 'window' ? o.sill ?? m.defaultSillMm : 0))
}
function hosts(w: Wall, o: Opening): boolean {
  const t = policy.measurement.hostToleranceMm
  if (o.orient === 'h') return Math.abs(w.a.y - w.b.y) <= t && Math.abs(w.a.y - o.at.y) <= t &&
    o.at.x - o.width / 2 >= Math.min(w.a.x, w.b.x) - t && o.at.x + o.width / 2 <= Math.max(w.a.x, w.b.x) + t
  return Math.abs(w.a.x - w.b.x) <= t && Math.abs(w.a.x - o.at.x) <= t &&
    o.at.y - o.width / 2 >= Math.min(w.a.y, w.b.y) - t && o.at.y + o.width / 2 <= Math.max(w.a.y, w.b.y) + t
}
/** Read-only geometry take-off. Never trusts cached areas/counts or a bounding box. */
function measureEnvelope(design: Design): EnvelopeQuantities {
  const sizing=sizeStructure(design)
  const rooms: RoomQuantity[] = []
  let floorArea = 0, wallArea = 0, paintArea = 0, doorArea = 0, windowArea = 0, doorCount = 0, windowCount = 0
  const holes = (f: Design['floors'][number]) => [...(f.courtyard ? [f.courtyard] : []), ...(f.doubleHeightVoids ?? []).map(v => v.rect)]
  for (const f of design.floors) {
    const cuts = holes(f)
    floorArea += measuredArea(f.footprint, cuts)
    const wallHeight = design.model.brief.levels.floorToFloor * 1000 - sizing.floors.find(s=>s.level===f.level)!.slabThicknessMm
    const assigned = new Set<Opening>()
    for (const w of f.walls.filter(w => w.kind !== 'parapet')) {
      const h = w.heightMm ?? wallHeight
      const area = Math.max(0, segLength(w) * h / 1e6 - f.openings.reduce((sum, o) => {
        if (assigned.has(o) || !hosts(w, o)) return sum
        assigned.add(o)
        return sum + o.width * Math.min(h, openingHeight(o)) / 1e6
      }, 0))
      wallArea += area
      paintArea += area * 2
    }
    for (const o of f.openings) {
      const area = o.width * openingHeight(o) / 1e6
      if (o.kind === 'window' || o.leaf === false && o.treatment === 'glazed-slide') { windowArea += area; windowCount++ }
      else if (o.leaf !== false) { doorArea += area; doorCount++ }
    }
    for (const r of f.rooms.filter(r => !r.outdoor)) rooms.push({ id: `${f.level}:${r.semanticId || r.id}`,
      floor: f.name, name: r.name, area: measuredArea([r.rect], cuts) })
  }
  const ordered = [...design.floors].sort((a, b) => a.level - b.level)
  const ground = ordered[0]
  const roofs = (f: Design['floors'][number]) => [...f.footprint, ...(f.doubleHeightVoids ?? []).map(v => v.rect)]
  const roofArea = ordered.reduce((sum, f, i) => sum + measuredArea(roofs(f),
    [...(f.courtyard ? [f.courtyard] : []), ...(ordered[i + 1] ? roofs(ordered[i + 1]) : [])]), 0)
  const siteArea = (kinds: string[]) => measuredArea((design.siteFeatures ?? []).filter(f => kinds.includes(f.kind)).map(f => f.rect))
  return { geometryKey: geometryCostKey(design), floorArea, groundArea: ground ? measuredArea(ground.footprint, holes(ground)) : 0,
    wallArea, paintArea, doorArea, windowArea, doorCount, windowCount, roofArea,
    pavingArea: siteArea(['parking', 'driveway', 'path', 'sitOut', 'utilityYard']), lawnArea: siteArea(['lawn']), poolArea: siteArea(['pool']), rooms,
    assumptions: ['Floor areas use source footprint unions minus courtyard and double-height voids. Roofs include exposed lower roofs and ceilings over double-height space.',
      'Paint covers both wall faces after opening deductions; wall-height and missing opening heights use documented concept defaults.',
      'Floor finishes use indoor room rectangles; RCC and masonry use measured members. Service points and pool equipment remain concept allowances.',
      'Blender-only facade additions, furniture and landscape objects are excluded.'] }
}

/** SI units: m³ / m² / m / number. Weight is kept separately in kg. */
export type IFCQuantities = {NetVolume:number;NetSideArea:number;NetArea:number;Length:number;Count:number}
export type QuantityMember = {id:string;category:string;quantities:IFCQuantities;steelKg:number;formworkM2:number}
export type FloorQuantities = {level:number;name:string;items:Record<string,IFCQuantities>;members:QuantityMember[];steelKg:Record<string,number>;formworkM2:Record<string,number>}
export type Quantities = EnvelopeQuantities & {structureSizing:StructuralSizing;perFloor:FloorQuantities[];
  total:FloorQuantities;concreteMaterials:{grade:string;cementBags:number|null;sandM3:number|null;aggregateM3:number|null};
  masonryMaterials:{type:string;Count:number};tanks:{occupants:number;overheadLitres:number;undergroundLitres:number}}
const zero=():IFCQuantities=>({NetVolume:0,NetSideArea:0,NetArea:0,Length:0,Count:0})
const perimeter=(rects:Rect[],hole?:Rect|null)=>rectUnionEdges(rects,hole).reduce((n,e)=>n+Math.hypot(e.b.x-e.a.x,e.b.y-e.a.y)/1000,0)
function add(f:FloorQuantities,id:string,values:Partial<IFCQuantities>) {
  const item=f.items[id]??=zero()
  for(const key of Object.keys(values) as (keyof IFCQuantities)[])item[key]+=values[key]??0
}
function concrete(f:FloorQuantities,id:string,category:keyof typeof rules.steelKgPerM3,volume:number,formwork:number,area=0,length=0) {
  const quantities={...zero(),NetVolume:Math.max(0,volume),NetArea:area,Length:length,Count:1}
  const steelKg=quantities.NetVolume*rules.steelKgPerM3[category]
  f.members.push({id,category,quantities,steelKg,formworkM2:Math.max(0,formwork)})
  add(f,`concrete.${category}`,quantities)
  f.steelKg[category]=(f.steelKg[category]??0)+steelKg
  f.formworkM2[category]=(f.formworkM2[category]??0)+Math.max(0,formwork)
}
export function roomQuantityKind(room:Design['floors'][number]['rooms'][number]):keyof typeof rules.pointsByRoom {
  const id=`${room.id} ${room.semanticId} ${room.name}`.toLowerCase()
  if(/bath|toilet|washroom/.test(id))return 'bath'
  if(/kitchen/.test(id))return 'kitchen'
  if(/utility|laundry/.test(id))return 'utility'
  if(/bed|master|guest|staff/.test(id))return 'bedroom'
  if(/living|dining|lounge|family/.test(id))return 'living'
  if(/office|study/.test(id))return 'office'
  if(/pooja|puja|prayer/.test(id))return 'pooja'
  return room.zone==='circulation'?'circulation':'other'
}
/** Mirrors Blender's dog-leg slab opening, retaining the destination landing. */
export function stairSlabOpening(stair:NonNullable<Design['floors'][number]['stair']>):Rect {
  const r=stair.rect, side=stair.startSide??'N', along=side==='N'||side==='S'
  const positions=stair.treads.filter(t=>t.length>1).map(t=>{
    const p=t[0],q=t.at(-1)!,center=along?(p.x+q.x)/2-r.x:(p.y+q.y)/2-r.y
    if(center>=(along?r.w:r.h)/2)return null
    return side==='N'?p.y-r.y:side==='S'?r.y+r.h-p.y:side==='W'?p.x-r.x:r.x+r.w-p.x
  }).filter((x):x is number=>x!==null).sort((a,b)=>a-b)
  if(!positions.length)throw new Error('Cannot measure a staircase without source nosings')
  const increments=[positions[0],...positions.slice(1).map((p,i)=>p-positions[i])].sort((a,b)=>a-b)
  const mid=Math.floor(increments.length/2),going=increments.length%2?increments[mid]:(increments[mid-1]+increments[mid])/2
  return side==='N'?{...r,y:r.y+going,h:r.h-going}:side==='S'?{...r,h:r.h-going}:side==='W'?{...r,x:r.x+going,w:r.w-going}:{...r,w:r.w-going}
}
function quantitiesKey(design:Design):string {
  // Deliberately ignore cached areas, rendering DNA, finishes, rates and seed.
  // Include room names (schedules/point rules), occupants and technical specs.
  return JSON.stringify({geometry:geometryCostKey(design),floors:design.floors.map(f=>({level:f.level,name:f.name,columns:f.columns,beams:f.beams,shafts:f.shafts,stair:f.stair,rooms:f.rooms.map(r=>({id:r.id,name:r.name,zone:r.zone,semanticId:r.semanticId}))})),
    plot:design.model.plot,compound:design.model.brief.rooms.priorities.compoundWall,
    occupants:occupantCount(design.model.brief),technical:['soil-type','plinth-height','concrete-grade','masonry-type'].map(id=>resolveSpecification(design.model.brief,id).id),version:rules.version})
}
const cache=new Map<string,Quantities>()
function freeze<T>(value:T):T {
  if(value&&typeof value==='object') {for(const item of Object.values(value))freeze(item);Object.freeze(value)}
  return value
}
/** Pure measurement. Small content cache also detects in-place edits to legacy designs. */
export function measureDesign(design:Design):Quantities {
  const key=quantitiesKey(design),cached=cache.get(key)
  if(cached)return cached
  const q=freeze(calculateQuantities(design))
  cache.set(key,q)
  if(cache.size>rules.memoEntries)cache.delete(cache.keys().next().value!)
  return q
}
/** Uncached, side-effect-free take-off; does not generate or modify a plan. */
export function calculateQuantities(design:Design):Quantities {
  const envelope=measureEnvelope(design),sizing=sizeStructure(design),ordered=[...design.floors].sort((a,b)=>a.level-b.level)
  const h=design.model.brief.levels.floorToFloor,perFloor:FloorQuantities[]=[]
  const voids=(f:Design['floors'][number])=>[...(f.courtyard?[f.courtyard]:[]),...(f.doubleHeightVoids??[]).map(v=>v.rect)]
  const roofPlates=(f:Design['floors'][number])=>[...f.footprint,...(f.doubleHeightVoids??[]).map(v=>v.rect)]
  for(const [index,floor] of ordered.entries()) {
    const f:FloorQuantities={level:floor.level,name:floor.name,items:{},members:[],steelKg:{},formworkM2:{}}
    const size=sizing.floors.find(s=>s.level===floor.level)!, slab=size.slabThicknessMm/1000,wallH=h-slab
    const lower=ordered[index-1],upper=ordered[index+1],shafts=(floor.shafts??[]).map(s=>s.rect)
    const plateArea=measuredArea(floor.footprint,[...voids(floor),...shafts,...(lower?.stair?[stairSlabOpening(lower.stair)]:[])])
    const roofArea=measuredArea(roofPlates(floor),[...(floor.courtyard?[floor.courtyard]:[]),...shafts,...(upper?roofPlates(upper):[]),...(!upper&&floor.stair?[stairSlabOpening(floor.stair)]:[])])
    const columnRects=size.columns.map(c=>({x:c.at.x-c.size/2,y:c.at.y-c.size/2,w:c.size,h:c.size}))
    // Plates end at centre lines. Column height stops at slab soffit; beam lengths stop at column faces.
    if(plateArea)concrete(f,`${floor.level}:floor-slab`,'slabs',plateArea*slab,index===0?0:plateArea,plateArea)
    if(roofArea)concrete(f,`${floor.level}:roof-slab`,'slabs',roofArea*slab,roofArea,roofArea)
    for(const c of size.columns) {
      const side=c.size/1000, height=wallH
      concrete(f,c.id,'columns',side*side*height,4*side*height,0,height)
    }
    for(const beam of size.beams) {
      const raw=Math.hypot(beam.b.x-beam.a.x,beam.b.y-beam.a.y)
      const endSize=(p:{x:number;y:number})=>size.columns.find(c=>Math.hypot(c.at.x-p.x,c.at.y-p.y)<=rules.toleranceMm)?.size??0
      const length=Math.max(0,raw-(endSize(beam.a)+endSize(beam.b))/2)/1000
      const width=beam.widthMm/1000,depth=Math.max(0,beam.depthMm/1000-slab)
      concrete(f,beam.id,'beams',length*width*depth,length*(width+2*depth),0,length)
    }
    if(index===0) {
      const excavation:Rect[]=[],pcc:Rect[]=[];let substructure=0
      for(const footing of sizing.footings) {
        const r=footing.rect,w=r.w/1000,d=r.h/1000,t=footing.thicknessMm/1000
        concrete(f,footing.id,'footings',w*d*t,2*(w+d)*t,w*d)
        const expand=(amount:number)=>({x:r.x-amount,y:r.y-amount,w:r.w+2*amount,h:r.h+2*amount})
        excavation.push(expand(rules.earthwork.workingSpaceMm));pcc.push(expand(rules.earthwork.pccProjectionMm))
        const c=size.columns.find(c=>c.id===footing.columnId)!,side=c.size/1000
        const height=(-footing.bottomMm-footing.thicknessMm-size.slabThicknessMm)/1000
        concrete(f,`${c.id}:pedestal`,'columns',side*side*height,4*side*height,0,height)
        const belowGrade=(rules.footing.depthBelowGradeMm-footing.thicknessMm)/1000
        substructure+=w*d*t+side*side*belowGrade
      }
      const pccArea=measuredArea(pcc),excArea=measuredArea(excavation)
      const pccVolume=pccArea*rules.earthwork.pccThicknessMm/1000
      const exc=excArea*(rules.footing.depthBelowGradeMm+rules.earthwork.pccThicknessMm)/1000
      add(f,'earthwork.excavation',{NetVolume:exc});add(f,'earthwork.pcc',{NetVolume:pccVolume,NetArea:pccArea})
      add(f,'earthwork.backfill',{NetVolume:Math.max(0,exc-pccVolume-substructure)})
      let plinthVolume=0
      for(const beam of sizing.plinthBeams) {
        const endSize=(p:{x:number;y:number})=>size.columns.find(c=>Math.hypot(c.at.x-p.x,c.at.y-p.y)<=rules.toleranceMm)?.size??0
        const length=Math.max(0,Math.hypot(beam.b.x-beam.a.x,beam.b.y-beam.a.y)-(endSize(beam.a)+endSize(beam.b))/2)/1000
        const volume=length*beam.widthMm*beam.depthMm/1e6
        concrete(f,beam.id,'plinthBeams',volume,length*(beam.widthMm+2*beam.depthMm)/1000,0,length);plinthVolume+=volume
      }
      const fillHeight=Math.max(0,(sizing.plinthHeightMm-size.slabThicknessMm)/1000)
      const fillArea=measuredArea(floor.footprint,[...voids(floor),...columnRects])
      add(f,'earthwork.plinthFilling',{NetVolume:Math.max(0,fillArea*fillHeight-plinthVolume)})
      add(f,'earthwork.antiTermite',{NetArea:measuredArea(floor.footprint,voids(floor))})
    }
    const assigned=new Set<Opening>()
    for(const [wi,wall] of floor.walls.filter(w=>w.kind!=='parapet').entries()) {
      const length=segLength(wall)/1000,height=(wall.heightMm??wallH*1000)/1000
      const openings=floor.openings.filter(o=>!assigned.has(o)&&hosts(wall,o));openings.forEach(o=>assigned.add(o))
      const horizontal=Math.abs(wall.a.y-wall.b.y)<=rules.toleranceMm
      const lo=horizontal?Math.min(wall.a.x,wall.b.x):Math.min(wall.a.y,wall.b.y)
      const fixed=horizontal?wall.a.y:wall.a.x
      const side=(p:{x:number;y:number})=>horizontal?p.x:p.y
      const plane=(p:{x:number;y:number})=>horizontal?p.y:p.x
      const wallRect={x:lo,y:0,w:length*1000,h:height*1000}
      const openingCuts=openings.map(o=>({x:side(o.at)-o.width/2,y:o.kind==='window'?(o.sill??rules.openingLimits.defaultSillMm):0,w:o.width,h:openingHeight(o)}))
      const frameCuts=size.columns.filter(c=>Math.abs(plane(c.at)-fixed)<=c.size/2+wall.thickness/2).map(c=>({x:side(c.at)-c.size/2,y:0,w:c.size,h:height*1000}))
      frameCuts.push(...size.beams.filter(b=>Math.abs(plane(b.a)-fixed)<=rules.toleranceMm&&Math.abs(plane(b.b)-fixed)<=rules.toleranceMm).map(b=>({x:Math.min(side(b.a),side(b.b)),y:(h*1000-b.depthMm),w:Math.abs(side(b.b)-side(b.a)),h:Math.max(0,b.depthMm-size.slabThicknessMm)})))
      frameCuts.push(...openings.map(o=>({x:side(o.at)-o.width/2-rules.openings.lintelBearingMm,y:(o.kind==='window'?(o.sill??rules.openingLimits.defaultSillMm):0)+openingHeight(o),w:o.width+2*rules.openings.lintelBearingMm,h:rules.openings.lintelDepthMm})))
      const net=measuredArea([wallRect],openingCuts),masonry=measuredArea([wallRect],[...openingCuts,...frameCuts]),thickness=wall.thickness/1000
      add(f,`masonry.${wall.thickness}`,{NetVolume:masonry*thickness,NetSideArea:masonry,Length:length,Count:1})
      add(f,'plaster.walls',{NetSideArea:net*2});add(f,'paint.walls',{NetSideArea:net*2})
      for(const [oi,o] of openings.entries()) {
        const span=(o.width+2*rules.openings.lintelBearingMm)/1000,depth=rules.openings.lintelDepthMm/1000
        concrete(f,`${floor.level}:lintel:${wi}:${oi}`,'lintels',span*thickness*depth,span*(thickness+2*depth),0,span)
        if(o.kind==='window'&&wall.kind==='exterior') {
          const p=rules.openings.chajjaProjectionMm/1000,t=rules.openings.chajjaThicknessMm/1000
          concrete(f,`${floor.level}:chajja:${wi}:${oi}`,'chajjas',span*p*t,span*p+2*(span+p)*t,span*p,span)
        }
      }
    }
    add(f,'plaster.ceiling',{NetArea:measuredArea(floor.footprint,[...voids(floor),...shafts,...(floor.stair?[stairSlabOpening(floor.stair)]:[])])})
    for(const [i,o] of floor.openings.entries()) {
      const glazed=o.kind==='window'||o.leaf===false&&o.treatment==='glazed-slide'
      if(!glazed&&o.leaf===false)continue
      const area=o.width*openingHeight(o)/1e6,id=glazed?'windows':'doors'
      add(f,`${id}.${o.width}x${openingHeight(o)}`,{NetArea:area,Count:1})
      f.members.push({id:o.id??`${floor.level}:opening:${i}`,category:id,quantities:{...zero(),NetArea:area,Count:1},steelKg:0,formworkM2:0})
      if(glazed){add(f,'glazing',{NetArea:area*rules.openings.glassRatio});if(o.kind==='window')add(f,'grills',{NetArea:area*rules.openings.grillRatio})}
    }
    for(const room of floor.rooms) {
      const area=measuredArea([room.rect],voids(floor)),kind=roomQuantityKind(room)
      if(room.outdoor) {
        if(/balcony/i.test(`${room.id} ${room.semanticId}`)) {
          const outside=rectUnionEdges([room.rect]).filter(e=>!floor.walls.some(w=>hosts(w,{kind:'door',at:{x:(e.a.x+e.b.x)/2,y:(e.a.y+e.b.y)/2},orient:e.a.y===e.b.y?'h':'v',width:Math.hypot(e.b.x-e.a.x,e.b.y-e.a.y)}))).reduce((n,e)=>n+Math.hypot(e.b.x-e.a.x,e.b.y-e.a.y)/1000,0)
          add(f,'railings.balconies',{Length:outside});add(f,'waterproofing.balconies',{NetArea:area})
        }
        continue
      }
      const roomDoors=floor.openings.filter(o=>o.kind!=='window'&&o.rooms?.includes(room.id)).reduce((n,o)=>n+o.width/1000,0)
      const p=2*(room.rect.w+room.rect.h)/1000,skirting=Math.max(0,p-roomDoors)
      add(f,`flooring.${room.semanticId||room.id}`,{NetArea:area});add(f,'flooring',{NetArea:area})
      if(kind!=='bath')add(f,'skirting',{Length:skirting,NetSideArea:skirting*rules.finishes.skirtingHeightMm/1000})
      if(kind==='bath') {
        const tileH=Math.min(wallH,rules.finishes.wetTileHeightMm/1000)
        const doorArea=floor.openings.filter(o=>o.rooms?.includes(room.id)).reduce((n,o)=>{
          const sill=o.kind==='window'?(o.sill??rules.openingLimits.defaultSillMm)/1000:0
          return n+o.width/1000*Math.max(0,Math.min(tileH,sill+openingHeight(o)/1000)-sill)
        },0)
        add(f,'wallTiles.wetRooms',{NetSideArea:Math.max(0,p*tileH-doorArea)});add(f,'waterproofing.baths',{NetArea:area})
      }
      if(kind==='kitchen')add(f,'wallTiles.kitchenDado',{NetSideArea:p*rules.finishes.kitchenDadoWallRatio*rules.finishes.kitchenDadoHeightMm/1000})
      add(f,'plumbing.points',{Count:rules.pointsByRoom[kind].plumbing});add(f,'electrical.points',{Count:rules.pointsByRoom[kind].electrical})
    }
    if(floor.stair) {
      const r=floor.stair.rect,along=['N','S'].includes(floor.stair.startSide??'N'),run=(along?r.h:r.w)/1000,across=(along?r.w:r.h)/1000
      const opening=stairSlabOpening(floor.stair),going=(along?r.h-opening.h:r.w-opening.w)/1000
      const count=floor.stair.treads.length/2+1,travel=count*going,width=across/2
      const slope=Math.hypot(travel,h/2),landing=across*Math.max(0,run-travel)
      const waist=rules.stairs.waistMm/1000
      const volume=2*width*slope*waist+2*count*width*going*(h/(count*2))/2+landing*rules.stairs.landingThicknessMm/1000
      concrete(f,`${floor.level}:stair`,'stairs',volume,2*width*slope+landing)
      add(f,'railings.stairs',{Length:2*slope*rules.stairs.guardSides})
    }
    add(f,'waterproofing.terrace',{NetArea:roofArea})
    const roofPerimeter=perimeter(roofPlates(floor),floor.courtyard)
    if(!upper) {
      add(f,'parapet',{Length:roofPerimeter,NetSideArea:roofPerimeter*rules.roof.parapetHeightMm/1000,NetVolume:roofPerimeter*rules.roof.parapetHeightMm*rules.roof.parapetThicknessMm/1e6})
      const parapet=f.items.parapet
      add(f,'masonry.parapet',{...parapet});add(f,'plaster.walls',{NetSideArea:parapet.NetSideArea*2});add(f,'paint.walls',{NetSideArea:parapet.NetSideArea*2})
      // Solid perimeter parapet; only the actual stair opening needs guard railing.
      const guards=floor.stair?rectUnionEdges([stairSlabOpening(floor.stair)]).filter(e=>e.side!==(floor.stair!.startSide??'N')).reduce((n,e)=>n+Math.hypot(e.b.x-e.a.x,e.b.y-e.a.y)/1000,0):0
      add(f,'railings.terrace',{Length:guards})
    }
    if(index===0) {
      const features=design.siteFeatures??[]
      const area=(kinds:string[])=>measuredArea(features.filter(s=>kinds.includes(s.kind)).map(s=>s.rect))
      add(f,'external.paving',{NetArea:area(['parking','path','sitOut','utilityYard'])})
      add(f,'external.driveway',{NetArea:area(['driveway'])});add(f,'external.lawn',{NetArea:area(['lawn'])});add(f,'external.pool',{NetArea:area(['pool']),Count:features.filter(s=>s.kind==='pool').length})
      const length=design.model.brief.rooms.priorities.compoundWall?Math.max(0,2*(design.model.plot.width+design.model.plot.depth)-rules.site.gateWidthMm)/1000:0
      add(f,'external.compoundWall',{Length:length,NetSideArea:length*rules.site.compoundHeightMm/1000,NetVolume:length*rules.site.compoundHeightMm*rules.site.compoundThicknessMm/1e6})
    }
    if(f.items['paint.walls'])f.items['paint.walls'].NetSideArea=Math.max(0,f.items['paint.walls'].NetSideArea-(f.items['wallTiles.wetRooms']?.NetSideArea??0)-(f.items['wallTiles.kitchenDado']?.NetSideArea??0))
    perFloor.push(f)
  }
  const total:FloorQuantities={level:-1,name:'Total',items:{},members:perFloor.flatMap(f=>f.members),steelKg:{},formworkM2:{}}
  for(const f of perFloor) {
    for(const [id,v] of Object.entries(f.items))add(total,id,v)
    for(const k of Object.keys(f.steelKg))total.steelKg[k]=(total.steelKg[k]??0)+f.steelKg[k]
    for(const k of Object.keys(f.formworkM2))total.formworkM2[k]=(total.formworkM2[k]??0)+f.formworkM2[k]
  }
  const rcc=Object.entries(total.items).filter(([id])=>id.startsWith('concrete.')).reduce((n,[,v])=>n+v.NetVolume,0)
  const masonry=Object.entries(total.items).filter(([id])=>id.startsWith('masonry.')).reduce((n,[,v])=>n+v.NetVolume,0)
  const grade=resolveSpecification(design.model.brief,'concrete-grade').id
  const parts=rules.concrete.m20Parts, dry=rcc*rules.concrete.dryFactor,sum=parts.reduce((a,b)=>a+b,0)
  const masonryType=resolveSpecification(design.model.brief,'masonry-type').id as keyof typeof rules.masonryUnitsPerM3
  const occupants=occupantCount(design.model.brief),tank=rules.tanks,storage=occupants*tank.litresPerOccupant*tank.storageDays
  const capacity=(factor:number)=>Math.max(tank.minLitres,Math.ceil(storage*factor/tank.roundLitres)*tank.roundLitres)
  return {...envelope,structureSizing:sizing,perFloor,total,
    concreteMaterials:{grade,cementBags:grade==='m20'?dry*parts[0]/sum*rules.concrete.cementDensityKgM3/rules.concrete.bagKg:null,sandM3:grade==='m20'?dry*parts[1]/sum:null,aggregateM3:grade==='m20'?dry*parts[2]/sum:null},
    masonryMaterials:{type:masonryType,Count:Math.ceil(masonry*rules.masonryUnitsPerM3[masonryType])},
    tanks:{occupants,overheadLitres:capacity(tank.overheadFraction),undergroundLitres:capacity(1)},
    assumptions:[...envelope.assumptions,rules.qualification,...rules.notes,
      'RCC includes the ground/plinth floor plate and exposed roof plates once; intermediate stair landings remain, stair/shaft voids are deducted. No pile or raft design is inferred.',
      'Columns stop at slab soffits; beams use clear spans and exclude slab depth. Masonry deducts the union of openings, columns, beams and lintels; plaster includes RCC faces.',
      'Stair RCC uses inclined waist slabs, triangular treads and a turning landing. Points, glazing fraction, grills, skirting and tank capacities are configurable allowances.',
      'Terrace perimeter is a parapet by default; guard railing is counted at the stair opening. Detailed member quantities replace legacy floor-area allowances in the BOQ.']}
}
