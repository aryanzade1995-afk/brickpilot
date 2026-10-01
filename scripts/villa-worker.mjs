import { readFile, writeFile, mkdir, open, unlink, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { writeAtomicJson } from '../server/atomic-json.mjs'
import { generateAlternativeDesign } from '../src/lib/engine/generateAlternativeDesign.ts'
import { makeRng } from '../src/lib/engine/massing/rng.ts'
import { fingerprintRecord, parseFingerprintHistory } from '../src/lib/engine/fingerprint/VillaShapeFingerprint.ts'
import { evaluateVillaFingerprint } from '../src/lib/engine/fingerprint/VillaDiversityGate.ts'
import { evaluateRealizedVilla, validRealizedShape } from '../server/villa-shape.mjs'
import { PROJECT_ROOT, runBlender } from '../server/blender-process.mjs'

const directory = resolve(process.argv[2])
const progress = { id: directory.split(/[\\/]/).at(-1), status: 'generating', phase: 'Starting', debug: [] }
process.stdout.on('error', (error) => { if (error.code !== 'EPIPE') throw error })
const emit = async (event) => {
  if (event.debug) progress.debug = [...progress.debug, event.debug].slice(-64)
  else Object.assign(progress, event)
  await writeAtomicJson(resolve(directory, 'status.json'), progress)
  process.stdout.write(JSON.stringify(event) + '\n')
}
const historyPath = resolve(PROJECT_ROOT, 'output/villa-production-history.json')
let lock
try {
  const request = JSON.parse(await readFile(resolve(directory, 'request.json'), 'utf8'))
  try { lock = await open(historyPath + '.lock', 'wx') }
  catch (error) {
    if (error.code !== 'EEXIST') throw error
    let owner
    try { owner = JSON.parse(await readFile(historyPath + '.lock', 'utf8')) }
    catch { throw new Error('Another generation owns the history lock; wait for it to finish') }
    if (!Number.isInteger(owner.pid)) throw new Error('Production history lock is malformed')
    let alive = true
    try { process.kill(owner.pid, 0) } catch (check) { if (check.code === 'ESRCH') alive = false }
    if (alive) throw new Error('Another generation is still running; wait for it to finish')
    await unlink(historyPath + '.lock')
    lock = await open(historyPath + '.lock', 'wx')
  }
  await lock.writeFile(JSON.stringify({ pid: process.pid, directory }))
  let history = []
  try {
    const items = JSON.parse(await readFile(historyPath, 'utf8'))
    if (!Array.isArray(items)) throw new Error('Malformed production history')
    history = items.slice(-50).filter((h) => parseFingerprintHistory([h.fingerprint], 1).length && validRealizedShape(h.geometry))
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const rng = makeRng(request.seed, 'villa-production-retry-v1'), seen = new Set()
  let seed = request.seed, accepted = null
  const attempts = Number(process.env.VILLA_MAX_ATTEMPTS || 32)
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 64) throw new Error('VILLA_MAX_ATTEMPTS must be an integer from 1 to 64')
  const threshold = Number(process.env.VILLA_SIMILARITY_THRESHOLD || .75)
  for (let attempt = 0; attempt < attempts; attempt++) {
    seen.add(seed)
    await emit({ status: 'generating', phase: 'Checking architecture', seed, attempt: attempt + 1 })
    try {
      const payload = generateAlternativeDesign(request.plan, seed)
      const quota = evaluateVillaFingerprint(payload.shapeFingerprint, history.map((h) => h.fingerprint), { similarityThreshold: 1 })
      if (!quota.accepted) { await emit({ debug: quota }); throw new Error('Diversity quota retry') }
      const stage = resolve(directory, 'candidates', String(seed))
      await mkdir(stage, { recursive: true })
      const input = resolve(stage, 'input.json'), name = `villa_${seed}`
      await writeFile(input, JSON.stringify(payload))
      const options = ['--input', input, '--out-dir', stage, '--name', name, '--production-names', '--quality', request.quality]
      await emit({ status: 'generating', phase: 'Building and measuring the Blender scene', seed, attempt: attempt + 1 })
      await runBlender([...options, '--prepare'], resolve(directory, 'blender.log'))
      const manifest = JSON.parse(await readFile(resolve(stage, name + '.json'), 'utf8'))
      const decision = evaluateRealizedVilla(payload, manifest.realizedGeometry, history, threshold)
      await emit({ debug: decision })
      if (!decision.accepted) throw new Error('Similar shape retry')
      await emit({ status: 'rendering', phase: 'Rendering front, hero and aerial views', seed, attempt: attempt + 1 })
      await runBlender([...options, '--resume', '--render-all'], resolve(directory, 'blender.log'))
      const final = JSON.parse(await readFile(resolve(stage, name + '.json'), 'utf8'))
      const files = [name + '.blend', name + '.glb', name + '_hero.png', name + '_front.png', name + '_aerial.png']
      for (const file of files) if (!(await stat(resolve(stage, file))).size) throw new Error('An output file is empty')
      history = [...history, { fingerprint: fingerprintRecord(payload.shapeFingerprint), geometry: final.realizedGeometry }].slice(-50)
      await writeAtomicJson(historyPath, history)
      accepted = { seed, requestedSeed: request.seed, planId: payload.buildingModel.planId, family: payload.massingModel.family,
        hero: payload.shapeFingerprint.heroFeature, facadeFamily: payload.shapeFingerprint.facadeFamily,
        roofline: payload.shapeFingerprint.rooflineType, files, directory: stage, quality: request.quality,
        shapeFingerprint: payload.shapeFingerprint, realizedGeometry: final.realizedGeometry, warnings: final.warnings }
      await writeFile(resolve(directory, 'accepted.json'), JSON.stringify(accepted))
      await emit({ status: 'complete', phase: 'Ready', result: accepted })
      break
    } catch (error) {
      if (!['Diversity quota retry', 'Similar shape retry'].includes(error.message)) {
        if (/Blender/.test(error.message)) throw error
        await emit({ debug: { seed, family: 'unknown', accepted: false, reason: error.message, code: 'INVALID_ARCHITECTURE' } })
      }
    }
    do { seed = rng.int(0, 0xffffffff) } while (seen.has(seed))
  }
  if (!accepted) throw new Error('No sufficiently different valid villa found within the attempt limit. Your current plan and design are retained.')
} catch (error) {
  await emit({ status: 'failed', phase: 'Generation stopped', error: error.message })
  process.exitCode = 1
} finally {
  if (lock) { await lock.close(); await unlink(historyPath + '.lock').catch(() => {}) }
}
