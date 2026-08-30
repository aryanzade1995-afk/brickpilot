import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate, STRATEGIES } from '../src/lib/engine/index.ts'
import { validate } from '../src/lib/rules/index.ts'
for (const st of [0,1,2,3]) {
  for (const s of STRATEGIES) {
    const b = defaultBrief(); b.levels.storeys = st
    const d = generate(compile(b), s.id)
    const r = validate(d)
    const reach = d.floors.every(f=>f.reachable)
    console.log(`G+${st} ${s.id.padEnd(16)} score ${String(r.score).padStart(3)} hardPass ${r.hardChecksPass?'Y':'N'} reach ${reach?'Y':'N'} ${r.counts.error}E/${r.counts.warning}W built ${d.builtAreaSqm.toFixed(0)}`)
  }
}
