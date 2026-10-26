import { BufferGeometry, Float32BufferAttribute, Matrix3, Mesh, Texture, Vector3, type Group, type Material } from 'three'
import type { WalkthroughGeometryPayload, WalkthroughAppearancePayload } from '../walkthrough/delivery.ts'
import {isWalkthroughShellMesh} from './walkthroughShell.ts'

type Vertex = { p: Vector3; n: Vector3; uv: [number, number]; uv2?:[number,number] }
const sourceDomains = new WeakMap<Group, { signature: string; sources: Map<Mesh, { geometry: BufferGeometry; material: Material | Material[] }> }>()
const materialsOf = (m: Material | Material[]) => Array.isArray(m) ? m : [m]

export function disposeAcceptedVillaFinishSources(root: Group) {
  const sources = sourceDomains.get(root)
  if (!sources) return
  const live = new Set<BufferGeometry>(); root.traverse(o => { if (o instanceof Mesh) live.add(o.geometry) })
  for (const item of sources.sources.values()) if (!live.has(item.geometry)) item.geometry.dispose()
  sourceDomains.delete(root)
}
const blend = (a: Vertex, b: Vertex, t: number): Vertex => ({ p: a.p.clone().lerp(b.p, t), n: a.n.clone().lerp(b.n, t).normalize(), uv: [a.uv[0] + (b.uv[0] - a.uv[0]) * t, a.uv[1] + (b.uv[1] - a.uv[1]) * t],uv2:a.uv2&&b.uv2?[a.uv2[0]+(b.uv2[0]-a.uv2[0])*t,a.uv2[1]+(b.uv2[1]-a.uv2[1])*t]:undefined })
function clip(poly: Vertex[], axis: number, value: number, sign: number) {
  const out: Vertex[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], da = (a.p.getComponent(axis) - value) * sign, db = (b.p.getComponent(axis) - value) * sign
    if (da >= -1e-8) out.push(a)
    if ((da < -1e-8 && db > 1e-8) || (da > 1e-8 && db < -1e-8)) out.push(blend(a, b, da / (da - db)))
  }
  return out
}

/** Partition existing Blender triangles into material domains; no overlay planes,
 * extra furniture, changed wall thickness, filled openings or room replacement.
 * Clipping is required for slabs spanning several rooms: centroid colouring
 * would paint neighbouring rooms with the wrong product. World-metre UVs keep
 * catalogue tile dimensions stable under Blender's nested axis transforms.
 */
export function bindAcceptedVillaFinishes(root: Group, geometry: WalkthroughGeometryPayload, appearance: WalkthroughAppearancePayload) {
  const signature = JSON.stringify(appearance.skins.filter(f => /wall-tiles/.test(f.id)).map(f => [f.id, f.vertices]))
  const previous = sourceDomains.get(root)
  if (previous?.signature === signature) return
  const retiredMaterials = new Set<Material>()
  if (previous) for (const [mesh, item] of previous.sources) {
    materialsOf(mesh.material).forEach(m => retiredMaterials.add(m))
    if (mesh.geometry !== item.geometry) mesh.geometry.dispose()
    mesh.geometry = item.geometry; mesh.material = item.material
    delete mesh.userData.materialBindings; delete mesh.userData.resolvedLooks; delete mesh.userData.resolvedLook
  }
  const saved = previous ?? { signature, sources: new Map<Mesh, { geometry: BufferGeometry; material: Material | Material[] }>() }
  saved.signature = signature; sourceDomains.set(root, saved)
  const remember = (mesh: Mesh) => { if (!saved.sources.has(mesh)) saved.sources.set(mesh, { geometry: mesh.geometry, material: mesh.material }) }
  root.updateMatrixWorld(true)
  const domains = [...appearance.skins.filter(f => /wall-tiles/.test(f.id)), ...geometry.faces]
    .filter(f => f.roomId && ['wall', 'slab', 'column', 'beam'].includes(f.role))
    .map(f => {
      const axis = f.normal.findIndex(n => Math.abs(n) > .9)
      return { ...f, axis, bounds: [0, 1, 2].map(i => [Math.min(...f.vertices.map(p => p[i])), Math.max(...f.vertices.map(p => p[i]))]),
        binding: ['column', 'beam'].includes(f.role) ? JSON.stringify([f.floorId, f.roomId, 'wall']) : f.binding }
    }).filter(f => f.axis >= 0)
  const meshes: Mesh[] = [], retired = new Set<BufferGeometry>()
  root.traverse(o => { if (o instanceof Mesh) meshes.push(o) })
  for (const mesh of meshes) {
    const opening = geometry.metadata.openings.find(o => o.sourceId === mesh.userData.source_id)
    if (opening) {
      const roomId = opening.rooms?.find(id => id !== null)
      const role = mesh.userData.material_role === 'glass' ? 'glass' : /_Leaf(?:_|$)/.test(mesh.name) ? opening.kind === 'entry' && !opening.emergencyExit ? 'mainDoor' : 'door' : /_(?:L|R|Head|Stile_-?1|Bottom|Top)$/.test(mesh.name) ? 'frame' : null
      if (role && roomId) {
        remember(mesh)
        mesh.userData.materialBinding = JSON.stringify([opening.floorId, roomId, role]); mesh.userData.materialTileM = 1
        const p = mesh.geometry.getAttribute('position'), n = mesh.geometry.getAttribute('normal')
        if (p && n) {
          const uv: number[] = [], matrix = new Matrix3().getNormalMatrix(mesh.matrixWorld)
          for (let i = 0; i < p.count; i++) {
            const point = new Vector3().fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld), normal = new Vector3().fromBufferAttribute(n, i).applyMatrix3(matrix)
            const axis = [Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)].indexOf(Math.max(Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)))
            uv.push(axis === 0 ? -point.z : point.x, axis === 1 ? -point.z : point.y)
          }
          const previous = mesh.geometry; mesh.geometry = previous.clone(); retired.add(previous)
          mesh.geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2))
        }
      }
    }
    // Original furnishings and decorative/exterior layers retain their geometry.
    if (!isWalkthroughShellMesh(mesh)) continue
    const source = mesh.geometry, pos = source.getAttribute('position'), normal = source.getAttribute('normal'), uv = source.getAttribute('uv'),uv2=source.getAttribute('uv2')
    if (!pos || !normal) continue
    const index = source.index, inverse = mesh.matrixWorld.clone().invert(), normalMatrix = new Matrix3().getNormalMatrix(mesh.matrixWorld)
    const old = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const groups = new Map<string, { binding: string | null; material: Material; p: number[]; n: number[]; uv: number[]; uv2:number[] }>()
    let changed = false
    const emit = (poly: Vertex[], binding: string | null, material: Material, axis: number) => {
      if (poly.length < 3) return
      const key = `${binding}:${material.uuid}`, group = groups.get(key) ?? { binding, material, p: [], n: [], uv: [],uv2:[] }
      for (let j = 1; j + 1 < poly.length; j++) {
        if (new Vector3().subVectors(poly[j].p, poly[0].p).cross(new Vector3().subVectors(poly[j + 1].p, poly[0].p)).lengthSq() < 1e-16) continue
        for (const v of [poly[0], poly[j], poly[j + 1]]) {
          group.p.push(...v.p.clone().applyMatrix4(inverse).toArray()); group.n.push(...v.n.toArray())
          group.uv.push(...(binding ? [axis === 0 ? -v.p.z : v.p.x, axis === 1 ? -v.p.z : v.p.y] : v.uv))
          if(v.uv2)group.uv2.push(...v.uv2)
        }
      }
      groups.set(key, group)
    }
    for (let i = 0, count = index?.count ?? pos.count; i < count; i += 3) {
      const triangle:Vertex[] = [0, 1, 2].map(k => {
        const v = index ? index.getX(i + k) : i + k
        return { p: new Vector3().fromBufferAttribute(pos, v).applyMatrix4(mesh.matrixWorld), n: new Vector3().fromBufferAttribute(normal, v), uv: [uv?.getX(v) ?? 0, uv?.getY(v) ?? 0] as [number, number],uv2:uv2?[uv2.getX(v),uv2.getY(v)] as [number,number]:undefined }
      })
      const n = triangle[0].n.clone().applyMatrix3(normalMatrix).normalize(), axis = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)].findIndex(v => v > .99)
      const slot = source.groups.find(g => i >= g.start && i < g.start + g.count)?.materialIndex ?? 0, material = old[slot] ?? old[0]
      let remaining = [triangle]
      if (axis >= 0) for (const domain of domains) {
        if (domain.axis !== axis || n.dot(new Vector3(...domain.normal)) < .99 || Math.abs(triangle[0].p.getComponent(axis) - domain.bounds[axis][0]) > .012) continue
        const next: Vertex[][] = []
        for (const polygon of remaining) {
          let inside = polygon
          for (const a of [0, 1, 2].filter(a => a !== axis)) for (const side of [0, 1]) {
            const value = domain.bounds[a][side], sign = side ? -1 : 1
            const outside = clip(inside, a, value, -sign)
            if (outside.length >= 3) next.push(outside)
            inside = clip(inside, a, value, sign)
          }
          if (inside.length >= 3) { emit(inside, domain.binding, material, axis); changed = true }
        }
        remaining = next
        if (!remaining.length) break
      }
      for (const poly of remaining) emit(poly, null, material, axis)
    }
    if (!changed) continue
    remember(mesh)
    const output = new BufferGeometry(), p: number[] = [], n: number[] = [], tex: number[] = [],lightUV:number[]=[], materials: Material[] = [], bindings: (string | null)[] = []
    for (const group of groups.values()) {
      if (!group.p.length) continue
      output.addGroup(p.length / 3, group.p.length / 3, materials.length)
      p.push(...group.p); n.push(...group.n); tex.push(...group.uv); materials.push(group.material); bindings.push(group.binding)
      lightUV.push(...group.uv2)
    }
    output.setAttribute('position', new Float32BufferAttribute(p, 3)); output.setAttribute('normal', new Float32BufferAttribute(n, 3)); output.setAttribute('uv', new Float32BufferAttribute(tex, 2))
    if(uv2)output.setAttribute('uv2',new Float32BufferAttribute(lightUV,2))
    mesh.geometry = output; mesh.material = materials; mesh.userData.materialBindings = bindings; mesh.userData.materialTileM = 1
    retired.add(source)
  }
  const retained = new Set(meshes.map(m => m.geometry)), originals = new Set([...saved.sources.values()].map(s => s.geometry))
  for (const g of retired) if (!retained.has(g) && !originals.has(g)) g.dispose()
  const retainedMaterials = new Set<Material>(), retainedTextures = new Set<Texture>(), retiredTextures = new Set<Texture>()
  meshes.forEach(m => materialsOf(m.material).forEach(mat => retainedMaterials.add(mat)))
  saved.sources.forEach(s => materialsOf(s.material).forEach(mat => retainedMaterials.add(mat)))
  retainedMaterials.forEach(m => Object.values(m).forEach(v => { if (v instanceof Texture) retainedTextures.add(v) }))
  for (const m of retiredMaterials) if (!retainedMaterials.has(m)) { Object.values(m).forEach(v => { if (v instanceof Texture) retiredTextures.add(v) }); m.dispose() }
  for (const tex of retiredTextures) if (!retainedTextures.has(tex)) tex.dispose()
  root.userData.acceptedFinishDomains = true
}
