/*
 * Batch-bake DesignSpec JSON -> GLB with headless Blender. Zero dependencies.
 *
 *   node blender/bake/bake.mjs --in blender/specs --out public/villas [--mode detailed] [--limit 50]
 *
 * Finds Blender via $BLENDER, then common install paths. Without Blender it
 * runs house_generator.py under plain python3 as a dry validation pass.
 * Writes <out>/manifest.json — the catalog the three.js viewer reads.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../..')
const GEN = resolve(HERE, '../generator/house_generator.py')

const argv = process.argv.slice(2)
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const inDir = resolve(REPO, opt('in', 'blender/specs'))
const outDir = resolve(REPO, opt('out', 'public/villas'))
const mode = opt('mode', 'detailed')
const limit = Number(opt('limit', '1000'))

function findBlender() {
  if (process.env.BLENDER && existsSync(process.env.BLENDER)) return process.env.BLENDER
  const guesses = [
    'blender',
    '/Applications/Blender.app/Contents/MacOS/Blender',
    'C:/Program Files/Blender Foundation/Blender 4.2/blender.exe',
    'C:/Program Files/Blender Foundation/Blender 4.1/blender.exe',
    '/usr/bin/blender',
    '/snap/bin/blender',
  ]
  for (const g of guesses) {
    try {
      execFileSync(g, ['--version'], { stdio: 'ignore' })
      return g
    } catch {
      /* keep looking */
    }
  }
  return null
}

const blender = findBlender()
mkdirSync(outDir, { recursive: true })

const specs = existsSync(inDir)
  ? readdirSync(inDir).filter((f) => f.endsWith('.json') && f !== 'manifest.json').slice(0, limit)
  : []

if (specs.length === 0) {
  console.error(`no specs in ${inDir} — run:  npx tsx scripts/export-specs.mts`)
  process.exit(1)
}

console.log(`${blender ? `Blender: ${blender}` : 'no Blender found — dry validation only'}`)
console.log(`${specs.length} spec(s)  ->  ${outDir}  (mode=${mode})\n`)

const manifest = []
let ok = 0
let fail = 0

for (const file of specs) {
  const specPath = join(inDir, file)
  const spec = JSON.parse(readFileSync(specPath, 'utf8'))
  const glb = join(outDir, `${spec.id}.glb`)
  const args = [GEN, '--spec', specPath, '--out', glb, '--mode', mode]
  try {
    if (blender) {
      execFileSync(blender, ['--background', '--factory-startup', '--python', ...args], { stdio: 'inherit' })
      if (existsSync(glb)) {
        manifest.push({
          id: spec.id,
          style: spec.style,
          seed: spec.seed,
          shape: spec.massing.planShape,
          strategy: spec.massing.strategy,
          floors: spec.requirements.floors,
          bedrooms: spec.requirements.bedrooms,
          plotWidthMm: spec.plot.widthMm,
          plotDepthMm: spec.plot.depthMm,
          url: `villas/${spec.id}.glb`,
          bytes: statSync(glb).size,
        })
        ok++
      } else {
        fail++
      }
    } else {
      execFileSync('python3', args, { stdio: 'inherit' })
      ok++
    }
  } catch (e) {
    console.error(`  FAILED ${file}: ${e.message}`)
    fail++
  }
}

if (blender) {
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ generated: new Date().toISOString(), mode, villas: manifest }, null, 2))
  console.log(`\nmanifest.json — ${manifest.length} villa(s)`)
}
console.log(`\ndone: ${ok} ok, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
