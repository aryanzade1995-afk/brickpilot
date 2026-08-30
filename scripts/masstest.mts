import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/index.ts'
import { buildMassing } from '../src/lib/three/buildMassing.ts'
const b = defaultBrief(); b.levels.storeys = 2
const m = buildMassing(generate(compile(b)))
console.log('boxes:', m.boxes.length, 'bounds:', m.bounds, 'floors:', m.floors)
const bad = m.boxes.filter(x => x.pos.some(Number.isNaN) || x.size.some(v => Number.isNaN(v) || v <= 0))
console.log('bad boxes:', bad.length, bad.slice(0,3))
console.log('sample:', m.boxes.slice(0,4))
const ys = m.boxes.map(x=>x.pos[1]); console.log('y range', Math.min(...ys).toFixed(2), Math.max(...ys).toFixed(2))
const xs = m.boxes.map(x=>x.pos[0]); console.log('x range', Math.min(...xs).toFixed(2), Math.max(...xs).toFixed(2))
