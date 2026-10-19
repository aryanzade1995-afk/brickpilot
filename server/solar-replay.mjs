import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { resolve, relative, isAbsolute, basename } from 'node:path'
import { PROJECT_ROOT } from './blender-process.mjs'
import { createSolarRenderContract, SOLAR_RENDER_VERSION } from '../src/lib/solar/renderContract.ts'

export const solarJobsRoot = resolve(PROJECT_ROOT, 'output/villa-jobs')
const digest = value => createHash('sha256').update(value).digest('hex')
async function inside(root, path) {
  const actual = await realpath(path), base = await realpath(root), rel = relative(base, actual)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Accepted artifact is outside its building job')
  return actual
}
/** Solar requests supply no filesystem paths, architecture seeds or generated geometry. */
export async function prepareSolarReplay(request) {
  if (!/^[a-f0-9-]{36}$/.test(request?.baseJobId ?? '') || !['preview', 'final'].includes(request.quality ?? 'preview'))
    throw new Error('An accepted building job and preview/final quality are required')
  const directory = resolve(solarJobsRoot, request.baseJobId)
  const accepted = JSON.parse(await readFile(resolve(directory, 'accepted.json'), 'utf8'))
  if (accepted.artifactScope === 'building-plus-solar') throw new Error('Use the original building-only job for solar replay')
  const sourceDir = await inside(directory, accepted.directory)
  const source = JSON.parse(await readFile(resolve(directory, 'request.json'), 'utf8'))
  const payloadPath = await inside(directory, resolve(sourceDir, 'input.json'))
  const payloadBytes = await readFile(payloadPath), payload = JSON.parse(payloadBytes)
  const blendName = accepted.files.find(f => f.endsWith('.blend') && basename(f) === f)
  if (!blendName || payload.villaDesignDNA.seed !== accepted.seed || payload.buildingModel.planId !== accepted.planId)
    throw new Error('Accepted building identity is inconsistent')
  const baseBlend = await inside(directory, resolve(sourceDir, blendName))
  const baseManifest = await inside(directory, resolve(sourceDir, blendName.replace(/\.blend$/, '.json')))
  const contract = createSolarRenderContract(source.plan, { buildingModel: payload.buildingModel,
    massingModel: payload.massingModel, facadeGrammar: payload.facadeGrammar, villaDesignDNA: payload.villaDesignDNA }, request.solar)
  const buildingCacheKey = digest(Buffer.concat([payloadBytes, await readFile(baseBlend)]))
  const quality = request.quality ?? 'preview'
  const solarCacheKey = digest(JSON.stringify([SOLAR_RENDER_VERSION, buildingCacheKey, contract, quality]))
  return { mode: 'solar-replay', baseJobId: request.baseJobId, accepted, baseBlend, baseManifest, payloadPath,
    buildingCacheKey, solarCacheKey, contract, quality }
}
