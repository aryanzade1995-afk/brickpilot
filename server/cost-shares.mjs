import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { publicSheetSchema } from '../src/lib/cost/deliverySchemas.ts'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const send = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(data)) }
export async function handleCostShareRequest(req, res, readJson, directory = resolve(process.env.COST_SHARE_DIR || resolve(ROOT, 'output/cost-shares'))) {
  const path = new URL(req.url, 'http://local').pathname
  if (!path.startsWith('/api/cost-shares')) return false
  if (path === '/api/cost-shares' && req.method === 'POST') {
    try {
      const parsed = publicSheetSchema.safeParse(await readJson(req, 2e6))
      if (!parsed.success) { send(res, 400, { error: 'The specification sheet is incomplete. Refresh your estimate and try again.' }); return true }
      const snapshot = { ...parsed.data, createdAt: new Date().toISOString() }
      const token = randomBytes(32).toString('hex')
      await mkdir(directory, { recursive: true })
      await writeFile(resolve(directory, `${token}.json`), JSON.stringify(snapshot), { flag: 'wx' })
      send(res, 201, { path: `/share/finishes/${token}` })
    } catch { send(res, 400, { error: 'The read-only sheet could not be saved. Please try again.' }) }
    return true
  }
  const match = path.match(/^\/api\/cost-shares\/([a-f0-9]{64})$/)
  if (!match) { send(res, 404, { error: 'Sheet not found' }); return true }
  if (req.method !== 'GET') { send(res, 405, { error: 'This shared sheet is read-only.' }); return true }
  try { send(res, 200, publicSheetSchema.parse(JSON.parse(await readFile(resolve(directory, `${match[1]}.json`), 'utf8')))) }
  catch { send(res, 404, { error: 'This shared sheet is no longer available.' }) }
  return true
}
