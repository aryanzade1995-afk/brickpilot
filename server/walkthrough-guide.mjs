import { guideRequestSchema, guideFacts } from '../src/lib/walkthrough/guide.ts'
import { answerWalkthrough } from './providers/gemini-web.mjs'

const send = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)) }
let active = 0
export async function answerGuide(payload, { answer = answerWalkthrough, signal } = {}) {
  const p = guideRequestSchema.parse(payload)
  try {
    const text = await answer({ question: p.question, context: p.context, language: p.language, signal })
    if (typeof text !== 'string' || !text.trim() || text.length > 4000) throw new Error('Invalid guide response')
    return { answer: text.trim(), mode: 'ai', planId: p.context.planId, roomId: p.context.currentRoomId }
  } catch (error) {
    if (signal?.aborted) throw error
    return { answer: guideFacts(p.question, p.context, p.language), mode: 'facts', planId: p.context.planId, roomId: p.context.currentRoomId }
  }
}
export async function handleWalkthroughGuide(req, res, readJson, respond = answerGuide) {
  if (new URL(req.url, 'http://local').pathname !== '/api/walkthrough-guide') return false
  if (req.method !== 'POST') { send(res, 405, { error: 'Use POST to ask the house guide.' }); return true }
  if (active >= 2) { send(res, 429, { error: 'The guide is busy. Please try again shortly.' }); return true }
  const controller = new AbortController(), disconnect = () => { if (!res.writableEnded) controller.abort() }
  res.on('close', disconnect); active++
  try {
    const payload = await readJson(req, 512000)
    const parsed = guideRequestSchema.safeParse(payload)
    if (!parsed.success) { send(res, 422, { error: 'Choose a valid room and ask a question of up to 600 characters.' }); return true }
    const result = await respond(parsed.data, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(24000)]) })
    if (!controller.signal.aborted) send(res, 200, result)
  } catch {
    if (!controller.signal.aborted && !res.destroyed) send(res, 503, { error: 'The guide could not respond. Please retry.' })
  } finally { active--; res.off('close', disconnect) }
  return true
}
