import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir, rename, rm, stat, realpath } from 'node:fs/promises'
import { readFileSync, createReadStream } from 'node:fs'
import { resolve, sep } from 'node:path'
import { createBuildingModel } from '../src/lib/engine/buildingModel.ts'
import { validate } from '../src/lib/rules/index.ts'
import { briefSchema } from '../src/lib/model/brief.ts'
import { createWalkthroughSource } from '../src/lib/walkthrough/source.ts'
import { buildWalkthroughScene } from '../src/lib/walkthrough/scene.ts'
import { prepareWalkthroughGeometry, prepareWalkthroughAppearance, furnitureColliders, WALKTHROUGH_DELIVERY_VERSION, WALKTHROUGH_APPEARANCE_VERSION } from '../src/lib/walkthrough/delivery.ts'
import { INTERIOR_STYLES, LIGHTINGS, DENSITIES } from '../src/lib/interior/preview.ts'
import { runBlender, PROJECT_ROOT } from './blender-process.mjs'

const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v
export const digest = v => createHash('sha256').update(typeof v === 'string' || Buffer.isBuffer(v) ? v : JSON.stringify(canonical(v))).digest('hex')
const VERSION_FILES = ['blender/walkthrough_export.py', 'blender/exporters/glb.py', 'src/lib/walkthrough/scene.ts', 'src/lib/walkthrough/surfaces.ts', 'src/lib/walkthrough/stairs.ts', 'src/lib/walkthrough/delivery.ts', 'src/lib/walkthrough/fittedFinishes.ts', 'src/lib/walkthrough/roomAssets.ts', 'src/lib/interior/finishes.ts', 'src/lib/interior/preview.ts', 'src/lib/three/dressRoom.ts', 'src/lib/three/buildDollhouse.ts', 'server/walkthrough-assets.mjs']
const rendererIdentity = () => digest(VERSION_FILES.map(f => readFileSync(resolve(PROJECT_ROOT, f), 'utf8')))
const fail = (message, status = 400) => Object.assign(new Error(message), { status })

/** Revalidate the submitted Design; never trust a client-provided shell or report. */
export function prepareWalkthroughRequest(p) {
  if (!p || typeof p.projectId !== 'string' || !p.projectId.trim() || p.projectId.length > 160 || typeof p.expectedPlanId !== 'string') throw fail('Select a current project and validated house.')
  if (!p.design || !Array.isArray(p.design.floors) || p.design.floors.length > 8 ||
    p.design.floors.reduce((n, f) => n + (f.rooms?.length ?? 0) + (f.walls?.length ?? 0) + (f.openings?.length ?? 0), 0) > 2500) throw fail('This house exceeds the supported walkthrough size.')
  if (!briefSchema.safeParse(p.design.model?.brief).success) throw fail('The saved project specifications are invalid. Review them before exporting.', 422)
  const prefs = p.preferences
  if (!prefs || ![[INTERIOR_STYLES, prefs.style], [LIGHTINGS, prefs.lighting], [DENSITIES, prefs.furnitureDensity]].every(([list, v]) => list.some(o => o.id === v))) throw fail('Choose valid interior preferences.')
  const report = validate(p.design)
  if (!report.hardChecksPass) throw fail('The current plan must pass validation before a walkthrough can be exported.', 422)
  const building = createBuildingModel(p.design)
  if (building.planId !== p.expectedPlanId) throw fail('The requested design no longer matches the validated house. Refresh and retry.', 409)
  const source = createWalkthroughSource(p.design, report, prefs, building), scene = buildWalkthroughScene(building, report)
  const geometry = prepareWalkthroughGeometry(scene)
  if (geometry.faces.length > 60000) throw fail('The walkthrough has too many surfaces for this exporter.', 422)
  const appearance = prepareWalkthroughAppearance(p.design, source, geometry)
  return { projectId: p.projectId, designId: building.planId, geometry, appearance }
}

/** Validate GLB framing, embedded buffers, finite positions, index ranges and design extras.
 * A file's existence alone is never a successful export.
 */
export function inspectWalkthroughGlb(bytes, planId, allowEmpty = false) {
  if (bytes.length < 32 || bytes.length > 100e6 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error('Incomplete or oversized walkthrough GLB.')
  let offset = 12, doc, binary
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new Error('Truncated GLB chunk.')
    const n = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4); offset += 8
    if (n % 4 || offset + n > bytes.length) throw new Error('Invalid GLB chunk extent.')
    if (type === 0x4e4f534a) doc = JSON.parse(bytes.subarray(offset, offset + n).toString('utf8').trim())
    if (type === 0x004e4942) binary = bytes.subarray(offset, offset + n)
    offset += n
  }
  if (!doc || !doc.nodes?.some(n => n.extras?.sourcePlanId === planId) || (!allowEmpty && (!binary || !doc.meshes?.length)) || doc.buffers?.some(b => b.uri || b.byteLength > (binary?.length ?? 0))) throw new Error('GLB is missing geometry or source design identity.')
  if (doc.nodes.some(n => n.extras?.sourcePlanId && n.extras.sourcePlanId !== planId)) throw new Error('GLB contains a different house identity.')
  if (doc.images?.some(i => i.uri && !i.uri.startsWith('data:'))) throw new Error('GLB contains an external image dependency.')
  for (const view of doc.bufferViews ?? []) if ((view.byteOffset ?? 0) + view.byteLength > binary.length) throw new Error('GLB buffer view is incomplete.')
  let triangles = 0
  for (const mesh of doc.meshes ?? []) for (const primitive of mesh.primitives) {
    const a = doc.accessors?.[primitive.attributes?.POSITION], view = a && doc.bufferViews?.[a.bufferView]
    if (!a || !view || a.type !== 'VEC3' || a.componentType !== 5126 || !a.count) throw new Error('Invalid GLB vertex data.')
    const stride = view.byteStride ?? 12, start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0)
    if ((a.byteOffset ?? 0) + (a.count - 1) * stride + 12 > view.byteLength) throw new Error('GLB vertex range is incomplete.')
    for (let i = 0; i < a.count; i++) for (let j = 0; j < 3; j++) if (!Number.isFinite(binary.readFloatLE(start + i * stride + j * 4))) throw new Error('Non-finite GLB position.')
    const index = primitive.indices === undefined ? null : doc.accessors[primitive.indices]
    if (index) {
      const v = doc.bufferViews[index.bufferView], width = { 5121: 1, 5123: 2, 5125: 4 }[index.componentType], begin = (v?.byteOffset ?? 0) + (index.byteOffset ?? 0)
      if (!v || !width || (index.byteOffset ?? 0) + index.count * width > v.byteLength) throw new Error('Invalid GLB index data.')
      for (let i = 0; i < index.count; i++) if (binary.readUIntLE(begin + i * width, width) >= a.count) throw new Error('GLB index is outside its vertex range.')
    }
    triangles += (index?.count ?? a.count) / 3
  }
  if ((!allowEmpty && !triangles) || triangles > 2_000_000) throw new Error('Walkthrough triangle budget exceeded.')
  return { triangles, nodes: doc.nodes.length, meshes: doc.meshes?.length ?? 0, bytes: bytes.length, doc }
}

function verifyStructuralDomains(info, geometry) {
  const expectedFaces = new Set(geometry.faces.map(f => f.id)), expectedParts = new Set(geometry.openingParts.map(p => p.id))
  const exportedFaces = new Set(), exportedParts = new Set()
  for (const node of info.doc.nodes) {
    for (const id of node.extras?.surfaceIds ?? []) exportedFaces.add(id)
    for (const id of node.extras?.partIds ?? []) exportedParts.add(id)
  }
  if ([...expectedFaces].some(id => !exportedFaces.has(id)) || [...expectedParts].some(id => !exportedParts.has(id))) throw new Error('Walkthrough export is missing source surfaces or opening parts.')
}

/** Only local public catalogue images can reach Blender. Missing photos fall
 * back to the selected PBR colour, with an explicit qualification. Bytes enter
 * the appearance identity, so replacing a photo at the same URL invalidates it.
 */
export async function resolveWalkthroughImages(appearance) {
  const app = structuredClone(appearance), publicRoot = await realpath(resolve(PROJECT_ROOT, 'public')), hashes = {}
  for (const look of Object.values(app.bindings)) {
    const url = look.surface?.image
    if (!url) continue
    try {
      if (!url.startsWith('/') || url.startsWith('//')) throw new Error('not a local image')
      const path = await realpath(resolve(publicRoot, '.' + decodeURIComponent(url)))
      if (!path.startsWith(publicRoot + sep) || !/\.(png|jpg|jpeg|webp)$/i.test(path)) throw new Error('not a supported public image')
      const bytes = await readFile(path)
      if (bytes.length > 8e6) throw new Error('image too large')
      hashes[url] = digest(bytes); look.surface.image = path
    } catch {
      delete look.surface.image
      if (!app.issues.some(i => i.code === 'TEXTURE_UNAVAILABLE' && i.message.includes(url))) app.issues.push({ code: 'TEXTURE_UNAVAILABLE', message: `Selected surface photo unavailable: ${url}. Its selected colour is used; the product selection is retained.` })
    }
  }
  return { appearance: app, imageHashes: hashes }
}

const json = async path => JSON.parse(await readFile(path, 'utf8'))
const save = (dir, name, value) => writeFile(resolve(dir, name), JSON.stringify(value))

export function createWalkthroughService({ root = resolve(PROJECT_ROOT, 'output/walkthrough'), runner = runBlender, rendererKey = rendererIdentity } = {}) {
  const jobs = new Map(), pending = new Map(), queue = []; let running = false
  const safeRemove = path => {
    if (!resolve(path).startsWith(resolve(root) + sep)) throw new Error('Invalid walkthrough cache workspace.')
    return rm(path, { recursive: true, force: true })
  }
  const idPath = id => resolve(root, 'jobs', id)
  const manifestFiles = ['house.glb', 'structure.glb', 'furniture.glb', 'collision.glb', 'collision.json', 'metadata.json', 'materials.json']
  async function verified(dir, name, identity) {
    const m = await json(resolve(dir, name))
    if (m.identity !== identity || !m.files || m.files.length !== (name === 'manifest.json' ? manifestFiles.length : 3)) throw new Error('Stale asset manifest.')
    const wanted = name === 'manifest.json' ? manifestFiles : ['structure.glb', 'collision.glb', 'structure.json']
    for (const f of wanted) {
      const rec = m.files.find(r => r.name === f)
      const bytes = await readFile(resolve(dir, f))
      if (!rec || bytes.length !== rec.bytes || digest(bytes) !== rec.sha256) throw new Error('Incomplete or changed asset.')
      if (f.endsWith('.glb')) inspectWalkthroughGlb(bytes, m.designId, f === 'furniture.glb')
    }
    return m
  }
  async function inventory(dir, names) {
    return Promise.all(names.map(async name => { const bytes = await readFile(resolve(dir, name)); return { name, bytes: bytes.length, sha256: digest(bytes) } }))
  }
  async function publish(stage, dir) {
    // No partial artifact is ever served. Only replace an invalid cache directory.
    await safeRemove(dir); await rename(stage, dir)
  }
  async function generate(record, data, renderer) {
    const { geometry, appearance, designId, projectId } = data, { geometryKey, appearanceKey, id } = record
    const base = resolve(root, 'geometry', geometryKey), baseStage = `${base}.tmp-${randomUUID()}`, dir = idPath(id), stage = `${dir}.tmp-${randomUUID()}`
    try {
      record.status = 'generating'
      await mkdir(resolve(root, 'geometry'), { recursive: true }); await mkdir(resolve(root, 'jobs'), { recursive: true })
      let baseManifest
      try { baseManifest = await verified(base, 'geometry-manifest.json', geometryKey) } catch { /* regenerate corrupt/missing cache */ }
      record.stage = 'Preparing the shared house structure'
      if (!baseManifest) {
        await mkdir(baseStage)
        await save(baseStage, 'input.json', { mode: 'structure', geometry })
        await runner(['--input', resolve(baseStage, 'input.json'), '--out', baseStage], resolve(baseStage, 'generation.log'), 600_000, undefined, undefined, 'blender/walkthrough_export.py')
        verifyStructuralDomains(inspectWalkthroughGlb(await readFile(resolve(baseStage, 'structure.glb')), designId), geometry)
        inspectWalkthroughGlb(await readFile(resolve(baseStage, 'collision.glb')), designId)
        const structure = await json(resolve(baseStage, 'structure.json'))
        if (structure.planId !== designId || structure.surfaceCount !== geometry.faces.length) throw new Error('The structure export does not match the validated house.')
        await save(baseStage, 'geometry-manifest.json', { identity: geometryKey, designId, renderer, files: await inventory(baseStage, ['structure.glb', 'collision.glb', 'structure.json']) })
        await publish(baseStage, base)
      }
      record.geometryReused = !!baseManifest
      record.stage = 'Applying room finishes and existing furniture'
      await mkdir(stage)
      await save(stage, 'input.json', { mode: 'appearance', geometry, appearance, structurePath: resolve(base, 'structure.glb') })
      await runner(['--input', resolve(stage, 'input.json'), '--out', stage], resolve(stage, 'generation.log'), 600_000, undefined, undefined, 'blender/walkthrough_export.py')
      const model = inspectWalkthroughGlb(await readFile(resolve(stage, 'house.glb')), designId)
      verifyStructuralDomains(model, geometry)
      inspectWalkthroughGlb(await readFile(resolve(stage, 'furniture.glb')), designId, !appearance.furniture.length)
      const expected = new Set([...geometry.faces, ...geometry.openingParts].map(x => x.binding))
      for (const node of model.doc.nodes) if (node.extras?.materialBinding) expected.delete(node.extras.materialBinding)
      if (expected.size) throw new Error('House export is missing architectural material domains.')
      await writeFile(resolve(stage, 'collision.glb'), await readFile(resolve(base, 'collision.glb')))
      await writeFile(resolve(stage, 'structure.glb'), await readFile(resolve(base, 'structure.glb')))
      const furnishingColliders = furnitureColliders(appearance), all = [...geometry.collision.colliders, ...furnishingColliders]
      const entries = geometry.metadata.entries.filter(e => !furnishingColliders.some(c => e.position[1] + 1.7 > c.min[1] && e.position[1] + .05 < c.max[1] &&
        e.position[0] + .25 > c.min[0] && e.position[0] - .25 < c.max[0] && e.position[2] + .25 > c.min[2] && e.position[2] - .25 < c.max[2]))
      await save(stage, 'collision.json', { ...geometry.collision, designId, projectId, geometryKey, appearanceKey, colliders: all,
        visualCollisionGlb: 'collision.glb contains immutable structure; furniture AABBs and dynamic doors are in this JSON.' })
      await save(stage, 'metadata.json', { ...geometry.metadata, version: WALKTHROUGH_DELIVERY_VERSION, designId, projectId, geometryKey, appearanceKey, entries,
        appearanceVersion: WALKTHROUGH_APPEARANCE_VERSION, appearanceIssues: appearance.issues, specifications: appearance.specifications, structuralSurfaceCount: geometry.faces.length,
        coordinateUnits: { sourceFootprintsAndOpenings: 'mm, plan x east / y south / z up', surfacesAndCollidersAndEntries: 'm, x east / y up / z plan north' },
        surfaces: geometry.faces.map(f => ({ id: f.id, canonicalSurfaceId: f.canonicalSurfaceId, sourceIds: f.sourceIds, floorId: f.floorId, roomId: f.roomId, binding: f.binding, vertices: f.vertices, normal: f.normal })),
        openingParts: geometry.openingParts, furniture: appearance.furniture.map(b => ({ id: b.id, roomId: b.roomId, binding: b.binding })),
        finishSkins: appearance.skins, visualBasis: appearance.specifications.map(r => ({ roomId: r.roomId, products: r.finishes.visualBasis })),
        variants: { 'house.glb': { includesFurniture: true, finishesApplied: true }, 'structure.glb': { includesFurniture: false, finishesApplied: false }, 'furniture.glb': { furnitureOnly: true } },
        render: { bakedLighting: false, materials: 'glTF metallic-roughness; supported selected surface images embedded; procedural preview shading reduced to PBR', triangles: model.triangles, bytes: model.bytes } })
      const browserBindings = structuredClone(appearance.bindings), publicRoot = resolve(PROJECT_ROOT, 'public')
      for (const look of Object.values(browserBindings)) if (look.surface?.image?.startsWith(publicRoot + sep)) look.surface.image = '/' + look.surface.image.slice(publicRoot.length + 1).replaceAll('\\', '/')
      await save(stage, 'materials.json', { designId, geometryKey, appearanceKey, appearanceVersion: WALKTHROUGH_APPEARANCE_VERSION, bindings: browserBindings,
        furniture: appearance.furniture, skins: appearance.skins })
      const m = { version: WALKTHROUGH_DELIVERY_VERSION, identity: id, designId, projectId, geometryKey, appearanceKey, geometryReused: record.geometryReused,
        status: 'ready', reviewRequired: geometry.metadata.issues.length > 0 || appearance.issues.length > 0, createdAt: new Date().toISOString(), files: await inventory(stage, manifestFiles) }
      await save(stage, 'manifest.json', m); await verified(stage, 'manifest.json', id); await publish(stage, dir)
      record.status = 'ready'; record.stage = 'Walkthrough assets ready for review'
    } catch (error) { record.status = 'failed'; record.stage = 'Export failed'; record.error = 'The walkthrough could not be completed. The existing house and previews are unchanged. Retry after checking the plan and local Blender installation.'; console.error('[walkthrough]', id, error.message) }
    finally { await safeRemove(baseStage).catch(() => {}); await safeRemove(stage).catch(() => {}); pending.delete(id); if (record.status === 'ready') jobs.delete(id) }
  }
  function pump() {
    if (running || !queue.length) return
    running = true; const next = queue.shift()
    generate(...next).catch(error => console.error('[walkthrough]', error.message)).finally(() => { running = false; pump() })
  }
  async function request(p) {
    const data = prepareWalkthroughRequest(p), renderer = typeof rendererKey === 'function' ? rendererKey() : rendererKey
    const images = await resolveWalkthroughImages(data.appearance)
    data.appearance = images.appearance
    // Renderer/content hashes use SHA-256; the small frontend plan hash is an association, not the cache's only identity.
    const geometryKey = digest({ version: WALKTHROUGH_DELIVERY_VERSION, renderer, geometry: data.geometry })
    const appearanceKey = digest({ geometryKey, appearance: data.appearance, imageHashes: images.imageHashes })
    const id = digest({ projectId: data.projectId, designId: data.designId, geometryKey, appearanceKey })
    const record = { id, projectId: data.projectId, designId: data.designId, geometryKey, appearanceKey, status: 'queued', stage: 'Waiting to export', geometryReused: false }
    try { const m = await verified(idPath(id), 'manifest.json', id); return { ...record, ...m, id, status: 'ready', cached: true } } catch { /* missing, changed or incomplete */ }
    if (pending.has(id)) return { ...jobs.get(id) }
    if (queue.length >= 8) throw fail('The walkthrough export queue is full. Please try again shortly.', 429)
    if (jobs.size >= 256) for (const [key, job] of jobs) { if (job.status === 'failed') jobs.delete(key); if (jobs.size < 128) break }
    jobs.set(id, record); pending.set(id, true); queue.push([record, data, renderer]); pump(); return { ...record }
  }
  async function status(id) {
    if (pending.has(id) || jobs.get(id)?.status === 'failed') return jobs.get(id)
    try { return { ...await verified(idPath(id), 'manifest.json', id), id, status: 'ready', stage: 'Walkthrough assets ready for review' } }
    catch { return { id, status: 'missing', error: 'The walkthrough assets are missing or incomplete. Generate them again.' } }
  }
  async function handle(req, res, readJson) {
    const url = new URL(req.url, 'http://localhost'), match = /^\/api\/walkthrough-assets\/([a-f0-9]{64})(?:\/(house\.glb|structure\.glb|furniture\.glb|collision\.glb|metadata\.json|collision\.json|materials\.json))?$/.exec(url.pathname)
    const send = (code, value) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)) }
    if (req.method === 'POST' && url.pathname === '/api/walkthrough-assets') {
      try { const job = await request(await readJson(req, 16e6)); send(job.status === 'ready' ? 200 : 202, job) }
      catch (e) { send(e.status ?? 400, { error: e.status ? e.message : 'The project could not be prepared. Check its validated plan and retry.' }) }
      return true
    }
    if (!match || !['GET', 'HEAD'].includes(req.method)) return false
    const [, id, file] = match, s = await status(id)
    if (!file) { send(s.status === 'missing' ? 404 : 200, s); return true }
    if (s.status !== 'ready') { send(409, { error: 'The walkthrough export is not ready. Request a complete export first.' }); return true }
    const path = resolve(idPath(id), file), info = await stat(path).catch(() => null)
    if (!info) { send(404, { error: 'This walkthrough artifact is unavailable.' }); return true }
    res.writeHead(200, { 'content-type': file.endsWith('.glb') ? 'model/gltf-binary' : 'application/json', 'content-length': info.size,
      'cache-control': 'private, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' })
    if (req.method === 'HEAD') res.end(); else createReadStream(path).on('error', () => res.destroy()).pipe(res)
    return true
  }
  return { request, status, handle }
}
const service = createWalkthroughService()
export const handleWalkthroughAssets = (...args) => service.handle(...args)
