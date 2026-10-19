import type {Design} from '../engine/types.ts'
import type {Brief} from '../model/brief.ts'
import {occupantCount} from '../model/brief.ts'
import {resolveSpecification} from './catalogue.ts'
import {quantityRules} from './data/quantityRules.ts'
import {PLUMBING_SIZES} from './plumbingCatalogue.ts'

export type PipeRun={id:string;floor:number;floorName:string;system:'water'|'drain';purpose:'Water branches'|'Water riser'|'Waste branches'|'Soil / drain stack';diameterMm:number;lengthM:number;points:number;sizeBasis:'nominal'|'outside'}
export type ServiceTank={kind:'water'|'chamber'|'septic'|'holding';capacityLitres:number;lengthM:number;widthM:number;depthM:number;pricingUnits:number}
export type PlumbingSchedule={schemaVersion:1;occupants:number;overheadLitres:number;underground:ServiceTank|null;drain:ServiceTank|null;runs:PipeRun[];waterLengthM:number;drainLengthM:number;notes:string[]}
export const PLUMBING_NOTES=[
  'Pipe lengths are concept allowances from wet-room points and floor heights, not a surveyed pipe route.',
  'Water branches allow 8 m per point. Waste/soil share 6 m per point (60/40); risers use floor heights and the water main includes a 5 m ground feed.',
  'Diameter adjustments use provisional size factors. Fittings and normal installation are included in the per-metre allowance; supplier quotation required.',
  'Supply sizes are nominal. Waste/soil sizes are outside diameters. Hydraulic checks, gradients and vent sizing are not inferred.',
  'Underground tank dimensions describe usable storage only, before wall thickness and freeboard. Tank siting, excavation safety and sewage disposal need a site design.',
]
export function tankDimensions(capacityLitres:number,kind:ServiceTank['kind']):ServiceTank{
  if(kind==='chamber')return {kind,capacityLitres:0,lengthM:.6,widthM:.6,depthM:.9,pricingUnits:1}
  const depthM=1.5,ratio=kind==='water'?1.5:2.5,widthM=Math.sqrt(capacityLitres/1000/depthM/ratio)
  return {kind,capacityLitres,widthM,lengthM:widthM*ratio,depthM,pricingUnits:capacityLitres/1000}
}
export function plumbingSchedule(design:Design,brief:Brief=design.model.brief):PlumbingSchedule{
  const rules=quantityRules.tanks,occupants=occupantCount(brief),storage=occupants*rules.litresPerOccupant*rules.storageDays
  const round=(factor:number)=>Math.max(rules.minLitres,Math.ceil(storage*factor/rules.roundLitres)*rules.roundLitres)
  const water=resolveSpecification(brief,'underground-water-tank').id,drain=resolveSpecification(brief,'drain-tank').id
  const underground=water==='off'?null:tankDimensions(water==='auto'?round(1):Number(water.slice(1)),'water')
  const tank=drain==='off'?null:drain==='chamber'?tankDimensions(0,'chamber'):tankDimensions(Number(drain.replace(/\D/g,'')),drain.startsWith('septic')?'septic':'holding')
  const size=(id:keyof typeof PLUMBING_SIZES)=>Number(resolveSpecification(brief,id).id.slice(2))
  const runs:PipeRun[]=[]
  for(const floor of design.floors){
    const points=floor.rooms.filter(r=>!r.outdoor).reduce((n,r)=>{
      const id=`${r.id} ${r.semanticId} ${r.name}`.toLowerCase()
      return n+(/bath|toilet|washroom/.test(id)?quantityRules.pointsByRoom.bath.plumbing:/kitchen/.test(id)?quantityRules.pointsByRoom.kitchen.plumbing:/utility|laundry/.test(id)?quantityRules.pointsByRoom.utility.plumbing:0)
    },0)
    if(!points)continue
    const add=(purpose:PipeRun['purpose'],system:PipeRun['system'],id:keyof typeof PLUMBING_SIZES,lengthM:number)=>runs.push({id:`${floor.level}:${id}`,floor:floor.level,floorName:floor.name,system,purpose,diameterMm:size(id),lengthM:Math.round(lengthM*100)/100,points,sizeBasis:system==='water'?'nominal':'outside'})
    add('Water branches','water','water-pipe-size',points*8)
    add('Water riser','water','water-riser-size',brief.levels.floorToFloor+(floor.level===0?5:0))
    add('Waste branches','drain','waste-pipe-size',points*6*.6)
    add('Soil / drain stack','drain','soil-pipe-size',points*6*.4+brief.levels.floorToFloor)
  }
  return {schemaVersion:1,occupants,overheadLitres:round(rules.overheadFraction),underground,drain:tank,runs,
    waterLengthM:runs.filter(r=>r.system==='water').reduce((n,r)=>n+r.lengthM,0),drainLengthM:runs.filter(r=>r.system==='drain').reduce((n,r)=>n+r.lengthM,0),notes:[...PLUMBING_NOTES]}
}
