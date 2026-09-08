/*
 * Emit DesignSpec JSON for a matrix of style × footprint × programme × seed.
 * These feed the offline Blender bake (blender/bake/bake.mjs).
 *
 *   npx tsx scripts/export-specs.mts [--out blender/specs] [--seeds 4] [--styles modern_indian,...]
 */
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/index.ts'
import { STYLE_IDS, CHARACTER_OF_STYLE, requirementsOf, generateDesign } from '../src/architecture/index.ts'
import type { StyleId } from '../src/architecture/index.ts'

// only the footprints the engine actually builds distinctly today; add
// l/t/u/courtyard once their shape builders land (engine Milestone B).
const SHAPES = ['rectangle', 'square', 'auto'] as const

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d
}
const outDir = resolve(arg('out', 'blender/specs'))
const seeds = Number(arg('seeds', '4'))
const styles: StyleId[] = (arg('styles', '') ? arg('styles', '').split(',') : [...STYLE_IDS]) as StyleId[]

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const PROGRAMMES = [
  { beds: 2, storeys: 1, plotW: 12, plotD: 18 },
  { beds: 3, storeys: 1, plotW: 15, plotD: 21 },
  { beds: 3, storeys: 2, plotW: 15, plotD: 24 },
  { beds: 4, storeys: 2, plotW: 18, plotD: 27 },
  { beds: 5, storeys: 2, plotW: 22, plotD: 30 },
]

let n = 0
for (const style of styles) {
  for (const shape of SHAPES) {
    for (const prog of PROGRAMMES) {
      for (let s = 0; s < seeds; s++) {
        const b = defaultBrief()
        b.style.character = CHARACTER_OF_STYLE[style]
        b.style.shape = shape
        b.levels.storeys = prog.storeys
        b.rooms.bedroomsWithBath = Math.min(prog.beds, 2)
        b.rooms.bedroomsNoBath = Math.max(0, prog.beds - 2)
        b.site.plotWidth = prog.plotW
        b.site.plotDepth = prog.plotD
        b.variation = s * 1009 + prog.beds * 37

        const design = generate(compile(b))
        const spec = generateDesign(requirementsOf(design, style), b.variation)
        writeFileSync(resolve(outDir, `${spec.id}.json`), JSON.stringify(spec))
        n++
      }
    }
  }
}

console.log(`wrote ${n} spec(s) to ${outDir}`)
console.log(`next:  node blender/bake/bake.mjs --in ${arg('out', 'blender/specs')} --out public/villas`)
