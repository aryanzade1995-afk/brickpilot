import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { MODERN_SEED_CATALOGUE, modernSeedSchedule, nextModernSeedCursor } from '../src/lib/engine/modernSeedBank.ts'
import { villaGeometryIdentity } from '../src/lib/engine/fingerprint/villaGeometryIdentity.ts'
import { validRealizedShape } from './villa-shape.mjs'

export const modernGeometryHash = payload => createHash('sha256').update(villaGeometryIdentity(payload)).digest('hex')
export const emptyModernUsage = () => ({ schemaVersion: 1, catalogueVersion: MODERN_SEED_CATALOGUE.version,
  cursor: 0, usedSeeds: [], geometryHashes: [], realizedHashes: [] })
export function modernRealizedHash(geometry) {
  if (!validRealizedShape(geometry)) throw new Error('Invalid measured modern geometry')
  return createHash('sha256').update(JSON.stringify({ schemaVersion: geometry.schemaVersion, grid: geometry.grid,
    parts: Object.fromEntries(Object.entries(geometry.parts).sort(([a], [b]) => a.localeCompare(b))) })).digest('hex')
}

export async function readModernUsage(path) {
  let value
  try { value = JSON.parse(await readFile(path, 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return emptyModernUsage(); throw error }
  if (value?.schemaVersion !== 1 || !Number.isInteger(value.cursor) || value.cursor < 0 ||
    !Array.isArray(value.usedSeeds) || !value.usedSeeds.every(Number.isSafeInteger) ||
    !Array.isArray(value.geometryHashes) || !value.geometryHashes.every(h => typeof h === 'string' && /^[a-f0-9]{64}$/.test(h)) ||
    (value.realizedHashes !== undefined && (!Array.isArray(value.realizedHashes) || !value.realizedHashes.every(h => typeof h === 'string' && /^[a-f0-9]{64}$/.test(h)))))
    throw new Error('Modern design usage record is damaged; previous designs were preserved')
  return { ...value, realizedHashes: value.realizedHashes ?? [] }
}

export const modernCandidateSeeds = (seed, usage, count) => modernSeedSchedule(seed, usage, count)
export const alreadyBuiltModernDesign = (usage, payload) => usage.geometryHashes.includes(modernGeometryHash(payload))
export const alreadyBuiltModernMesh = (usage, geometry) => (usage.realizedHashes ?? []).includes(modernRealizedHash(geometry))

/** Retry an explicitly rejected candidate, never a missing executable, timeout
 * or arbitrary Blender crash. The architectural safety check remains intact. */
export function classifyModernCandidateFailure(error, log) {
  const rejection = /^\s*(?:ValueError|AssertionError): (.+)$/m.exec(log)
  if (/^Blender failed \(1\)/.test(error.message) && rejection) {
    const rejected = new Error(`Candidate geometry rejected: ${rejection[1]}`)
    rejected.candidateInvalid = true
    return rejected
  }
  return error
}

/** Called only after a complete successful render, under the production lock.
 * Exact saved-design replays are idempotent. Usage is never trimmed to 50. */
export function recordModernDesign(usage, payload, geometry) {
  const seed = payload.villaDesignDNA.seed, hash = modernGeometryHash(payload)
  if (geometry && (geometry.seed !== seed || geometry.planId !== payload.buildingModel.planId)) throw new Error('Measured modern geometry has a different plan or seed')
  return { schemaVersion: 1, catalogueVersion: MODERN_SEED_CATALOGUE.version,
    cursor: nextModernSeedCursor(seed, usage.cursor),
    usedSeeds: [...new Set([...usage.usedSeeds, seed])], geometryHashes: [...new Set([...usage.geometryHashes, hash])],
    realizedHashes: [...new Set([...(usage.realizedHashes ?? []), ...(geometry ? [modernRealizedHash(geometry)] : [])])] }
}
