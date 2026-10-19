import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { generateAlternativeDesign } from '../src/lib/engine/generateAlternativeDesign.ts'
import { villaGeometryIdentity } from '../src/lib/engine/fingerprint/villaGeometryIdentity.ts'
import { makeRng } from '../src/lib/engine/massing/rng.ts'

const brief = defaultBrief()
brief.style.character = 'modern-box'
const plan = generate(compile(brief), { seed: 41 })
const target = 1000, entries = [], hashes = new Set(), used = new Set(), errors = {}
const rng = makeRng(20261018, 'formstead-modern-seed-bank-v1')
let attempts = 0
while (entries.length < target && attempts < 20000) {
  const seed = rng.int(0, 0xffffffff)
  if (used.has(seed)) continue
  used.add(seed); attempts++
  try {
    const a = generateAlternativeDesign(plan, seed)
    const geometryHash = createHash('sha256').update(villaGeometryIdentity(a)).digest('hex')
    if (hashes.has(geometryHash)) continue
    hashes.add(geometryHash)
    entries.push({ seed, geometryHash, family: a.facadeGrammar.architecturalFamily,
      hero: a.shapeFingerprint.heroFeature, roofline: a.shapeFingerprint.rooflineType })
    if (entries.length % 100 === 0) console.log(`Validated ${entries.length}/${target} distinct modern geometries (${attempts} candidates)`)
  } catch (error) { const key = error.message.split(':')[0]; errors[key] = (errors[key] ?? 0) + 1 }
}
if (entries.length !== target) throw new Error(`Only ${entries.length} valid distinct designs; catalogue was not replaced`)
// Alternate realised composition families rather than presenting long runs of one facade.
const groups = new Map()
for (const entry of entries) { if (!groups.has(entry.family)) groups.set(entry.family, []); groups.get(entry.family).push(entry) }
const sorted = []
while (sorted.length < target) for (const family of [...groups.keys()].sort()) {
  const entry = groups.get(family).shift()
  if (entry) sorted.push({ id: `MOD-${String(sorted.length + 1).padStart(4, '0')}`, ...entry })
}
const catalogue = { schemaVersion: 1, version: 'modern-1000-v1', style: 'modern-box', count: target,
  validation: { pipeline: 'generateAlternativeDesign', geometryIdentityVersion: 1, referencePlanSeed: 41,
    referencePlanId: generateAlternativeDesign(plan, sorted[0].seed).buildingModel.planId,
    note: 'Validated architecture inputs, not 1000 pre-rendered Blender scenes. Each user plan is validated again at generation.',
    candidates: attempts, rejected: errors,
    families: Object.fromEntries([...new Set(sorted.map(e => e.family))].sort().map(f => [f, sorted.filter(e => e.family === f).length])) },
  entries: sorted }
const destination = resolve('src/lib/engine/data/modern-seed-bank.json')
await mkdir(resolve('src/lib/engine/data'), { recursive: true })
await writeFile(destination, JSON.stringify(catalogue, null, 2) + '\n')
console.log(JSON.stringify({ count: catalogue.count, uniqueGeometry: hashes.size, families: catalogue.validation.families, destination }))
