import type { Design } from '../engine/types.ts'
import type { WalkthroughScene, SceneSurface } from './sceneTypes.ts'
import type { WalkthroughSource } from './source.ts'
import { resolveWalkthroughRoomAssets } from './roomAssets.ts'
import { roomLocalToWalkthrough, planToThreeGlb } from './coordinates.ts'
import { houseLooks, surfaceLook, type Look } from '../three/dressRoom.ts'
import { intersectRegions, subtractRegions } from '../solar/regions.ts'
import { fitWalkthroughFinishes } from './fittedFinishes.ts'
import type { InteriorFinishes } from '../interior/finishes.ts'
import { createStairGuards } from './stairGuards.ts'
import {roomInteriorModels,type InteriorModelInstance} from '../interior-assets/placements.ts'

export const WALKTHROUGH_DELIVERY_VERSION = 'walkthrough-assets-v1'
export const WALKTHROUGH_APPEARANCE_VERSION = 'room-finishes-fittings-v6'
type V3 = [number, number, number]
export type AssetFace = SceneSurface & { binding: string; roomId: string | null; canonicalSurfaceId: string }
export type AssetBox = { id: string; floorId: string; roomId: string | null; position: V3; size: V3; rotation: number;
  shape: 'box' | 'cyl' | 'ball'; binding: string; sourceIds: string[]; kind: 'furniture' | 'door' | 'frame'; bevelM?: number;
  support?:{surfaceId:string;point:V3;normal:V3;group:string} }
export type Collider = { id: string; sourceIds: string[]; floorId: string; kind: string; min: V3; max: V3 }
export type WalkthroughGeometryPayload = {
  version: typeof WALKTHROUGH_DELIVERY_VERSION; planId: string; coordinates: WalkthroughScene['coordinates']; faces: AssetFace[];
  openingParts: AssetBox[]; collision: { version: 1; units: 'm'; coordinates: WalkthroughScene['coordinates']; colliders: Collider[];
    doors: { id: string; collider: Collider; state: 'closed'; dynamic: true }[] };
  metadata: { planId: string; status: string; floors: WalkthroughScene['floors']; rooms: WalkthroughScene['rooms'];
    openings: WalkthroughScene['openings']; stairs: WalkthroughScene['stairs']; roofs: WalkthroughScene['roofs']; connections: WalkthroughScene['connections'];
    entries: { id: string; roomId: string; floorId: string; position: V3; clearanceBasis: string }[];
    exitAccess?: WalkthroughScene['source']['emergency']['exitAccess'];
    entryAccess?: WalkthroughScene['source']['emergency']['entryAccess'];
    issues: WalkthroughScene['issues']; navigation: { ready: false; reason: string; agentRadiusM: number; agentHeightM: number } };
}
export type WalkthroughAppearancePayload = { bindings: Record<string, Look>; furniture: AssetBox[]; skins: AssetFace[];
  models?: InteriorModelInstance[];
  specifications: { roomId: string; selections: InteriorFinishes['specifications']; finishes: InteriorFinishes }[];
  issues: { code: string; roomId?: string; message: string }[] }

const binding = (floorId: string, roomId: string | null, role: string) => JSON.stringify([floorId, roomId, role])
const neutral: Record<string, Look> = { wall: { color: '#eeeae2', rough: .8 }, floor: { color: '#d5ccba', rough: .7 },
  ceiling: { color: '#f4f0e8', rough: .9 }, glass: { color: '#c6dce4', rough: .12, opacity: .28 },
  door: { color: '#785d46', rough: .5 }, frame: { color: '#333b39', rough: .4, metal: .4 }, railing: { color: '#41474b', rough: .3, metal: .85 } }

/** Split only material domains; these are the exact source boundary faces, not new architecture.
 * A shared wall's inward face belongs to its adjacent room, never both rooms.
 */
export function materialDomains(scene: WalkthroughScene): AssetFace[] {
  const result: AssetFace[] = []
  for (const face of scene.surfaces) {
    const axis = face.normal.findIndex(n => Math.abs(n) > .9), u = axis === 0 ? 2 : 0, v = axis === 1 ? 2 : 1
    const min = Math.min(...face.vertices.map(p => p[u])), low = Math.min(...face.vertices.map(p => p[v]))
    let remaining = [{ x: min, y: low, w: Math.max(...face.vertices.map(p => p[u])) - min, h: Math.max(...face.vertices.map(p => p[v])) - low }]
    const plane = face.vertices[0][axis], sign = face.normal[axis]
    const role = face.role === 'glass' ? 'glass' : face.role === 'slab' ? axis === 1 && sign > 0 ? 'floor' : axis === 1 ? 'ceiling' : 'slab' : face.role
    const rooms = scene.rooms.filter(r => !r.outdoor).sort((a, b) => a.id.localeCompare(b.id))
    const add = (r: typeof remaining[number], roomId: string | null, floorId: string) => {
      const verts = face.vertices.map(p => { const q = [...p] as V3; q[u] = Math.abs(p[u] - min) < 1e-6 ? r.x : r.x + r.w;
        q[v] = Math.abs(p[v] - low) < 1e-6 ? r.y : r.y + r.h; return q })
      result.push({ ...face, id: JSON.stringify([face.id, roomId, r.x, r.y, r.w, r.h]), vertices: verts,
        canonicalSurfaceId: face.id, floorId, roomId, binding: binding(floorId, roomId, role) })
    }
    for (const room of rooms) {
      const f = scene.source.floors.find(f => f.id === room.floorId)!, rect = room.rectMm
      const bounds = [[rect.x / 1000, (rect.x + rect.w) / 1000], [room.elevationM, (f.elevationMm + f.heightMm - (f.slabThicknessMm ?? 0)) / 1000], [-(rect.y + rect.h) / 1000, -rect.y / 1000]]
      // Inward-facing skin may sit half a wall thickness inside a room. A ceiling
      // from the storey above belongs to the room below, not that slab's floor.
      const sample = plane + sign * .001
      if (sample < bounds[axis][0] - .002 || sample > bounds[axis][1] + .002) continue
      if (axis !== 1 && room.floorId !== face.floorId) continue
      const domain = { x: bounds[u][0], y: bounds[v][0], w: bounds[u][1] - bounds[u][0], h: bounds[v][1] - bounds[v][0] }
      for (const r of intersectRegions(remaining, [domain])) add(r, room.id, room.floorId)
      remaining = subtractRegions(remaining, [domain])
    }
    for (const r of remaining) add(r, null, face.floorId)
  }
  return result.sort((a, b) => a.id.localeCompare(b.id))
}

function collider(id: string, floorId: string, sourceIds: string[], b: { x: number; y: number; z: number; w: number; d: number; h: number }, kind: string): Collider {
  return { id, floorId, sourceIds, kind, min: [b.x / 1000, b.z / 1000, -(b.y + b.d) / 1000],
    max: [(b.x + b.w) / 1000, (b.z + b.h) / 1000, -b.y / 1000] }
}

/** No planner, door relocation, inferred guards, ramps, or automatic traversal. */
export function prepareWalkthroughGeometry(scene: WalkthroughScene): WalkthroughGeometryPayload {
  if (scene.status === 'unsupported' || !scene.surfaces.length) throw new Error('Review the invalid or unsupported house geometry before exporting.')
  const colliders = scene.solids.map(s => collider(s.id, s.floorId, s.sourceIds, s.boundsMm, s.role))
  const openingParts: AssetBox[] = [], doors: WalkthroughGeometryPayload['collision']['doors'] = []
  for (const o of scene.openings) {
    if (o.operation === 'open') continue
    const a = o.apertureMm, horizontal = o.orient === 'h'
    const roomId = o.rooms?.find(r => r !== null) ?? null
    // Display profiles only, not measured product sections. Remain inside the
    // source aperture. Operation metadata keeps these closed leaves explicit.
    const t = Math.min(35, a.w / 8, a.d / 8), depth = Math.min(35, horizontal ? a.d : a.w)
    const put = (suffix: string, x: number, y: number, z: number, w: number, d: number, h: number, kind: 'frame' | 'door') => {
      const p = planToThreeGlb({ x, y, z })
      openingParts.push({ id: `${o.id}:${suffix}`, floorId: o.floorId, roomId, kind, sourceIds: [o.sourceId],
        position: [p.x, p.y, p.z], size: [w / 1000, h / 1000, d / 1000], rotation: 0, shape: 'box', binding: binding(o.floorId, roomId, kind === 'frame' ? 'frame' : o.operation === 'sliding' ? 'glass' : o.kind === 'entry' && !o.emergencyExit ? 'mainDoor' : 'door') })
    }
    if (horizontal) {
      put('jamb-a', a.x + t / 2, a.y + a.d / 2, a.z + a.h / 2, t, depth, a.h, 'frame')
      put('jamb-b', a.x + a.w - t / 2, a.y + a.d / 2, a.z + a.h / 2, t, depth, a.h, 'frame')
      put('head', a.x + a.w / 2, a.y + a.d / 2, a.z + a.h - t / 2, a.w - 2 * t, depth, t, 'frame')
    } else {
      put('jamb-a', a.x + a.w / 2, a.y + t / 2, a.z + a.h / 2, depth, t, a.h, 'frame')
      put('jamb-b', a.x + a.w / 2, a.y + a.d - t / 2, a.z + a.h / 2, depth, t, a.h, 'frame')
      put('head', a.x + a.w / 2, a.y + a.d / 2, a.z + a.h - t / 2, depth, a.d - 2 * t, t, 'frame')
    }
    if (o.kind === 'window') {
      // Pane is already part of the canonical shell. Never export it twice.
      colliders.push(collider(o.id, o.floorId, [o.sourceId], a, 'window'))
    } else {
      put('leaf', a.x + a.w / 2, a.y + a.d / 2, a.z + (a.h - t) / 2, horizontal ? a.w - 2 * t : depth,
        horizontal ? depth : a.d - 2 * t, a.h - t, 'door')
      const leaf = openingParts[openingParts.length - 1]
      doors.push({ id: o.id, state: 'closed', dynamic: true, collider: { id: o.id, floorId: o.floorId, sourceIds: [o.sourceId], kind: 'door',
        min: leaf.position.map((p, i) => p - leaf.size[i] / 2) as V3, max: leaf.position.map((p, i) => p + leaf.size[i] / 2) as V3 } })
    }
  }
  const entries: WalkthroughGeometryPayload['metadata']['entries'] = []
  for (const p of openingParts.filter(p => p.kind === 'frame')) colliders.push({ id: p.id, floorId: p.floorId, sourceIds: p.sourceIds, kind: 'display-frame',
    min: p.position.map((v, i) => v - p.size[i] / 2) as V3, max: p.position.map((v, i) => v + p.size[i] / 2) as V3 })
  const ground = Math.min(...scene.floors.map(f => f.level)), radius = .25, height = 1.7
  for (const o of scene.openings.filter(o => o.kind !== 'window' && o.rooms?.includes(null) && scene.source.floors.find(f => f.id === o.floorId)!.level === ground)) {
    const room = scene.rooms.find(r => r.id === o.rooms!.find(r => r !== null))
    if (!room || o.headMm / 1000 < height || (o.orient === 'h' ? o.apertureMm.w : o.apertureMm.d) / 1000 < 2 * radius) continue
    const a = o.apertureMm, h = o.orient === 'h', x = a.x + a.w / 2, y = a.y + a.d / 2
    const sign = (h ? room.rectMm.y + room.rectMm.h / 2 - y : room.rectMm.x + room.rectMm.w / 2 - x) > 0 ? 1 : -1
    const p = planToThreeGlb({ x: x + (h ? 0 : sign * (a.w / 2 + 350)), y: y + (h ? sign * (a.d / 2 + 350) : 0), z: a.z })
    const footprint = { x: p.x * 1000 - radius * 1000, y: -p.z * 1000 - radius * 1000, w: radius * 2000, h: radius * 2000 }
    if (subtractRegions([footprint], room.supportedRegionsMm).length) continue
    if (colliders.some(c => p.y + height > c.min[1] + .001 && p.y + .05 < c.max[1] &&
      p.x + radius > c.min[0] && p.x - radius < c.max[0] && p.z + radius > c.min[2] && p.z - radius < c.max[2])) continue
    entries.push({ id: o.id, roomId: room.id, floorId: o.floorId, position: [p.x, p.y, p.z], clearanceBasis: 'Static source-AABB and supported-floor test, radius 0.25m / height 1.7m; furniture rechecked per appearance.' })
  }
  const faces=materialDomains(scene), guards=createStairGuards(scene.source)
  for(const part of guards.parts) {
    const vertices=part.verticesMm.map(([x,y,z])=>[x/1000,z/1000,-y/1000] as V3)
    part.faces.forEach((indices,index)=>{
      const v=indices.map(i=>vertices[i]), a=v[1].map((x,i)=>x-v[0][i]), b=v[2].map((x,i)=>x-v[0][i])
      const cross=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]], length=Math.hypot(...cross)
      faces.push({id:`${part.id}:face:${index}`,canonicalSurfaceId:part.id,solidId:part.id,floorId:part.floorId,sourceIds:[part.stairId],roomId:null,
        role:'stair',binding:binding(part.floorId,null,'railing'),vertices:v,normal:cross.map(x=>x/length) as V3})
    })
    colliders.push({id:part.id,floorId:part.floorId,sourceIds:[part.stairId],kind:'stair-guard',min:[0,1,2].map(i=>Math.min(...vertices.map(p=>p[i]))) as V3,max:[0,1,2].map(i=>Math.max(...vertices.map(p=>p[i]))) as V3})
  }
  return { version: WALKTHROUGH_DELIVERY_VERSION, planId: scene.planId, coordinates: scene.coordinates, faces, openingParts,
    collision: { version: 1, units: 'm', coordinates: scene.coordinates, colliders, doors }, metadata: { planId: scene.planId, status: scene.status,
      floors: scene.floors, rooms: scene.rooms, openings: scene.openings, stairs: scene.stairs, roofs: scene.roofs, connections: scene.connections, entries,
      issues: [...scene.issues,...guards.issues.map(i=>({code:'GUARD_REVIEW',severity:'warning' as const,sourceId:i.stairId,message:i.message}))], ...(scene.source.emergency?.exitAccess ? { exitAccess: scene.source.emergency.exitAccess } : {}), ...(scene.source.emergency?.entryAccess ? { entryAccess: scene.source.emergency.entryAccess } : {}), navigation: { ready: false, reason: 'Collision primitives and source stair treads are provided. The browser must audit the current character spawn and apply collision and edge controls. Missing guard details and headroom still require source review.', agentRadiusM: radius, agentHeightM: height } } }
}

export function prepareWalkthroughAppearance(design: Design, source: WalkthroughSource, geometry: WalkthroughGeometryPayload): WalkthroughAppearancePayload {
  const models:InteriorModelInstance[]=[]
  const bindings: Record<string, Look> = {}, furniture: AssetBox[] = [], skins: AssetFace[] = [], specifications: WalkthroughAppearancePayload['specifications'] = [], issues: WalkthroughAppearancePayload['issues'] = []
  const looks = new Map<string, Record<string, Look>>()
  for (const room of source.rooms.filter(r => !r.outdoor)) {
    const result = resolveWalkthroughRoomAssets(design, source, room.key)
    if (!('finishes' in result) || !result.finishes) { issues.push({ code: 'ROOM_ASSETS_UNAVAILABLE', roomId: room.key, message: 'Room assets are unavailable; source architecture remains intact.' }); continue }
    const fin = result.finishes, house = houseLooks(fin)!
    looks.set(room.key, { floor: surfaceLook(fin.floor), wall: { color: fin.walls.color, rough: fin.walls.rough, metal: fin.walls.metallic ? .35 : 0 },
      ceiling: { color: fin.ceiling.color, rough: .9 }, glass: house.glass, frame: house.frame, door: house.door, mainDoor: house.mainDoor })
    specifications.push({ roomId: room.key, selections: fin.specifications, finishes: fin })
    const fitted = fitWalkthroughFinishes(fin, room.key, geometry, result.state === 'resolved' ? result.furnishing.tiles?.sides : [])
    Object.assign(bindings, fitted.bindings); furniture.push(...fitted.furniture); skins.push(...fitted.skins)
    if (result.state !== 'resolved') { issues.push({ code: 'FURNISHING_UNAVAILABLE', roomId: room.key, message: 'This room has finishes but no supported procedural furnishing.' }); continue }
    const r = source.building.rooms.find(r => r.floorId === room.floorId && r.id === room.sourceRoomId)!, f = source.building.floors.find(f => f.id === room.floorId)!
    for (const box of result.furnishing.boxes) {
      if (/bath|toilet|ensuite/i.test(r.name) && /mirror/i.test(box.id)) continue
      const id = JSON.stringify([room.key, box.id]), key = `furniture:${id}`
      bindings[key] = box.look
      furniture.push({ id, floorId: room.floorId, roomId: room.key, sourceIds: [box.id], kind: 'furniture', binding: key,
        position: roomLocalToWalkthrough(box.pos, r, f), size: [...box.size], rotation: -(box.rot ?? 0), shape: box.shape ?? 'box', bevelM: box.bevel })
    }
    models.push(...roomInteriorModels(design.model.brief,room.key,room.finishRoomKey,furniture.filter(p=>p.roomId===room.key),result.furnishing.placements??[],fin,bindings,r.rect))
  }
  for (const item of [...geometry.faces, ...geometry.openingParts]) {
    const role = JSON.parse(item.binding)[2] as string
    bindings[item.binding] = item.roomId && looks.get(item.roomId)?.[role] || neutral[role] || neutral.wall
  }
  issues.push({ code: 'PROCEDURAL_ASSETS', message: 'Selected products follow Finishes & Cost. Product shapes, fitted positions, ceiling profiles, tile heights and PBR values are visual approximations; they are not manufacturer models or measured installation quantities. Product photographs remain references; swatches/material closeups are approximate textures. Opening profiles are illustrative 35mm sections. Unrepresented products remain listed in the room schedule.' })
  return { bindings, furniture, skins, specifications, issues,models }
}

/** Conservative rotated furniture boxes, separate from immutable structure. */
export function furnitureColliders(appearance: WalkthroughAppearancePayload): Collider[] {
  const original=appearance.furniture.filter(b => b.size[1] > .05).map(b => {
    const c = Math.abs(Math.cos(b.rotation)), s = Math.abs(Math.sin(b.rotation)), size: V3 = [b.size[0] * c + b.size[2] * s, b.size[1], b.size[0] * s + b.size[2] * c]
    return { id: b.id, floorId: b.floorId, kind: 'furniture-aabb', sourceIds: b.sourceIds,
      min: b.position.map((p, i) => p - size[i] / 2) as V3, max: b.position.map((p, i) => p + size[i] / 2) as V3 }
  })
  return [...original,...(appearance.models??[]).map(m=>{
    const c=Math.abs(Math.cos(m.rotation)),s=Math.abs(Math.sin(m.rotation)),size=[m.size[0]*c+m.size[2]*s,m.size[1],m.size[0]*s+m.size[2]*c]
    return {id:m.id,floorId:m.floorId,kind:'furniture-model-aabb',sourceIds:[m.assetId],min:[m.position[0]-size[0]/2,m.position[1],m.position[2]-size[2]/2] as V3,max:[m.position[0]+size[0]/2,m.position[1]+size[1],m.position[2]+size[2]/2] as V3}
  })]
}
