// No architecture generator, diversity gate or production-history dependency.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runBlender } from '../server/blender-process.mjs'
import { prepareSolarReplay, solarJobsRoot } from '../server/solar-replay.mjs'
import { writeAtomicJson } from '../server/atomic-json.mjs'
import { basename } from 'node:path'
const directory = resolve(process.argv[2])
const progress = async event => { await writeAtomicJson(resolve(directory, 'status.json'), { ...event,
  id: basename(directory), directory, mode: 'solar-replay', workerPid: process.pid }); console.log(JSON.stringify(event)) }
try {
  const request = JSON.parse(await readFile(resolve(directory, 'request.json'), 'utf8'))
  const replay = await prepareSolarReplay(request)
  const name = `villa_${replay.accepted.seed}_solar`
  await writeFile(resolve(directory, 'replay.json'), JSON.stringify(replay))
  await progress({ status: 'rendering', phase: 'Replaying accepted building with saved solar layout', progress: 10, seed: replay.accepted.seed })
  await runBlender(['--replay', resolve(directory, 'replay.json'), '--out-dir', directory, '--name', name],
    resolve(directory, 'blender.log'), undefined, undefined, undefined, 'blender/solar_replay.py')
  const result = { ...replay.accepted, artifactScope: 'building-plus-solar', baseJobId: replay.baseJobId,
    buildingCacheKey: replay.buildingCacheKey, solarCacheKey: replay.solarCacheKey,
    solarVisualSignature: replay.contract.solarVisualSignature, roofSignature: replay.contract.roofSignature,
    panelCount: replay.contract.panelCount, capacityKwp: replay.contract.capacityKwp, quality: replay.quality,
    directory, files: [`${name}.blend`, `${name}.glb`, `${name}_hero.png`, `${name}_front.png`, `${name}_aerial.png`, 'solar-layout.json'] }
  await writeFile(resolve(directory, 'solar-layout.json'), JSON.stringify({ schemaVersion: 1, buildingCacheKey: replay.buildingCacheKey,
    sourcePlanId: result.planId, seed: result.seed, solar: request.solar, renderContract: replay.contract }, null, 2))
  await writeAtomicJson(resolve(directory, 'accepted.json'), result)
  const cacheDirectory = resolve(solarJobsRoot, 'solar-cache')
  await mkdir(cacheDirectory, { recursive: true })
  await writeAtomicJson(resolve(cacheDirectory, `${replay.solarCacheKey}.json`), { jobId: basename(directory) })
  await progress({ status: 'complete', phase: 'Solar render and combined exports ready', progress: 100, result })
} catch (error) {
  await progress({ status: 'failed', phase: 'Solar replay stopped; accepted building preserved', error: error.message })
  process.exitCode = 1
}
