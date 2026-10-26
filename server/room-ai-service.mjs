import { Worker } from 'node:worker_threads'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { ROOM_AUDIO_ROOT, MARATHI_VOICE, ROOM_ANALYSIS_MODEL } from './room-ai-models.mjs'
import { describeRoom, suggestionCandidates, ROOM_EXPERIENCE_VERSION } from '../src/lib/walkthrough/roomExperience.ts'

let worker, serial = 0
const pending = new Map(), audioJobs = new Map(), insightCache = new Map()
function run(kind, payload) {
  if (pending.size >= 6) return Promise.reject(new Error('Room narration is busy'))
  if (!worker) {
    worker = new Worker(new URL('./room-ai-worker.mjs', import.meta.url)); worker.unref()
    worker.on('message', ({ id, result, error }) => { const task = pending.get(id); if (!task) return; pending.delete(id); clearTimeout(task.timer); if (error) task.reject(new Error(error)); else task.resolve(result) })
    const fail = error => { worker = null; for (const task of pending.values()) { clearTimeout(task.timer); task.reject(error) } pending.clear() }
    worker.on('error', fail); worker.on('exit', code => { if (code) fail(new Error('Room voice worker exited')) })
  }
  const id = ++serial
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Room narration timed out')) }, 150000)
    pending.set(id, { resolve, reject, timer }); worker.postMessage({ id, kind, payload })
  })
}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export async function roomInsight(context, language, analyse = payload => run('rank', payload)) {
  const room = context.rooms.find(r => r.id === context.currentRoomId), candidates = suggestionCandidates(context, language)
  if (!room || !candidates.length) throw new Error('Walk into a recorded room first')
  const key = digest([ROOM_EXPERIENCE_VERSION, ROOM_ANALYSIS_MODEL.revision, context.planId, room, language])
  if (insightCache.has(key)) return insightCache.get(key)
  let mode = 'design-rules', similarity = candidates.map(() => 0)
  try {
    const result = await analyse({ query: `${room.name}. ${room.widthM ?? 'unknown'} by ${room.depthM ?? 'unknown'} metres. ${room.finishes.map(f => `${f.label}: ${f.value}`).join('. ')}`,
      candidates: candidates.map(c => c.analysisText) })
    if (result.similarity?.length !== candidates.length || result.similarity.some(n => !Number.isFinite(n))) throw new Error('Invalid candidate ranking')
    similarity = result.similarity; mode = 'local-ai'
  } catch { /* Specific, evidence-based design rules remain available if inference fails. */ }
  const best = candidates.map((c, i) => ({ c, score: c.score + similarity[i] * .2 })).sort((a, b) => b.score - a.score || a.c.id.localeCompare(b.c.id))[0].c
  const { score: _score, analysisText: _analysisText, ...suggestion } = best
  const result = { planId: context.planId, roomId: room.id, description: describeRoom(context, language), suggestion, mode,
    model: mode === 'local-ai' ? ROOM_ANALYSIS_MODEL.model : null }
  if (mode === 'local-ai') { if (insightCache.size >= 128) insightCache.delete(insightCache.keys().next().value); insightCache.set(key, result) }
  return result
}
export async function roomAudio(context, language, synthesize = text => run('voice', { text })) {
  if (language !== 'mr') throw new Error('This neural voice supports Marathi')
  const text = describeRoom(context, 'mr')
  if (!text) throw new Error('No recorded room for narration')
  const id = digest([ROOM_EXPERIENCE_VERSION, MARATHI_VOICE.revision, MARATHI_VOICE.voice, context.planId, context.currentRoomId, text])
  const path = join(ROOM_AUDIO_ROOT, `${id}.wav`)
  const existing = await readFile(path).catch(() => null)
  if (!existing || existing.length < 100 || existing.toString('ascii', 0, 4) !== 'RIFF') {
    if (!audioJobs.has(id)) {
      const job = (async () => { const { wav } = await synthesize(text); const bytes = Buffer.from(wav)
        if (bytes.length < 100 || bytes.length > 5e6 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error('Incomplete voice output')
        await mkdir(ROOM_AUDIO_ROOT, { recursive: true }); await writeFile(path + '.tmp', bytes); await rename(path + '.tmp', path)
      })().finally(() => audioJobs.delete(id)); audioJobs.set(id, job)
    }
    await audioJobs.get(id)
  }
  return { id, url: `/api/walkthrough-room/audio/${id}.wav`, planId: context.planId, roomId: context.currentRoomId, language, voice: MARATHI_VOICE.voice, model: MARATHI_VOICE.model }
}
export async function handleRoomExperience(req, res, readJson) {
  const pathname = new URL(req.url, 'http://local').pathname
  if (!pathname.startsWith('/api/walkthrough-room')) return false
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)) }
  const audio = /^\/api\/walkthrough-room\/audio\/([a-f0-9]{64})\.wav$/.exec(pathname)
  if (audio && req.method === 'GET') {
    const bytes = await readFile(join(ROOM_AUDIO_ROOT, `${audio[1]}.wav`)).catch(() => null)
    if (!bytes) send(404, { error: 'Room audio is unavailable' })
    else { res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': bytes.length, 'cache-control': 'private, max-age=31536000, immutable' }); res.end(bytes) }
    return true
  }
  if (!['/api/walkthrough-room', '/api/walkthrough-room/audio'].includes(pathname)) { send(404, { error: 'Room endpoint not found' }); return true }
  if (req.method !== 'POST') { send(405, { error: 'Use POST for room narration' }); return true }
  if (pending.size >= 6) { send(429, { error: 'Room narration is busy. Try replay shortly.' }); return true }
  try {
    const { roomExperienceRequest } = await import('../src/lib/walkthrough/roomExperience.ts')
    const parsed = roomExperienceRequest.safeParse(await readJson(req, 512000))
    if (!parsed.success || !parsed.data.context.currentRoomId) { send(422, { error: 'Choose a recorded room first' }); return true }
    const { context, language } = parsed.data
    const result = pathname.endsWith('/audio') ? await roomAudio(context, language) : await roomInsight(context, language)
    if (!res.destroyed) send(200, result)
  } catch { if (!res.destroyed) send(503, { error: 'Room narration is not ready. Replay in a moment.' }) }
  return true
}
