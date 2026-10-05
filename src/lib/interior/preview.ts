import type { Design } from '../engine/types.ts'
import type { Character } from '../model/themes.ts'
import { buildRoom, type RoomBox, type Side } from '../three/buildRoom.ts'
import { furnishSingleRoom, type DollBox } from '../three/buildDollhouse.ts'
import { createBuildingModel } from '../engine/buildingModel.ts'

/* ------------------------------------------------------------------ *
 *  Fast 360° interior preview: the interior is styled, the architecture
 *  is locked. The room shell (walls, real doors and windows at their real
 *  sill / head heights, ceiling height) comes from buildRoom, the
 *  furniture from the same rule-based placer as the furnished 3D view.
 *  Nothing here may move a wall, a door, a window or change a dimension.
 * ------------------------------------------------------------------ */

export const INTERIOR_STYLES = [
  { id: 'modern', label: 'Modern' }, { id: 'contemporary', label: 'Contemporary' }, { id: 'minimal', label: 'Minimal' },
  { id: 'luxury', label: 'Luxury' }, { id: 'indian-contemporary', label: 'Indian Contemporary' }, { id: 'scandinavian', label: 'Scandinavian' },
] as const
export const FLOORINGS = [
  { id: 'beige-marble', label: 'Beige Marble', color: '#D8CBB8' }, { id: 'white-marble', label: 'White Marble', color: '#EEEBE6' },
  { id: 'grey-marble', label: 'Grey Marble', color: '#B9B8B5' }, { id: 'light-wood', label: 'Light Wood', color: '#C9A47C' },
  { id: 'dark-wood', label: 'Dark Wood', color: '#6B4A33' }, { id: 'travertine', label: 'Travertine', color: '#D6C3A3' },
  { id: 'concrete', label: 'Concrete', color: '#A9A6A0' }, { id: 'ceramic-tile', label: 'Ceramic Tile', color: '#D9D4CC' },
] as const
export const CEILINGS = [
  { id: 'plain', label: 'Plain White' }, { id: 'false', label: 'False Ceiling' }, { id: 'cove', label: 'Cove Ceiling' },
  { id: 'tray', label: 'Tray Ceiling' }, { id: 'wooden', label: 'Wooden Accent Ceiling' },
] as const
export const LIGHTINGS = [
  { id: 'daylight', label: 'Daylight' }, { id: 'warm', label: 'Warm' }, { id: 'neutral', label: 'Neutral' }, { id: 'evening', label: 'Evening' },
] as const
export const DENSITIES = [{ id: 'low', label: 'Low' }, { id: 'medium', label: 'Medium' }, { id: 'full', label: 'Full' }] as const
export const WALL_PRESETS = [
  { label: 'Cream', color: '#F2EADC' }, { label: 'Warm white', color: '#F4F0E8' }, { label: 'Pure white', color: '#FAFAF7' },
  { label: 'Greige', color: '#D9D2C5' }, { label: 'Sage', color: '#C9D2C0' }, { label: 'Dusty blue', color: '#C7D3DC' },
  { label: 'Blush', color: '#E7CDBF' }, { label: 'Charcoal', color: '#4A4A48' },
] as const

type Id<T extends readonly { id: string }[]> = T[number]['id']
export type InteriorConfiguration = {
  roomId: string
  floor: number
  style: Id<typeof INTERIOR_STYLES>
  flooring: { material: Id<typeof FLOORINGS>; color: string }
  walls: { color: string }
  ceiling: { type: Id<typeof CEILINGS>; color: string }
  lighting: Id<typeof LIGHTINGS>
  furnitureDensity: Id<typeof DENSITIES>
}
export type Quality = 'fast' | 'high'

export const defaultConfiguration = (roomId: string, floor: number): InteriorConfiguration => ({
  roomId, floor, style: 'modern', flooring: { material: 'beige-marble', color: '#D8CBB8' }, walls: { color: '#F2EADC' },
  ceiling: { type: 'cove', color: '#FAFAF7' }, lighting: 'warm', furnitureDensity: 'medium',
})

/** rooms a person would style: no stairs, shafts, corridors, lobbies, stores or open-air spaces */
export function previewRooms(design: Design) {
  const skip = /^(stair|lift|corridor|foyer|lobby|shaft|vacant|store|duct|passage|landing)/i
  return design.floors.flatMap((f) => f.rooms.filter((r) => !r.outdoor && r.zone !== 'circulation' && !skip.test(r.id)).map((r) => ({
    floor: f.level, floorName: f.name, id: r.id, name: r.name, w: r.rect.w / 1000, d: r.rect.h / 1000,
  })))
}

/** decor that a lighter furniture level leaves out; the working pieces always stay */
const DECOR: Record<InteriorConfiguration['furnitureDensity'], RegExp | null> = {
  low: /art|plant|lamp|rug|cushion|pillow|throw|vase|decor|shelf/i, medium: /art|vase|decor/i, full: null,
}

export type InteriorScene = {
  designId: string
  room: { id: string; name: string; floor: number; floorName: string; dims: { w: number; d: number; h: number }; focal: Side }
  shell: RoomBox[]
  furniture: DollBox[]
  openings: { id?: string; kind: string; side: Side; alongM?: number; widthM: number; sillM: number; headM: number; exterior: boolean }[]
  /** room-local metres, y up: a clear standing point near the centre at eye height */
  camera: [number, number, number]
  /** where the 360 opens: facing the main window wall, in degrees clockwise from north */
  initialYaw: number
  daylightDir: [number, number, number]
  config: InteriorConfiguration
  quality: Quality
}

/** isolate the selected room from the validated plan and dress it — never altering its architecture */
export function createInteriorScene(design: Design, designId: string, config: InteriorConfiguration, character: Character, quality: Quality = 'fast'): InteriorScene | null {
  if (!design.floors.some(f => f.level === config.floor && f.rooms.some(r => r.id === config.roomId && !r.outdoor))) return null
  const shell = buildRoom(design, config.floor, config.roomId, character)
  if (!shell) return null
  const architecture = sourceShell(design, config)
  shell.boxes = [...architecture.boxes, ...connectedShells(design,config)]
  shell.dims.h = architecture.height
  const drop = DECOR[config.furnitureDensity]
  const placed = furnishSingleRoom(design, config.floor, config.roomId)
  const columns=architecture.boxes.filter(b=>b.id.startsWith('column'))
  const unsafeGroups=new Set(placed.filter(b=>columns.some(c=>b.pos.every((v,i)=>Math.abs(v-c.pos[i])<(b.size[i]+c.size[i])/2-0.005))).map(b=>b.id.slice(config.roomId.length+1).split('-')[0]))
  const furniture = [...placed, ...kitchenExtras(placed, architecture.boxes, shell.dims)].filter((b) => (!drop || !(drop.test(b.id) || drop.test(b.mat))) && !unsafeGroups.has(b.id.slice(config.roomId.length+1).split('-')[0]) && b.pos[1]+b.size[1]/2<shell.dims.h)
  const camera = standingPoint(shell.dims.w, shell.dims.d, [...furniture, ...shell.boxes.filter(b => b.id.startsWith('column'))] as DollBox[])
  return {
    designId,
    room: { id: config.roomId, name: shell.name, floor: shell.floorLevel, floorName: shell.floorName, dims: shell.dims, focal: shell.focal },
    shell: shell.boxes,
    furniture,
    openings: architecture.openings,
    camera,
    initialYaw: { N: 0, E: 90, S: 180, W: 270 }[shell.focal],
    daylightDir: shell.daylightDir,
    config,
    quality,
  }
}

/** the clear point nearest the room centre: away from the walls and out of every piece of furniture, at 1.6 m eye height */
function standingPoint(w: number, d: number, furniture: DollBox[]): [number, number, number] {
  const solid = furniture.filter((b) => b.size[1] > 0.05 && b.pos[1] - b.size[1] / 2 < 1.7)
  const clearance = (x: number, z: number) => Math.min(
    w / 2 - Math.abs(x), d / 2 - Math.abs(z),
    ...solid.map((b) => Math.max(Math.abs(x - b.pos[0]) - b.size[0] / 2, Math.abs(z - b.pos[2]) - b.size[2] / 2)),
  )
  let best: [number, number] = [0, 0], bestScore = -Infinity
  for (let x = -w / 2 + 0.3; x <= w / 2 - 0.3; x += 0.1) for (let z = -d / 2 + 0.3; z <= d / 2 - 0.3; z += 0.1) {
    const c = clearance(x, z)
    // enough room to stand (0.45 m all round) wins; among those, the one nearest the centre
    const score = c >= 0.45 ? 10 - Math.hypot(x, z) : c
    if (score > bestScore) { bestScore = score; best = [x, z] }
  }
  return [Math.round(best[0] * 100) / 100, 1.6, Math.round(best[1] * 100) / 100]
}

/** A kitchen run also gets its wall cabinets and a hob, by rule: wall cabinets sit 1.45-2.15 m over each counter against
 *  its wall and are left out wherever a window or door is in the way; the hob goes at the end of the run away from the
 *  sink, only where the full 600 mm fits. */
function kitchenExtras(furniture: DollBox[], shell: RoomBox[], dims: { w: number; d: number }): DollBox[] {
  const extra: DollBox[] = []
  const openings = shell.filter((b) => b.mat === 'glass' || b.mat === 'reveal')
  for (const c of furniture.filter((b) => /-counter\d*$/.test(b.id))) {
    const [x, , z] = c.pos, [sx, , sz] = c.size
    const gaps = { N: z - sz / 2 + dims.d / 2, S: dims.d / 2 - (z + sz / 2), W: x - sx / 2 + dims.w / 2, E: dims.w / 2 - (x + sx / 2) }
    const side = (Object.keys(gaps) as (keyof typeof gaps)[]).sort((a, b) => gaps[a] - gaps[b])[0]
    const alongX = side === 'N' || side === 'S'
    const len = alongX ? sx : sz, depth = 0.35, y0 = 1.45, y1 = 2.15
    const wallAt = side === 'N' ? -dims.d / 2 : side === 'S' ? dims.d / 2 : side === 'W' ? -dims.w / 2 : dims.w / 2
    const inner = wallAt + (side === 'N' || side === 'W' ? 1 : -1) * (gaps[side] + depth / 2)
    const pos: [number, number, number] = alongX ? [x, (y0 + y1) / 2, inner] : [inner, (y0 + y1) / 2, z]
    const size: [number, number, number] = alongX ? [len, y1 - y0, depth] : [depth, y1 - y0, len]
    const blocked = openings.some((o) => {
      const top = o.pos[1] + o.size[1] / 2, bottom = o.pos[1] - o.size[1] / 2
      const ox = Math.abs(o.pos[0] - pos[0]) < (o.size[0] + size[0]) / 2 + 0.05, oz = Math.abs(o.pos[2] - pos[2]) < (o.size[2] + size[2]) / 2 + 0.3
      return ox && oz && top > y0 && bottom < y1
    })
    if (!blocked) extra.push({ id: `${c.id}-wall-cabinet`, mat: 'panel', pos, size })
    const top = furniture.find((b) => b.id === c.id.replace('counter', 'top'))
    const sink = furniture.find((b) => /-sink$/.test(b.id) && Math.abs(b.pos[1] - (top?.pos[1] ?? 0)) < 0.2)
    if (top && len >= 1.2) {
      const centre = alongX ? x : z, sinkAt = sink ? (alongX ? sink.pos[0] : sink.pos[2]) : centre - len
      const sinkHalf = sink ? (alongX ? sink.size[0] : sink.size[2]) / 2 : 0
      const room = sinkAt <= centre ? centre + len / 2 - (sinkAt + sinkHalf) : sinkAt - sinkHalf - (centre - len / 2)
      if (room >= 0.66) {
        const at = sinkAt <= centre ? centre + len / 2 - 0.36 : centre - len / 2 + 0.36
        const y = top.pos[1] + top.size[1] / 2 + 0.008
        extra.push({ id: `${c.id}-hob`, mat: 'metal', pos: alongX ? [at, y, top.pos[2]] : [top.pos[0], y, at], size: alongX ? [0.58, 0.016, 0.5] : [0.5, 0.016, 0.58] })
      }
    }
  }
  return extra
}

/** Use the same source wall segments and vertical limits as the Blender building export. */
function sourceShell(design: Design, config: InteriorConfiguration) {
  const building = createBuildingModel(design)
  const floor = building.floors.find(f => f.level === config.floor)!
  const room = building.rooms.find(r => r.floorId === floor.id && r.id === config.roomId)!
  if(building.floors.some(f=>f.level>floor.level && f.doubleHeightVoids?.some(v=>v.sourceRoomId===room.semanticId))) throw new Error('Interior preview could not be prepared for this room: double-height galleries require full-height isolation.')
  const r = room.rect, cx = r.x + r.w / 2, cy = r.y + r.h / 2
  const slab = floor.slabThicknessMm ?? 120, height = (floor.heightMm - slab) / 1000
  const boxes: RoomBox[] = []
  const roomOpenings: InteriorScene['openings'] = []
  const add = (id: string, mat: RoomBox['mat'], x: number, y: number, z: number, w: number, h: number, d: number) => {
    if (w > 0 && h > 0 && d > 0) boxes.push({id, mat, pos: [(x-cx)/1000, (z+h/2)/1000, (y-cy)/1000], size: [w/1000,h/1000,d/1000]})
  }
  add('floor','slab',cx,cy,-slab,r.w,slab,r.h)
  add('ceil','ceil',cx,cy,height*1000,r.w,slab,r.h)
  const openings = [...building.doors, ...building.windows].filter(o => o.floorId === floor.id)
  for (const [i, wall] of building.walls.filter(w => w.floorId === floor.id && w.kind !== 'parapet').entries()) {
    const horizontal = wall.a.y === wall.b.y, fixed = horizontal ? wall.a.y : wall.a.x
    const lo = Math.min(horizontal ? wall.a.x : wall.a.y, horizontal ? wall.b.x : wall.b.y)
    const hi = Math.max(horizontal ? wall.a.x : wall.a.y, horizontal ? wall.b.x : wall.b.y)
    const start = Math.max(lo, horizontal ? r.x : r.y), end = Math.min(hi, horizontal ? r.x+r.w : r.y+r.h)
    if (end <= start || fixed < (horizontal ? r.y : r.x)-wall.thickness/2 || fixed > (horizontal ? r.y+r.h : r.x+r.w)+wall.thickness/2) continue
    const top = Math.min(wall.heightMm ?? floor.heightMm, height*1000)
    const piece = (a: number,b: number,z: number,h: number,id: string,mat: RoomBox['mat']='wall',t=wall.thickness) => add(id,mat,horizontal?(a+b)/2:fixed,horizontal?fixed:(a+b)/2,z,horizontal?b-a:t,h,horizontal?t:b-a)
    let cursor = start
    const ops = openings.filter(o => o.orient === (horizontal?'h':'v') && Math.abs((horizontal?o.at.y:o.at.x)-fixed)<1 && (horizontal?o.at.x:o.at.y)+o.width/2>start && (horizontal?o.at.x:o.at.y)-o.width/2<end).sort((a,b)=>(horizontal?a.at.x:a.at.y)-(horizontal?b.at.x:b.at.y))
    for (const [j,o] of ops.entries()) {
      const along = horizontal?o.at.x:o.at.y, a=Math.max(start,along-o.width/2), b=Math.min(end,along+o.width/2)
      const limits= floor.openingLimits!
      const sill=o.kind==='window'?(o.sill??limits.defaultSillMm):0
      const head=Math.min(o.head??(o.kind==='window'?limits.windowHeadMm:o.kind==='entry'?limits.entryHeadMm:limits.doorHeadMm),floor.heightMm-limits.lintelClearanceMm)
      const side: Side=horizontal?(fixed<=cy?'N':'S'):(fixed<=cx?'W':'E')
      if(!roomOpenings.some(p=>p.id===o.id)) roomOpenings.push({id:o.id,kind:o.kind,side,alongM:(along-(horizontal?cx:cy))/1000,widthM:o.width/1000,sillM:sill/1000,headM:head/1000,exterior:wall.kind==='exterior'})
      piece(cursor,a,0,top,`wall-${i}-${j}`)
      piece(a,b,0,sill,`sill-${i}-${j}`)
      piece(a,b,head,top-head,`head-${i}-${j}`)
      if(o.kind==='window' || o.leaf!==false || o.treatment==='glazed-slide') piece(a,b,sill,head-sill,`opening-${i}-${j}`,o.kind==='window'||o.treatment==='glazed-slide'?'glass':'reveal',40)
      cursor=Math.max(cursor,b)
    }
    piece(cursor,end,0,top,`wall-${i}-end`)
  }
  for (const c of building.columns.filter(c=>c.floorId===floor.id && c.at.x+c.size/2>=r.x && c.at.x-c.size/2<=r.x+r.w && c.at.y+c.size/2>=r.y && c.at.y-c.size/2<=r.y+r.h)) add(`column-${c.id}`,'wall',c.at.x,c.at.y,0,c.size,height*1000,c.size)
  return { boxes, height, openings: roomOpenings }
}

/** Only the source rooms directly visible through leafless internal connections. */
function connectedShells(design: Design, config: InteriorConfiguration): RoomBox[] {
  const floor=design.floors.find(f=>f.level===config.floor)!, selected=floor.rooms.find(r=>r.id===config.roomId)!
  const cx=selected.rect.x+selected.rect.w/2, cy=selected.rect.y+selected.rect.h/2
  const touches=(r: typeof selected,o: typeof floor.openings[number])=>o.orient==='h'
    ? (Math.abs(o.at.y-r.rect.y)<1 || Math.abs(o.at.y-r.rect.y-r.rect.h)<1) && o.at.x>=r.rect.x && o.at.x<=r.rect.x+r.rect.w
    : (Math.abs(o.at.x-r.rect.x)<1 || Math.abs(o.at.x-r.rect.x-r.rect.w)<1) && o.at.y>=r.rect.y && o.at.y<=r.rect.y+r.rect.h
  const ids=new Set<string>()
  for(const o of floor.openings.filter(o=>o.kind!=='window' && o.leaf===false && (o.rooms?.includes(config.roomId) || (!o.rooms && touches(selected,o))))) {
    for(const r of floor.rooms.filter(r=>r.id!==selected.id && !r.outdoor && (o.rooms?.includes(r.id) || (!o.rooms && touches(r,o))))) ids.add(r.id)
  }
  return [...ids].flatMap(id=> {
    const r=floor.rooms.find(r=>r.id===id)!, dx=(r.rect.x+r.rect.w/2-cx)/1000, dz=(r.rect.y+r.rect.h/2-cy)/1000
    return sourceShell(design,{...config,roomId:id}).boxes.map(b=>({...b,id:`connected-${id}-${b.id}`,pos:[b.pos[0]+dx,b.pos[1],b.pos[2]+dz] as [number,number,number]}))
  })
}
