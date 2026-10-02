import { readFile, writeFile, mkdir, open, unlink, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { availableParallelism } from 'node:os'
import { writeAtomicJson } from '../server/atomic-json.mjs'
import { generateAlternativeDesign } from '../src/lib/engine/generateAlternativeDesign.ts'
import { makeRng } from '../src/lib/engine/massing/rng.ts'
import { fingerprintRecord, parseFingerprintHistory } from '../src/lib/engine/fingerprint/VillaShapeFingerprint.ts'
import { evaluateVillaFingerprint } from '../src/lib/engine/fingerprint/VillaDiversityGate.ts'
import { evaluateRealizedVilla, productionDiversityPolicy, validRealizedShape } from '../server/villa-shape.mjs'
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
  let seed = request.seed, accepted = null, validFallback = null
  // an exact request has one candidate: its own seed, accepted when valid
  const attempts = request.exact ? 1 : Number(process.env.VILLA_MAX_ATTEMPTS || 32)
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 64) throw new Error('VILLA_MAX_ATTEMPTS must be an integer from 1 to 64')
  const threshold = Number(process.env.VILLA_SIMILARITY_THRESHOLD || .75)
  const finish = async (candidate, decision) => {
    const {payload,stage,name,options,seed} = candidate
    // spare candidates still building would only compete with the render
    stopSpare.abort()
    await emit({debug:decision})
      await emit({ status: 'rendering', phase: 'Rendering front, hero and aerial views', seed, attempt: candidate.attempt })
      await runBlender([...options, '--resume', '--render-all'], resolve(directory, 'blender.log'))
      const final = JSON.parse(await readFile(resolve(stage, name + '.json'), 'utf8'))
      const files = [name + '.blend', name + '.glb', name + '_hero.png', name + '_front.png', name + '_aerial.png']
      for (const file of files) if (!(await stat(resolve(stage, file))).size) throw new Error('An output file is empty')
      history = [...history, { fingerprint: fingerprintRecord(payload.shapeFingerprint), geometry: final.realizedGeometry }].slice(-50)
      await writeAtomicJson(historyPath, history)
      accepted = { seed, requestedSeed: request.seed, planId: payload.buildingModel.planId, family: payload.massingModel.family,
        hero: payload.shapeFingerprint.heroFeature, facadeFamily: payload.shapeFingerprint.facadeFamily,
        roofline: payload.shapeFingerprint.rooflineType, files, directory: stage, quality: request.quality,
        shapeFingerprint: payload.shapeFingerprint, realizedGeometry: final.realizedGeometry, warnings: [...(final.warnings ?? []), ...(decision.relaxed ? [decision.reason] : [])] }
      await writeFile(resolve(directory, 'accepted.json'), JSON.stringify(accepted))
      await emit({ status: 'complete', phase: 'Ready', result: accepted })
  }
  // The candidate seeds never depend on results, so the whole sequence is known
  // up front. Candidates are built and measured in Blender several at a time,
  // then judged strictly in attempt order with the same rules as one at a time
  // — the accepted villa is exactly the one a sequential search would accept.
  const seeds = []
  for (let i = 0; i < attempts; i++) {
    seeds.push(seed); seen.add(seed)
    do { seed = rng.int(0, 0xffffffff) } while (seen.has(seed))
  }
  const cores = availableParallelism()
  const parallel = request.exact ? 1 : Math.max(1, Math.min(8, Number(process.env.VILLA_PARALLEL || Math.max(1, Math.floor(cores / 3)))))
  const prepareThreads = Math.max(1, Math.floor(cores / parallel))
  const stopSpare = new AbortController()
  const payloads = new Map(), prepared = new Map()
  const payloadAt = (i) => {
    if (!payloads.has(i)) {
      try { payloads.set(i, { payload: generateAlternativeDesign(request.plan, seeds[i]) }) }
      catch (error) { payloads.set(i, { error }) }
    }
    return payloads.get(i)
  }
  const prepare = (i) => {
    if (prepared.has(i)) return prepared.get(i)
    const p = payloadAt(i)
    const stage = resolve(directory, 'candidates', String(seeds[i]))
    const input = resolve(stage, 'input.json'), name = `villa_${seeds[i]}`
    const options = ['--input', input, '--out-dir', stage, '--name', name, '--production-names', '--quality', request.quality]
    const work = p.error ? Promise.resolve({ error: p.error }) : (async () => {
      await mkdir(stage, { recursive: true })
      await writeFile(input, JSON.stringify(p.payload))
      await runBlender([...options, '--prepare'], resolve(stage, 'blender.log'), undefined, prepareThreads, stopSpare.signal)
      return { manifest: JSON.parse(await readFile(resolve(stage, name + '.json'), 'utf8')), stage, name, options }
    })().catch((error) => ({ error }))
    prepared.set(i, work)
    return work
  }
  for (let attempt = 0; attempt < attempts; attempt++) {
    const seed = seeds[attempt]
    await emit({ status: 'generating', phase: 'Checking architecture', seed, attempt: attempt + 1 })
    try {
      const built = payloadAt(attempt)
      if (built.error) throw built.error
      const payload = built.payload
      const policy = productionDiversityPolicy(attempt,attempts,threshold)
      const quota = evaluateVillaFingerprint(payload.shapeFingerprint, history.map((h) => h.fingerprint), { ...policy.limits, similarityThreshold: 1 })
      if (!quota.accepted && validFallback) { await emit({ debug: quota }); throw new Error('Diversity quota retry') }
      await emit({ status: 'generating', phase: 'Building and measuring the Blender scene', seed, attempt: attempt + 1 })
      for (let j = attempt; j < Math.min(attempts, attempt + parallel); j++) void prepare(j)
      const ready = await prepare(attempt)
      if (ready.error) throw ready.error
      const { manifest, stage, name, options } = ready
      // Identity, mesh validity and all geometry checks must pass before retaining a fallback.
      evaluateRealizedVilla(payload,manifest.realizedGeometry,[],1)
      const candidate = {payload,stage,name,options,seed,manifest,attempt:attempt+1}
      let decision = evaluateRealizedVilla(payload, manifest.realizedGeometry, history, policy.threshold, policy.limits)
      if (!validFallback || decision.similarityPercent < validFallback.similarity) validFallback={...candidate,similarity:decision.similarityPercent}
      if (policy.stage > 0 && decision.accepted) decision={...decision,relaxed:true,reason:`Valid architecture accepted after relaxing uniqueness to ${Math.round(policy.threshold*100)}%. Fixed rooms and a clear terrace constrain variation.`}
      await emit({ debug: decision })
      if (!decision.accepted) throw new Error('Similar shape retry')
      await finish(candidate,decision)
      break
    } catch (error) {
      if (!['Diversity quota retry', 'Similar shape retry'].includes(error.message)) {
        if (/Blender/.test(error.message)) throw error
        await emit({ debug: { seed, family: 'unknown', accepted: false, reason: error.message, code: 'INVALID_ARCHITECTURE' } })
      }
    }
  }
  stopSpare.abort()
  if (!accepted && validFallback) {
    const policy=productionDiversityPolicy(attempts,attempts,threshold)
    const decision=evaluateRealizedVilla(validFallback.payload,validFallback.manifest.realizedGeometry,history,1,policy.limits)
    if(decision.accepted) await finish(validFallback,{...decision,relaxed:true,reason:'Returning the best geometrically valid candidate. Uniqueness preferences were exhausted; the source plan and clear-terrace checks remain mandatory.'})
  }
  if (!accepted) throw new Error('No valid Blender scene could be produced. Your current plan and design are retained.')
} catch (error) {
  await emit({ status: 'failed', phase: 'Generation stopped', error: error.message })
  process.exitCode = 1
} finally {
  if (lock) { await lock.close(); await unlink(historyPath + '.lock').catch(() => {}) }
}
