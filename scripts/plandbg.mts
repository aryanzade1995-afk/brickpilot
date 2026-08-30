import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile, canonicalSummary } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/index.ts'
const b = defaultBrief(); b.levels.storeys = 1
const model = compile(b)
console.log('SUMMARY', canonicalSummary(model))
const d = generate(model)
for (const f of d.floors) {
  console.log(`\n=== ${f.name} (outline ${(f.outline.w/1000).toFixed(1)} x ${(f.outline.h/1000).toFixed(1)} m) ===`)
  for (const r of f.rooms) {
    console.log(`  ${r.id.padEnd(13)} ${r.name.padEnd(18)} ${(r.rect.x/1000).toFixed(1)},${(r.rect.y/1000).toFixed(1)}  ${(r.rect.w/1000).toFixed(1)}x${(r.rect.h/1000).toFixed(1)}  ${r.area}m2 ${r.outdoor?'OUT':''}`)
  }
  console.log(`  walls: ${f.walls.filter(w=>w.kind==='interior').length} interior, ${f.walls.filter(w=>w.kind==='exterior').length} exterior`)
  console.log(`  openings: ${f.openings.filter(o=>o.kind==='window').length}w ${f.openings.filter(o=>o.kind==='door').length}d ${f.openings.filter(o=>o.kind==='entry').length}e`)
}
