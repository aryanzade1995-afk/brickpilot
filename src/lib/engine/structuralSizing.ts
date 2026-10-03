import type { Design, FloorPlan } from './types.ts'
import type { Beam, Column } from './planner/types.ts'
import type { Point, Rect } from '../geometry.ts'
import { quantityRules as rules } from '../cost/data/quantityRules.ts'
import { resolveSpecification } from '../cost/catalogue.ts'

export type ColumnPosition = 'corner'|'edge'|'interior'
export type SizedColumn = Column & {position:ColumnPosition}
export type SizedBeam = Beam & {widthMm:number;depthMm:number}
export type Footing = {id:string;columnId:string;rect:Rect;thicknessMm:number;bottomMm:number}
export type FloorSizing = {level:number;columns:SizedColumn[];beams:SizedBeam[];slabThicknessMm:number}
export type StructuralSizing = {version:string;qualification:string;storeys:number;soilClass:'unknown'|'firm'|'rock';plinthHeightMm:number;footings:Footing[];plinthBeams:SizedBeam[];floors:FloorSizing[]}
export function columnPosition(at:Point,plate:Rect[]):ColumnPosition {
  const t=rules.toleranceMm
  const quadrants=[[-t,-t],[-t,t],[t,-t],[t,t]].filter(([x,y])=>plate.some(r=>at.x+x>r.x&&at.x+x<r.x+r.w&&at.y+y>r.y&&at.y+y<r.y+r.h)).length
  return quadrants===4?'interior':quadrants<=1?'corner':'edge'
}
export function columnSizeMm(storeys:number,position:ColumnPosition):number {
  return rules.columnsByStoreysMm[Math.min(rules.columnsByStoreysMm.length,Math.max(1,storeys))-1][position]
}
export const beamDepthMm=(spanMm:number):number=>Math.max(rules.beam.minDepthMm,Math.ceil(spanMm/rules.beam.spanDepthRatio/rules.beam.roundMm)*rules.beam.roundMm)
export const slabThicknessMm=(spanMm:number):number=>spanMm<=rules.slab.shortSpanLimitMm?rules.slab.shortThicknessMm:rules.slab.longThicknessMm
export function sizeFloor(floor:FloorPlan,storeys:number):FloorSizing {
  const columns=(floor.columns??[]).map(c=>{const position=columnPosition(c.at,floor.footprint);return {...c,at:{...c.at},position,size:columnSizeMm(storeys,position)}})
  const beams=(floor.beams??[]).map(b=>({...b,a:{...b.a},b:{...b.b},widthMm:rules.beam.widthMm,depthMm:beamDepthMm(Math.hypot(b.b.x-b.a.x,b.b.y-b.a.y))}))
  const span=beams.length?Math.max(...beams.map(b=>Math.hypot(b.b.x-b.a.x,b.b.y-b.a.y))):Math.max(...floor.footprint.map(r=>Math.min(r.w,r.h)),0)
  return {level:floor.level,columns,beams,slabThicknessMm:slabThicknessMm(span)}
}
/** Derived from the existing grid only. Does not move rooms, grid centres or openings. */
export function sizeStructure(design:Design,storeys=design.floors.length):StructuralSizing {
  const brief=design.model.brief
  const soilClass=resolveSpecification(brief,'soil-type').id as StructuralSizing['soilClass']
  const plinthChoice=resolveSpecification(brief,'plinth-height').id as keyof typeof rules.plinthHeightsMm
  const plinthHeightMm=rules.plinthHeightsMm[plinthChoice]
  const floors=design.floors.map(f=>sizeFloor(f,storeys)), ground=[...floors].sort((a,b)=>a.level-b.level)[0]
  const f=rules.footing, width=Math.ceil((f.baseWidthMm+(storeys-1)*f.perStoreyMm)*f.soilFactors[soilClass]/f.roundMm)*f.roundMm
  const thicknessMm=f.thicknessMm+(storeys-1)*f.perStoreyThicknessMm
  return {version:rules.version,qualification:rules.qualification,storeys,soilClass,plinthHeightMm,floors,
    footings:(ground?.columns??[]).map(c=>({id:`Footing_${c.id}`,columnId:c.id,rect:{x:c.at.x-width/2,y:c.at.y-width/2,w:width,h:width},thicknessMm,bottomMm:-plinthHeightMm-f.depthBelowGradeMm})),
    plinthBeams:(ground?.beams??[]).map(b=>({...b,id:`Plinth_${b.id}`,widthMm:rules.plinthBeam.widthMm,depthMm:rules.plinthBeam.depthMm}))}
}
/** Legacy drawings acquire metadata without mutating saved floor geometry. */
export function drawingStructure(floor:FloorPlan,model:Design['model']):NonNullable<FloorPlan['structuralSizing']> {
  const sizing=sizeStructure({floors:[floor],model} as Design,model.brief.levels.storeys)
  return {...sizing.floors[0],qualification:sizing.qualification,...(floor.level===0?{footings:sizing.footings,plinthBeams:sizing.plinthBeams,plinthHeightMm:sizing.plinthHeightMm}:{})}
}
/** Attach derived member metadata after planning; all spatial coordinates stay intact. */
export function exposeStructuralSizing(design:Design):Design {
  const sizing=sizeStructure(design)
  design.structuralSizing=sizing
  for(const floor of design.floors) {
    const size=sizing.floors.find(s=>s.level===floor.level)!
    floor.structuralSizing={...size,qualification:sizing.qualification,
      ...(floor.level===Math.min(...design.floors.map(f=>f.level))?{footings:sizing.footings,plinthBeams:sizing.plinthBeams,plinthHeightMm:sizing.plinthHeightMm}:{})}
  }
  return design
}
