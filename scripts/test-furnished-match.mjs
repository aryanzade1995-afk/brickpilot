import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { createInteriorScene, defaultConfiguration } from '../src/lib/interior/preview.ts'
import { interiorFinishes } from '../src/lib/interior/finishes.ts'
import { buildDollhouse } from '../src/lib/three/buildDollhouse.ts'
import { furnishedDresser } from '../src/lib/three/dressRoom.ts'

/* The furnished 3D view and the 360 preview show the same room: the same pieces in the same places, in the same
 * interior style and the same Finishes & Cost choices. Only the exploded cut-away differs. */

const brief = defaultBrief(); brief.site.plotWidth = 18; brief.site.plotDepth = 24
const design = generate(compile(brief), { seed: 41 })
const rooms = design.floors.flatMap((f) => f.rooms.filter((r) => !r.outdoor).map((r) => ({ floor: f, room: r })))
const find = (re) => rooms.find(({ room }) => re.test(`${room.id} ${room.name}`))
const withBrief = (b) => ({ ...design, model: { ...design.model, brief: b } })
const centreOf = (floor, room, doll) => {
  const baseY = doll.floors.find((f) => f.level === floor.level).baseY
  return [(room.rect.x + room.rect.w / 2 - design.model.plot.width / 2) / 1000, baseY, (room.rect.y + room.rect.h / 2 - design.model.plot.depth / 2) / 1000]
}

test('every designed piece of the 360 stands in the same place in the furnished view', () => {
  const t0 = performance.now()
  const doll = buildDollhouse(design, undefined, furnishedDresser(design, 'luxury', 'full'))
  const ms = performance.now() - t0
  assert.ok(ms < 4000, `dressing the whole house took ${ms.toFixed(0)} ms`)
  for (const re of [/living/i, /bed/i, /dining/i]) {
    const hit = find(re)
    if (!hit) continue
    const scene = createInteriorScene(design, 'fixture', { ...defaultConfiguration(hit.room.id, hit.floor.level), style: 'luxury', furnitureDensity: 'full' }, brief.style.character)
    assert.ok(scene.pieces.length > 0, `${hit.room.id} has a designed layout`)
    const [cx, , cz] = centreOf(hit.floor, hit.room, doll)
    for (const p of scene.pieces.filter((p) => !['curtain', 'art', 'pendant'].includes(p.type))) {
      const parts = doll.boxes.filter((b) => b.id.startsWith(`${hit.room.id}-${p.id}-`))
      assert.ok(parts.length, `${p.id} (${p.type}) is in the furnished view`)
      const near = parts.some((b) => Math.hypot(b.pos[0] - cx - p.x, b.pos[2] - cz - p.z) < Math.max(p.w, p.d))
      assert.ok(near, `${p.id} stands where the 360 puts it`)
    }
    // the luxury palette, as the 360's Blender renderer paints it
    assert.ok(doll.boxes.some((b) => b.id.startsWith(`${hit.room.id}-`) && b.look?.color === '#3B2A20'), 'luxury wood')
  }
})

test('a room takes its own floor, paint and tiles, and follows a change at once', () => {
  const bath = find(/bath|toilet/i)
  assert.ok(bath)
  const fin = interiorFinishes(design, bath.floor.level, bath.room.id)
  const doll = buildDollhouse(design, undefined, furnishedDresser(design, 'modern', 'medium'))
  const floor = doll.boxes.find((b) => b.id === `finish-floor-${bath.floor.level}-${bath.room.id}`)
  assert.equal(floor.look.color, fin.floor.color)
  if (fin.wallTiles) assert.ok(doll.boxes.some((b) => b.id.endsWith(`-${bath.room.id}-tile`) && b.look.color === fin.wallTiles.color), 'bathroom wall tiles')
  // the WC type chosen on Finishes & Cost: an Indian pan sits in the floor, its cistern high on the wall
  const b2 = structuredClone(brief)
  b2.specs = { ...(b2.specs ?? {}), overrides: { ...(b2.specs?.overrides ?? {}), sanitary: 'svc-toilet-indian' } }
  const chosen = interiorFinishes(withBrief(b2), bath.floor.level, bath.room.id)
  assert.equal(chosen.sanitary.wc, 'indian')
  {
    const doll2 = buildDollhouse(withBrief(b2), undefined, furnishedDresser(withBrief(b2), 'modern', 'medium'))
    const pan = doll2.boxes.find((b) => b.id === `${bath.room.id}-${bath.room.id}-toilet`)
    assert.ok(pan && pan.size[1] < 0.1, 'Indian pan in the floor')
  }
})

test('the exploded view keeps its trays', () => {
  const plain = buildDollhouse(design)
  const dressed = buildDollhouse(design, undefined, furnishedDresser(design, 'modern', 'medium'))
  assert.deepEqual(dressed.floors, plain.floors)
  assert.deepEqual(dressed.center, plain.center)
})

test('nothing stands above the cut walls, and the kitchen sink is set into the worktop', () => {
  let sinks = 0
  for (const seed of [41, 7, 19, 3, 11, 23]) {
    const d = generate(compile(brief), { seed })
    const doll = buildDollhouse(d, undefined, furnishedDresser(d, 'modern', 'full'))
    const wallTop = Math.max(...doll.boxes.filter((b) => b.mat === 'wall' && !b.look).map((b) => b.pos[1] + b.size[1] / 2 - doll.floors.reduce((y, f) => (f.baseY <= b.pos[1] + 0.05 ? f.baseY : y), 0)))
    for (const b of doll.boxes.filter((b) => !/^(slab|plinth)/.test(b.id))) {
      const base = doll.floors.reduce((y, f) => (f.baseY <= b.pos[1] + 0.05 ? f.baseY : y), 0)
      assert.ok(b.pos[1] + b.size[1] / 2 - base <= wallTop + 0.02, `${b.id} stands above the walls (seed ${seed})`)
    }
    const kitchen = d.floors.flatMap((f) => f.rooms).find((r) => /kitchen/i.test(`${r.id} ${r.name}`))
    // where the kitchen has a sink on its counter, it is the fitted sink (bowl, rim, opening), never a flat metal plate
    const flat = doll.boxes.some((b) => kitchen && b.id === `${kitchen.id}-${kitchen.id}-sink`)
    if (kitchen) assert.ok(!flat, `kitchen sink is fitted (seed ${seed})`)
    sinks += kitchen && doll.boxes.some((b) => b.id.startsWith(`${kitchen.id}-`) && b.id.includes('sink-bowl')) ? 1 : 0
  }
  assert.ok(sinks > 0, 'at least one kitchen shows its fitted sink')
})
