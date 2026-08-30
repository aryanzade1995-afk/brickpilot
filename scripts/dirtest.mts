import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generateDirections } from '../src/lib/engine/index.ts'
import { validate } from '../src/lib/rules/index.ts'
const b = defaultBrief(); b.levels.storeys = 2
const dirs = generateDirections(compile(b))
for (const d of dirs) {
  const r = validate(d.design)
  console.log(`\n### ${d.label} (${d.strategy}) — score ${r.score}, hardPass ${r.hardChecksPass}, ${r.counts.error}E/${r.counts.warning}W`)
  for (const f of d.design.floors) {
    console.log(`  ${f.name}: ${f.rooms.length} rooms, outline ${Math.round(f.outline.w)}x${Math.round(f.outline.h)}, reachable ${f.reachable}`)
    console.log('   ', f.rooms.filter(x=>!x.outdoor).map(x=>`${x.id}(${(x.rect.w/1000).toFixed(1)}x${(x.rect.h/1000).toFixed(1)})`).join(' '))
  }
  for (const fn of r.findings) console.log(`   [${fn.severity}] ${fn.message}`)
}
