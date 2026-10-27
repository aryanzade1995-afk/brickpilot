import type { BuildingModel, BuildingRoom, BuildingWindow } from '../engine/buildingModel.ts'
import type { Direction } from '../model/brief.ts'
import type { Point } from '../geometry.ts'

export type AirPoint = Point & { z: number }
export type AirPath = { id: string; floorId: string; inletId: string; outletId: string; roomIds: string[]; points: AirPoint[] }
export const AIR_SIDES: Direction[] = ['N', 'E', 'S', 'W']
const opposite: Record<Direction, Direction> = { N: 'S', S: 'N', E: 'W', W: 'E' }

/** Plan sides, not a weather forecast or surveyed compass. Exterior windows
 * are candidates only; their actual operability is unknown in BuildingModel. */
export function openingSide(w: BuildingWindow, room: BuildingRoom): Direction | null {
  const r = room.rect
  if (w.orient === 'h') return Math.abs(w.at.y - r.y) < 250 ? 'N' : Math.abs(w.at.y - r.y - r.h) < 250 ? 'S' : null
  return Math.abs(w.at.x - r.x) < 250 ? 'W' : Math.abs(w.at.x - r.x - r.w) < 250 ? 'E' : null
}

/** Topology illustration through recorded windows and doorways. Straight
 * segments stay within convex source room rectangles. No pressure, ACH,
 * comfort, temperature reduction or CFD result is calculated here. */
export function ventilationPaths(building: BuildingModel, from: Direction, doorsOpen = true) {
  const paths: AirPath[] = [], reviews: string[] = []
  const rooms = building.rooms.filter(r => !r.outdoor)
  const windows = building.windows.flatMap(w => {
    if (w.rooms?.[1]) return []
    const room = rooms.find(r => r.floorId === w.floorId && r.id === w.rooms?.[0])
    const side = room ? openingSide(w, room) : null
    return room && side ? [{ w, room, side }] : []
  })
  const inlets = windows.filter(w => w.side === from)
  const outlets = windows.filter(w => w.side === opposite[from])
  for (const inlet of inlets) {
    const floor = building.floors.find(f => f.id === inlet.w.floorId)!
    const candidates = outlets.filter(o => o.w.floorId === floor.id)
    const parent = new Map<string, { previous: string; at: Point; id: string } | null>([[inlet.room.id, null]])
    const queue = [inlet.room.id]
    for (let i = 0; i < queue.length && doorsOpen; i++) {
      for (const door of building.doors.filter(d => d.floorId === floor.id && d.rooms?.[0] && d.rooms?.[1])) {
        const [a, b] = door.rooms!, next = a === queue[i] ? b : b === queue[i] ? a : null
        if (!next || parent.has(next) || !rooms.some(r => r.floorId === floor.id && r.id === next)) continue
        parent.set(next, { previous: queue[i], at: door.at, id: door.id! }); queue.push(next)
      }
    }
    const outlet = candidates.find(o => parent.has(o.room.id))
    if (!outlet) { reviews.push(`${floor.name} · ${inlet.room.name}: no connected opposite-side opening for this wind direction.`); continue }
    const chain: { roomId: string; door?: Point }[] = []
    let roomId = outlet.room.id
    while (true) {
      const step = parent.get(roomId)
      chain.unshift({ roomId, door: step?.at })
      if (!step) break
      roomId = step.previous
    }
    const windowZ=(w:BuildingWindow)=>floor.elevationMm+(w.sill??900)+Math.min(250,Math.max(0,((w.head??2200)-(w.sill??900))/2))
    const ports:AirPoint[]=[{...inlet.w.at,z:windowZ(inlet.w)},...chain.slice(1).map(c=>({...c.door!,z:floor.elevationMm+1400})),{...outlet.w.at,z:windowZ(outlet.w)}]
    const points:AirPoint[]=[]
    for(let i=0;i<chain.length;i++){
      const room=rooms.find(r=>r.floorId===floor.id&&r.id===chain[i].roomId)!
      const trace=roomTrace(ports[i],ports[i+1],room,building)
      if(!trace){points.length=0;break}
      points.push(...(i?trace.slice(1):trace))
    }
    // A column/shaft is not a ventilation opening. Hide an obstructed
    // illustrative trace instead of animating air through its solid envelope.
    const blocked = !points.length||points.some((p, i) => i && segmentBlocked(points[i - 1], p, building, floor.id))
    if (blocked) { reviews.push(`${floor.name} · ${inlet.room.name}: trace obstructed by a recorded shaft or column; detailed airflow review needed.`); continue }
    paths.push({ id: `air:${from}:${inlet.w.id}:${outlet.w.id}`, floorId: floor.id, inletId: inlet.w.id!, outletId: outlet.w.id!, roomIds: chain.map(c => c.roomId), points })
  }
  if (!inlets.length) reviews.push(`No recorded ${from}-side indoor window is available.`)
  return { from, paths, reviews, inletCount: inlets.length, outletCount: outlets.length,
    assumptions: ['Recorded windows are assumed open and operable.', 'Internal doors are assumed open only when enabled.', 'Blue/orange describe illustrative cooler incoming and warmer outgoing air, not calculated temperatures.'] }
}

/** Visibility path inside one actual rectangular room, around represented
 * columns/shafts. It cannot add doors or move architectural geometry. */
function roomTrace(a:AirPoint,b:AirPoint,room:BuildingRoom,building:BuildingModel):AirPoint[]|null {
  const r=room.rect,within=(p:Point)=>p.x>=r.x-.1&&p.y>=r.y-.1&&p.x<=r.x+r.w+.1&&p.y<=r.y+r.h+.1
  if(!within(a)||!within(b))return null
  const obstacles=[...building.columns.filter(c=>c.floorId===room.floorId).map(c=>({x:c.at.x-c.size/2-200,y:c.at.y-c.size/2-200,w:c.size+400,h:c.size+400})),...building.shafts.filter(s=>s.floorId===room.floorId).map(s=>({x:s.rect.x-200,y:s.rect.y-200,w:s.rect.w+400,h:s.rect.h+400}))]
  const nodes:Point[]=[a,b,...obstacles.flatMap(o=>[{x:o.x-1,y:o.y-1},{x:o.x+o.w+1,y:o.y-1},{x:o.x+o.w+1,y:o.y+o.h+1},{x:o.x-1,y:o.y+o.h+1}]).filter(within)]
  const lengths=nodes.map(()=>Infinity),parents=nodes.map(()=>-1),done=new Set<number>();lengths[0]=0
  for(let n=0;n<nodes.length;n++){
    let at=-1;for(let i=0;i<nodes.length;i++)if(!done.has(i)&&(at<0||lengths[i]<lengths[at]))at=i
    if(at<0||!Number.isFinite(lengths[at]))break
    if(at===1)break
    done.add(at)
    for(let j=0;j<nodes.length;j++){
      if(done.has(j)||j===at)continue
      const x={...nodes[at],z:a.z},y={...nodes[j],z:a.z}
      if(segmentBlocked(x,y,building,room.floorId,200))continue
      const d=lengths[at]+Math.hypot(x.x-y.x,x.y-y.y)
      if(d<lengths[j]){lengths[j]=d;parents[j]=at}
    }
  }
  if(!Number.isFinite(lengths[1]))return null
  const path:Point[]=[];for(let at=1;at>=0;at=parents[at])path.unshift(nodes[at])
  let length=0;return path.map((p,i)=>{if(i)length+=Math.hypot(p.x-path[i-1].x,p.y-path[i-1].y);return {...p,z:a.z+(b.z-a.z)*length/Math.max(.001,lengths[1])}})
}

function segmentBlocked(a: AirPoint, b: AirPoint, building: BuildingModel, floorId: string,pad=0) {
  const obstacles = [...building.columns.filter(c => c.floorId === floorId).map(c => ({ x: c.at.x - c.size / 2-pad, y: c.at.y - c.size / 2-pad, w: c.size+2*pad, h: c.size+2*pad })), ...building.shafts.filter(s => s.floorId === floorId).map(s => ({x:s.rect.x-pad,y:s.rect.y-pad,w:s.rect.w+2*pad,h:s.rect.h+2*pad}))]
  return obstacles.some(r => {
    let lo = 0, hi = 1
    for (const [v, d, min, max] of [[a.x, b.x - a.x, r.x, r.x + r.w], [a.y, b.y - a.y, r.y, r.y + r.h]]) {
      if (Math.abs(d) < .001) { if (v <= min || v >= max) return false }
      else { const t1 = (min - v) / d, t2 = (max - v) / d; lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2)); if (lo >= hi) return false }
    }
    return lo < hi
  })
}
