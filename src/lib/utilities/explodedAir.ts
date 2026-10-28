import type { BuildingModel } from '../engine/buildingModel.ts'
import type { Dollhouse } from '../three/buildDollhouse.ts'
import { openingSide, type AirPath, type AirPoint } from './ventilation.ts'

/** Presentation only: use the existing furnished trays' actual baseY, centred
 * plan X/Z, and the source point's height above its own floor. No architecture
 * or saved ventilation paths are changed. Missing floors are never guessed. */
export function explodedAirPoint(building:BuildingModel,doll:Dollhouse,p:AirPoint,path:AirPath):[number,number,number]{
  const floor=building.floors.find(f=>f.id===path.floorId)
  const tray=floor&&doll.floors.find(f=>f.level===floor.level)
  if(!floor||!tray)throw new Error(`No furnished floor for ${path.floorId}`)
  return [(p.x-building.plot.widthMm/2)/1000,tray.baseY+(p.z-floor.elevationMm)/1000,(p.y-building.plot.depthMm/2)/1000]
}

export function explodedAirPaths(building:BuildingModel,doll:Dollhouse,paths:AirPath[]){
  const ports:{id:string;label:string;kind:'inlet'|'outlet';position:[number,number,number]}[]=[]
  const seen=new Set<string>()
  const displayed=paths.flatMap(path=>{
    const floor=building.floors.find(f=>f.id===path.floorId)
    if(!floor||!doll.floors.some(f=>f.level===floor.level)||path.points.length<2)return []
    const ends=([['inlet',path.inletId,path.points[0]],['outlet',path.outletId,path.points.at(-1)!]] as const).map(([kind,id,p])=>{
      const window=building.windows.find(w=>w.floorId===path.floorId&&w.id===id)
      const room=window&&building.rooms.find(r=>r.floorId===path.floorId&&r.id===window.rooms?.[0])
      const side=window&&room?openingSide(window,room):null
      const key=`${path.floorId}:${kind}:${id}`
      if(!seen.has(key)){
        seen.add(key)
        ports.push({id:key,kind,position:explodedAirPoint(building,doll,p,path),label:`${kind==='inlet'?'IN':'OUT'} · ${floor.name} · ${room?.name??id} window`})
      }
      // Two metres outdoors makes the source/destination readable. These
      // tails are illustrative, not an inferred balcony or a new opening.
      return {...p,x:p.x+(side==='E'?2000:side==='W'?-2000:0),y:p.y+(side==='S'?2000:side==='N'?-2000:0)}
    })
    // Keep window entry/exit at their recorded heights, then descend inside
    // the room. The cutaway's breathing-height trace is illustrative only.
    const first=path.points[0],last=path.points.at(-1)!
    const low=(p:AirPoint):AirPoint=>({...p,z:Math.min(p.z,floor.elevationMm+750)})
    const distances=[0]
    for(let i=1;i<path.points.length;i++)distances.push(distances[i-1]+Math.hypot(path.points[i].x-path.points[i-1].x,path.points[i].y-path.points[i-1].y))
    const total=distances.at(-1)!
    const doors=path.points.flatMap((p,i)=>building.doors.some(d=>d.floorId===path.floorId&&Math.hypot(d.at.x-p.x,d.at.y-p.y)<1)?[distances[i]]:[])
    const baseMm=Math.min(floor.elevationMm+750,...path.points.map(p=>p.z))
    // Spread a high-window descent through its room, finishing before the
    // first doorway. The same eased profile rises gently to the exit window.
    return [{...path,points:[ends[0],first,...path.points.slice(1,-1).map(low),last,ends[1]],visualHeight:{
      baseMm,inletMm:first.z,outletMm:last.z,lengthMm:total+4000,entryMm:2000,exitMm:2000+total,
      dropMm:Math.min(doors[0]??total/2,Math.max(1400,(first.z-baseMm)*1.8)),
      riseMm:Math.min(doors.length?total-doors.at(-1)!:total/2,Math.max(1400,(last.z-baseMm)*1.8)),
    }}]
  })
  return {paths:displayed,ports}
}
