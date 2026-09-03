/**
 * bighousetest.mts — stress the generator + the 3-D model builder on large
 * villas: big plots, every massing, every character, G+1..G+3. Reports plan
 * validity AND a battery of geometry checks on `buildMassing()` output.
 */
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/index.ts'
import { validate } from '../src/lib/rules/index.ts'
import { buildMassing, type MassKind } from '../src/lib/three/buildMassing.ts'
import { MASSING_TYPES } from '../src/lib/engine/massing/types.ts'
import { characterSchema } from '../src/lib/model/brief.ts'

const PLOTS: [number, number][] = [
  [24, 30],
  [30, 34],
  [36, 40],
  [40, 45],
]
const CHARS = characterSchema.options
type Issue = { tag: string; msg: string }
const issues: Issue[] = []
let runs = 0
let planBad = 0

const flag = (tag: string, msg: string) => issues.push({ tag, msg })

for (const [pw, pd] of PLOTS) {
  for (let storeys = 1; storeys <= 3; storeys++) {
    for (const mt of MASSING_TYPES) {
      for (let ci = 0; ci < CHARS.length; ci++) {
        const character = CHARS[(ci + storeys) % CHARS.length]
        const b = defaultBrief()
        b.project.buildingType = 'large-villa'
        b.site.plotWidth = pw
        b.site.plotDepth = pd
        b.site.setbacks = { N: 4, E: 2, S: 3, W: 2 }
        b.levels.storeys = storeys
        b.spaces.occupants = 6
        b.rooms.bedroomsWithBath = 3
        b.rooms.bedroomsNoBath = 2
        b.rooms.studies = 1
        b.rooms.priorities.courtyard = mt === 'courtyard' || mt === 'u-shape' || mt === 'rear-courtyard'
        b.style.character = character
        b.style.massing = mt
        b.style.diversity = (['low', 'medium', 'high', 'extreme'] as const)[(pw + storeys) % 4]
        b.variation = (pw * 31 + pd * 7 + storeys * 101 + ci * 13) % 99991

        const tag = `${pw}x${pd} G+${storeys} ${mt}/${character}`
        runs++

        let design
        try {
          design = generate(compile(b))
        } catch (e) {
          flag(tag, `generate() threw: ${e}`)
          planBad++
          continue
        }
        const rep = validate(design)
        if (!rep.hardChecksPass) {
          planBad++
          flag(tag, `plan hard-fail: ${rep.findings.filter((f) => f.severity === 'error').map((f) => f.code).join(',')}`)
        }
        if (!design.floors.every((f) => f.reachable)) {
          planBad++
          flag(tag, 'a floor is unreachable')
        }

        // ---- 3-D model ----
        let m
        try {
          m = buildMassing(design)
        } catch (e) {
          flag(tag, `buildMassing() threw: ${e}`)
          continue
        }

        const plotHalfX = pw / 2 + 6
        const plotHalfZ = pd / 2 + 6
        const kinds = new Set<MassKind>()
        let minX = Infinity
        let maxX = -Infinity
        let minY = Infinity
        let maxY = -Infinity
        let minZ = Infinity
        let maxZ = -Infinity

        for (const box of m.boxes) {
          kinds.add(box.kind)
          const [x, y, z] = box.pos
          const [w, h, d] = box.size
          if (![x, y, z, w, h, d].every(Number.isFinite)) {
            flag(tag, `non-finite box ${box.id} pos=${JSON.stringify(box.pos)} size=${JSON.stringify(box.size)}`)
            continue
          }
          const siteKind = box.kind === 'lawn' || box.kind === 'paving' || box.kind === 'hedge' || box.kind === 'fence'
          if (w <= 0.01 || h <= 0.01 || d <= 0.01) flag(tag, `degenerate box ${box.id} size=${JSON.stringify(box.size)}`)
          if (!siteKind && (w > 42 || h > 22 || d > 42)) flag(tag, `oversized box ${box.id} size=${JSON.stringify(box.size.map((v) => +v.toFixed(1)))}`)
          if (!siteKind && (Math.abs(x) > plotHalfX + 1 || Math.abs(z) > plotHalfZ + 1))
            flag(tag, `box ${box.id} outside plot: pos=(${x.toFixed(1)},${z.toFixed(1)}) vs ±(${plotHalfX.toFixed(1)},${plotHalfZ.toFixed(1)})`)
          if (y - h / 2 < -1.2) flag(tag, `box ${box.id} sinks below grade (bottom y=${(y - h / 2).toFixed(2)})`)
          if (box.kind === 'prism' && !box.prism) flag(tag, `prism ${box.id} missing prism spec`)
          minX = Math.min(minX, x - w / 2)
          maxX = Math.max(maxX, x + w / 2)
          minY = Math.min(minY, y - h / 2)
          maxY = Math.max(maxY, y + h / 2)
          minZ = Math.min(minZ, z - d / 2)
          maxZ = Math.max(maxZ, z + d / 2)
        }

        // structural minimums
        if (!kinds.has('wall')) flag(tag, 'no exterior walls')
        if (!kinds.has('slab')) flag(tag, 'no floor slabs')
        const roofish = kinds.has('roof') || kinds.has('prism')
        if (!roofish) flag(tag, 'no roof at all')
        if (storeys >= 1 && !kinds.has('stair')) flag(tag, 'multi-storey but no stair geometry')
        if (design.floors.some((f) => f.rooms.some((r) => r.outdoor && r.id.startsWith('balcony'))) && !kinds.has('railing'))
          flag(tag, 'balcony room but no railing')

        // per-storey slab count should track the block count
        const wantSlabs = design.floors.reduce((a, f) => a + (f.footprint?.length ?? 1), 0)
        const gotSlabs = m.boxes.filter((x) => x.kind === 'slab').length
        if (gotSlabs < wantSlabs) flag(tag, `slab count ${gotSlabs} < block count ${wantSlabs}`)

        // model height should match storeys*floor-to-floor + roof, roughly
        const modelH = maxY - Math.max(0, minY)
        const expectH = design.floors.length * b.levels.floorToFloor
        if (modelH > expectH + 6) flag(tag, `model ${modelH.toFixed(1)} m tall vs expected ~${expectH.toFixed(1)} m`)
        if (modelH < expectH * 0.6) flag(tag, `model only ${modelH.toFixed(1)} m tall vs expected ~${expectH.toFixed(1)} m`)

        // pitched-roof styles should actually emit a prism
        const themeRoof = ['modern-kerala', 'tropical-indian'].includes(character)
        if (themeRoof && !kinds.has('prism')) flag(tag, `${character} but no prism roof`)
      }
    }
  }
}

const byKind = issues.reduce<Record<string, number>>((a, i) => {
  const k = i.msg.replace(/[0-9]+(\.[0-9]+)?/g, '#').replace(/ [a-z]?[0-9#]+[a-z-]*/gi, ' …').slice(0, 60)
  a[k] = (a[k] ?? 0) + 1
  return a
}, {})

console.log(`\n${runs} large-villa configs · ${planBad} plan issues · ${issues.length} geometry flags\n`)
console.log('flag summary:')
for (const [k, n] of Object.entries(byKind).sort((a, c) => c[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`)
console.log('\nfirst 40 flags:')
for (const it of issues.slice(0, 40)) console.log(`  ${it.tag.padEnd(34)} ${it.msg}`)

process.exit(issues.length > 0 || planBad > 0 ? 1 : 0)
