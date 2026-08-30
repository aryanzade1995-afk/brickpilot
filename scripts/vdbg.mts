import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/index.ts'
import { validate } from '../src/lib/rules/index.ts'
const b = defaultBrief(); b.levels.storeys = 1
const d = generate(compile(b)); const r = validate(d)
for (const f of r.findings) console.log(`[${f.severity}] ${f.code}: ${f.message}`)
