/*
 * BrickPilot server — serves the built SPA and proxies the image-model API
 * so the key stays server-side. Zero dependencies (Node ≥ 18, global fetch).
 * Loads server/.env itself.
 *
 *   POST /api/render          { imageBase64, mimeType?, prompt } -> { imageBase64, mimeType }
 *   GET  /api/render/health                                      -> { ok, configured, mock, model }
 *   GET  /*                    -> static file from ../dist, SPA-fallback to index.html
 *
 * In dev the Vite server handles the SPA and proxies /api here; in production
 * (e.g. Render) this one process does both, listening on $PORT.
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveProvider } from './providers/index.mjs'

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

// Render injects PORT; keep the old var as a local fallback.
const PORT = Number(process.env.PORT || process.env.RENDER_PROXY_PORT || 8787)
const KEY = process.env.GEMINI_API_KEY || ''
const MODEL = process.env.RENDER_MODEL || 'gemini-2.5-flash-image'
const MOCK = process.env.RENDER_MOCK === '1'
const ENDPOINT = (key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`

const DIST = fileURLToPath(new URL('../dist/', import.meta.url))
const SERVE_STATIC = existsSync(join(DIST, 'index.html'))

const send = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
  res.end(JSON.stringify(obj))
}

const readJson = (req, cap = 16e6) =>
  new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (c) => {
      body += c
      if (body.length > cap) {
        req.destroy()
        reject(new Error('request body too large'))
      }
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(body))
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

function serveStatic(req, res) {
  let pathname = '/'
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  } catch {
    /* keep default */
  }

  // resolve inside DIST, defeating "../" traversal
  const rel = normalize(pathname).replace(/^(\.\.[/\\])+/, '')
  let filePath = join(DIST, rel)
  if (!filePath.startsWith(DIST)) filePath = join(DIST, 'index.html')

  let isFile = existsSync(filePath) && statSync(filePath).isFile()
  // unknown path with no extension (a client route) -> SPA fallback
  if (!isFile) {
    filePath = join(DIST, 'index.html')
    isFile = existsSync(filePath)
  }
  if (!isFile) return send(res, 404, { error: 'not built — run `npm run build`' })

  const ext = extname(filePath).toLowerCase()
  const headers = { 'content-type': MIME[ext] || 'application/octet-stream' }
  // hashed assets are immutable; the HTML shell must always revalidate
  if (filePath.startsWith(join(DIST, 'assets')) && ext !== '.html') {
    headers['cache-control'] = 'public, max-age=31536000, immutable'
  } else {
    headers['cache-control'] = 'no-cache'
  }

  res.writeHead(200, headers)
  if (req.method === 'HEAD') return res.end()
  createReadStream(filePath).pipe(res)
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

  if (req.method === 'POST' && req.url === '/api/render') {
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
            contents: [
              { parts: [{ text: prompt }, { inlineData: { mimeType, data: imageBase64 } }] },
            ],
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
    return
  }

  // ---- AI interior render (SDXL + ControlNet via ComfyUI, modular provider) ----
  if (req.method === 'GET' && req.url === '/api/interior/health') {
    resolveProvider()
      .then(({ id, reachable, note, usingMock }) =>
        send(res, 200, { provider: usingMock && id !== 'mock' ? `mock (${id} offline)` : id, reachable, note }),
      )
      .catch((e) => send(res, 200, { provider: 'error', reachable: false, note: String(e?.message || e) }))
    return
  }

  if (req.method === 'POST' && req.url === '/api/interior') {
    readJson(req, 40e6)
      .then(async (p) => {
        const { beauty, depth, edge, positive, negative = '', params = {} } = p || {}
        if (!beauty || !depth || !edge || !positive) {
          return send(res, 400, { error: 'beauty, depth, edge and positive are required' })
        }
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'access-control-allow-origin': '*',
          'x-accel-buffering': 'no',
        })
        const sse = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        let pct = 0
        const onProgress = (p2, stage) => {
          if (typeof p2 === 'number') pct = Math.max(pct, Math.min(99, p2))
          sse('progress', { pct, stage: stage || '' })
        }
        const ping = setInterval(() => res.write(': keep-alive\n\n'), 15000)
        try {
          const r = await resolveProvider()
          if (r.usingMock && r.id !== 'mock') sse('progress', { pct: 2, stage: r.note })
          const out = await r.provider.generateInterior({
            beauty,
            depth,
            edge,
            positive,
            negative,
            params,
            onProgress,
          })
          sse('done', { imageBase64: out.imageBase64, mimeType: out.mimeType || 'image/png', meta: out.meta || {} })
        } catch (e) {
          sse('error', { error: String(e?.message || e) })
        } finally {
          clearInterval(ping)
          res.end()
        }
      })
      .catch((e) => send(res, 400, { error: String(e?.message || e) }))
    return
  }

  if ((req.method === 'GET' || req.method === 'HEAD') && SERVE_STATIC) {
    return serveStatic(req, res)
  }

  return send(res, 404, { error: 'not found' })
})

server.listen(PORT, () => {
  const interior = (process.env.INTERIOR_PROVIDER || 'comfyui').toLowerCase()
  console.log(
    `[brickpilot] http://localhost:${PORT}  static=${SERVE_STATIC ? 'dist' : 'off'}  ` +
      `render=${MOCK ? 'mock' : KEY ? 'gemini' : 'MISSING'}  interior=${interior}`,
  )
})
