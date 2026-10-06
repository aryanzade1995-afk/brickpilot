import assert from 'node:assert/strict'
import test from 'node:test'
import { briefSchema } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { roomSpecs } from '../src/lib/render/roomSpecs.ts'

const brief = briefSchema.parse({ specs: { overrides: { 'floor-living': 'italian-marble', 'interior-paint-colour': '#7A9A8B', 'false-ceiling': 'ceiling-slats', 'bath-wall-tiles': 'wall-subway' } } })
const design = generate(compile(brief))
const room = (level, re) => design.floors[level].rooms.find((r) => re.test(r.id))

test('the finishes chosen on Finishes & Cost reach the room: colours, floor, ceiling, tiles', () => {
  const living = roomSpecs(design, brief, 0, room(0, /living/).id)
  assert.equal(living.look.wall, '#7A9A8B')
  assert.match(living.statement, /Italian marble/)
  assert.match(living.statement, /mid green/)
  const bath = roomSpecs(design, brief, 0, room(0, /bath/i).id)
  assert.match(bath.statement, /Subway ceramic wall tile/)
  assert.ok(bath.lines.some((l) => l.item === 'sanitary'))
  const lounge = roomSpecs(design, brief, 1, room(1, /lounge|bed/).id)
  assert.equal(lounge.look.ceil, '#B07C48', 'a timber slat ceiling is drawn as timber')
})
