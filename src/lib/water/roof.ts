import type { Design } from '../engine/types.ts'
import { buildSolarRoofModel, type SolarRoofArchitecture } from '../solar/roofModel.ts'
import { regionAreaM2 } from '../solar/regions.ts'
import { planToThreeGlb } from '../solar/coordinates.ts'
import type { Rect } from '../geometry.ts'
import type { WaterConfig, WaterPoint, WaterComponent } from './schema.ts'

/** Reuses physical roof regions, NOT the solar allocation or 80% free-terrace
 * policy. Projected area is suitable for rainfall volume, not proof of drainage. */
export function waterRoof(design:Design,architecture?:SolarRoofArchitecture) {
  const roof=buildSolarRoofModel(design,{architecture})
  return {sourcePlanId:roof.sourcePlanId,roofSignature:roof.roofSignature,surfaces:roof.surfaces.filter(s=>['flat-top-roof','lower-terrace','sloping-roof'].includes(s.kind)).map(s=>({
    id:s.id,label:`${s.kind.replaceAll('-',' ')} · level ${s.level}`,regionsMm:s.regionsMm,elevationMm:s.elevationMm,
    projectedAreaM2:regionAreaM2(s.regionsMm),basis:architecture?'calculated' as const:'estimated' as const,
    note:s.kind==='sloping-roof'?'Projected catchment only. Eaves, slopes and outlets require a measured survey.':'Plan-derived projected roof area excludes represented courtyards, voids and shafts. Verify actual roof falls, obstructions and drainable area.',
  }))}
}
export type WaterRoof=ReturnType<typeof waterRoof>
export function roofPoint(regions:Rect[],elevationMm:number):WaterPoint|null {
  if(!regions.length)return null
  const r=regions[0],p=planToThreeGlb({x:r.x+r.w/2,y:r.y+r.h/2,z:elevationMm})
  return [p.x,p.y,p.z]
}
export function newWaterComponent(kind:WaterComponent['kind'],id:string):WaterComponent {
  return {id,kind,name:kind.replaceAll('_',' '),positionM:null,positionBasis:'unknown',capacityLps:null,capacityBasis:'',diversionLitres:null,efficiency:null,tankCapacityLitres:null,initialStorageLitres:null,destinationApproved:null}
}
export function addRoofCatchment(config:WaterConfig,surface:WaterRoof['surfaces'][number],id:string):WaterConfig {
  const component={...newWaterComponent('catchment',id),name:surface.label,positionM:roofPoint(surface.regionsMm,surface.elevationMm),positionBasis:'calculated' as const}
  return {...config,components:[...config.components,component],catchments:[...config.catchments,{id:`area:${id}`,componentId:id,surfaceId:surface.id,areaM2:surface.projectedAreaM2,areaBasis:surface.basis,runoffCoefficient:null,collectionEfficiency:null,note:surface.note}]}
}
/** Scaffold only. No routes, dimensions, ratings or installation positions are inferred. */
export function addHarvestingChain(config:WaterConfig,sourceId:string,ids:string[]):WaterConfig {
  if(ids.length!==7||config.connections.some(e=>e.from===sourceId)||config.components.find(n=>n.id===sourceId)?.kind!=='catchment')throw new Error('Choose an unconnected catchment and seven unique component IDs.')
  const kinds=['gutter','downpipe','first_flush','filter','tank','overflow','outlet'] as const
  const components=kinds.map((kind,i)=>newWaterComponent(kind,ids[i]))
  const connections=components.map((n,i)=>({id:`chain:${n.id}`,from:i===0?sourceId:components[i-1].id,to:n.id,kind:i>=5?'overflow' as const:'collection' as const,viaM:[],routingBasis:'concept-user-route' as const}))
  return {...config,components:[...config.components,...components],connections:[...config.connections,...connections],demands:[...config.demands,{tankId:components[4].id,dailyLitres:null,basis:'unknown'}]}
}
