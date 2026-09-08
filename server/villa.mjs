/*
 * Villa generation route — resolves a DesignSpec (from the frontend's
 * architectural grammar) to a baked GLB.
 *
 *   POST /api/generate     { spec }            -> { glbUrl, cached, id, validation, note }
 *   GET  /api/generate/health                  -> { ok, blender, baked }
 *
 * Default path: match the spec against public/villas/manifest.json (produced
 * offline by `node blender/bake/bake.mjs`) and return the closest GLB URL.
 *
 * Opt-in live path: set BLENDER_BIN to a Blender 4.x executable and the route
 * will render a missing spec on demand into <dist|public>/villas/<id>.glb.
 * Not needed for the offline-bake deployment.
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')
const GEN = join(REPO, 'blender/generator/house_generator.py')
const BLENDER_BIN = process.env.BLENDER_BIN || ''

// villas live next to the served static root: dist/villas in prod, public/villas in dev
function villaDir() {
  const distV = join(REPO, 'dist/villas')
  if (existsSync(join(REPO, 'dist/index.html'))) return distV
  return join(REPO, 'public/villas')
}

function loadManifest() {
  const p = join(villaDir(), 'manifest.json')
  if (!existsSync(p)) return { villas: [] }
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return { villas: [] }
  }
}

function scoreEntry(v, spec) {
  if (v.style !== spec.style) return null
  if (v.floors !== spec.requirements.floors) return null
  let s = 0
  s += Math.abs(v.plotWidthMm - spec.plot.widthMm) / 1000
  s += Math.abs(v.plotDepthMm - spec.plot.depthMm) / 1000
  s += Math.abs(v.bedrooms - spec.requirements.bedrooms) * 3
  s += v.shape === spec.massing.planShape ? 0 : 2
  s += v.seed === spec.seed ? -1.5 : 0
  return s <= 14 ? s : null
}

function match(spec) {
  const m = loadManifest()
  let best = null
  for (const v of m.villas || []) {
    const sc = scoreEntry(v, spec)
    if (sc == null) continue
    if (!best || sc < best.sc) best = { v, sc }
  }
  return best?.v ?? null
}

function runBlender(spec) {
  return new Promise((resolve) => {
    if (!BLENDER_BIN || !existsSync(BLENDER_BIN)) return resolve(null)
    const dir = villaDir()
    mkdirSync(dir, { recursive: true })
    const specPath = join(dir, `${spec.id}.spec.json`)
    const glbPath = join(dir, `${spec.id}.glb`)
    writeFileSync(specPath, JSON.stringify(spec))
    execFile(
      BLENDER_BIN,
      ['--background', '--factory-startup', '--python', GEN, '--', '--spec', specPath, '--out', glbPath, '--mode', 'detailed'],
      { timeout: 120_000 },
      (err) => {
        if (err || !existsSync(glbPath)) return resolve(null)
        resolve(`villas/${spec.id}.glb`)
      },
    )
  })
}

/** returns true if it handled the request */
export function handleVilla(req, res, send, readJson) {
  if (req.method === 'GET' && req.url === '/api/generate/health') {
    const m = loadManifest()
    send(res, 200, { ok: true, blender: Boolean(BLENDER_BIN), baked: (m.villas || []).length })
    return true
  }

  if (req.method === 'POST' && req.url === '/api/generate') {
    readJson(req, 8e6)
      .then(async (p) => {
        const spec = p?.spec ?? p
        if (!spec?.id || !spec?.style || !spec?.requirements) {
          return send(res, 400, { error: 'a DesignSpec (with id, style, requirements) is required' })
        }
        const hit = match(spec)
        if (hit) {
          return send(res, 200, { glbUrl: hit.url, cached: true, id: hit.id, validation: spec.validation ?? null })
        }
        const live = await runBlender(spec)
        if (live) {
          return send(res, 200, { glbUrl: live, cached: false, id: spec.id, validation: spec.validation ?? null })
        }
        return send(res, 200, {
          glbUrl: null,
          cached: false,
          id: spec.id,
          validation: spec.validation ?? null,
          note: BLENDER_BIN
            ? 'no baked GLB and live generation failed — viewer will use the procedural model'
            : 'no baked GLB for this design yet — run the Blender bake; viewer uses the procedural model',
        })
      })
      .catch((e) => send(res, 400, { error: String(e?.message || e) }))
    return true
  }

  return false
}
