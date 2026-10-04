import type { Design, FloorPlan, Opening } from './types.ts'
import { rectCenter, type Point, type Rect } from '../geometry.ts'
import { planFindings } from './planner/validate.ts'
import { siteGate } from './siteGate.ts'

/** Concept dimensions only. This is not a fire-code or engineering certificate. */
export const ESCAPE_LIMITS = Object.freeze({ doorWidthMm: 1000, doorHeightMm: 2200,
  pathWidthMm: 900, wallClearanceMm: 150, openingGapMm: 150, exitSeparationMm: 2500,
  signHeightMm: 2350, alarmHeightMm: 2600, equipmentHeightMm: 1100 })
export type EscapeRoute = { roomId: string; level: number; destination: string; points: Point[]; openingIds: string[] }
export type SafetyMarker = { id: string; level: number; at: Point; orient: 'h' | 'v'; facing?:1|-1; kind: 'exit' | 'alarm' | 'extinguisher'; sourceId: string }
export type EmergencyPlan = { routes: EscapeRoute[]; markers: SafetyMarker[]; outsideRoute: Point[];
  secondaryExitId: string | null; meetingPoint: Point | null; notes: string[]; disclaimer: string }
const overlap = (a: Rect, b: Rect) => a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y
const swing = (o: Opening): Rect => o.orient === 'h' ? {x:o.at.x-o.width/2,y:o.at.y+(o.swing===-1?-o.width:0),w:o.width,h:o.width}
  : {x:o.at.x+(o.swing===-1?-o.width:0),y:o.at.y-o.width/2,w:o.width,h:o.width}

/** Rectilinear visibility graph in the real free site. Inflate obstacles for a clear walkway. */
export function outsideEscapePath(design: Design, door: Opening): Point[] {
  const radius = ESCAPE_LIMITS.pathWidthMm/2, g=design.floors[0], room=g.rooms.find(r=>r.id===door.rooms?.[0])
  if(!room) return []
  const direction = door.orient==='h' ? (door.at.y===room.rect.y?-1:1) : (door.at.x===room.rect.x?-1:1)
  const start={x:door.at.x+(door.orient==='v'?direction*(radius+ESCAPE_LIMITS.wallClearanceMm):0),
    y:door.at.y+(door.orient==='h'?direction*(radius+ESCAPE_LIMITS.wallClearanceMm):0)}
  const width=design.model.plot.width, depth=design.model.plot.depth
  const gate=siteGate(design)
  if(gate&&gate.widthMm<ESCAPE_LIMITS.pathWidthMm+300)return []
  const obstacles=[...g.rooms.filter(r=>r.id!=='courtyard').map(r=>r.rect),
    ...(design.siteFeatures??[]).filter(f=>f.kind==='pool'||f.kind==='parking').map(f=>f.rect)]
    .map(r=>({x:r.x-radius,y:r.y-radius,w:r.w+2*radius,h:r.h+2*radius}))
  const xs=[...new Set([radius,width-radius,start.x,...(gate?[gate.centerX]:[]),...obstacles.flatMap(r=>[r.x-1,r.x+r.w+1])])].filter(x=>x>=radius&&x<=width-radius).sort((a,b)=>a-b)
  const ys=[...new Set([radius,depth-radius,start.y,...obstacles.flatMap(r=>[r.y-1,r.y+r.h+1])])].filter(y=>y>=radius&&y<=depth-radius).sort((a,b)=>a-b)
  const free=(p:Point)=>!obstacles.some(r=>p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h)
  if(!free(start)||!xs.includes(start.x)||!ys.includes(start.y)) return []
  const key=(x:number,y:number)=>y*xs.length+x, first=key(xs.indexOf(start.x),ys.indexOf(start.y))
  const parents=new Map<number,number>([[first,-1]]),queue=[first]
  let last=-1
  for(let i=0;i<queue.length;i++) {
    const k=queue[i], x=k%xs.length,y=Math.floor(k/xs.length), p={x:xs[x],y:ys[y]}
    if(p.y===depth-radius&&(!gate||p.x===gate.centerX)){last=k;break}
    for(const [nx,ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]) {
      if(nx<0||ny<0||nx>=xs.length||ny>=ys.length)continue
      const n=key(nx,ny),q={x:xs[nx],y:ys[ny]}
      if(parents.has(n)||!free(q))continue
      const segment={x:Math.min(p.x,q.x)-.1,y:Math.min(p.y,q.y)-.1,w:Math.abs(p.x-q.x)+.2,h:Math.abs(p.y-q.y)+.2}
      if(obstacles.some(r=>overlap(segment,r)))continue
      parents.set(n,k);queue.push(n)
    }
  }
  if(last<0)return []
  const path:Point[]=[]
  for(let k=last;k>=0;k=parents.get(k)!)path.unshift({x:xs[k%xs.length],y:ys[Math.floor(k/xs.length)]})
  return [door.at,...path]
}

/** Add one real secondary aperture, without moving rooms, walls, windows, or stairs. */
export function withEmergencyExit(design: Design): Design {
  const floor=design.floors[0], main=floor.openings.find(o=>o.kind==='entry'&&!o.emergencyExit)
  if(!main||floor.openings.some(o=>o.emergencyExit))return design
  // A secondary aperture cannot repair an already-invalid room/stair plan.
  // Avoid retrying every external wall of candidates the planner will reject.
  if(planFindings(design).length)return design
  const width=ESCAPE_LIMITS.doorWidthMm, candidates:Opening[]=[]
  for(const room of floor.rooms.filter(r=>!r.outdoor&&['circulation','social','work'].includes(r.zone))) {
    for(const wall of floor.walls.filter(w=>w.kind==='exterior')) {
      const horizontal=wall.a.y===wall.b.y, fixed=horizontal?wall.a.y:wall.a.x
      const onEdge=horizontal?(fixed===room.rect.y||fixed===room.rect.y+room.rect.h):(fixed===room.rect.x||fixed===room.rect.x+room.rect.w)
      if(!onEdge)continue
      const lo=Math.max(horizontal?room.rect.x:room.rect.y,horizontal?Math.min(wall.a.x,wall.b.x):Math.min(wall.a.y,wall.b.y))+width/2+ESCAPE_LIMITS.wallClearanceMm
      const hi=Math.min(horizontal?room.rect.x+room.rect.w:room.rect.y+room.rect.h,horizontal?Math.max(wall.a.x,wall.b.x):Math.max(wall.a.y,wall.b.y))-width/2-ESCAPE_LIMITS.wallClearanceMm
      for(let along=Math.ceil(lo);along<=hi;along+=width/2) {
        const at=horizontal?{x:along,y:fixed}:{x:fixed,y:along}
        if(Math.hypot(at.x-main.at.x,at.y-main.at.y)<ESCAPE_LIMITS.exitSeparationMm)continue
        const o:Opening={id:'GF_EMERGENCY_EXIT',kind:'entry',emergencyExit:true,at,orient:horizontal?'h':'v',width,head:ESCAPE_LIMITS.doorHeightMm,
          sill:0,swing:fixed===(horizontal?room.rect.y:room.rect.x)?1:-1,leaf:true,rooms:[room.id,null]}
        if(floor.openings.some(p=>p.orient===o.orient&&Math.abs((horizontal?p.at.y:p.at.x)-fixed)<2&&Math.abs((horizontal?p.at.x:p.at.y)-along)<(p.width+width)/2+ESCAPE_LIMITS.openingGapMm))continue
        if(floor.openings.some(p=>p.rooms?.[0]===room.id&&p.kind!=='window'&&p.leaf!==false&&overlap(swing(o),swing(p))))continue
        if(floor.columns?.some(c=>Math.abs((horizontal?c.at.y:c.at.x)-fixed)<2&&Math.abs((horizontal?c.at.x:c.at.y)-along)<width/2+c.size/2+ESCAPE_LIMITS.openingGapMm))continue
        candidates.push(o)
      }
    }
  }
  candidates.sort((a,b)=>Math.hypot(b.at.x-main.at.x,b.at.y-main.at.y)-Math.hypot(a.at.x-main.at.x,a.at.y-main.at.y))
  for(const door of candidates) {
    if(!outsideEscapePath(design,door).length)continue
    const next={...design,floors:[{...floor,openings:[...floor.openings,door]},...design.floors.slice(1)],openingCounts:{...design.openingCounts,doors:design.openingCounts.doors+1}}
    if(!planFindings(next).length)return next
  }
  return design
}

function route(floor:FloorPlan,roomId:string,target:string,destination:string,exit?:Opening):EscapeRoute|null {
  const queue=[roomId],prev=new Map<string,{room:string;door:Opening}>(),seen=new Set(queue)
  for(let i=0;i<queue.length&& !seen.has(target);i++)for(const door of floor.openings) {
    if(door.kind==='window'||!door.rooms?.[0]||!door.rooms[1])continue
    const [a,b]=door.rooms,other=a===queue[i]?b:b===queue[i]?a:null
    if(other&&!seen.has(other)){seen.add(other);prev.set(other,{room:queue[i],door});queue.push(other)}
  }
  if(!seen.has(target))return null
  const steps:{room:string;door:Opening}[]=[]
  for(let current=target;current!==roomId;) {const p=prev.get(current)!;steps.unshift(p);current=p.room}
  const rooms=new Map(floor.rooms.map(r=>[r.id,r])),points:Point[]=[rectCenter(rooms.get(roomId)!.rect)],ids:string[]=[]
  for(const s of steps){points.push(s.door.at);ids.push(s.door.id??`${s.door.at.x}:${s.door.at.y}`)}
  if(exit){points.push(exit.at);ids.push(exit.id??'main-entry')}
  else points.push(rectCenter(rooms.get(target)!.rect))
  // Straight segments lie inside each convex source room and cross only the selected door.
  return {roomId,level:floor.level,destination,points,openingIds:ids}
}
export function floorEscapeRoutes(floor:FloorPlan):EscapeRoute[] {
  const goal=floor.level===0?(floor.openings.find(o=>o.emergencyExit)??floor.openings.find(o=>o.kind==='entry')):undefined
  const target=goal?.rooms?.[0]??floor.rooms.find(r=>r.id==='stair')?.id
  if(!target)return []
  return floor.rooms.filter(r=>!r.outdoor&&!/lift|shaft/i.test(r.id)).flatMap(room=>{
    const path=route(floor,room.id,target,floor.level===0?(goal?.emergencyExit?'Secondary exit':'Main entry'):'Stair → ground exit',goal)
    return path?[path]:[]
  })
}
const cache=new WeakMap<Design,EmergencyPlan>()
export function emergencyPlan(design:Design):EmergencyPlan {
  const cached=cache.get(design);if(cached)return cached
  const ground=design.floors[0],secondary=ground.openings.find(o=>o.emergencyExit),main=ground.openings.find(o=>o.kind==='entry'&&!o.emergencyExit)
  const outsideRoute=secondary?outsideEscapePath(design,secondary):[]
  const routes:EscapeRoute[]=[],markers:SafetyMarker[]=[]
  for(const floor of design.floors) {
    const goal=floor.level===0?(secondary&&outsideRoute.length?secondary:main):undefined
    const target=goal?.rooms?.[0]??floor.rooms.find(r=>r.id==='stair')?.id
    for(const room of floor.rooms.filter(r=>!r.outdoor&&!/lift|shaft/i.test(r.id))) {
      if(target){const path=route(floor,room.id,target,floor.level===0?(goal?.emergencyExit?'Secondary exit':'Main entry'):'Stair → ground exit',goal);if(path)routes.push(path)}
      if(room.zone==='private'||room.zone==='circulation'||room.zone==='social')markers.push({id:`L${floor.level}_Alarm_${room.id}`,level:floor.level,at:rectCenter(room.rect),orient:'h',kind:'alarm',sourceId:room.id})
    }
    const stair=floor.rooms.find(r=>r.id==='stair')??floor.rooms.find(r=>r.zone==='circulation')
    if(stair)markers.push({id:`L${floor.level}_Extinguisher`,level:floor.level,at:{x:stair.rect.x+200,y:stair.rect.y+300},orient:'v',kind:'extinguisher',sourceId:stair.id})
    for(const entry of floor.openings.filter(o=>o.kind==='entry')) {
      const owner=floor.rooms.find(r=>r.id===entry.rooms?.[0]),facing:1|-1=owner?(entry.orient==='h'?(entry.at.y<=owner.rect.y?-1:1):(entry.at.x<=owner.rect.x?-1:1)):1
      markers.push({id:`L${floor.level}_Exit_${entry.id??'main'}`,level:floor.level,at:{x:entry.at.x+(entry.orient==='v'?facing*180:0),y:entry.at.y+(entry.orient==='h'?facing*180:0)},orient:entry.orient,facing,kind:'exit',sourceId:entry.id??'main-entry'})
    }
  }
  const value:EmergencyPlan={routes,markers,outsideRoute,secondaryExitId:secondary?.id??null,meetingPoint:outsideRoute.at(-1)??null,
    notes:[...(!secondary?['A second exit could not fit without changing this plan. An architect must design an independent escape route.']:[]),
      ...(design.floors.length>1?['Upper floors use the existing aligned stair. This is a shared route, not an independent second escape stair.']:[]),
      'Keep escape paths and doors clear; never use the lift during a fire. The assembly marker is a site-side meeting point; agree a safe location away from the building.'],
    disclaimer:'Indicative escape layout only. Fire safety, alarm coverage, accessible escape and local requirements need review by a qualified architect/fire professional.'}
  cache.set(design,value);return value
}
