import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate, STRATEGIES } from '../src/lib/engine/index.ts'
import { validate } from '../src/lib/rules/index.ts'
import { estimateCost } from '../src/lib/cost/index.ts'
import { buildMassing } from '../src/lib/three/buildMassing.ts'

/* Large-villa typology. For every character × storey count × strategy the large
 * villa must: stay valid and reachable; carry a higher build rate; score at
 * least as well as the plain villa on the same plot; give a genuinely larger
 * headline social room than a default (15×18) villa; keep its rooms believable
 * (no runaway ballooning); and produce only finite, positive-size massing boxes. */

const chars = ['modern-indian', 'minimal-indian', 'kerala-contemporary', 'modern-kerala', 'tropical-indian', 'luxury-indian', 'contemporary-indian', 'courtyard-indian'] as const

// headline social room of a plain villa on the default plot — the "large" one must beat it
const socialOf = (d: ReturnType<typeof generate>) =>
  Math.max(0, ...d.floors.flatMap((f) => f.rooms).filter((r) => r.zone === 'social').map((r) => r.area))

let total = 0
let bad = 0

for (const c of chars) {
  for (const st of [0, 1, 2, 3]) {
    for (const s of STRATEGIES) {
      total++
      const base = defaultBrief()
      base.levels.storeys = st
      base.style.character = c

      const dfault = generate(compile(base), s.id) // default 15×18 plain villa

      const onPlot = (bt: 'villa' | 'large-villa') => {
        const b = structuredClone(base)
        b.project.buildingType = bt
        b.site.plotWidth = 26
        b.site.plotDepth = 32
        return generate(compile(b), s.id)
      }
      const ds = onPlot('villa')
      const db = onPlot('large-villa')
      const rs = validate(ds)
      const rb = validate(db)
      const cs = estimateCost(ds)
      const cb = estimateCost(db)

      const m = buildMassing(db)
      const badBox = m.boxes.find(
        (x) => x.pos.some((v) => !Number.isFinite(v)) || x.size.some((v) => !(v > 0) || !Number.isFinite(v)),
      )
      const checks = {
        valid: rb.hardChecksPass || !rs.hardChecksPass, // no worse than the plain villa
        reach: db.floors.every((f) => f.reachable),
        dearerRate: cb.ratePerSqm.high > cs.ratePerSqm.high,
        scoreOk: rb.score >= Math.max(55, rs.score - 2),
        roomier: socialOf(db) > socialOf(dfault) + 2,
        believable: socialOf(db) < 140, // grand, not runaway
        boxesOk: !badBox && Number.isFinite(m.bounds.w) && m.bounds.w > 0,
      }
      const tag = `${c} G+${st} ${s.id}`
      const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k)
      if (failed.length) {
        bad++
        console.log('BAD ', tag.padEnd(34), failed.join(','), JSON.stringify({
          scoreS: rs.score, scoreB: rb.score, socialDefault: +socialOf(dfault).toFixed(0),
          socialB: +socialOf(db).toFixed(0), builtB: +db.builtAreaSqm.toFixed(0), badBox: badBox?.id,
        }))
      } else {
        console.log('ok  ', tag.padEnd(34),
          `social ${socialOf(dfault).toFixed(0)}→${socialOf(db).toFixed(0)} m²  score ${rs.score}→${rb.score}  boxes ${m.boxes.length}`)
      }
    }
  }
}

console.log(`\n${total} large-villa cases, ${bad} bad`)
process.exit(bad ? 1 : 0)
