/*
 * BrickPilot render proxy — keeps the image-model API key server-side.
 * Zero dependencies (Node ≥ 18, global fetch). Loads server/.env itself.
 *
 *   POST /api/render   { imageBase64, mimeType?, prompt }  -> { imageBase64, mimeType }
 *   GET  /api/render/health                                -> { ok, configured, mock, model }
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'

// --- load server/.env (no dependency, no --env-file flag needed) ---
try {
  const env = readFileSync(new URL('./.env', import.meta.url), 'utf8')
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/)
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = (m[2] ?? '').trim().replace(/^["']|["']$/g, '')
    }
  }
} catch {
  /* no .env — fine, fall back to real env / mock */
}

const PORT = Number(process.env.RENDER_PROXY_PORT || 8787)
const KEY = process.env.GEMINI_API_KEY || ''
const MODEL = process.env.RENDER_MODEL || 'gemini-2.5-flash-image'
const MOCK = process.env.RENDER_MOCK === '1'
const ENDPOINT = (key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`

const send = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
  res.end(JSON.stringify(obj))
}

const server = createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    })
    return res.end()
  }

  if (req.method === 'GET' && req.url === '/api/render/health') {
    return send(res, 200, { ok: true, configured: Boolean(KEY), mock: MOCK, model: MODEL })
  }

  if (req.method !== 'POST' || req.url !== '/api/render') {
    return send(res, 404, { error: 'not found' })
  }

  let body = ''
  req.on('data', (c) => {
    body += c
    if (body.length > 16e6) req.destroy()
  })
  req.on('end', async () => {
    let p
    try {
      p = JSON.parse(body)
    } catch {
      return send(res, 400, { error: 'invalid JSON body' })
    }
    const { imageBase64, mimeType = 'image/png', prompt } = p || {}
    if (!imageBase64 || !prompt) {
      return send(res, 400, { error: 'imageBase64 and prompt are required' })
    }
    // mock mode / no key configured → echo the source image so the flow is demoable
    if (MOCK || !KEY) {
      return send(res, MOCK ? 200 : 503, {
        imageBase64,
        mimeType,
        mock: true,
        note: KEY ? 'mock mode' : 'RENDER: API key not configured — showing the source reference',
      })
    }
    try {
      const r = await fetch(ENDPOINT(KEY), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: imageBase64 } }] }],
        }),
      })
      const j = await r.json()
      if (!r.ok) {
        return send(res, r.status, { error: j?.error?.message || `image model error (${r.status})` })
      }
      const part = j?.candidates?.[0]?.content?.parts?.find((x) => x.inlineData)
      if (!part) return send(res, 502, { error: 'no image in model response' })
      return send(res, 200, {
        imageBase64: part.inlineData.data,
        mimeType: part.inlineData.mimeType || 'image/png',
      })
    } catch (e) {
      return send(res, 502, { error: String(e?.message || e) })
    }
  })
})

server.listen(PORT, () => {
  console.log(
    `[render-proxy] http://localhost:${PORT}  model=${MODEL}  key=${KEY ? 'set' : 'MISSING'}  mock=${MOCK}`,
  )
})
