import assert from 'node:assert/strict'
import test from 'node:test'
import { briefSchema } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { suggestRooms } from '../src/lib/model/household.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { terraceLayout } from '../src/lib/engine/terrace.ts'
import { doorZones, furnishFloor, roomKind } from '../src/lib/draw/furniture.ts'
import { buildMassing } from '../src/lib/three/buildMassing.ts'

/* Presentation plan: furniture layout and the roof terrace (drawing data). */

const withRooms = (b) => {
  const s = suggestRooms(b)
  Object.assign(b.rooms, { bedroomsWithBath: s.bedroomsWithBath, bedroomsNoBath: s.bedroomsNoBath, sharedBaths: s.sharedBaths, studies: s.studies })
  return b
}
const BRIEFS = {
  'default 15x18': briefSchema.parse({}),
  'case A 18x24': withRooms(briefSchema.parse({ site: { plotWidth: 18, plotDepth: 24 }, household: { members: ['adult', 'adult', 'senior', 'senior', 'teen', 'child'].map((role) => ({ role })) }, lifestyle: { wfhCount: 1, clientVisits: true } })),
  'combined living G+0': briefSchema.parse({ site: { plotWidth: 20, plotDepth: 25 }, levels: { storeys: 0 }, spaces: { livingDining: 'combined' } }),
  'large villa G+2': briefSchema.parse({ project: { buildingType: 'large-villa' }, site: { plotWidth: 30, plotDepth: 40 }, levels: { storeys: 2 } }),
  'narrow 7x60': briefSchema.parse({ site: { plotWidth: 7, plotDepth: 60, setbacks: { N: 3, E: 0.5, S: 2, W: 0.5 } } }),
}
const designs = Object.fromEntries(Object.entries(BRIEFS).map(([k, b]) => [k, generate(compile(b))]))

const box = (s) => s.kind === 'rect' ? s : { x: s.cx - s.r, y: s.cy - s.r, w: 2 * s.r, h: 2 * s.r }
const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

test('every piece of furniture stays inside its room and clear of every door swing', () => {
  for (const [name, d] of Object.entries(designs)) {
    for (const f of d.floors) {
      for (const rf of furnishFloor(f)) {
        const room = f.rooms.find((r) => r.id === rf.roomId)
        const zones = doorZones(room, f.openings)
        for (const s of rf.items) {
          const b = box(s)
          const r = room.rect
          assert.ok(b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h, `${name} ${room.id}: ${s.role} outside`)
          if (s.role !== 'rug') assert.ok(zones.every((z) => !hit(b, z)), `${name} ${room.id}: ${s.role} blocks a door`)
        }
      }
    }
  }
})

test('each room gets the piece that says what it is', () => {
  const need = { bed: 'bed', living: 'soft', livingDining: 'soft', lounge: 'soft', dining: 'table', kitchen: 'counter', bath: 'sanitary', study: 'table', parking: 'car' }
  const missing = []
  for (const [name, d] of Object.entries(designs)) {
    for (const f of d.floors) {
      for (const rf of furnishFloor(f)) {
        const kind = roomKind(f.rooms.find((r) => r.id === rf.roomId))
        if (need[kind] && !rf.items.some((s) => s.role === need[kind])) missing.push(`${name} ${rf.roomId}`)
      }
    }
  }
  assert.deepEqual(missing, [])
})

test('floor finishes follow the room: wood bedrooms, tiled living areas, wet-tiled baths', () => {
  const d = designs['case A 18x24']
  for (const f of d.floors) {
    for (const rf of furnishFloor(f)) {
      const kind = roomKind(f.rooms.find((r) => r.id === rf.roomId))
      if (kind === 'bed') assert.equal(rf.finish, 'wood')
      if (kind === 'living' || kind === 'kitchen' || kind === 'dining') assert.equal(rf.finish, 'tile')
      if (kind === 'bath') assert.equal(rf.finish, 'wet')
    }
  }
})

test('furnishing is deterministic and never changes the plan', () => {
  const d = designs['default 15x18']
  const before = JSON.stringify(d)
  assert.deepEqual(furnishFloor(d.floors[0]), furnishFloor(d.floors[0]))
  assert.equal(JSON.stringify(d), before)
})

test('the terrace: the stair headroom room encloses the stair; tank and pergola stay clear', () => {
  for (const [name, d] of Object.entries(designs)) {
    const t = terraceLayout(d)
    if (!t) continue
    const top = d.floors[d.floors.length - 1]
    if (top.stair && t.mumty) assert.deepEqual(t.mumty, top.stair.rect, name)
    if (t.tank && t.mumty) assert.ok(!hit(t.tank, t.mumty), `${name}: tank on the stair room`)
    if (t.pergola) for (const r of [t.mumty, t.tank].filter(Boolean)) assert.ok(!hit(t.pergola, r), `${name}: pergola clash`)
    for (const r of [t.mumty, t.tank, t.pergola].filter(Boolean)) {
      const o = t.outline
      assert.ok(r.x >= o.x && r.y >= o.y && r.x + r.w <= o.x + o.w && r.y + r.h <= o.y + o.h, `${name}: roof item off the roof`)
    }
  }
})

test('the 2D terrace and the 3D model share one stair headroom room', () => {
  const d = designs['default 15x18']
  const t = terraceLayout(d)
  assert.ok(t?.mumty, 'the default house has a flat roof with a stair room')
  const m = buildMassing(d)
  const north = m.boxes.find((b) => b.id === 'mumty-n')
  const west = m.boxes.find((b) => b.id === 'mumty-w')
  assert.ok(north && west)
  // plan mm → world metres is a fixed offset + scale; compare spans, which are offset-free
  assert.ok(Math.abs(north.size[0] - t.mumty.w / 1000) < 1e-6, 'same width')
  assert.ok(Math.abs(west.size[2] - t.mumty.h / 1000) < 1e-6, 'same depth')
})

test('a pitched top roof has no terrace', () => {
  const d = generate(compile(briefSchema.parse({ style: { character: 'modern-kerala' } })))
  const top = d.floors[d.floors.length - 1]
  if (top.roof.kind !== 'flat' && top.roof.kind !== 'flat-parapet') assert.equal(terraceLayout(d), null)
})

/* Modern box: the default 3D style keeps one look across seeds and rerolls */

import { defaultBrief as freshBrief } from '../src/lib/model/brief.ts'
import { THEMES } from '../src/lib/model/themes.ts'
import { varyExterior, selectExteriorDirections } from '../src/lib/engine/variation.ts'
import { STYLE_FACTOR } from '../src/lib/cost/rates.ts'

test('new briefs default to the modern box; saved briefs keep their style', () => {
  assert.equal(freshBrief().style.character, 'modern-box')
  assert.equal(briefSchema.parse({ style: { character: 'modern-kerala' } }).style.character, 'modern-kerala')
  assert.equal(STYLE_FACTOR['modern-box'], 1, 'the default style is the cost reference')
})

test('the modern box keeps its look on every seed and every reroll', () => {
  const t = THEMES['modern-box']
  assert.equal(t.accents.railStyle, 'glass')
  assert.equal(t.roofBias, 'flat')
  assert.equal(t.massing.chajjaMm, 0)
  assert.equal(t.windows.sillMm, 0, 'floor-to-ceiling glazing')
  assert.ok(t.modern && t.modern.cantileverMm > 0 && !t.modern.baffleScreen && !t.modern.featureTower)
  const plan = generate(compile(freshBrief()))
  for (const level of ['subtle', 'balanced', 'bold']) {
    for (let seed = 1; seed <= 30; seed++) {
      const dna = varyExterior(plan, seed, level).dna
      assert.equal(dna.styleFamily, 'modern-box', `${level}/${seed}`)
      assert.ok(['floating-box', 'corner-feature'].includes(dna.facadeComposition), `${level}/${seed}`)
      assert.equal(dna.balconyDesign, 'glass-floating')
      assert.equal(dna.shadingSystem, 'none')
      assert.ok(['charcoal-oak', 'warm-stone', 'lime-plaster'].includes(dna.materialPalette))
    }
  }
})

test('the modern box still offers four distinct directions, even on subtle', () => {
  const plan = generate(compile(freshBrief()))
  for (const level of ['subtle', 'balanced', 'bold']) assert.equal(selectExteriorDirections(plan, 4, level).length, 4, level)
})

test('the modern box 3D model has glass rails, the oversailing frame and a roof pergola, and no fins', () => {
  const b = freshBrief()
  b.site.plotWidth = 18
  b.site.plotDepth = 24
  const d = generate(compile(b))
  const boxes = buildMassing(d).boxes
  const has = (re) => boxes.some((x) => re.test(x.id))
  assert.ok(boxes.some((x) => x.kind === 'glass'), 'glazing')
  assert.ok(has(/^cant-1b\d+$/), 'the upper floor oversails the ground floor at the front')
  assert.equal(new Set(boxes.map((x) => x.id)).size, boxes.length, 'no duplicate 3D ids')
  if (d.floors.some((f) => f.rooms.some((r) => r.id.startsWith('balcony')))) assert.ok(has(/^balg-/), 'frameless glass balcony rail')
  assert.ok(!has(/baffle|fin-/), 'no brise-soleil fins')
  if (terraceLayout(d)?.pergola) assert.ok(has(/^perg-/), 'roof pergola')
  assert.ok(boxes.every((x) => [...x.pos, ...x.size].every(Number.isFinite)))
})