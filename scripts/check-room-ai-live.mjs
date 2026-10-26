import { createGuideContext } from '../src/lib/walkthrough/guide.ts'
import { roomInsight, roomAudio } from '../server/room-ai-service.mjs'
import { ROOM_AUDIO_ROOT } from '../server/room-ai-models.mjs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
const context = createGuideContext({ planId: 'room-ai-smoke-v1', floors: [{ sourceId: 'ground', level: 0 }], rooms: [
  { id: 'kitchen', sourceId: 'kitchen', semanticId: 'kitchen', floorId: 'ground', name: 'Kitchen', rectMm: { x: 0, y: 0, w: 2400, h: 3300 }, outdoor: false }], openings: [] },
{ specifications: [{ roomId: 'kitchen', finishes: { walls: { color: '#D6DCCF' }, floor: { color: '#D7CABB' }, summary: [
  { label: 'Kitchen flooring', value: 'Travertine-look porcelain' }, { label: 'Interior paint', value: 'Porcelain olive' }] } }] }, 'kitchen')
try {
  const started = Date.now(), insight = await roomInsight(context, 'en'), voice = await roomAudio(context, 'mr')
  const longContext = structuredClone(context); longContext.planId = 'long-living-smoke'; longContext.rooms[0].name = 'Living room'; longContext.rooms[0].widthM = 13.9; longContext.rooms[0].depthM = 3.3; longContext.rooms[0].areaM2 = 45.87
  const longInsight = await roomInsight(longContext, 'en')
  const bytes = await readFile(join(ROOM_AUDIO_ROOT, `${voice.id}.wav`))
  let square = 0, peak = 0
  for (let i = 44; i < bytes.length; i += 2) { const s = bytes.readInt16LE(i) / 32768; square += s * s; peak = Math.max(peak, Math.abs(s)) }
  const result = { mode: insight.mode, suggestion: insight.suggestion.id, longRoomMode: longInsight.mode, longRoomSuggestion: longInsight.suggestion.id, model: voice.model, wavBytes: bytes.length, sampleRate: bytes.readUInt32LE(24),
    seconds: (bytes.length - 44) / 48000, peak, rms: Math.sqrt(square / ((bytes.length - 44) / 2)), elapsedMs: Date.now() - started }
  console.log(JSON.stringify(result, null, 2))
  if (result.mode !== 'local-ai' || result.longRoomMode !== 'local-ai' || result.longRoomSuggestion !== 'long-living-zones' || result.seconds < 1 || result.rms < .001) process.exitCode = 1
} catch (error) { console.error(String(error.message)); process.exitCode = 1 }
process.exit(process.exitCode || 0)
