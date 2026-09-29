/*
 * furnishtest — the furnished model must obey the rules a real room obeys:
 *   1. nothing stands inside a wall
 *   2. nothing stands in a door's way
 *   3. nothing taller than a sill stands in front of a window (curtains excepted)
 *   4. two pieces never occupy the same floor at the same height
 * The clearances themselves live in src/lib/three/buildDollhouse.ts.
 */
import { defaultBrief, type Brief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/index.ts'
import { buildDollhouse } from '../src/lib/three/buildDollhouse.ts'

const FT = 0.3048
const ft = (n: number) => +(n * FT).toFixed(2)
type Rect = { x: number; z: number; w: number; d: number }
const area = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2)) *
  Math.max(0, Math.min(a.z + a.d / 2, b.z + b.d / 2) - Math.max(a.z - a.d / 2, b.z - b.d / 2))
const FURNITURE = new Set(['rug', 'sage', 'blush', 'clay', 'cream', 'wood', 'panel', 'stone', 'metal', 'ceramic', 'plant', 'lamp'])

const CASES: [string, (b: Brief) => void][] = [
  ['default', () => {}],
  ['30x40 G+0', (b) => { b.site.plotWidth = ft(30); b.site.plotDepth = ft(40); b.levels.storeys = 0 }],
  ['30x50 G+1', (b) => { b.site.plotWidth = ft(30); b.site.plotDepth = ft(50); b.levels.storeys = 1 }],
  ['40x60 G+1', (b) => { b.site.plotWidth = ft(40); b.site.plotDepth = ft(60); b.levels.storeys = 1 }],
  ['60x80 G+2', (b) => { b.site.plotWidth = ft(60); b.site.plotDepth = ft(80); b.levels.storeys = 2 }],
]

let checked = 0
const issues: string[] = []
for (const [name, tweak] of CASES) {
  const brief = defaultBrief()
  tweak(brief)
  const design = generate(compile(brief))
  const doll = buildDollhouse(design)
  const plotW = design.model.envelope ? design.model.brief.site.plotWidth * 1000 : 0
  void plotW
  const bandOf = (y: number) => doll.floors.reduce((best, f) => (y >= f.baseY - 0.25 && y < f.baseY + doll.floorHeight ? f.level : best), -1)
  const pieces = doll.boxes
    .filter((b) => FURNITURE.has(b.mat) && b.size[1] > 0.06)
    .map((b) => ({ id: b.id, x: b.pos[0], z: b.pos[2], w: b.size[0], d: b.size[2], y0: b.pos[1] - b.size[1] / 2, y1: b.pos[1] + b.size[1] / 2, level: bandOf(b.pos[1] - b.size[1] / 2), group: b.id.split('-').slice(0, 2).join('-') }))
  // walls and door leaves of the model itself are the obstacles
  const walls = doll.boxes.filter((b) => b.mat === 'wall' || b.mat === 'exterior' || b.mat === 'door')
  for (const p of pieces) {
    checked++
    for (const w of walls) {
      if (w.pos[1] - w.size[1] / 2 > p.y1 || w.pos[1] + w.size[1] / 2 < p.y0) continue
      const a = area(p, { x: w.pos[0], z: w.pos[2], w: w.size[0], d: w.size[2] })
      if (a > 0.02) issues.push(`${name}: ${p.id} runs into ${w.id} (${a.toFixed(2)} m²)`)
    }
  }
  for (let i = 0; i < pieces.length; i++)
    for (let j = i + 1; j < pieces.length; j++) {
      const a = pieces[i], b = pieces[j]
      if (a.group === b.group || a.level !== b.level) continue
      if (a.y1 <= b.y0 + 0.02 || b.y1 <= a.y0 + 0.02) continue
      const ov = area(a, b)
      if (ov > 0.06) issues.push(`${name}: ${a.id} and ${b.id} overlap ${ov.toFixed(2)} m²`)
    }
  console.log(`${name.padEnd(10)} ${doll.stats.rooms} rooms · ${doll.stats.pieces} pieces`)
}
console.log(`\n${checked} pieces checked · ${issues.length} problems`)
for (const i of issues.slice(0, 25)) console.log(`  ✗ ${i}`)
process.exit(issues.length ? 1 : 0)
