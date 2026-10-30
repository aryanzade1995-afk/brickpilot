import type { BuildingModel } from '../engine/buildingModel.ts'
import type { SceneOpening, SourceBox } from './sceneTypes.ts'
import { TERRACE_LIMITS } from '../engine/terrace.ts'

export type BalconySlider = { sourceId: string; operation: 'paired-slide' | 'surface-slide'; offsetMm: number; travelMm: number; clearWidthMm: number }
/** Presentation hardware only. Never resize a wall opening or change the plan. */
export function balconySliders(building: BuildingModel): BalconySlider[] {
  const balconyIds = new Set(building.rooms.filter(r => r.outdoor && r.id.startsWith('balcony')).flatMap(r => [r.id, r.semanticId]))
  return building.doors.filter(d => d.rooms?.some(id => id !== null && balconyIds.has(id))).map(d => {
    const wall = building.walls.find(w => w.floorId === d.floorId && (d.orient === 'h' ? Math.abs(w.a.y-d.at.y)<2&&Math.abs(w.b.y-d.at.y)<2&&d.at.x>=Math.min(w.a.x,w.b.x)&&d.at.x<=Math.max(w.a.x,w.b.x) : Math.abs(w.a.x-d.at.x)<2&&Math.abs(w.b.x-d.at.x)<2&&d.at.y>=Math.min(w.a.y,w.b.y)&&d.at.y<=Math.max(w.a.y,w.b.y)))
    const balcony = building.rooms.find(r => r.floorId === d.floorId && r.outdoor && r.id.startsWith('balcony') && d.rooms?.some(id => id === r.id || id === r.semanticId))!
    const horizontal = d.orient === 'h', center = horizontal ? d.at.x : d.at.y
    const sign = (horizontal ? balcony.rect.y + balcony.rect.h / 2 - d.at.y : balcony.rect.x + balcony.rect.w / 2 - d.at.x) >= 0 ? 1 : -1
    const lo = wall ? Math.min(horizontal ? wall.a.x : wall.a.y, horizontal ? wall.b.x : wall.b.y) : center-d.width/2
    const hi = wall ? Math.max(horizontal ? wall.a.x : wall.a.y, horizontal ? wall.b.x : wall.b.y) : center+d.width/2
    const paired=d.treatment === 'glazed-slide' && d.width >= 1500
    const clearWidth=paired?(d.width-110-80)/2:d.width-110
    const travel = Math.max(0,paired?clearWidth:clearWidth+35), direction = hi-center-d.width/2 >= center-d.width/2-lo ? 1 : -1
    // Broad existing sliders keep their two-track assembly. Narrow existing
    // hinged apertures use a full-clear surface sash, rather than halving access.
    return { sourceId: d.id!, operation: paired ? 'paired-slide' : 'surface-slide',
      offsetMm: sign*((wall?.thickness ?? 200)/2+55), travelMm: direction*travel, clearWidthMm: clearWidth }
  })
}

export type RoofAccess = { opening: SceneOpening; side: string; protectedAreaMm: {x:number;y:number;w:number;h:number}; walls: { name: string; boundsMm: SourceBox }[]; cap: SourceBox }
/** The exact existing roof_services enclosure rule, shared with Blender and
 * navigation. Sizes are a concept assembly policy, not a compliance claim. */
export function roofAccess(building: BuildingModel): RoofAccess | null {
  const r=building.roofTerrace?.mumty,top=[...building.floors].sort((a,b)=>a.level-b.level).at(-1)
  if(!r||!top)return null
  const stair=building.stairs.find(s=>s.floorId===top.id)
  if(!stair)return null
  const stairRoom=building.rooms.find(r=>r.floorId===top.id&&r.id==='stair')
  const side=stair.startSide??'N',z=top.elevationMm+top.heightMm,height=TERRACE_LIMITS.headroomHeightMm,t=120
  const acrossX=side==='N'||side==='S'
  const acrossStart=acrossX?stair.rect.x:stair.rect.y,acrossSize=acrossX?stair.rect.w:stair.rect.h
  // The return flight reaches the top on the second half of the source nosings.
  // Keep the descending-flight half as a solid wall, never a second door leaf.
  const returnLines=(stair.treads??[]).filter(line=>line.length===2&&line.every(p=>Number.isFinite(acrossX?p.x:p.y)))
    .map(line=>line.map(p=>acrossX?p.x:p.y).sort((a,b)=>a-b))
    .filter(([a,b])=>(a+b)/2>=acrossStart+acrossSize/2)
  if(!returnLines.length)return null
  const flightLo=Math.min(...returnLines.map(l=>l[0])),flightHi=Math.max(...returnLines.map(l=>l[1]))
  // Keep the jamb clear of the perimeter parapet as well as the flight edge.
  // These 30/50 mm assembly allowances are not statutory access dimensions.
  const parapet=building.quantityRules?.roof.parapetThicknessMm??0
  const clearLo=Math.max(flightLo+50,acrossStart+parapet+30)
  const clearHi=Math.min(flightHi-50,acrossStart+acrossSize-parapet-30)
  const doorWidth=Math.min(900,clearHi-clearLo)
  if(doorWidth<750)return null
  const sides=[['N',true,r.y,r.x,r.w],['S',true,r.y+r.h,r.x,r.w],['W',false,r.x,r.y,r.h],['E',false,r.x+r.w,r.y,r.h]] as const
  const walls:RoofAccess['walls']=[]
  let opening:SceneOpening|null=null
  for(const [name,horizontal,fixed,lo,length] of sides){
    let spans=[[lo,length,0,height]]
    if(name===side){
      const width=doorWidth,margin=(clearLo+clearHi-width)/2-lo
      const right=length-margin-width
      if(margin<0||right<0)return null
      spans=[[lo,margin,0,height],[lo+margin+width,right,0,height],[lo+margin,width,2100,height-2100]]
      const a:SourceBox=horizontal?{x:lo+margin,y:fixed-t/2,z,w:width,d:t,h:2100}:{x:fixed-t/2,y:lo+margin,z,w:t,d:width,h:2100}
      opening={id:'roof-stair-exit',sourceId:'ROOF_STAIR_EXIT',floorId:top.id,wallId:`Roof_Mumty_${name}`,kind:'door',orient:horizontal?'h':'v',apertureMm:a,sillMm:0,headMm:2100,headBasis:'explicit',operation:'door-leaf-unmodelled',hinge:'a',swing:name==='N'||name==='W'?-1:1,rooms:stairRoom?[JSON.stringify([top.id,stairRoom.id]),null]:null}
    }
    spans.forEach(([at,w,bottom,h],i)=>{if(w<=0||h<=0)return;walls.push({name:`Roof_Mumty_${name}_${i}`,boundsMm:horizontal?{x:at,y:fixed-t/2,z:z+bottom,w,d:t,h}:{x:fixed-t/2,y:at,z:z+bottom,w:t,d:w,h}})})
  }
  if(!opening)return null
  const a=opening.apertureMm,horizontal=opening.orient==='h',length=Math.max(1200,(horizontal?a.w:a.d)/2+350)
  const protectedAreaMm=horizontal?{x:a.x-300,y:side==='N'?r.y-length:r.y+r.h,w:a.w+600,h:length}:{x:side==='W'?r.x-length:r.x+r.w,y:a.y-300,w:length,h:a.d+600}
  return {opening,side,protectedAreaMm,walls,cap:{x:r.x,y:r.y,z:z+height,w:r.w,d:r.h,h:120}}
}
