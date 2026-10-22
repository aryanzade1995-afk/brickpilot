import type { InteriorFinishes } from '../interior/finishes.ts'
import { surfaceLook, type Look } from '../three/dressRoom.ts'
import type { AssetBox, AssetFace, WalkthroughAppearancePayload, WalkthroughGeometryPayload } from './delivery.ts'

/** Appearance only. All skins are clipped to existing boundary faces, which
 * already exclude doors, windows, shafts and stair/double-height openings.
 * Fitted products are concept representations, never new measured BOQ items.
 */
export function fitWalkthroughFinishes(fin: InteriorFinishes, roomId: string, geometry: WalkthroughGeometryPayload,
  tileSides: string[] = []): Pick<WalkthroughAppearancePayload, 'skins' | 'furniture' | 'bindings'> {
  const skins: AssetFace[] = [], furniture: AssetBox[] = [], bindings: Record<string, Look> = {}
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
    furniture.push({ id: key, roomId, floorId: room.floorId, kind: 'furniture', binding: key, sourceIds: [id], position, size, shape, rotation })
  }
  const area = (f: AssetFace) => { const b = bounds(f); return (b[0][1] - b[0][0]) * (b[2][1] - b[2][0]) }
  const ceiling = ceilings.filter(f => area(f) > .25).sort((a, b) => area(b) - area(a))[0]
  if (ceiling) {
    const b = bounds(ceiling), x = (b[0][0] + b[0][1]) / 2, z = (b[2][0] + b[2][1]) / 2, y = b[1][0] - (fin.ceiling.type === 'plain' ? 0 : .16)
    if (fin.fan && Math.min(b[0][1] - b[0][0], b[2][1] - b[2][0]) > 1.5) {
      const color = fin.fan.profile?.color ?? '#ECEAE4', accent = fin.fan.profile?.accent ?? '#777777'
      add('fan-rod', [x, y - .14, z], [.025, .28, .025], { color: accent, rough: .4 }, 'cyl')
      add('fan-hub', [x, y - .31, z], [.24, .12, .24], { color, rough: .4 }, 'cyl')
      for (let i = 0; i < 3; i++) {
        const a = i * Math.PI * 2 / 3
        add(`fan-blade-${i}`, [x + Math.cos(a) * .32, y - .32, z - Math.sin(a) * .32], [.56, .018, .12], { color, rough: .45 }, 'box', a)
      }
      if (fin.fan.style !== 'plain') add('fan-light', [x, y - .4, z], [.2, .04, .2], { color: '#fff4df', rough: .4, emissive: '#ffe2ad', glow: .4 }, 'cyl')
    }
    // An illustrative fitting, not the count of electrical points in the BOQ.
    const lightX = fin.fan ? b[0][0] + .22 : x
    add('ceiling-light', [lightX, y - .025, z], fin.lights.kind === 'panel' ? [.3, .04, .3] : [.16, .04, .16],
      { color: fin.lights.profile?.color ?? '#ffffff', rough: .4, emissive: '#fff2d6', glow: .4 }, fin.lights.kind === 'panel' ? 'box' : 'cyl')
    if (fin.batten) add('batten', [x, y - .03, b[2][0] + .15], [.6, .04, .06], { color: fin.batten.profile?.color ?? '#ffffff', rough: .4, emissive: '#fff4df', glow: .3 })
    if (fin.bulb && b[2][1] - b[2][0] > .5) {
      add('bulb-holder', [x, y - .035, b[2][1] - .18], [.06, .07, .06], { color: fin.bulb.profile?.accent ?? '#dddddd', rough: .4 }, 'cyl')
      add('bulb', [x, y - .12, b[2][1] - .18], [.09, .12, .09], { color: fin.bulb.profile?.color ?? '#faf7ec', rough: .3, emissive: '#fff2d6', glow: .3 }, 'ball')
    }
  }
  const wallAt = (height: number, width: number, panelHeight: number) => walls.filter(f => {
    const b = bounds(f), span = Math.max(b[0][1] - b[0][0], b[2][1] - b[2][0])
    return span > width + .1 && b[1][0] <= room.elevationM + height - panelHeight / 2 && b[1][1] >= room.elevationM + height + panelHeight / 2
  }).sort((a, b) => a.id.localeCompare(b.id))[0]
  const wallProduct = (id: string, height: number, width: number, h: number, depth: number, color: string, metal = 0) => {
    const f = wallAt(height, width, h); if (!f) return
    const b = bounds(f), x = (b[0][0] + b[0][1]) / 2 + f.normal[0] * (depth / 2 + .005), z = (b[2][0] + b[2][1]) / 2 + f.normal[2] * (depth / 2 + .005)
    add(id, [x, room.elevationM + height, z], Math.abs(f.normal[0]) > .9 ? [depth, h, width] : [width, h, depth], { color, rough: .4, metal })
  }
  wallProduct('switchboard', 1.2, .16, .1, .018, fin.switches.profile?.color ?? '#f5f3ee')
  if (fin.exhaust) wallProduct('exhaust', 2.25, .24, .24, .07, fin.exhaust.profile?.color ?? '#f0f0ec')
  if (fin.waterHeater) wallProduct('water-heater', 2.05, .35, fin.waterHeater.kind === 'instant' ? .25 : .5, .25, fin.waterHeater.profile?.color ?? '#eeeeee')
  if (fin.shower) wallProduct('shower-head', 2.05, .2, .03, .24, fin.fittings?.finish === 'black' ? '#151515' : fin.fittings?.finish === 'gold' ? '#ba9856' : '#bdc2c5', 1)
  return { skins, furniture, bindings }
}
