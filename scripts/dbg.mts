import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/index.ts'
import { validate } from '../src/lib/rules/index.ts'
const b = defaultBrief(); b.levels.storeys = 1
const d = generate(compile(b), 'wing-split')
const r = validate(d)
for (const f of d.floors) {
  console.log(`\n${f.name}: outline ${Math.round(f.outline.w)}x${Math.round(f.outline.h)}`)
  for (const rm of f.rooms.filter(x=>!x.outdoor)) console.log(`  ${rm.id.padEnd(12)} ${(rm.rect.w/1000).toFixed(2)}x${(rm.rect.h/1000).toFixed(2)} @ (${(rm.rect.x/1000).toFixed(1)},${(rm.rect.y/1000).toFixed(1)})  ${rm.area}`)
}
for (const fn of r.findings) console.log(`[${fn.severity}] ${fn.code}: ${fn.message}`)
