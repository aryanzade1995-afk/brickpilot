import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, createReadStream, statSync } from 'node:fs'
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises'
import { resolve, basename, extname } from 'node:path'
import { PROJECT_ROOT, blenderExecutable } from './blender-process.mjs'

const ROOT = resolve(PROJECT_ROOT, 'output/villa-jobs')
const jobs = new Map(), queue = []
let running = false
const UUID = /^[a-f0-9-]{36}$/
const json = (res, code, value) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)) }
const publicJob = (job) => {
  const result = job.result && { seed: job.result.seed, requestedSeed: job.result.requestedSeed, planId: job.result.planId,
    finishSignature: job.result.finishSignature, family: job.result.family, hero: job.result.hero, roofline: job.result.roofline, quality: job.result.quality,
    warnings: job.result.warnings, files: Object.fromEntries(job.result.files.map((file) =>
      [extname(file) === '.blend' ? 'blend' : extname(file) === '.glb' ? 'glb' : file.match(/_(hero|front|aerial)\.png$/)[1],
        `/api/villas/${job.id}/files/${file}`])) }
  return { id: job.id, status: job.status, phase: job.phase, seed: job.seed, attempt: job.attempt,
    error: job.error, debug: job.debug, result }
}
async function drain() {
  if (running || !queue.length) return
  running = true
  const job = queue.shift()
  job.status = 'generating'; job.phase = 'Checking architecture'
  const child = spawn(process.execPath, ['--experimental-strip-types', resolve(PROJECT_ROOT, 'scripts/villa-worker.mjs'), job.directory],
    { cwd: PROJECT_ROOT, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let pending = '', errors = ''
  child.stderr.on('data', (chunk) => { errors = (errors + chunk).slice(-3000) })
  child.stdout.on('data', (chunk) => {
    pending += chunk
    const lines = pending.split('\n'); pending = lines.pop()
    for (const line of lines) {
      try {
        const event = JSON.parse(line)
        if (event.debug) { job.debug.push(event.debug); job.debug = job.debug.slice(-64) }
        else Object.assign(job, event)
      } catch { /* Workers use JSON progress; non-JSON diagnostics are private. */ }
    }
  })
  child.on('error', (error) => { job.status = 'failed'; job.error = error.message })
  child.on('close', async (code) => {
    if (job.status !== 'complete') { job.status = 'failed'; job.error ||= `Generation failed (${code}). ${errors.trim()}` }
    await writeFile(resolve(job.directory, 'status.json'), JSON.stringify(publicJob(job))).catch(() => {})
    running = false; void drain()
  })
}
export async function handleVillaRequest(req, res, readJson) {
  const path = new URL(req.url, 'http://localhost').pathname
  if (!path.startsWith('/api/villas')) return false
  try {
    if (['GET', 'HEAD'].includes(req.method) && path.startsWith('/api/villas/gallery')) {
      if (path === '/api/villas/gallery') { res.writeHead(302, { location: '/api/villas/gallery/' }); res.end(); return true }
      const relative = path.slice('/api/villas/gallery/'.length) || 'index.html'
      const match = relative.match(/^(\d{1,2})\/villa_(\d{1,2})(\.blend|\.glb|_(hero|front|aerial)\.png)$/)
      const allowed = ['index.html', 'report.json', 'contact-sheet-1-25.jpg', 'contact-sheet-26-50.jpg'].includes(relative) ||
        (match && match[1] === match[2] && Number(match[1]) >= 1 && Number(match[1]) <= 50)
      if (!allowed) { json(res, 404, { error: 'Gallery artifact not found' }); return true }
      const gallery=existsSync(resolve(PROJECT_ROOT,'output/gallery-100-integrated/index.html'))
        ? 'output/gallery-100-integrated' : 'output/gallery-50-integrated'
      const file = resolve(PROJECT_ROOT, gallery, relative)
      if (!existsSync(file)) { json(res, 404, { error: 'Gallery has not been generated on this computer' }); return true }
      const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.glb': 'model/gltf-binary' }
      res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' })
      if (req.method === 'HEAD') res.end(); else createReadStream(file).pipe(res)
      return true
    }
    if (req.method === 'GET' && path === '/api/villas/health') {
      const supported = Number(process.versions.node.split('.')[0]) >= 24
      const executable = blenderExecutable()
      // a file, not a folder: the project's own blender/ scripts directory must
      // not pass for an installed `blender` executable
      const installed = (existsSync(executable) && statSync(executable).isFile()) ||
        spawnSync(executable, ['--version'], { windowsHide: true, timeout: 3000 }).status === 0
      json(res, 200, { available: supported && installed,
        note: !supported ? 'Blender generation requires Node.js 24 or newer' : installed ? 'Local Blender procedural generation' : 'Set BLENDER_BIN to your Blender executable' })
      return true
    }
    if (req.method === 'POST' && path === '/api/villas') {
      if (queue.length >= 8) { json(res, 429, { error: 'Generation queue is full. Try after the current design finishes.' }); return true }
      const request = await readJson(req, 4e6)
      if (!request?.plan?.floors?.length || !Number.isSafeInteger(request.seed) ||
        !['preview', 'final'].includes(request.quality ?? 'preview')) throw new Error('A source plan, numeric seed and preview/final quality are required')
      if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Blender generation requires Node.js 24 or newer')
      const id = randomUUID(), directory = resolve(ROOT, id)
      await mkdir(directory, { recursive: true })
      // exact: render this seed as given (a Directions preview must show the
      // direction the user sees, not a retried look-alike)
      await writeFile(resolve(directory, 'request.json'), JSON.stringify({ plan: request.plan, seed: request.seed, quality: request.quality ?? 'preview',
        ...(request.exact === true ? { exact: true } : {}) }))
      const job = { id, directory, status: 'queued', phase: 'Waiting to generate', seed: request.seed, debug: [] }
      await writeFile(resolve(directory, 'status.json'), JSON.stringify(job))
      jobs.set(id, job); queue.push(job); void drain()
      json(res, 202, publicJob(job)); return true
    }
    const match = path.match(/^\/api\/villas\/([a-f0-9-]{36})(?:\/files\/([^/]+))?$/)
    if (!match || !UUID.test(match[1]) || !['GET', 'HEAD'].includes(req.method)) { json(res, 404, { error: 'Unknown villa endpoint' }); return true }
    const id = match[1], directory = resolve(ROOT, id)
    let job = jobs.get(id)
    if (!job) {
      try {
        const result = JSON.parse(await readFile(resolve(directory, 'accepted.json'), 'utf8'))
        let saved = {}
        try { saved = JSON.parse(await readFile(resolve(directory, 'status.json'), 'utf8')) } catch { /* Older accepted job. */ }
        job = { id, directory, status: 'complete', phase: 'Ready', result, seed: result.seed,
          attempt: saved.attempt, debug: Array.isArray(saved.debug) ? saved.debug : [] }
      } catch {
        try {
          job = JSON.parse(await readFile(resolve(directory, 'status.json'), 'utf8'))
          if (match[2]) { json(res, 404, { error: 'Accepted artifact not found' }); return true }
          if (!['complete', 'failed'].includes(job.status)) {
            let owner
            try { owner = JSON.parse(await readFile(resolve(PROJECT_ROOT, 'output/villa-production-history.json.lock'), 'utf8')) } catch { /* Not active. */ }
            let alive = false
            if (owner?.directory === directory && Number.isInteger(owner.pid)) {
              try { process.kill(owner.pid, 0); alive = true } catch { /* Interrupted by a restart. */ }
            }
            if (!alive) { job.status = 'failed'; job.error = 'Generation was interrupted. Generate another design to resume.' }
          }
          json(res, 200, publicJob(job)); return true
        }
        catch { json(res, 404, { error: 'Generation no longer available' }); return true }
      }
    }
    if (!match[2]) { json(res, 200, publicJob(job)); return true }
    const file = match[2]
    if (job.status !== 'complete' || file !== basename(file) || !job.result.files.includes(file)) { json(res, 404, { error: 'Accepted artifact not found' }); return true }
    const filePath = resolve(job.result.directory, file), size = (await stat(filePath)).size
    res.writeHead(200, { 'content-type': file.endsWith('.glb') ? 'model/gltf-binary' : file.endsWith('.png') ? 'image/png' : 'application/octet-stream',
      'content-length': size, 'cache-control': 'public, max-age=31536000, immutable',
      ...(file.endsWith('.blend') ? { 'content-disposition': `attachment; filename="${file}"` } : {}) })
    if (req.method === 'HEAD') res.end(); else createReadStream(filePath).pipe(res)
    return true
  } catch (error) { json(res, 400, { error: error.message }); return true }
}
