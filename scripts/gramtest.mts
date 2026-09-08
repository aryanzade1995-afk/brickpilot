/* smoke test the architectural grammar: every style × seed produces a
 * valid, non-degenerate, deterministic DesignSpec with sane windows. */
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/index.ts'
import { STYLE_IDS, requirementsOf, generateDesign, CHARACTER_OF_STYLE } from '../src/architecture/index.ts'

let cases = 0
let bad = 0
const winCounts: number[] = []
const strategies = new Set<string>()
const kinds = new Set<string>()

for (const style of STYLE_IDS) {
  for (let beds = 2; beds <= 4; beds++) {
    for (let seed = 0; seed < 6; seed++) {
      const b = defaultBrief()
      b.style.character = CHARACTER_OF_STYLE[style]
      b.levels.storeys = beds >= 3 ? 2 : 1
      b.rooms.bedroomsWithBath = Math.min(beds, 2)
      b.rooms.bedroomsNoBath = Math.max(0, beds - 2)
      b.site.plotWidth = 15 + (seed % 3) * 4
      b.site.plotDepth = 20 + (seed % 3) * 5
      b.variation = seed * 131 + beds

      const design = generate(compile(b))
      const req = requirementsOf(design, style)
      const spec = generateDesign(req, req.seed)
      cases++
      strategies.add(spec.massing.strategy)

      const fail: string[] = []
      if (spec.floors.length !== design.floors.length) fail.push('floor count mismatch')
      for (const fl of spec.floors) {
        if (!fl.blocks.length) fail.push(`${fl.name}: no blocks`)
        const perRoom = new Map<string, number>()
        for (const w of fl.windows) {
          kinds.add(w.kind)
          perRoom.set(w.roomId, (perRoom.get(w.roomId) ?? 0) + 1)
          const wallLen = Math.hypot(w.wall.b.x - w.wall.a.x, w.wall.b.y - w.wall.a.y)
          const maxW = w.kind === "strip" ? wallLen + 5 : w.kind === "picture" ? Math.min(wallLen, 6400) : 4600
          if (w.widthMm < 300 || w.widthMm > maxW || w.heightMm < 400 || w.heightMm > 4000)
            fail.push(`${w.id}: bad size ${w.widthMm}x${w.heightMm} (${w.kind}, wall ${wallLen | 0})`)
        }
        for (const [rid, n] of perRoom) if (n > 3) fail.push(`${rid}: ${n} windows`)
        winCounts.push(fl.windows.length)
      }
      const spec2 = generateDesign(req, req.seed)
      if (JSON.stringify(spec) !== JSON.stringify(spec2)) fail.push('NON-DETERMINISTIC')
      if (spec.validation.issues.length) fail.push(`validation: ${spec.validation.issues.join('; ')}`)

      if (fail.length) {
        bad++
        console.log(`✗ ${style} ${beds}BR seed${seed}: ${fail.join(' | ')}`)
      }
    }
  }
}

// distinct forms from the same brief, different seeds
const b = defaultBrief(); b.style.character = 'modern-indian'; b.levels.storeys = 2
const forms = new Set<string>()
for (let s = 0; s < 12; s++) {
  b.variation = s
  const d = generate(compile(b))
  const spec = generateDesign(requirementsOf(d, 'modern_indian'), s)
  forms.add(spec.massing.strategy + '|' + spec.floors.map(f => f.blocks.map(bl => `${bl.rect.w|0}x${bl.rect.h|0}@${bl.rect.x|0},${bl.rect.y|0}`).join(';')).join('/'))
}

const avg = winCounts.reduce((a, b) => a + b, 0) / winCounts.length
console.log(`\n${cases} specs, ${bad} bad`)
console.log(`massing strategies: ${[...strategies].join(', ')}`)
console.log(`window kinds: ${[...kinds].join(', ')}`)
console.log(`windows/floor: min ${Math.min(...winCounts)}  avg ${avg.toFixed(1)}  max ${Math.max(...winCounts)}`)
console.log(`distinct massing forms over 12 seeds (modern_indian, same brief): ${forms.size}/12`)
if (bad > 0) process.exit(1)
