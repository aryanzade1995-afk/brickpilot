import type { Point, Rect } from '../geometry.ts'
import { rectUnionArea } from '../geometry.ts'
import type { BuildingModel } from './buildingModel.ts'
import type { MassingModel } from './massing/model.ts'
import { massRect } from './massing/transforms.ts'
import type { ProceduralFacadeModel } from './facade/proceduralTypes.ts'
import { CAR_LENGTH_MM, CAR_WIDTH_MM, CAR_HEIGHT_MM, CAR_MARGIN_MM } from './outdoorAssets.ts'

export type OutdoorSolid = Rect & { z: number; height: number }
export type CoveredOutdoorModel = {
  schemaVersion: 1; sourcePlanId: string
  roofs: { id: string; roomId: string; rect: Rect; slabs: Rect[]; posts: Rect[] }[]
  cars: { id: string; roomId: string; rect: Rect; alongY: boolean }[]
  issues: { code: string; message: string; roomId: string }[]
  omissions: string[]
  /** roof pieces deliberately left open to the sky because no safe pillar layout exists */
  openRoofs?: string[]
}
export const OUTDOOR_POST_MM = 250
const SLAB = 200, MAX_SPAN = 4800, CLEAR = 40
const overlaps = (a: Rect, b: Rect) => Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>1 &&
  Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>1
export const outdoorIntersects = (a: OutdoorSolid, b: OutdoorSolid) => overlaps(a,b) &&
  Math.min(a.z+a.height,b.z+b.height)-Math.max(a.z,b.z)>1
const contains = (a: Rect, b: Rect) => b.x>=a.x && b.y>=a.y && b.x+b.w<=a.x+a.w && b.y+b.h<=a.y+a.h
const pad = (r: Rect, n: number): Rect => ({x:r.x-n,y:r.y-n,w:r.w+2*n,h:r.h+2*n})
const covered = (r: Rect, plates: Rect[]) => {
  const clips=plates.map(p=>({x:Math.max(r.x,p.x),y:Math.max(r.y,p.y),
    w:Math.max(0,Math.min(r.x+r.w,p.x+p.w)-Math.max(r.x,p.x)),
    h:Math.max(0,Math.min(r.y+r.h,p.y+p.h)-Math.max(r.y,p.y))})).filter(p=>p.w>0&&p.h>0)
  return rectUnionArea(clips)>=r.w*r.h-1
}
/** Same ordered bands as Blender's slab subtraction. */
const subtract = (r: Rect, cutters: Rect[]) => cutters.reduce<Rect[]>((pieces,c)=>pieces.flatMap(p=>{
  const x0=Math.max(p.x,c.x),y0=Math.max(p.y,c.y),x1=Math.min(p.x+p.w,c.x+c.w),y1=Math.min(p.y+p.h,c.y+c.h)
  if(x1<=x0||y1<=y0)return [p]
  return [{x:p.x,y:p.y,w:x0-p.x,h:p.h},{x:x1,y:p.y,w:p.x+p.w-x1,h:p.h},
    {x:x0,y:p.y,w:x1-x0,h:y0-p.y},{x:x0,y:y1,w:x1-x0,h:p.y+p.h-y1}].filter(b=>b.w>.01&&b.h>.01)
}),[r])
function inset(r: Rect, house: Rect[]): Rect {
  let {x,y,w,h}=r
  if(house.some(p=>Math.abs(p.x+p.w-r.x)<=2&&Math.min(p.y+p.h,r.y+r.h)>Math.max(p.y,r.y))){x+=160;w-=160}
  if(house.some(p=>Math.abs(p.x-r.x-r.w)<=2&&Math.min(p.y+p.h,r.y+r.h)>Math.max(p.y,r.y)))w-=160
  if(house.some(p=>Math.abs(p.y+p.h-r.y)<=2&&Math.min(p.x+p.w,r.x+r.w)>Math.max(p.x,r.x))){y+=160;h-=160}
  if(house.some(p=>Math.abs(p.y-r.y-r.h)<=2&&Math.min(p.x+p.w,r.x+r.w)>Math.max(p.x,r.x)))h-=160
  return {x,y,w,h}
}

/** Physical blockers shared by the porch planner and the fresh geometry gate. */
export function outdoorBlockers(building: BuildingModel, massing: MassingModel, facade: ProceduralFacadeModel): OutdoorSolid[] {
  const floors=new Map(building.floors.map(f=>[f.id,f]))
  const parts=[...facade.features.flatMap(f=>f.parts.map(p=>p.world)),
    ...(facade.specialized?.assemblies??[]).flatMap(a=>a.parts.filter(p=>p.operation==='ADD').map(p=>p.world))]
  const columns=building.columns.map(c=>({x:c.at.x-c.size/2,y:c.at.y-c.size/2,w:c.size,h:c.size,
    z:floors.get(c.floorId)!.elevationMm,height:floors.get(c.floorId)!.heightMm}))
  const walls=building.walls.map(w=>{
    const h=Math.abs(w.a.y-w.b.y)<=2, f=floors.get(w.floorId)!
    return {x:h?Math.min(w.a.x,w.b.x):w.a.x-w.thickness/2,
      y:h?w.a.y-w.thickness/2:Math.min(w.a.y,w.b.y),
      w:h?Math.abs(w.b.x-w.a.x):w.thickness,h:h?w.thickness:Math.abs(w.b.y-w.a.y),
      z:f.elevationMm,height:w.heightMm??f.heightMm}
  })
  const openings=building.doors.map(o=>{
    const f=floors.get(o.floorId)!, h=o.orient==='h', approach=900
    return {x:o.at.x-(h?o.width/2+100:approach),y:o.at.y-(h?approach:o.width/2+100),
      w:h?o.width+200:2*approach,h:h?2*approach:o.width+200,z:f.elevationMm,height:o.head??2300}
  })
  const ground=[...building.floors].sort((a,b)=>a.level-b.level)[0]
  const paths=(building.siteFeatures??[]).filter(f=>['driveway','path','pool','utilityYard'].includes(f.kind))
    .map(f=>({...f.rect,z:ground.elevationMm-500,height:ground.heightMm+500}))
  return [...parts,...columns,...walls,...openings,...paths,
    ...massing.masses.filter(m=>m.usage!=='terrace').map(m=>({...massRect(m),z:m.elevation,height:m.height}))]
}

/** Additional objects are placed against the edited source geometry, before Blender runs. */
export function planCoveredOutdoor(building: BuildingModel, massing: MassingModel, facade: ProceduralFacadeModel, omitCars = false, openWhenUnsafe = false): CoveredOutdoorModel {
  const out: CoveredOutdoorModel={schemaVersion:1,sourcePlanId:building.planId,roofs:[],cars:[],issues:[],omissions:[],openRoofs:[]}
  const floors=[...building.floors].sort((a,b)=>a.level-b.level),ground=floors[0],upper=floors[1]
  const grade=ground.elevationMm-(building.structuralSizing?.plinthHeightMm??400),top=ground.elevationMm+ground.heightMm
  const z=grade+70,height=top-SLAB-z
  const blockers=outdoorBlockers(building,massing,facade)
  const sourceParts=[...facade.features.flatMap(f=>f.parts.map(p=>p.world)),
    ...(facade.specialized?.assemblies??[]).filter(a=>['BALCONY','ENTRANCE','DEPTH'].includes(a.category))
      .flatMap(a=>a.parts.filter(p=>p.operation==='ADD').map(p=>p.world))]
  const cuts=sourceParts.filter(p=>p.z<top+1100&&p.z+p.height>top-SLAB).map(p=>pad(p,20))
  const shelters=[...(upper?.footprint??[]),...massing.masses.filter(m=>['terrace','canopy'].includes(m.usage)&&m.elevation<top+400).map(massRect)]
  const rooms=building.rooms.filter(r=>r.floorId===ground.id&&r.outdoor&&(['parking','verandah'].includes(r.id)||r.id.startsWith('verandahWing')))
  const acceptedPosts: Rect[]=[]
  for(const room of rooms){
    const r=room.rect
    if(room.id==='parking'&&!omitCars){
      const drive=building.siteFeatures?.find(f=>f.kind==='driveway')?.rect
      const preferred=drive?Math.abs(drive.y-r.y-r.h)<=2||Math.abs(drive.y+drive.h-r.y)<=2:r.h>=r.w
      let placed=false
      for(const alongY of [preferred,!preferred]){
        const cross=alongY?r.w:r.h,run=alongY?r.h:r.w
        if(run<CAR_LENGTH_MM+2*CAR_MARGIN_MM)continue
        for(let n=Math.min(2,Math.floor(cross/(CAR_WIDTH_MM+2*CAR_MARGIN_MM)));n>=1;n--){
          const cars=Array.from({length:n},(_,i)=>{
            const cx=r.x+(alongY?cross*(i+.5)/n:r.w/2),cy=r.y+(alongY?r.h/2:cross*(i+.5)/n)
            return {id:`GF_Parking_Car_${i+1}`,roomId:room.semanticId,alongY,
              rect:{x:cx-(alongY?CAR_WIDTH_MM:CAR_LENGTH_MM)/2,y:cy-(alongY?CAR_LENGTH_MM:CAR_WIDTH_MM)/2,
                w:alongY?CAR_WIDTH_MM:CAR_LENGTH_MM,h:alongY?CAR_LENGTH_MM:CAR_WIDTH_MM}}
          })
          if(cars.every(c=>contains(r,pad(c.rect,CAR_MARGIN_MM))&&!blockers.some(b=>outdoorIntersects({...pad(c.rect,CLEAR),z,height:CAR_HEIGHT_MM},b)))){
            out.cars.push(...cars);placed=true;break
          }
        }
        if(placed)break
      }
      if(!placed)out.omissions.push(`${room.name}: car omitted because the resized bay has no clear space for a full-size car.`)
    }
    const carBlocks=out.cars.map(c=>({...c.rect,z,height:CAR_HEIGHT_MM}))
    for(const [index,piece] of subtract(r,shelters).entries()){
      if(piece.w<600||piece.h<600)continue
      const roof={id:`GF_${room.id}_Roof_${String(index+1).padStart(2,'0')}`,roomId:room.semanticId,rect:piece,
        slabs:subtract(inset(piece,ground.footprint),cuts).filter(s=>s.w>=50&&s.h>=50),posts:[] as Rect[]}
      const corners=[{x:piece.x+125,y:piece.y+125},{x:piece.x+piece.w-125,y:piece.y+125},
        {x:piece.x+125,y:piece.y+piece.h-125},{x:piece.x+piece.w-125,y:piece.y+piece.h-125}]
      const free=corners.filter(c=>!ground.footprint.some(p=>c.x>=p.x-200&&c.x<=p.x+p.w+200&&c.y>=p.y-200&&c.y<=p.y+p.h+200))
      const anchors=[...free]
      for(let i=0;i<free.length;i++)for(let j=i+1;j<free.length;j++){
        const a=free[i],b=free[j],gap=Math.abs(a.x-b.x)+Math.abs(a.y-b.y)
        if((a.x===b.x||a.y===b.y)&&gap>MAX_SPAN){
          const n=Math.floor(gap/MAX_SPAN)
          for(let k=1;k<=n;k++)anchors.push({x:a.x+(b.x-a.x)*k/(n+1),y:a.y+(b.y-a.y)*k/(n+1)})
        }
      }
      const candidates=(a: Point)=>[a,...[100,-100,200,-200,350,-350,500,-500,700,-700].flatMap(d=>
        [{x:a.x+d,y:a.y},{x:a.x,y:a.y+d}])].filter(p=>p.x>=piece.x+125&&p.x<=piece.x+piece.w-125&&p.y>=piece.y+125&&p.y<=piece.y+piece.h-125)
      let failed=false
      const bearings: { anchor: Point; center: Point }[]=[]
      for(const a of anchors){
        const post=candidates(a).map(p=>({x:p.x-125,y:p.y-125,w:OUTDOOR_POST_MM,h:OUTDOOR_POST_MM})).find(p=>
          covered(p,roof.slabs)&&![...blockers,...carBlocks].some(b=>outdoorIntersects({...pad(p,CLEAR),z,height},b))&&
          [...acceptedPosts,...roof.posts].every(q=>!overlaps(pad(p,CLEAR),q)||JSON.stringify(p)===JSON.stringify(q)))
        if(!post){failed=true;break}
        bearings.push({anchor:a,center:{x:post.x+125,y:post.y+125}})
        if(![...acceptedPosts,...roof.posts].some(q=>JSON.stringify(q)===JSON.stringify(post)))roof.posts.push(post)
      }
      // Relocation cannot turn a checked 4.8 m support bay into a larger unsupported span.
      if(!failed)for(let i=0;i<free.length;i++)for(let j=i+1;j<free.length;j++){
        const a=free[i],b=free[j]
        if(a.x!==b.x&&a.y!==b.y)continue
        const horizontal=a.y===b.y
        const bearing=bearings.filter(p=>horizontal?p.anchor.y===a.y:p.anchor.x===a.x)
          .sort((p,q)=>horizontal?p.anchor.x-q.anchor.x:p.anchor.y-q.anchor.y)
        if(bearing.some((p,k)=>k>0&&Math.hypot(p.center.x-bearing[k-1].center.x,p.center.y-bearing[k-1].center.y)>MAX_SPAN+1))failed=true
      }
      if((failed||!roof.slabs.length)&&openWhenUnsafe){
        // never build an unsafe pillar: this part of the porch stays open to the sky instead
        out.openRoofs!.push(roof.id);out.omissions.push(`${room.name}: part of the roof left open because its pillars cannot fit clear of the walls, doors, cars and exterior objects.`);continue
      }
      if(failed||!roof.slabs.length){out.issues.push({code:'OUTDOOR_SUPPORT_COLLISION',roomId:room.semanticId,
        message:`${room.name}: its roof pillars cannot fit clear of the edited walls, doors, cars and exterior objects.`});continue}
      acceptedPosts.push(...roof.posts);out.roofs.push(roof)
    }
  }
  // Display furniture must never prevent the real porch from receiving safe bearings.
  if((out.issues.length||out.openRoofs!.length)&&out.cars.length&&!omitCars){
    const withoutCars=planCoveredOutdoor(building,massing,facade,true,openWhenUnsafe)
    // dropping the display cars is better than a failed or partly open porch
    if(!withoutCars.issues.length&&(out.issues.length>0||withoutCars.openRoofs!.length<out.openRoofs!.length)){withoutCars.omissions.push('Display cars omitted to keep the porch pillars and circulation clear.');return withoutCars}
  }
  return out
}
