import { parentPort } from 'node:worker_threads'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as ort from 'onnxruntime-node'
import { ROOM_MODEL_ROOT } from './room-ai-models.mjs'

let voice, embedder
async function voiceRuntime() {
  if (!voice) voice = (async () => {
    const [{ default: init }, config, bytes, session] = await Promise.all([
      import('@echogarden/espeak-ng-emscripten'), readFile(join(ROOM_MODEL_ROOT, 'config.json'), 'utf8').then(JSON.parse),
      readFile(join(ROOM_MODEL_ROOT, 'voice.bin')),
      ort.InferenceSession.create(join(ROOM_MODEL_ROOT, 'model.onnx'), { executionProviders: ['cpu'], intraOpNumThreads: 2, interOpNumThreads: 1, logSeverityLevel: 3 }),
    ])
    const module = await init(), phonemes = new module.eSpeakNGWorker(); phonemes.set_voice('mr')
    if (bytes.length !== 510 * 256 * 4) throw new Error('Invalid Marathi voicepack')
    return { phonemes, vocab: config.vocab, voice: new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), session }
  })().catch(error => { voice = null; throw error })
  return voice
}
async function embeddings() {
  if (!embedder) embedder = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers')
    env.localModelPath = ROOM_MODEL_ROOT; env.allowRemoteModels = false
    return pipeline('feature-extraction', 'room-embedding', { local_files_only: true, dtype: 'q8', device: 'cpu',
      session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 } })
  })().catch(error => { embedder = null; throw error })
  return embedder
}
function segments(text) {
  const words = text.replace(/[।!?]/g, '. ').split(/\s+/), result = []; let part = ''
  for (const word of words) {
    if (part.length + word.length > 105 && part) { result.push(part); part = '' }
    part += (part ? ' ' : '') + word
    if (/[^\d]\.$/.test(word) && part.length > 35) { result.push(part); part = '' }
  }
  if (part) result.push(part)
  return result
}
export function waveBuffer(samples, rate = 24000) {
  let peak = 0
  for (const value of samples) { if (!Number.isFinite(value)) throw new Error('Invalid voice waveform'); peak = Math.max(peak, Math.abs(value)) }
  if (peak < .0001 || peak > 5 || samples.length < rate / 5 || samples.length > rate * 90) throw new Error('Voice output is silent or outside supported limits')
  const bytes = Buffer.alloc(44 + samples.length * 2), gain = peak > .98 ? .98 / peak : 1
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28)
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i++) bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i] * gain)) * 32767), 44 + i * 2)
  return bytes
}
async function narrate(text) {
  if (typeof text !== 'string' || text.length > 1600 || !/[\u0900-\u097f]/.test(text)) throw new Error('Unsupported narration text')
  const runtime = await voiceRuntime(), chunks = []; let length = 0
  for (const part of segments(text)) {
    // eSpeak supplies IPA only. The neural Hugging Face model supplies all audio.
    const ipa = runtime.phonemes.synthesize_ipa(part).ipa.replace(/\([a-z-]+\)/g, '').replace(/_/g, '').replace(/\s+/g, ' ').trim()
      .replace(/dʒ/g, 'ʤ').replace(/tʃ/g, 'ʧ').replace(/ɹ/g, 'ɾ').replace(/ɪ/g, 'i')
    const symbols = Array.from(ipa), ids = symbols.filter(p => runtime.vocab[p] !== undefined).map(p => runtime.vocab[p])
    if (!ids.length || ids.length > 480 || ids.length < symbols.length * .85) throw new Error('Unsupported Marathi pronunciation sequence')
    const wrapped = BigInt64Array.from([0, ...ids, 0], n => BigInt(n)), style = runtime.voice.slice(ids.length * 256, (ids.length + 1) * 256)
    const output = await runtime.session.run({ input_ids: new ort.Tensor('int64', wrapped, [1, wrapped.length]),
      style: new ort.Tensor('float32', style, [1, 256]), speed: new ort.Tensor('float32', Float32Array.of(1), [1]) })
    const duration = output.pred_dur?.data, raw = output.audio.data
    const start = duration ? Number(duration[0]) * 600 : 0, end = raw.length - (duration ? Number(duration[duration.length - 1]) * 600 : 0)
    const audio = Float32Array.from(raw.slice(start, Math.max(start, end)))
    chunks.push(audio, new Float32Array(2880)); length += audio.length + 2880
    if (length > 24000 * 90) throw new Error('Narration is too long')
  }
  const samples = new Float32Array(length); let offset = 0
  for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length }
  return { wav: waveBuffer(samples), durationSeconds: length / 24000 }
}
async function rank({ query, candidates }) {
  const extractor = await embeddings(), output = await extractor([query, ...candidates], { pooling: 'mean', normalize: true })
  const rows = output.tolist(), similarity = rows.slice(1).map(row => row.reduce((sum, n, i) => sum + n * rows[0][i], 0))
  if (similarity.some(n => !Number.isFinite(n))) throw new Error('Invalid room analysis')
  return { similarity }
}
let queue = Promise.resolve()
parentPort?.on('message', ({ id, kind, payload }) => {
  queue = queue.then(async () => {
    try { const result = kind === 'voice' ? await narrate(payload.text) : await rank(payload); parentPort.postMessage({ id, result }) }
    catch (error) { parentPort.postMessage({ id, error: String(error.message).slice(0, 200) }) }
  })
})
