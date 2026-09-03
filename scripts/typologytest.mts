import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate, STRATEGIES } from '../src/lib/engine/index.ts'
import { validate } from '../src/lib/rules/index.ts'
import { estimateCost } from '../src/lib/cost/index.ts'
import { buildMassing } from '../src/lib/three/buildMassing.ts'

/* Large-villa typology: for every character × storey count × strategy the design
 * must stay valid, cost more and build bigger than the matching plain villa, and
 * the massing must produce only finite, positive-size boxes. */

const chars = ['modernist', 'warm-minimal', 'kerala-contemporary'] as const
let total = 0
let bad = 0

for (const c of chars) {
  for (const st of [0, 1, 2, 3]) {
    for (const s of STRATEGIES) {
      total++
      const base = defaultBrief()
      base.levels.storeys = st
      base.style.character = c
      // a plot large enough that the standard-villa caps bind but the large
      // villa still has room to spread
      base.site.plotWidth = 26
      base.site.plotDepth = 32

      const small = { ...structuredClone(base), project: { ...base.project, buildingType: 'villa' as const } }
      const big = { ...structuredClone(base), project: { ...base.project, buildingType: 'large-villa' as const } }

      const ds = generate(compile(small), s.id)
      const db = generate(compile(big), s.id)
      const rs = validate(ds)
      const rb = validate(db)
      const reach = db.floors.every((f) => f.reachable)
      const cs = estimateCost(ds)
      const cb = estimateCost(db)

      const m = buildMassing(db)
      const badBox = m.boxes.find(
        (x) => x.pos.some((v) => !Number.isFinite(v)) || x.size.some((v) => !(v > 0) || !Number.isFinite(v)),
      )
      const finiteBounds = Number.isFinite(m.bounds.w) && Number.isFinite(m.bounds.d) && m.bounds.w > 0

      const bigger = db.builtAreaSqm > ds.builtAreaSqm + 1
      const dearerRate = cb.ratePerSqm.high > cs.ratePerSqm.high
      // the large villa must be no worse than the plain villa on the same plot —
      // a hard-check the plain villa already fails is a pre-existing engine issue,
      // not a typology regression
      const notWorse = rb.hardChecksPass || !rs.hardChecksPass
      const scoreOk = rb.score >= rs.score - 4

      const tag = `${c} G+${st} ${s.id}`
      const fail =
        !notWorse || !reach || !bigger || !dearerRate || !scoreOk || !!badBox || !finiteBounds
      if (fail) {
        bad++
        console.log(
          'BAD ',
          tag.padEnd(34),
          JSON.stringify({
            notWorse,
            hardPassS: rs.hardChecksPass,
            hardPassB: rb.hardChecksPass,
            reach,
            bigger,
            builtS: +ds.builtAreaSqm.toFixed(0),
            builtB: +db.builtAreaSqm.toFixed(0),
            dearerRate,
            scoreOk,
            scoreS: rs.score,
            scoreB: rb.score,
            badBox: badBox?.id,
            finiteBounds,
          }),
        )
      } else {
        console.log(
          'ok  ',
          tag.padEnd(34),
          `built ${ds.builtAreaSqm.toFixed(0)}→${db.builtAreaSqm.toFixed(0)} m²  score ${rb.score}  boxes ${m.boxes.length}`,
        )
      }
    }
  }
}

console.log(`\n${total} large-villa cases, ${bad} bad`)
process.exit(bad ? 1 : 0)
