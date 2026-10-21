import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, realpath, stat, rename, rm } from 'node:fs/promises'
import { resolve, relative, isAbsolute, basename } from 'node:path'
import { PROJECT_ROOT, runBlender } from './blender-process.mjs'

export const CAD_EXPORT_VERSION = 'villa-mesh-v2'
const ROOT = resolve(PROJECT_ROOT, 'output/villa-jobs')
const pending = new Map()
let tail = Promise.resolve()
const inside = (root, path) => { const rel = relative(root, path); return rel !== '..' && !rel.startsWith('..\\') && !rel.startsWith('../') && !isAbsolute(rel) }

/** Convert only an immutable accepted master. Never invoke architectural generation. */
export async function prepareCadExport(jobId, format, { root = ROOT, convert = runBlender } = {}) {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(jobId) || !['dxf', 'dae'].includes(format))
    throw new Error('Unsupported villa export')
  const directory = resolve(root, jobId)
  const accepted = JSON.parse(await readFile(resolve(directory, 'accepted.json'), 'utf8'))
  const blend = accepted.files?.find(f => typeof f === 'string' && basename(f) === f && f.endsWith('.blend'))
  if (!blend) throw new Error('This villa has no accepted Blender master to export')
  const source = await realpath(resolve(accepted.directory, blend)), allowed = await realpath(directory)
  if (!inside(allowed, source)) throw new Error('Accepted master is outside its villa job')
  const sourceStat = await stat(source)
  const key = createHash('sha256').update(JSON.stringify([CAD_EXPORT_VERSION, source, sourceStat.size, sourceStat.mtimeMs,
    accepted.planId, accepted.seed, accepted.solarCacheKey ?? null])).digest('hex')
  const target = resolve(directory, 'cad', key), filename = `villa-${accepted.artifactScope === 'building-plus-solar' ? 'building-plus-solar' : 'building-only'}.${format}`
  if (!inside(directory, target)) throw new Error('Invalid CAD output directory')
  const ready = async () => {
    try { const info = JSON.parse(await readFile(resolve(target, 'manifest.json'), 'utf8')); return info.exportVersion === CAD_EXPORT_VERSION && info.triangleCount > 0 && (await stat(resolve(target, filename))).size > 0 } catch { return false }
  }
  if (!await ready()) {
    if (!pending.has(target)) {
      if (pending.size >= 4) throw new Error('CAD export queue is full. Please try again shortly.')
      const task = tail.catch(() => {}).then(async () => {
        if (await ready()) return
        const temporary = `${target}-${randomUUID()}`
        if (!inside(directory, temporary)) throw new Error('Invalid temporary CAD directory')
        await mkdir(temporary, { recursive: true })
        try {
          await convert(['--source', source, '--output', temporary, '--scope', accepted.artifactScope === 'building-plus-solar' ? 'building-plus-solar' : 'building-only',
            '--version', CAD_EXPORT_VERSION], resolve(directory, 'cad-export.log'), 180000, '2', undefined, 'blender/cad_export.py')
          const info = JSON.parse(await readFile(resolve(temporary, 'manifest.json'), 'utf8'))
          if (info.exportVersion !== CAD_EXPORT_VERSION || !(info.triangleCount > 0)) throw new Error('The accepted villa contains no exportable geometry')
          for (const ext of ['dxf', 'dae']) if (!(await stat(resolve(temporary, filename.replace(/\.[^.]+$/, `.${ext}`)))).size) throw new Error('CAD export is incomplete')
          await rm(target, { recursive: true, force: true })
          await rename(temporary, target)
        } finally { await rm(temporary, { recursive: true, force: true }) }
      })
      pending.set(target, task)
      tail = task.catch(() => {})
      void task.finally(() => pending.delete(target)).catch(() => {})
    }
    await pending.get(target)
  }
  return { path: resolve(target, filename), filename, contentType: format === 'dae' ? 'model/vnd.collada+xml' : 'application/dxf' }
}

export async function handleCadExport(req, res) {
  const path = new URL(req.url, 'http://localhost').pathname
  const match = path.match(/^\/api\/villas\/([^/]+)\/cad\/([^/]+)$/)
  if (!match) return false
  if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return true }
  try {
    const file = await prepareCadExport(match[1], match[2])
    res.writeHead(200, { 'content-type': file.contentType, 'content-length': (await stat(file.path)).size,
      'content-disposition': `attachment; filename="${file.filename}"`, 'cache-control': 'no-cache' })
    createReadStream(file.path).pipe(res)
  } catch (error) {
    res.writeHead(400, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ error: error.code === 'ENOENT' ? 'The accepted villa master is no longer available on this server' : error.message }))
  }
  return true
}
