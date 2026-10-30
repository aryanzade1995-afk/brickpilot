import type { InteriorFinishes } from '../interior/finishes.ts'
import {placeCeilingFitting,type CeilingPlacement} from './fittingLayout.ts'
import {quantityRules} from '../cost/data/quantityRules.ts'
import { surfaceLook, type Look } from '../three/dressRoom.ts'
import type { AssetBox, AssetFace, WalkthroughAppearancePayload, WalkthroughGeometryPayload } from './delivery.ts'

/** Appearance only. All skins are clipped to existing boundary faces, which
 * already exclude doors, windows, shafts and stair/double-height openings.
 * Fitted products are concept representations, never new measured BOQ items.
 */
export function fitWalkthroughFinishes(fin: InteriorFinishes, roomId: string, geometry: WalkthroughGeometryPayload,
  tileSides: string[] = [], occupiedFixtures: Pick<AssetBox,'position'|'size'>[] = []): Pick<WalkthroughAppearancePayload, 'skins' | 'furniture' | 'bindings'> {
  const skins: AssetFace[] = [], furniture: AssetBox[] = [], bindings: Record<string, Look> = {}
  let mounting:AssetBox['support']
  const faces = geometry.faces.filter(f => f.roomId === roomId), room = geometry.metadata.rooms.find(r => r.id === roomId)!
  const ceilings = faces.filter(f => JSON.parse(f.binding)[2] === 'ceiling')
  const walls = faces.filter(f => JSON.parse(f.binding)[2] === 'wall' && Math.abs(f.normal[1]) < .1)
  const bounds = (f: AssetFace) => [0, 1, 2].map(i => [Math.min(...f.vertices.map(p => p[i])), Math.max(...f.vertices.map(p => p[i]))])
  const skin = (f: AssetFace, suffix: string, look: Look, low?: number, high?: number, offset = .002) => {
    const b = bounds(f), lo = Math.max(b[1][0], low ?? b[1][0]), hi = Math.min(b[1][1], high ?? b[1][1])
    if (hi - lo < .001 && Math.abs(f.normal[1]) < .1) return
    const id = `${f.id}:${suffix}`, binding = `finish:${id}`; bindings[binding] = look
    skins.push({ ...f, id, binding, vertices: f.vertices.map(p => p.map((v, i) =>
      (i === 1 && Math.abs(f.normal[1]) < .1 ? Math.abs(v - b[1][0]) < .0001 ? lo : hi : v) + f.normal[i] * offset) as [number, number, number]) })
  }
  if (fin.wallTiles) for (const f of walls) {
    // Inward normal: N wall points south (-world z), S points north.
    const side = Math.abs(f.normal[0]) > .9 ? f.normal[0] > 0 ? 'W' : 'E' : f.normal[2] > 0 ? 'S' : 'N'
    if (fin.wallTiles.zone === 'backsplash' && !tileSides.includes(side)) continue
    const start = room.elevationM + (fin.wallTiles.zone === 'backsplash' ? .9 : 0)
    skin(f, 'wall-tiles', surfaceLook(fin.wallTiles), start, start + fin.wallTiles.heightM)
  }
  // Same 100 mm skirting rule already quantified in BOQ; no additional cost
  // selection. Source wall fragments keep every doorway/opening clear.
  if(fin.wallTiles?.zone!=='full')for(const face of walls){
    const b=bounds(face),h=quantityRules.finishes.skirtingHeightMm/1000
    if(b[1][0]>room.elevationM+.005||b[1][1]<room.elevationM+h)continue
    const alongX=Math.abs(face.normal[2])>.9,width=alongX?b[0][1]-b[0][0]:b[2][1]-b[2][0]
    if(width<.04)continue
    const point:[number,number,number]=[(b[0][0]+b[0][1])/2,room.elevationM+h/2,(b[2][0]+b[2][1])/2]
    mounting={surfaceId:face.canonicalSurfaceId,point,normal:[...face.normal],group:'skirting:'+face.id}
    add('skirting:'+face.id,[point[0]+face.normal[0]*.006,point[1],point[2]+face.normal[2]*.006],alongX?[width,h,.012]:[.012,h,width],surfaceLook(fin.floor))
    mounting=undefined
  }
  if (fin.ceiling.type !== 'plain') for (const f of ceilings) {
    skin(f, `ceiling-${fin.ceiling.type}`, { color: fin.ceiling.type === 'wooden' ? '#A58260' : fin.ceiling.color, rough: .7 }, undefined, undefined, .08)
    if (['tray', 'cove', 'wooden'].includes(fin.ceiling.type)) {
      const b = bounds(f), w = b[0][1] - b[0][0], d = b[2][1] - b[2][0], y = b[1][0] - .12
      if (w > .3 && d > .3) for (const [i, pos, size] of [
        [0, [(b[0][0] + b[0][1]) / 2, y, b[2][0] + .06], [w, .08, .12]],
        [1, [(b[0][0] + b[0][1]) / 2, y, b[2][1] - .06], [w, .08, .12]],
        [2, [b[0][0] + .06, y, (b[2][0] + b[2][1]) / 2], [.12, .08, d - .24]],
        [3, [b[0][1] - .06, y, (b[2][0] + b[2][1]) / 2], [.12, .08, d - .24]],
      ] as [number, [number, number, number], [number, number, number]][]) add(`${f.id}-ceiling-trim-${i}`, pos, size, { color: fin.ceiling.type === 'wooden' ? '#725238' : fin.ceiling.color, rough: .6 })
    }
  }
  function add(id: string, position: AssetBox['position'], size: AssetBox['size'], look: Look, shape: AssetBox['shape'] = 'box', rotation = 0) {
    if (size.some(n => n <= .001)) return
    const key = `fitted:${roomId}:${id}`; bindings[key] = look
    furniture.push({ id: key, roomId, floorId: room.floorId, kind: 'furniture', binding: key, sourceIds: [id], position, size, shape, rotation, support:mounting&&{...mounting} })
  }
  const occupied:CeilingPlacement[]=[]
  const ceilingOffset=fin.ceiling.type==='plain'?0:.08
  const mount=(p:CeilingPlacement,group:string)=>{mounting={surfaceId:p.surface.canonicalSurfaceId,point:[p.x,p.y,p.z],normal:[0,-1,0],group}}
  const fan=fin.fan&&placeCeilingFitting(ceilings,1.3,1.3)
  if(fan&&fin.fan){
    fan.radius=.62;occupied.push(fan);mount(fan,'fan')
    const {x,z}=fan,y=fan.y-ceilingOffset,color=fin.fan.profile?.color??'#8B6844',accent=fin.fan.profile?.accent??'#493B30'
    add('fan-rod',[x,y-.14,z],[.025,.28,.025],{color:accent,rough:.4},'cyl')
    add('fan-hub',[x,y-.31,z],[.24,.12,.24],{color,rough:.4},'cyl')
    for(let i=0;i<3;i++){
      const a=i*Math.PI*2/3
      add('fan-blade-'+i,[x+Math.cos(a)*.32,y-.32,z-Math.sin(a)*.32],[.56,.018,.12],{color,rough:.45},'box',a)
    }
    if(fin.fan.style!=='plain')add('fan-light',[x,y-.4,z],[.2,.04,.2],{color:'#fff4df',rough:.4,emissive:'#ffe2ad',glow:.4},'cyl')
  }
  // Separate mount positions and full footprints prevent fans, panels, battens
  // and bulbs from occupying each other's envelope. The mount touches the
  // actual finished ceiling rather than hanging 80 mm below an invisible plane.
  const mainSize:AssetBox['size']=fin.lights.kind==='panel'?[.3,.04,.3]:[.16,.04,.16]
  const light=placeCeilingFitting(ceilings,mainSize[0],mainSize[2],occupied)
  if(light){occupied.push(light);mount(light,'ceiling-light');add('ceiling-light',[light.x,light.y-ceilingOffset-mainSize[1]/2,light.z],mainSize,{color:fin.lights.profile?.color??'#eee2cb',rough:.4,emissive:'#fff2d6',glow:.4},fin.lights.kind==='panel'?'box':'cyl')}
  const batten=fin.batten&&placeCeilingFitting(ceilings,.6,.06,occupied)
  if(batten&&fin.batten){occupied.push(batten);mount(batten,'batten');add('batten',[batten.x,batten.y-ceilingOffset-.02,batten.z],[.6,.04,.06],{color:fin.batten.profile?.color??'#d9c49e',rough:.4,emissive:'#fff4df',glow:.3})}
  mounting=undefined
  const wallAt = (height: number, width: number, panelHeight: number) => walls.filter(f => {
    const b = bounds(f), span = Math.max(b[0][1] - b[0][0], b[2][1] - b[2][0])
    return span > width + .1 && b[1][0] <= room.elevationM + height - panelHeight / 2 && b[1][1] >= room.elevationM + height + panelHeight / 2
  }).sort((a, b) => a.id.localeCompare(b.id))
  const wallProduct = (id: string, height: number, width: number, h: number, depth: number, color: string, metal = 0) => {
    for(const f of wallAt(height, width, h))for(const fraction of [.5,.25,.75]){
    const standOff = id === 'switchboard' ? .0006 : .005
    const b = bounds(f), axis=Math.abs(f.normal[0])>.9?2:0
    const along=b[axis][0]+width/2+.05+(b[axis][1]-b[axis][0]-width-.1)*fraction
    const x = (axis===0?along:(b[0][0]+b[0][1])/2) + f.normal[0] * (depth / 2 + standOff), z = (axis===2?along:(b[2][0]+b[2][1])/2) + f.normal[2] * (depth / 2 + standOff)
    const position:AssetBox['position']=[x,room.elevationM+height,z],size:AssetBox['size']=axis===2?[depth,h,width]:[width,h,depth]
    if([...occupiedFixtures,...furniture].some(o=>position.every((v,i)=>Math.abs(v-o.position[i])<(size[i]+o.size[i])/2+.12)))continue
    mounting={surfaceId:f.canonicalSurfaceId,point:[x-f.normal[0]*(depth/2+standOff),room.elevationM+height,z-f.normal[2]*(depth/2+standOff)],normal:[...f.normal],group:id}
    add(id, position, size, { color, rough: .4, metal },id==='water-heater'&&fin.waterHeater?.kind!=='instant'?'cyl':'box')
    if(id==='water-heater'){
      furniture[furniture.length-1].bevelM=.025
      add('water-heater-control',[x+f.normal[0]*(depth/2+.006),position[1]-.08,z+f.normal[2]*(depth/2+.006)],axis===2?[.015,.09,.12]:[.12,.09,.015],{color:'#555b5c',rough:.35})
      for(const offset of [-.07,.07])add(`water-heater-connection-${offset}`,[x+(axis===0?offset:0),position[1]-h/2-.06,z+(axis===2?offset:0)],[.018,.12,.018],{color:'#a4a8a7',rough:.25,metal:.8},'cyl')
    }
    mounting=undefined
    return
    }
  }
  wallProduct('switchboard', 1.2, .16, .1, .018, fin.switches.profile?.color ?? '#f5f3ee')
  if (fin.exhaust) wallProduct('exhaust', 2.25, .24, .24, .07, fin.exhaust.profile?.color ?? '#f0f0ec')
  if (fin.waterHeater) wallProduct('water-heater', 2.05, .35, fin.waterHeater.kind === 'instant' ? .25 : .5, fin.waterHeater.kind==='instant'?.18:.35, fin.waterHeater.profile?.color ?? '#eeeeee')
  // Shower hardware is mounted by dressRoom at the allocated wet zone, rather
  // than an arbitrary first wall that may stand over a basin or doorway.
  return { skins, furniture, bindings }
}
