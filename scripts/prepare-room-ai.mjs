import { mkdir, readFile, rename, writeFile, stat } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { pipeline as stream } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { ROOM_MODEL_ROOT, MARATHI_VOICE, ROOM_ANALYSIS_MODEL } from '../server/room-ai-models.mjs'

await mkdir(ROOM_MODEL_ROOT, { recursive: true })
for (const file of [...MARATHI_VOICE.files, ...ROOM_ANALYSIS_MODEL.files]) {
  const path = join(ROOM_MODEL_ROOT, file.name)
  const valid = async () => { try { const bytes = await readFile(path); return file.sha256 ? createHash('sha256').update(bytes).digest('hex') === file.sha256 : typeof JSON.parse(bytes) === 'object' } catch { return false } }
  if (await valid()) { console.log(`Already verified: ${file.name}`); continue }
  console.log(`Downloading ${file.name} from the pinned Hugging Face revision`)
  await mkdir(dirname(path), { recursive: true })
  for (let attempt = 0; ; attempt++) {
    const offset = await stat(path + '.download').then(s => s.size).catch(() => 0)
    try {
      const response = await fetch(file.url, { signal: AbortSignal.timeout(600000), headers: offset ? { Range: `bytes=${offset}-` } : {} })
      if (!response.ok || !response.body) throw new Error(`Could not download ${file.name}: ${response.status}`)
      await stream(Readable.fromWeb(response.body), createWriteStream(path + '.download', { flags: offset && response.status === 206 ? 'a' : 'w' })); break
    } catch (error) { if (attempt >= 3) throw error; console.log(`Resuming interrupted download: ${file.name}`) }
  }
  await rename(path + '.download', path)
  if (!await valid()) throw new Error(`Model checksum/format did not match: ${file.name}`)
}
const { pipeline, env } = await import('@huggingface/transformers')
env.localModelPath = ROOM_MODEL_ROOT; env.allowRemoteModels = false
const extractor = await pipeline('feature-extraction', 'room-embedding', { local_files_only: true, dtype: 'q8', device: 'cpu',
  session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 } })
await extractor.dispose()
await writeFile(join(ROOM_MODEL_ROOT, 'sources.json'), JSON.stringify({ voice: MARATHI_VOICE, analysis: ROOM_ANALYSIS_MODEL }, null, 2))
console.log('Marathi voice and room-analysis models are ready. No GPU is used.')
