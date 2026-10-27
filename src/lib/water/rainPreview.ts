import type { BuildingModel } from '../engine/buildingModel.ts'
import type { VillaPlumbing } from '../plumbing/villaPlumbing.ts'
import type { RainCollection } from './simpleSystem.ts'
import { subtractRegions } from '../solar/regions.ts'
import type { Rect } from '../geometry.ts'

type Surface={rect:Rect;topMm:number;kind:'roof'|'garden'|'equipment'}
type Circle={x:number;y:number;radiusMm:number;topMm:number}
export type RainDrop={impact:[number,number,number];phase:number;speedMps:number;lengthM:number;wind:[number,number];surface:Surface['kind'];canSplash:boolean}
export type RainField={version:'rain-preview-v1';topM:number;drops:RainDrop[];splashCount:number}
const inside=(r:Rect,x:number,y:number)=>x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h
/** Height-only visual collision model derived from source roof unions, courtyard
 * openings, headroom, canopies and current tank dimensions. It does not mutate
 * architecture, sample sensor data, or calculate harvested litres. */
export function rainSurfaces(building:BuildingModel,ports:VillaPlumbing['tankPorts'],roofHeightScale:number,tank:RainCollection['tank']) {
  const surfaces:Surface[]=[],circles:Circle[]=[]
  for(const f of building.floors){const regions=subtractRegions(f.footprint,[...(f.courtyard?[f.courtyard]:[]),...building.shafts.filter(s=>s.floorId===f.id).map(s=>s.rect)])
    // A double-height interior void is not an opening through its roof cap.
    for(const rect of regions)surfaces.push({rect,topMm:f.elevationMm+f.heightMm,kind:'roof'})
  }
  for(const c of building.modernComposition?.canopies??[])surfaces.push({rect:c.rect,topMm:c.bottomMm+c.thicknessMm,kind:'roof'})
  const top=[...building.floors].sort((a,b)=>a.level-b.level).at(-1)
  if(top&&building.roofTerrace?.mumty)surfaces.push({rect:building.roofTerrace.mumty,topMm:top.elevationMm+top.heightMm+2320,kind:'roof'})
  for(const p of ports){const base=p.center.z-200
    circles.push({x:p.center.x,y:p.center.y,radiusMm:p.radiusMm,topMm:base+1000*roofHeightScale},
      {x:p.center.x,y:p.center.y,radiusMm:p.radiusMm*.82,topMm:base+1065*roofHeightScale},
      {x:p.center.x,y:p.center.y,radiusMm:p.radiusMm*.22,topMm:base+1135*roofHeightScale})
  }
  if(tank)circles.push({x:tank.center.x,y:tank.center.y,radiusMm:tank.radiusMm,topMm:tank.center.z+tank.heightMm/2+80})
  return {surfaces,circles}
}
export function rainImpactAt(model:ReturnType<typeof rainSurfaces>,xMm:number,yMm:number) {
  let topMm=0,kind:Surface['kind']='garden'
  for(const s of model.surfaces)if(s.topMm>topMm&&inside(s.rect,xMm,yMm)){topMm=s.topMm;kind=s.kind}
  for(const c of model.circles)if(c.topMm>topMm&&Math.hypot(xMm-c.x,yMm-c.y)<=c.radiusMm){topMm=c.topMm;kind='equipment'}
  return {topMm,kind}
}
export function createRainField(building:BuildingModel,ports:VillaPlumbing['tankPorts'],roofHeightScale=1,tank:RainCollection['tank']=null):RainField {
  if(!Number.isFinite(roofHeightScale)||roofHeightScale<.5||roofHeightScale>1.5||![building.plot.widthMm,building.plot.depthMm].every(n=>Number.isFinite(n)&&n>0))throw new RangeError('Rain preview needs valid house bounds and tank dimensions.')
  const model=rainSurfaces(building,ports,roofHeightScale,tank),highest=Math.max(0,...model.surfaces.map(s=>s.topMm),...model.circles.map(c=>c.topMm))
  let seed=2166136261;for(const c of building.planId)seed=Math.imul(seed^c.charCodeAt(0),16777619)>>>0
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
  // Surround the property with weather as well as raining directly on it; a
  // hard plot-sized particle box looks like an isolated column of water.
  const margin=6000,count=Math.min(2000,Math.max(650,Math.round((building.plot.widthMm+2*margin)*(building.plot.depthMm+2*margin)/1e6*2.2))),drops:RainDrop[]=[]
  for(let i=0;i<count;i++){const x=random()*(building.plot.widthMm+2*margin)-margin,y=random()*(building.plot.depthMm+2*margin)-margin,hit=rainImpactAt(model,x,y)
    // Stay vertical beside roof edges/holes; a slanted streak must not travel
    // through a wall before reaching a courtyard or garden impact point.
    const clear=[[-350,0],[350,0],[0,-350],[0,350],[-350,-350],[-350,350],[350,-350],[350,350]].every(([dx,dy])=>rainImpactAt(model,x+dx,y+dy).topMm===hit.topMm)
    drops.push({impact:[x/1000,hit.topMm/1000+.025,-y/1000],phase:random(),speedMps:9+random()*4,lengthM:.5+random()*.5,wind:clear?[.32,.10]:[0,0],surface:hit.kind,canSplash:x>=0&&x<=building.plot.widthMm&&y>=0&&y<=building.plot.depthMm})
  }
  return {version:'rain-preview-v1',topM:highest/1000+4,drops,splashCount:Math.min(240,drops.filter(d=>d.canSplash).length)}
}
