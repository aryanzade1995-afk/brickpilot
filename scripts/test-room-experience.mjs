import test from 'node:test'
import assert from 'node:assert/strict'
import { createGuideContext } from '../src/lib/walkthrough/guide.ts'
import { describeRoom, suggestionCandidates, roomName } from '../src/lib/walkthrough/roomExperience.ts'
import { RoomAudioPlayer } from '../src/lib/walkthrough/roomAudio.ts'
import { roomInsight, roomAudio } from '../server/room-ai-service.mjs'
import { waveBuffer } from '../server/room-ai-worker.mjs'

const base = () => createGuideContext({ planId: 'room-experience-unit', floors: [{ sourceId: 'F0', level: 0 }, { sourceId: 'F1', level: 1 }],
  rooms: [{ id: 'K', sourceId: 'k', semanticId: 'kitchen', floorId: 'F0', name: 'Kitchen', rectMm: { x: 0, y: 0, w: 2400, h: 3300 }, outdoor: false },
    { id: 'B', sourceId: 'b', semanticId: 'bedroom', floorId: 'F1', name: 'Master bedroom', rectMm: { x: 0, y: 0, w: 4500, h: 4000 }, outdoor: false }], openings: [] },
{ specifications: [{ roomId: 'K', finishes: { walls: { color: '#D6DCCF' }, floor: { color: '#DDCCAA' }, summary: [
  { label: 'Kitchen flooring', value: 'Travertine-look porcelain' }, { label: 'Interior paint', value: 'Porcelain olive' }] } }] }, 'K')

test('room narration is natural, room-specific and includes selected finishes in English, Hindi and Marathi', () => {
  const context = base(), before = JSON.stringify(context)
  assert.match(describeRoom(context, 'en'), /cooking and preparation/)
  assert.match(describeRoom(context, 'en'), /Travertine-look porcelain/)
  assert.match(describeRoom(context, 'mr'), /स्वयंपाकघर/)
  assert.match(describeRoom(context, 'mr'), /हिरव्या/)
  assert.match(describeRoom(context, 'hi'), /रसोई/)
  assert.doesNotMatch(describeRoom(context, 'en'), /records \d+ door|Ask|question/)
  assert.equal(JSON.stringify(context), before)
  context.currentRoomId = 'B'
  assert.match(describeRoom(context, 'mr'), /पहिल्या मजल्यावरील मुख्य शयनकक्ष/)
  assert.doesNotMatch(describeRoom(context, 'mr'), /ट्रॅव्हर्टीन/)
})
test('unknown dimensions, missing finishes and outside-room positions do not create invented facts', () => {
  const context = base(); context.rooms[0].widthM = null; context.rooms[0].finishes = []
  assert.doesNotMatch(describeRoom(context, 'en'), /plan dimensions|Travertine|bright|sunlight/)
  context.currentRoomId = null; assert.equal(describeRoom(context, 'mr'), null); assert.deepEqual(suggestionCandidates(context, 'en'), [])
})
test('prayer, dining, utility and balcony descriptions keep the room purpose and localized name', () => {
  const context = base()
  for (const [name, word] of [['Pooja room', 'प्रार्थनेसाठी'], ['Dining', 'जेवण'], ['Utility', 'घरकामे'], ['Balcony', 'बाहेरील']]) {
    context.rooms[0].name = name; context.rooms[0].outdoor = name === 'Balcony'
    assert.match(describeRoom(context, 'mr'), new RegExp(word)); assert.ok(roomName(context.rooms[0], 'mr'))
  }
})
test('design proposals use actual wall palette and compact dimensions, with valid finish-room references', () => {
  const context = base(), before = JSON.stringify(context), candidates = suggestionCandidates(context, 'en')
  assert.ok(candidates.some(c => c.id === 'compact-room-clearance'))
  const kitchen = candidates.find(c => c.id === 'kitchen-material-balance')
  assert.equal(kitchen.palette[0].colour, '#D6DCCF'); assert.equal(kitchen.finishRoomKey, '0:kitchen'); assert.equal(kitchen.section, 'kitchen')
  assert.match(kitchen.reason, /travertine-look porcelain/); assert.equal(JSON.stringify(context), before)
  context.rooms[0].outdoor = true; context.rooms[0].name = 'Balcony'
  const outdoor = suggestionCandidates(context, 'en').find(c => c.id === 'outdoor-material-continuity')
  assert.ok(outdoor); assert.doesNotMatch(outdoor.body, /sofa|headboard|bedding/)
  context.rooms[0].name = 'Living room'; context.rooms[0].outdoor = false; context.rooms[0].widthM = 13.9; context.rooms[0].depthM = 3.3
  const longRoom = suggestionCandidates(context, 'en').find(c => c.id === 'long-living-zones')
  assert.ok(longRoom); assert.match(longRoom.body, /longer than it is wide/); assert.equal(longRoom.section, 'furniture-models')
})
test('local AI ranks bounded proposals; failed/invalid ranking is honestly labelled and cannot inject text or product links', async () => {
  const context = base()
  const result = await roomInsight(context, 'en', async () => ({ similarity: [0.6, 0.2, 0.1], text: '<script>bad</script>' }))
  assert.equal(result.mode, 'local-ai'); assert.equal(result.suggestion.id, 'kitchen-material-balance'); assert.doesNotMatch(JSON.stringify(result), /<script>/)
  const failContext = base(); failContext.planId += '-offline'
  const fallback = await roomInsight(failContext, 'mr', async () => { throw new Error('offline') })
  assert.equal(fallback.mode, 'design-rules'); assert.equal(fallback.model, null); assert.match(fallback.suggestion.title, /स्वयंपाकघर/)
  failContext.planId += '-invalid'
  assert.equal((await roomInsight(failContext, 'en', async () => ({ similarity: [NaN] }))).mode, 'design-rules')
})
test('AI cache cannot return another project identity, even for identical rooms', async () => {
  const first = base(), second = base(); first.planId = 'first-cache-project'; second.planId = 'second-cache-project'
  let calls = 0
  const rank = async () => { calls++; return { similarity: [0, 0, 0] } }
  assert.equal((await roomInsight(first, 'en', rank)).planId, first.planId)
  assert.equal((await roomInsight(second, 'en', rank)).planId, second.planId); assert.equal(calls, 2)
})
test('wave validation rejects silent, nonfinite and implausible output; valid neural audio is standard PCM', () => {
  assert.throws(() => waveBuffer(new Float32Array(24000)), /silent/)
  assert.throws(() => waveBuffer(Float32Array.of(NaN)), /Invalid/)
  const wave = waveBuffer(Float32Array.from({ length: 24000 }, (_, i) => Math.sin(i / 16) * .2))
  assert.equal(wave.toString('ascii', 0, 4), 'RIFF'); assert.equal(wave.readUInt32LE(24), 24000); assert.equal(wave.readUInt32LE(4) + 8, wave.length)
})
test('Marathi audio cache is source-bound and deduplicates generation without changing room data', async () => {
  const context = base(); context.planId = `unit-audio-${Date.now()}`
  const before = JSON.stringify(context); let calls = 0
  const synthesize = async text => { calls++; assert.match(text, /स्वयंपाकघर/); return { wav: waveBuffer(Float32Array.from({ length: 24000 }, (_, i) => Math.sin(i / 16) * .2)) } }
  const [a, b] = await Promise.all([roomAudio(context, 'mr', synthesize), roomAudio(context, 'mr', synthesize)])
  assert.equal(a.id, b.id); assert.equal(calls, 1); assert.equal(a.roomId, 'K'); assert.equal(a.language, 'mr')
  await roomAudio(context, 'mr', synthesize); assert.equal(calls, 1); assert.equal(JSON.stringify(context), before)
  context.rooms[0].finishes[0].value = 'Wood'
  const c = await roomAudio(context, 'mr', synthesize); assert.notEqual(c.id, a.id)
  await assert.rejects(roomAudio(context, 'en', synthesize), /supports Marathi/)
})
test('a late-decoded audio buffer cannot play after room change or Escape', async () => {
  let decode, starts = 0, stops = 0
  const context = { state: 'running', destination: {}, decodeAudioData: () => new Promise(resolve => { decode = resolve }),
    createBufferSource: () => ({ connect() {}, disconnect() {}, start() { starts++ }, stop() { stops++ } }) }
  const player = new RoomAudioPlayer(() => context)
  const old = player.play(new ArrayBuffer(4), () => {}); player.stop(); decode({})
  assert.equal(await old, false); assert.equal(starts, 0)
  const current = player.play(new ArrayBuffer(4), () => {}); decode({}); assert.equal(await current, true)
  player.stop(); assert.equal(starts, 1); assert.equal(stops, 1)
  const locked = new RoomAudioPlayer(() => ({ ...context, state: 'suspended' }))
  await assert.rejects(locked.play(new ArrayBuffer(4), () => {}), /Tap Replay/)
})
