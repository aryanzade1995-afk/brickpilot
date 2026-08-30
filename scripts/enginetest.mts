import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile, canonicalSummary } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/index.ts'
import { validate } from '../src/lib/rules/index.ts'
import { estimateCost } from '../src/lib/cost/index.ts'

const brief = defaultBrief()
brief.levels.storeys = 2
const model = compile(brief)
console.log('SUMMARY', canonicalSummary(model))
console.log('envelope mm', model.envelope, 'seed', model.seed)
const design = generate(model)
console.log('\nfloors:', design.floors.length, 'built', design.builtAreaSqm, 'footprint', design.footprintSqm, 'coverage', (design.coverage*100).toFixed(1)+'%', 'height', design.heightM)
for (const f of design.floors) {
  console.log(`\n-- ${f.name} -- outline ${Math.round(f.outline.w)}x${Math.round(f.outline.h)} rooms:${f.rooms.length} walls:${f.walls.length} openings:${f.openings.length} reachable:${f.reachable} unreachable:[${f.unreachableRooms}]`)
  for (const r of f.rooms) console.log(`   ${r.id.padEnd(12)} ${r.name.padEnd(20)} ${(r.rect.w/1000).toFixed(1)}x${(r.rect.h/1000).toFixed(1)}m  ${r.area}m2 ${r.outdoor?'(outdoor)':''}`)
}
const report = validate(design)
console.log('\nVALIDATION', report.pack, 'score', report.score, 'hardPass', report.hardChecksPass, report.counts)
for (const fn of report.findings) console.log(`  [${fn.severity}] ${fn.code} - ${fn.message}`)
const cost = estimateCost(design)
console.log('\nCOST expected', Math.round(cost.expected), 'range', Math.round(cost.total.low), '-', Math.round(cost.total.high))
const d2 = generate(compile(brief))
console.log('\ndeterministic:', JSON.stringify(design) === JSON.stringify(d2))
