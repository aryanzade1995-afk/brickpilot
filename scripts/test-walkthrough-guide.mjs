import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createGuideContext, guideRequestSchema, guideFacts } from '../src/lib/walkthrough/guide.ts'
import { GuideSpeechSession, canRecognize } from '../src/lib/walkthrough/guideSpeech.ts'
import { answerGuide, handleWalkthroughGuide } from '../server/walkthrough-guide.mjs'

const metadata = {
  planId: 'plan-guide-test', floors: [{ sourceId: 'F0', level: 0 }, { sourceId: 'F1', level: 1 }],
  rooms: [{ id: 'F0:R', floorId: 'F0', name: 'Bedroom', rectMm: { x: 0, y: 0, w: 4000, h: 3000 }, outdoor: false },
    { id: 'F1:R', floorId: 'F1', name: 'Bedroom', rectMm: { x: 0, y: 0, w: 5000, h: 3500 }, outdoor: false }],
  openings: [{ floorId: 'F0', kind: 'door', rooms: ['F0:R', null] }, { floorId: 'F0', kind: 'window', rooms: ['F0:R', null] },
    { floorId: 'F1', kind: 'door', rooms: ['F1:R', null] }],
}
const appearance = { specifications: [{ roomId: 'F0:R', finishes: { summary: [{ label: 'Flooring', value: 'Warm oak' }, { label: 'Wall paint', value: 'Linen' }] } },
  { roomId: 'F1:R', finishes: { summary: [{ label: 'Flooring', value: 'Stone' }] } }] }
const context = () => createGuideContext(metadata, appearance, 'F0:R')
const payload = () => ({ context: context(), question: 'Describe this room', language: 'en' })

test('room IDs disambiguate identical names on different floors; metres, openings and selected products stay source-derived', () => {
  const before = JSON.stringify({ metadata, appearance }), c = context(), upper = createGuideContext(metadata, appearance, 'F1:R')
  assert.equal(c.rooms[0].widthM, 4); assert.equal(c.rooms[0].areaM2, 12)
  assert.equal(c.rooms[0].doors, 1); assert.equal(c.rooms[0].windows, 1)
  assert.equal(upper.rooms.find(r => r.id === upper.currentRoomId).finishes[0].value, 'Stone')
  assert.match(guideFacts('Describe this room', upper, 'en'), /floor 1/)
  assert.equal(JSON.stringify({ metadata, appearance }), before)
  assert.match(guideFacts('What finishes are in this room?', c, 'en'), /Selected specifications:.*Warm oak.*Linen/)
})
test('changing one finish changes only that room context and leaves architecture untouched', () => {
  const next = structuredClone(appearance); next.specifications[0].finishes.summary[0].value = 'Marble'
  const a = context(), b = createGuideContext(metadata, next, 'F0:R')
  assert.equal(b.rooms[0].finishes[0].value, 'Marble'); assert.deepEqual(a.rooms[1], b.rooms[1])
  assert.deepEqual(a.rooms.map(({ finishes: _finishes, ...geometry }) => geometry), b.rooms.map(({ finishes: _finishes, ...geometry }) => geometry))
})
test('unknown dimensions and unsupported references are never replaced by believable defaults', () => {
  const source = structuredClone(metadata); source.rooms[0].rectMm.w = NaN
  const c = createGuideContext(source, undefined, 'missing')
  assert.equal(c.rooms[0].widthM, null); assert.equal(c.rooms[0].areaM2, null); assert.equal(c.currentRoomId, null)
  assert.match(guideFacts('Describe this room', c, 'en'), /Choose a room/)
  const invalid = payload(); invalid.context.currentRoomId = 'different-plan-room'
  assert.equal(guideRequestSchema.safeParse(invalid).success, false)
  const duplicate = payload(); duplicate.context.rooms.push(duplicate.context.rooms[0])
  assert.equal(guideRequestSchema.safeParse(duplicate).success, false)
})
test('context is allowlisted; customer/address/cost/render data never reaches the provider', () => {
  const data = createGuideContext({ ...metadata, client: 'PRIVATE', address: 'PRIVATE', costs: 9999, files: { glb: '/private' } }, appearance, 'F0:R')
  assert.doesNotMatch(JSON.stringify(data), /PRIVATE|costs|files/)
  assert.equal(guideRequestSchema.safeParse({ ...payload(), arbitraryPrompt: 'extra' }).success, false)
  assert.equal(guideRequestSchema.safeParse({ ...payload(), question: 'x'.repeat(601) }).success, false)
})
test('AI service reuses current identity; failure/empty replies are explicitly factual fallbacks in all languages', async () => {
  let received
  const answer = await answerGuide(payload(), { answer: async input => { received = input; return 'Bedroom is 4 by 3 metres.' } })
  assert.equal(received.context.currentRoomId, 'F0:R'); assert.equal(answer.mode, 'ai'); assert.equal(answer.planId, metadata.planId)
  for (const language of ['en', 'hi', 'mr']) {
    const fallback = await answerGuide({ ...payload(), language }, { answer: async () => { throw new Error('offline') } })
    assert.equal(fallback.mode, 'facts'); assert.match(fallback.answer, /Bedroom/); assert.match(fallback.answer, /4\.00/)
  }
  assert.equal((await answerGuide(payload(), { answer: async () => '' })).mode, 'facts')
  const controller = new AbortController(); controller.abort()
  await assert.rejects(answerGuide(payload(), { signal: controller.signal, answer: async () => { throw new Error('cancelled') } }))
})
test('API rejects invalid methods/room identities and safely returns bounded guide data', async () => {
  let calls = 0
  const server = createServer(async (req, res) => {
    const read = async request => { let data = ''; for await (const chunk of request) data += chunk; return JSON.parse(data) }
    await handleWalkthroughGuide(req, res, read, async p => { calls++; return { answer: 'Room facts', mode: 'facts', planId: p.context.planId, roomId: p.context.currentRoomId } })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/api/walkthrough-guide`
  try {
    assert.equal((await fetch(url)).status, 405)
    assert.equal((await fetch(url, { method: 'POST', body: JSON.stringify({ ...payload(), language: 'wrong' }) })).status, 422)
    const response = await fetch(url, { method: 'POST', body: JSON.stringify(payload()) })
    assert.equal(response.status, 200); assert.equal((await response.json()).roomId, 'F0:R'); assert.equal(calls, 1)
  } finally { await new Promise(resolve => server.close(resolve)) }
})

function fakeSpeech() {
  let recognition, utterance, cancelled = 0, started = 0
  class Recognition {
    constructor() { recognition = this }
    start() { started++ }
    abort() { this.aborted = true }
  }
  class Utterance { constructor(text) { this.text = text } }
  const env = { SpeechRecognition: Recognition, SpeechSynthesisUtterance: Utterance, speechSynthesis: {
    getVoices: () => [{ lang: 'en-IN' }, { lang: 'hi-IN' }, { lang: 'mr-IN' }], speak: u => { utterance = u }, cancel: () => cancelled++,
  } }
  const events = { listening: [], speaking: [], errors: [] }, session = new GuideSpeechSession(env, {
    listening: v => events.listening.push(v), speaking: v => events.speaking.push(v), error: e => events.errors.push(e),
  })
  return { env, session, events, get recognition() { return recognition }, get utterance() { return utterance }, get started() { return started }, get cancelled() { return cancelled } }
}
test('speech is opt-in, one utterance only, uses language and ignores stale callbacks after cancellation', () => {
  const fake = fakeSpeech(), texts = []
  assert.equal(fake.started, 0); assert.ok(canRecognize(fake.env))
  fake.session.listen('mr', text => texts.push(text))
  const recognition = fake.recognition, late = recognition.onresult
  assert.equal(recognition.lang, 'mr-IN'); assert.equal(recognition.continuous, false)
  recognition.onresult({ results: [{ isFinal: true, 0: { transcript: 'Describe this room' } }] })
  assert.deepEqual(texts, ['Describe this room']); assert.ok(recognition.aborted)
  fake.session.stop(); late({ results: [{ isFinal: true, 0: { transcript: 'stale' } }] })
  assert.equal(texts.length, 1)
  fake.session.speak('Hello', 'hi'); assert.equal(fake.utterance.lang, 'hi-IN')
  fake.session.dispose(); assert.equal(fake.cancelled, 1)
})
test('denied microphone and missing speech APIs keep typed interaction available; StrictMode rehearsal can reactivate', () => {
  const fake = fakeSpeech()
  fake.session.listen('en', () => assert.fail('Denied speech must not submit'))
  fake.recognition.onerror({ error: 'not-allowed' }); assert.match(fake.events.errors.at(-1), /permission was denied/)
  fake.session.dispose(); fake.session.activate(); fake.session.listen('en', () => {})
  assert.equal(fake.started, 2); fake.session.dispose()
  const errors = [], unsupported = new GuideSpeechSession({}, { listening: () => {}, speaking: () => {}, error: e => errors.push(e) })
  assert.equal(canRecognize({}), false); unsupported.listen('en', () => {}); unsupported.speak('Answer', 'en')
  assert.match(errors[0], /Type your question/); assert.match(errors[1], /shown as text/); unsupported.dispose()
})
