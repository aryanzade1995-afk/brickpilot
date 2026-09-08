import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/index.ts'
import { validate } from '../src/lib/rules/index.ts'

for (const st of [0, 1, 2, 3]) {
  for (const shape of ['rectangle', 'square'] as const) {
    const b = defaultBrief()
    b.levels.storeys = st
    b.style.shape = shape
    const d = generate(compile(b))
    const r = validate(d)
    const reach = d.floors.every((f) => f.reachable)
    console.log(
      `G+${st} ${shape.padEnd(10)} score ${String(r.score).padStart(3)} hardPass ${r.hardChecksPass ? 'Y' : 'N'} reach ${reach ? 'Y' : 'N'} ${r.counts.error}E/${r.counts.warning}W built ${d.builtAreaSqm.toFixed(0)}`,
    )
  }
}
