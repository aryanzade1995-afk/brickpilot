/*
 * diversitytest — §18 ARCHITECTURAL VARIETY TEST.
 *
 *   Generate 50 villas from ONE fixed set of user requirements
 *   (40×60 ft · 2200 sq ft · 2 floors · 4 bed · 3 bath · 2 parking),
 *   over 50 seeds, per style.
 *
 *   The result must contain SUBSTANTIAL architectural variation — not
 *   just colour / material / window changes. Uses the architectural
 *   fingerprint (massing · floors · roof · entrance · balcony · facade
 *   · courtyard) and its similarity score.
 *
 *   PASS when, per style:
 *     - ≥ 40 / 50 designs are substantially distinct  (similarity < 0.86)
 *     - mean pairwise similarity < 0.72
 *     - the composition varies on ≥ 6 of the tracked axes
 *     - requirements are identical across all 50 seeds
 *     - every spec is valid (0 validation issues)
 */
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/index.ts'
import { CHARACTER_OF_STYLE, requirementsOf, generateDesign } from '../src/architecture/index.ts'
import { distinctCount, meanPairwiseSimilarity } from '../src/architecture/index.ts'
import type { ArchitecturalFingerprint, DesignSpec, StyleId } from '../src/architecture/index.ts'

// 40 × 60 ft in mm, ~2200 sq ft built-up, G+1, 4 bed
const REQ = { plotW: 12192, plotD: 18288, storeys: 1, levels: 2, beds: 4, bathsWithBed: 2, sharedBaths: 1 }
const N = 50
const STYLES: StyleId[] = ['modern_indian', 'contemporary_indian']

/** the composition axes we expect to vary across seeds (NOT colour / windows) */
const AXES = [
  'massingComposition',
  'volumeCount',
  'upperFloorStrategy',
  'voidStrategy',
  'roof',
  'entrance',
  'doubleHeightEntrance',
  'balcony',
  'facadeComposition',
  'screen',
  'courtyard',
  'glazing',
  'parking',
] as const

function briefFor(style: StyleId, seed: number) {
  const b = defaultBrief()
  b.style.character = CHARACTER_OF_STYLE[style]
  b.levels.storeys = REQ.storeys
  b.rooms.bedroomsWithBath = REQ.bathsWithBed
  b.rooms.bedroomsNoBath = REQ.beds - REQ.bathsWithBed
  b.rooms.sharedBaths = REQ.sharedBaths
  b.rooms.priorities.coveredParking = true
  b.spaces.occupants = 5
  b.site.plotWidth = REQ.plotW / 1000
  b.site.plotDepth = REQ.plotD / 1000
  b.variation = seed
  return b
}

let fail = 0
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    fail++
    console.log(`  ✗ ${msg}`)
  }
}

for (const style of STYLES) {
  console.log(`\n=== ${style} · ${N} seeds · identical requirements ===`)
  const specs: DesignSpec[] = []
  const fps: ArchitecturalFingerprint[] = []
  const reqSig = new Set<string>()
  const axisValues: Record<string, Set<string>> = Object.fromEntries(AXES.map((a) => [a, new Set<string>()]))

  for (let i = 0; i < N; i++) {
    const seed = 5000 + i
    const design = generate(compile(briefFor(style, seed)))
    const req = requirementsOf(design, style)
    const spec = generateDesign(req, seed)
    specs.push(spec)
    fps.push(spec.fingerprint)
    reqSig.add(`${spec.requirements.floors}|${spec.requirements.bedrooms}|${spec.requirements.bathrooms}|${spec.plot.widthMm}x${spec.plot.depthMm}`)
    for (const a of AXES) axisValues[a].add(String((spec.genome as Record<string, unknown>)[a]))
    check(spec.validation.issues.length === 0, `seed ${seed}: ${spec.validation.issues.join('; ')}`)
  }

  // requirements identical
  check(reqSig.size === 1, `requirements differ across seeds: ${[...reqSig].join('  vs  ')}`)

  // architectural distinctness
  const distinct = distinctCount(fps, 0.86)
  const meanSim = meanPairwiseSimilarity(fps)
  const uniqueHashes = new Set(fps.map((f) => f.hash)).size
  check(distinct >= 40, `only ${distinct}/50 substantially distinct (need ≥ 40)`)
  check(meanSim < 0.72, `mean pairwise similarity ${meanSim} too high (need < 0.72)`)

  // composition (not colour) actually varies
  const varyingAxes = AXES.filter((a) => axisValues[a].size >= 2)
  check(varyingAxes.length >= 6, `only ${varyingAxes.length} composition axes vary (need ≥ 6)`)

  console.log(`  distinct forms : ${distinct}/50   unique fingerprints: ${uniqueHashes}/50`)
  console.log(`  mean similarity: ${meanSim}`)
  console.log(`  axis spread    :`)
  for (const a of AXES) {
    const vals = [...axisValues[a]]
    console.log(`     ${a.padEnd(22)} ${String(vals.length).padStart(2)}  ${vals.slice(0, 6).join(', ')}${vals.length > 6 ? ' …' : ''}`)
  }
}

console.log(`\n${fail === 0 ? '✓ all checks pass — designs are architecturally varied, not recoloured' : `✗ ${fail} check(s) failed`}`)
if (fail) process.exit(1)
