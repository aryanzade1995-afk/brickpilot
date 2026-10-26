import { Box3, BufferGeometry, Color, CylinderGeometry, DataTexture, DoubleSide, Float32BufferAttribute, Group, InstancedMesh,
  LatheGeometry, Matrix4, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Quaternion, RGBAFormat, SRGBColorSpace, Shape, Path, ExtrudeGeometry,
  TubeGeometry, CatmullRomCurve3, Vector2, Vector3, type Object3D } from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { AssetBox, WalkthroughGeometryPayload } from '../walkthrough/delivery.ts'
import type { Look } from './dressRoom.ts'

export const INTERIOR_DETAIL_VERSION = 'switches-botanical-leaves-v1'
const ids = (part: AssetBox) => part.sourceIds.join(' ')
export const isSwitchboard = (part: AssetBox) => part.sourceIds.some(id => id === 'switchboard') && Boolean(part.support)
export function indoorPlantGroups(parts: AssetBox[]) {
  const groups = new Map<string, AssetBox[]>()
  for (const part of parts) for (const id of part.sourceIds) {
    if (!/(?:^|[-:])plant(?:[-:]|$)/i.test(id) || !/-(?:pot|soil|stem|leaf\d+)$/i.test(id)) continue
    const key = `${part.roomId}:${id.replace(/-(?:pot|soil|stem|leaf\d+)$/i, '')}`
    const group = groups.get(key) ?? []; group.push(part); groups.set(key, group); break
  }
  return [...groups.values()].filter(group => group.some(p => /-pot$/i.test(ids(p))) && group.some(p => /-leaf\d+$/i.test(ids(p))))
}
function tag(root: Group, parts: AssetBox[], kind: string) {
  root.name = kind; root.userData = { roomId: parts[0].roomId, refinement: kind, partIds: parts.map(p => p.id), detailRevision: INTERIOR_DETAIL_VERSION }
}
/** A physical modular plate in the existing mounted envelope. No catalogue
 * photograph is stretched across its face and no electrical rating is invented. */
export function detailedSwitchboard(part: AssetBox, look: Look) {
  const root = new Group(), normal = new Vector3(...part.support!.normal).normalize(), up = new Vector3(0, 1, 0)
  const right = up.clone().cross(normal).normalize()
  root.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(right, up, normal)); root.position.set(...part.position)
  tag(root, [part], 'detailed-switchboard')
  const width = Math.abs(normal.x) > .9 ? part.size[2] : part.size[0], height = part.size[1], depth = Math.abs(normal.x) > .9 ? part.size[0] : part.size[2]
  const scale = Math.min(width / .16, height / .1), dark = new Color(look.color).getHSL({ h: 0, s: 0, l: 0 }).l < .3
  const finish = new MeshPhysicalMaterial({ color: look.color, roughness: .29, metalness: Math.min(.2, look.metal ?? 0), clearcoat: .25, clearcoatRoughness: .32 })
  const recess = new MeshStandardMaterial({ color: '#252826', roughness: .72 }), seam = new MeshStandardMaterial({ color: dark ? '#141615' : '#9D9E96', roughness: .68 })
  const rocker = finish.clone(); rocker.roughness = .36; rocker.clearcoat = .15
  const metal = new MeshStandardMaterial({ color: '#9D9273', roughness: .32, metalness: .8 })
  const rect = (name: string, x: number, y: number, z: number, w: number, h: number, d: number, material: MeshStandardMaterial, radius = .001) => {
    const mesh = new Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, d * .35, h * .12)), material)
    mesh.name = name; mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; root.add(mesh); return mesh
  }
  rect('Backing gasket', 0, 0, -depth * .43, width * .97, height * .96, depth * .12, recess)
  rect('Soft bevel perimeter', 0, 0, -depth * .08, width, height, depth * .64, finish, .0025 * scale)
  rect('Inset module field', 0, 0, depth * .25, width * .91, height * .77, .0012, seam, .0003)
  const moduleW = width * .235, moduleH = height * .68, front = depth * .33
  for (let i = 0; i < 2; i++) {
    const x = width * (-.295 + i * .245)
    const key = rect(`Rocker ${i + 1}`, x, 0, front, moduleW * .94, moduleH, depth * .2, rocker, .0008)
    key.rotation.x = i ? -.025 : .025
    rect(`Rocker reveal ${i + 1}`, x, -moduleH * .38, front + depth * .1, moduleW * .54, .00065, .0005, seam, .0001)
    rect(`Embossed marker ${i + 1}`, x, moduleH * .3, front + depth * .105, .004 * scale, .00065, .00035, finish, .0001)
  }
  const socketX = width * .28
  const apertures = [[0, .017, .0042], [-.009, -.009, .0032], [.009, -.009, .0032]], shape = new Shape(), half = moduleW * 1.17 / 2
  shape.moveTo(-half, -moduleH / 2); shape.lineTo(half, -moduleH / 2); shape.lineTo(half, moduleH / 2); shape.lineTo(-half, moduleH / 2); shape.closePath()
  for (const [x, y, radius] of apertures) { const hole = new Path(); hole.absellipse(x * scale, y * scale, radius * scale, radius * scale, 0, Math.PI * 2, true); shape.holes.push(hole) }
  const socket = new Mesh(new ExtrudeGeometry(shape, { depth: depth * .2, bevelEnabled: true, bevelThickness: .0002, bevelSize: .0002, bevelSegments: 1, curveSegments: 12, steps: 1 }), finish)
  socket.name = 'Socket face with real open apertures'; socket.position.set(socketX, 0, front - depth * .1); socket.castShadow = socket.receiveShadow = true; root.add(socket)
  for (const [x, y, radius] of apertures) {
    // A dark well, surrounding lip and inset contact give depth at close range.
    const well = new Mesh(new CylinderGeometry(radius * scale, radius * scale, .001, 16), recess)
    well.name = 'Recessed socket opening'; well.rotation.x = Math.PI / 2; well.position.set(socketX + x * scale, y * scale, front - depth * .14); root.add(well)
    const contact = new Mesh(new CylinderGeometry(radius * .34 * scale, radius * .34 * scale, .0003, 12), metal)
    contact.name = 'Recessed contact'; contact.rotation.x = Math.PI / 2; contact.position.copy(well.position); contact.position.z += .00055; root.add(contact)
  }
  return root
}
function leafSurface() {
  const width = 64, height = 128, colour = new Uint8Array(width * height * 4), bump = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / (width - 1) * 2 - 1, v = y / (height - 1), central = Math.exp(-u * u * 850)
    const vein = Math.pow(Math.max(0, Math.cos((v * 8 - Math.abs(u) * .55) * Math.PI * 2)), 22) * (1 - Math.abs(u))
    const fleck = Math.sin(x * 17.3 + y * 11.1) * Math.sin(y * 7.7) * 2.5, at = (y * width + x) * 4
    const tint = central * 24 + vein * 9 + fleck
    colour.set([42 + tint, 83 + tint, 33 + tint * .65, 255], at)
    const h = 110 + central * 95 + vein * 28; bump.set([h, h, h, 255], at)
  }
  const map = new DataTexture(colour, width, height, RGBAFormat), heightMap = new DataTexture(bump, width, height, RGBAFormat)
  map.colorSpace = SRGBColorSpace; map.needsUpdate = heightMap.needsUpdate = true
  map.userData.proceduralKey = 'indoor-leaf-veins-colour-v1'; heightMap.userData.proceduralKey = 'indoor-leaf-veins-height-v1'
  return { map, heightMap }
}
function leafBlade() {
  const vertices: number[] = [], uv: number[] = [], index: number[] = [], rows = 12, columns = 4
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) {
    const t = y / rows, s = x / columns * 2 - 1, width = .29 * Math.pow(Math.sin(Math.PI * t), .7)
    vertices.push(s * width, t, Math.sin(Math.PI * t) * .07 + t * t * .14 - Math.abs(s) * .05 * Math.sin(Math.PI * t))
    uv.push(x / columns, t)
  }
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const a = y * (columns + 1) + x, b = a + columns + 1; index.push(a, b, a + 1, a + 1, b, b + 1)
  }
  const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(vertices, 3)); g.setAttribute('uv', new Float32BufferAttribute(uv, 2)); g.setIndex(index); g.computeVertexNormals(); return g
}
/** Curved, opaque leaf blades (one instanced draw), petioles, a tapered ceramic
 * pot and recessed soil. Everything remains inside the original placed volume. */
export function detailedIndoorPlant(parts: AssetBox[]) {
  const root = new Group(); tag(root, parts, 'detailed-indoor-plant')
  const envelope = new Box3(), corner = new Vector3()
  for (const part of parts) for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    corner.set(x * part.size[0] / 2, y * part.size[1] / 2, z * part.size[2] / 2).applyAxisAngle(new Vector3(0, 1, 0), part.rotation).add(new Vector3(...part.position)); envelope.expandByPoint(corner)
  }
  const pot = parts.find(p => /-pot$/i.test(ids(p)))!, height = envelope.max.y - envelope.min.y, potH = Math.min(pot.size[1], height * .38), radius = Math.min(pot.size[0], pot.size[2]) / 2
  root.position.set(pot.position[0], envelope.min.y, pot.position[2])
  const ceramic = new MeshPhysicalMaterial({ color: '#C8B9A0', roughness: .48, clearcoat: .12, clearcoatRoughness: .4 })
  const profile = [[radius * .66, 0], [radius * .75, .012 * height], [radius * .96, potH * .88], [radius, potH * .96], [radius * .99, potH], [radius * .88, potH], [radius * .86, potH * .93]].map(([x, y]) => new Vector2(x, y))
  const planter = new Mesh(new LatheGeometry(profile, 24), ceramic); planter.name = 'Tapered ceramic planter'; planter.castShadow = planter.receiveShadow = true; root.add(planter)
  const soil = new Mesh(new CylinderGeometry(radius * .85, radius * .85, .009 * height, 24), new MeshStandardMaterial({ color: '#3D2B1D', roughness: 1 }))
  soil.name = 'Recessed potting soil'; soil.position.y = potH * .93; soil.receiveShadow = true; root.add(soil)
  const surfaces = leafSurface(), material = new MeshPhysicalMaterial({ map: surfaces.map, bumpMap: surfaces.heightMap, bumpScale: .00035,
    roughness: .48, metalness: 0, side: DoubleSide, clearcoat: .12, clearcoatRoughness: .5 })
  const count = height < .6 ? 18 : 26, leaves = new InstancedMesh(leafBlade(), material, count), matrix = new Matrix4(), quaternion = new Quaternion(), stems: BufferGeometry[] = []
  const seed = parts[0].id.split('').reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 11)
  const random = (n: number) => { const value = Math.sin(seed * .01 + n * 91.17) * 43758.5453; return value - Math.floor(value) }
  const stem = (from: Vector3, via: Vector3, to: Vector3, thickness: number) => stems.push(new TubeGeometry(new CatmullRomCurve3([from, via, to]), 8, thickness, 5, false))
  stem(new Vector3(0, potH * .9, 0), new Vector3(height * .015, height * .65, 0), new Vector3(-height * .01, height * .94, height * .008), height * .006)
  for (let i = 0; i < count; i++) {
    const a = i * 2.399963 + random(i) * .25, y = potH + (height - potH) * (.08 + i / count * .78), reach = radius * (.08 + random(i + 30) * .25)
    const base = new Vector3(Math.cos(a) * reach, y, Math.sin(a) * reach)
    const direction = new Vector3(Math.cos(a), .2 + random(i + 60) * .6, Math.sin(a)).normalize()
    quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction)
    const length = (height - potH) * (.2 + random(i + 90) * .17)
    matrix.compose(base, quaternion, new Vector3(length * (.8 + random(i + 120) * .35), length, length)); leaves.setMatrixAt(i, matrix)
    leaves.setColorAt(i, new Color().setRGB(.78 + random(i + 150) * .22, .87 + random(i + 180) * .13, .75 + random(i + 210) * .25))
    stem(new Vector3(0, y - height * .018, 0), base.clone().multiply(new Vector3(.5, 1, .5)), base, height * .0015)
  }
  leaves.name = 'Curved leaves with midrib and branching veins'; leaves.instanceMatrix.needsUpdate = true; leaves.castShadow = leaves.receiveShadow = true; root.add(leaves)
  const merged = mergeGeometries(stems); stems.forEach(g => g.dispose())
  if (merged) { const branches = new Mesh(merged, new MeshStandardMaterial({ color: '#5C6539', roughness: .85 })); branches.name = 'Woody stem and leaf petioles'; branches.castShadow = true; root.add(branches) }
  root.updateMatrixWorld(true); const bounds = new Box3().setFromObject(root), anchor = root.position
  const fit = (axis: 'x' | 'z') => Math.min(1, (envelope.max[axis] - anchor[axis]) / Math.max(.0001, bounds.max[axis] - anchor[axis]),
    (anchor[axis] - envelope.min[axis]) / Math.max(.0001, anchor[axis] - bounds.min[axis]))
  root.scale.set(fit('x'), Math.min(1, height / Math.max(.0001, bounds.max.y - anchor.y)), fit('z'))
  root.userData.envelope = { min: envelope.min.toArray(), max: envelope.max.toArray() }
  return root
}
/** Only identifiable bathroom mirrors are hidden. Shower glazing, windows,
 * car mirrors and reflective metal finishes are deliberately not guessed away. */
export function removeBathroomMirrors(root: Object3D, metadata: Pick<WalkthroughGeometryPayload['metadata'], 'rooms'>) {
  const bathrooms = metadata.rooms.filter(r => /bath|toilet|ensuite/i.test(r.name)), hidden: string[] = []
  root.traverse(o => {
    if (!(o instanceof Mesh)) return
    const labels = [o.name, ...(o.userData.partIds ?? []), ...(o.userData.sourceIds ?? [])].join(' ')
    if (!/mirror/i.test(labels)) return
    if (o.userData.partIds?.some((id: string) => !/mirror/i.test(id))) return
    let roomId = o.userData.roomId, source = o.userData.source_id
    for (let p = o.parent; p && !roomId; p = p.parent) roomId = p.userData.roomId
    if (!bathrooms.some(r => (roomId != null && r.id === roomId) || (source != null && (r.sourceId === source || r.semanticId === source)))) return
    o.visible = false; o.userData.bathroomMirrorRemoved = true; hidden.push(o.uuid)
  })
  return hidden
}
