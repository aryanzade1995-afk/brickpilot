import type { BuildingModel } from '../engine/buildingModel.ts'
import { realizeSourceStair } from './stairs.ts'

type V3 = [number, number, number]
export const STAIR_GUARD_VERSION = 'stair-guards-v1'
/** Concept metal guard profile, not a structural/code certification. Placement
 * derives only from the recorded nosings and elevations. No stair is widened. */
export const STAIR_GUARD_PROFILE = { heightMm: 1000, railMm: 40, postMm: 30, maxPostSpacingMm: 850, maxInfillSpacingMm: 110 } as const
export type StairGuardPart = { id: string; stairId: string; floorId: string; kind: 'handrail' | 'post' | 'infill';
  fromMm: V3; toMm: V3; verticesMm: V3[]; faces: number[][]; material: 'metal' | 'timber' }

function beam(from: V3, to: V3, width: number): V3[] {
  const d=to.map((v,i)=>v-from[i]), length=Math.hypot(...d), n=d.map(v=>v/length)
  const u: V3 = Math.abs(n[2])>.99 ? [1,0,0] : [-n[1],n[0],0]
  const ul=Math.hypot(...u);u.forEach((v,i)=>u[i]=v/ul)
  const v=[n[1]*u[2]-n[2]*u[1],n[2]*u[0]-n[0]*u[2],n[0]*u[1]-n[1]*u[0]]
  return [from,to].flatMap(p=>[[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>p.map((x,i)=>x+width/2*(a*u[i]+b*v[i])) as V3))
}

export function createStairGuards(building: BuildingModel) {
  const parts: StairGuardPart[]=[], issues: {stairId:string; message:string}[]=[]
  for(const stair of building.stairs) {
    const floor=building.floors.find(f=>f.id===stair.floorId)
    try {
      if(!floor || !stair.startSide || !building.quantityRules?.stairs)throw new Error('Stair source dimensions are incomplete.')
      const geometry=realizeSourceStair(stair,floor,null,building.quantityRules.stairs), r=stair.rect, side=stair.startSide
      const local=(x:number,y:number):[number,number]=>side==='N'?[x-r.x,y-r.y]:side==='S'?[x-r.x,r.y+r.h-y]:side==='W'?[y-r.y,x-r.x]:[y-r.y,r.x+r.w-x]
      const world=(a:number,b:number,z:number):V3=>side==='N'?[r.x+a,r.y+b,z]:side==='S'?[r.x+a,r.y+r.h-b,z]:side==='W'?[r.x+b,r.y+a,z]:[r.x+r.w-b,r.y+a,z]
      const lines=stair.treads.map(line=>line.map(p=>local(p.x,p.y))), across=side==='N'||side==='S'?r.w:r.h
      const first=lines.filter(l=>(l[0][0]+l[1][0])/2<across/2), second=lines.filter(l=>(l[0][0]+l[1][0])/2>=across/2)
      const a=Math.max(...first[0].map(p=>p[0])), b=Math.min(...second[0].map(p=>p[0])), gap=b-a
      if(gap<2*STAIR_GUARD_PROFILE.railMm+4)throw new Error('No clear stair well for this guard profile; a wall-mounted handrail needs review.')
      const travel=geometry.goingMm*geometry.stepCount/2, count=geometry.stepCount/2, base=floor.elevationMm, rise=geometry.riseMm, h=STAIR_GUARD_PROFILE.heightMm
      const add=(id:string,kind:StairGuardPart['kind'],fromMm:V3,toMm:V3,width:number)=>parts.push({id:`${floor.id}_${stair.id}_Guard_${id}`,stairId:stair.id,floorId:floor.id,kind,fromMm,toMm,
        verticesMm:beam(fromMm,toMm,width),faces:[[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]],material:'metal'})
      for(const flight of [0,1]) {
        // Centre every profile in the existing well; never on a usable tread.
        const at=(a+b)/2, start=flight===0?0:geometry.goingMm, end=flight===0?travel-geometry.goingMm:travel
        const top=(run:number)=>base+(flight===0?rise+(count-1)*rise*run/(travel-geometry.goingMm):floor.heightMm-(count-1)*rise*(run-geometry.goingMm)/(travel-geometry.goingMm))
        const axis=at+(flight===0?-1:1)*Math.max(0,(gap-STAIR_GUARD_PROFILE.railMm-4)/2)
        add(`${flight}_rail`,'handrail',world(axis,start,top(start)+h),world(axis,end,top(end)+h),STAIR_GUARD_PROFILE.railMm)
        const span=end-start, bays=Math.max(1,Math.ceil(span/STAIR_GUARD_PROFILE.maxPostSpacingMm))
        for(let i=0;i<=bays;i++) {
          const run=start+span*i/bays
          const support=base+(flight===0?Math.min(count,Math.floor(run/geometry.goingMm)+1)*rise:Math.min(count*2,count+Math.floor((travel-run)/geometry.goingMm)+1)*rise)
          add(`${flight}_post_${i}`,'post',world(axis,run,support-20),world(axis,run,top(run)+h),STAIR_GUARD_PROFILE.postMm)
        }
        const infills=Math.ceil(span/STAIR_GUARD_PROFILE.maxInfillSpacingMm)
        for(let i=1;i<infills;i++) {
          const run=start+span*i/infills
          const support=base+(flight===0?Math.min(count,Math.floor(run/geometry.goingMm)+1)*rise:Math.min(count*2,count+Math.floor((travel-run)/geometry.goingMm)+1)*rise)
          add(`${flight}_bar_${i}`,'infill',world(axis,run,support+20),world(axis,run,top(run)+h-20),12)
        }
      }
    } catch(error) {issues.push({stairId:stair.id,message:error instanceof Error?error.message:'Unsupported stair guard.'})}
  }
  return {version:STAIR_GUARD_VERSION,profile:STAIR_GUARD_PROFILE,parts,issues}
}
