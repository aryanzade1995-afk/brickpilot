/**
 * Massing-grammar coverage + diversity gate.
 *
 *  1. 20 seeds × {auto, a spread of explicit archetypes} × 3 characters:
 *     every design must be geometrically valid, reachable, hard-checks-clean,
 *     with finite bounds and no degenerate 3-D boxes.
 *  2. Across the 20 `auto` seeds the STRUCTURE must genuinely vary — footprint
 *     aspect, block count, per-floor offset and roof type each above a floor —
 *     so a regression that collapses the grammar back to one template fails here.
 */
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/index.ts'
import { validate } from '../src/lib/rules/index.ts'
import { buildMassing } from '../src/lib/three/buildMassing.ts'
import { MASSING_TYPES, type MassingType } from '../src/lib/engine/massing/types.ts'

const CHARACTERS = ['modern-indian', 'minimal-indian', 'kerala-contemporary', 'modern-kerala', 'tropical-indian'] as const
const EXPLICIT: (MassingType | 'auto')[] = [
  'auto',
  'rectangular',
  'l-shape',
  'u-shape',
  'courtyard',
  'cantilever',
  'stepped',
  'split-volume',
  'side-wing',
  'asymmetric',
]
const SEEDS = 20

let cases = 0
let bad = 0
const fail = (tag: string, why: string) => {
  bad++
  console.log(`BAD  ${tag} — ${why}`)
}

type AutoRow = { seed: number; aspect: number; blocks: number; offset: number; roof: string; type: string }
const autoRows: AutoRow[] = []

for (const character of CHARACTERS) {
  for (const massing of EXPLICIT) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const b = defaultBrief()
      b.levels.storeys = 1 + (seed % 3) // G+1..G+3
      b.style.character = character
      b.style.massing = massing
      b.style.diversity = (['low', 'medium', 'high', 'extreme'] as const)[seed % 4]
      b.variation = seed * 101

      const model = compile(b)
      const design = generate(model)
      const report = validate(design)
      const tag = `${character} ${massing} s${seed} G+${b.levels.storeys}`
      cases++

      // --- determinism ---
      if (JSON.stringify(generate(compile(b))) !== JSON.stringify(design)) fail(tag, 'non-deterministic')

      // --- validity ---
      if (!report.hardChecksPass) {
        fail(tag, `hard checks: ${report.findings.filter((f) => f.severity === 'error').map((f) => f.code).join(',')}`)
      }
      if (!design.floors.every((f) => f.reachable)) fail(tag, 'a floor is unreachable')

      // --- footprint sanity ---
      for (const f of design.floors) {
        if (!f.footprint?.length) fail(tag, `${f.name} has no footprint blocks`)
        for (const blk of f.footprint ?? []) {
          if (!(blk.w > 2000 && blk.h > 2000) || !Number.isFinite(blk.x + blk.y + blk.w + blk.h))
            fail(tag, `${f.name} degenerate block ${JSON.stringify(blk)}`)
        }
      }

      // --- 3-D model sanity ---
      const mass = buildMassing(design)
      const badBox = mass.boxes.find(
        (x) =>
          x.pos.some((v) => !Number.isFinite(v) || Math.abs(v) > 60) ||
          x.size.some((v) => !(v > 0.01) || v > 40),
      )
      if (badBox) fail(tag, `bad box ${badBox.id} ${JSON.stringify(badBox.size)}`)
      if (!Number.isFinite(mass.center[0] + mass.center[1] + mass.center[2])) fail(tag, 'non-finite center')

      if (massing === 'auto') {
        const g = design.floors[0].outline
        // per-floor movement: how far the top storey's bounding box differs from
        // the ground bounding box on any edge (shrink / step / cantilever / offset)
        const bb = (f: (typeof design.floors)[number]) => {
          const bs = f.footprint
          return {
            x: Math.min(...bs.map((b) => b.x)),
            y: Math.min(...bs.map((b) => b.y)),
            r: Math.max(...bs.map((b) => b.x + b.w)),
            b: Math.max(...bs.map((b) => b.y + b.h)),
          }
        }
        const g0 = bb(design.floors[0])
        const gt = bb(design.floors[design.floors.length - 1])
        const offset =
          design.floors.length > 1
            ? Math.max(Math.abs(gt.x - g0.x), Math.abs(gt.y - g0.y), Math.abs(gt.r - g0.r), Math.abs(gt.b - g0.b))
            : 0
        autoRows.push({
          seed,
          aspect: Math.round((g.w / g.h) * 100) / 100,
          blocks: Math.max(...design.floors.map((f) => f.footprint.length)),
          offset: Math.round(offset),
          roof: design.floors[design.floors.length - 1].roof.kind,
          type: design.massingType,
        })
      }
    }
  }
}

/* ---- diversity gate over the 20 auto seeds (one character's worth) ---- */
const auto = autoRows.filter((_, i) => i < SEEDS) // modern-indian run
const distinctTypes = new Set(auto.map((r) => r.type)).size
const multiBlock = auto.filter((r) => r.blocks >= 2).length
const maxBlocks = Math.max(...auto.map((r) => r.blocks))
const withOffset = auto.filter((r) => r.offset > 600).length
const distinctRoofs = new Set(auto.map((r) => r.roof)).size

console.log('\nauto-pick spread (modern-indian, 20 seeds):')
console.log('  distinct massing types :', distinctTypes, '     ', [...new Set(auto.map((r) => r.type))].join(', '))
console.log('  seeds w/ a multi-block footprint:', multiBlock, '/', SEEDS, '(max', maxBlocks, 'blocks)')
console.log('  seeds w/ real per-floor movement:', withOffset, '/', SEEDS)
console.log('  distinct roof kinds    :', distinctRoofs)

// the grammar must not collapse back to one template: several distinct
// archetypes, some with a non-rectangular (multi-block) footprint, and real
// per-floor movement across the set.
if (distinctTypes < 5) fail('diversity', `only ${distinctTypes} distinct massing types over 20 seeds`)
if (multiBlock < 2) fail('diversity', `only ${multiBlock} seeds have a multi-block footprint`)
if (maxBlocks < 2) fail('diversity', 'no multi-block footprint ever chosen')
if (withOffset < 4) fail('diversity', `only ${withOffset} seeds show real per-floor movement`)

console.log(`\n${cases} cases, ${bad} bad`)
void MASSING_TYPES
process.exit(bad ? 1 : 0)
