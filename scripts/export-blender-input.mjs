import { readFile, writeFile, mkdir, rename, open, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { createVillaArchitecture } from '../src/lib/engine/fingerprint/createVillaArchitecture.ts'
import { selectDistinctVilla, formatFingerprintDebug, diversityLimits } from '../src/lib/engine/fingerprint/VillaDiversityGate.ts'
import { parseFingerprintHistory } from '../src/lib/engine/fingerprint/VillaShapeFingerprint.ts'

const arg = (flag, fallback) => {
  const at = process.argv.indexOf(flag)
  return at < 0 ? fallback : process.argv[at + 1]
}

export function createBlenderInput(design, seed = design.dna.seed, featureOptions = {}) {
  return { schemaVersion: 1, ...createVillaArchitecture(design, seed, featureOptions) }
}

export function createDistinctBlenderInput(design, seed, history, limits = {}, onAttempt) {
  return selectDistinctVilla(seed, history, (candidateSeed) => {
    const candidate = createBlenderInput(design, candidateSeed)
    return { candidate, fingerprint: candidate.shapeFingerprint }
  }, limits, onAttempt)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const designPath = arg('--design', null)
  const output = resolve(arg('--out', 'output/blender-input.json'))
  const seed = Number(arg('--seed', '41'))
  if (!Number.isSafeInteger(seed)) throw new RangeError('--seed must be a safe integer')
  const brief = defaultBrief()
  const width = arg('--plot-width', null)
  const depth = arg('--plot-depth', null)
  if (width !== null) brief.site.plotWidth = Number(width)
  if (depth !== null) brief.site.plotDepth = Number(depth)
  if (process.argv.includes('--courtyard')) brief.rooms.priorities.courtyard = true
  const massing = arg('--massing', undefined)
  const design = designPath
    ? JSON.parse(await readFile(resolve(designPath), 'utf8'))
    : generate(compile(brief), { seed, ...(massing ? { massing } : {}) })
  await mkdir(dirname(output), { recursive: true })
  if (process.argv.includes('--exact-seed')) {
    // Explicit saved-design replay: never count it as newly accepted architecture.
    await writeFile(output, JSON.stringify(createBlenderInput(design, seed), null, 2))
    process.stdout.write(`Exact seed replay (excluded from diversity history): ${seed}\n${output}\n`)
  } else {
    const historyPath = resolve(arg('--history', 'output/villa-fingerprint-history.json'))
    if (historyPath === output) throw new Error('--history and --out must be different files')
    const limits = diversityLimits({ similarityThreshold: Number(arg('--similarity-threshold', '0.75')),
      maxAttempts: Number(arg('--max-attempts', '32')) })
    await mkdir(dirname(historyPath), { recursive: true })
    const lockPath = `${historyPath}.lock`
    const lock = await open(lockPath, 'wx').catch((error) => {
      if (error.code === 'EEXIST') throw new Error(`Fingerprint history is locked by another export: ${lockPath}`)
      throw error
    })
    try {
      let history = []
      try { history = parseFingerprintHistory(JSON.parse(await readFile(historyPath, 'utf8')), limits.recentLimit) }
      catch (error) { if (error.code !== 'ENOENT') throw new Error(`Cannot read fingerprint history: ${error.message}`) }
      const selected = createDistinctBlenderInput(design, seed, history, limits,
        (debug) => process.stdout.write(`${formatFingerprintDebug(debug)}\n`))
      if (!selected.accepted) throw new Error(`No distinct valid architecture after ${selected.debug.length} attempts; existing output and history preserved.`)
      await writeFile(`${output}.tmp`, JSON.stringify(selected.accepted.candidate, null, 2))
      await rename(`${output}.tmp`, output)
      await writeFile(`${historyPath}.tmp`, JSON.stringify(selected.history))
      await rename(`${historyPath}.tmp`, historyPath)
      process.stdout.write(`${output}\n`)
    } finally { await lock.close(); await unlink(lockPath) }
  }
}
