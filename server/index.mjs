import { handleCostShareRequest } from './cost-shares.mjs'
/*
 * Formstead server — serves the built SPA and proxies the image-model API
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
import { generateInteriorWithFallback, generateBuildingWithFallback, buildingRenderHealth, providerName, resolveProvider } from './providers/index.mjs'
import { analyzeInspiration, healthy as geminiWebHealth } from './providers/gemini-web.mjs'
import { handleVillaRequest } from './villa-jobs.mjs'
import { generateVillaVisualizations, validateVillaReference } from './villa-visualizations.mjs'

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

const INSPIRATION_PROMPT = `Classify the villa architecture in this reference image. Return only JSON with one value for each key below. Read the image as design inspiration, never as a floor plan or geometry to copy.
styleFamily: modern-indian, contemporary-indian, luxury-modern, minimal-modern, tropical-modern, modern-kerala, kerala-contemporary, courtyard-modern, resort-luxury, neo-classical, contemporary-classical, urban-premium
facadeComposition: vertical-frame, horizontal-stack, floating-box, tower-and-wing, central-entry, asymmetric-entry, layered-facade, recessed-core, split-volume, portal-frame, courtyard-front, double-height-focus, corner-feature, stepped-composition, interlocking-volumes, frame-within-frame
entranceDesign: vertical-portal, horizontal-canopy, stone-pier, timber-screen, recessed-entry, floating-frame, column-portico, deep-shadow-entry
featureElement: stone-tower, timber-fins, metal-fins, deep-chajja, floating-slab, jaali-panel, planter-band, roof-pergola
roofDesign: flat, floating-flat, parapet-flat, pergola-terrace, hip, gable, mixed-flat-pitched, kerala-pitched
materialPalette: warm-stone, lime-plaster, earth, travertine-bronze, charcoal-oak, kerala-laterite, tropical-cream, classical-stone
windowTreatment: flush-frame, deep-reveal, projecting-frame, timber-surround, stone-surround, sunshade
balconyDesign: glass-floating, recessed, solid-parapet, metal-rail, timber-screened, planter-balcony
landscapeMood: minimal, formal, natural, lush-tropical, courtyard
Choose the closest listed value for every key. If a feature is not visible, choose a style-compatible value.`

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

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    })
    return res.end()
  }

  if (await handleCostShareRequest(req, res, readJson)) return

  if (await handleVillaRequest(req, res, readJson)) return

  if(req.method==='POST'&&req.url==='/api/villa-visualizations') {
    let reference
    try {reference=await readJson(req,48e6);validateVillaReference(reference)}
    catch(error) {console.warn('[villa-visualizations] Reference rejected:',error?.message);return send(res,400,{error:'Choose two views of the completed model.'})}
    const controller=new AbortController()
    const disconnect=()=>{if(!res.writableEnded)controller.abort()}
    res.once('close',disconnect)
    try {return send(res,200,await generateVillaVisualizations(reference,{signal:controller.signal}))}
    catch {if(!res.destroyed)return send(res,503,{error:'Visualizations are unavailable right now. Your 3D model is ready.'})}
    finally {res.removeListener('close',disconnect)}
    return
  }

  if (req.method === 'GET' && req.url === '/api/render/health') {
    return send(res, 200, await buildingRenderHealth())
  }

  if (req.method === 'GET' && req.url === '/api/inspiration/health') {
    geminiWebHealth().then((health) => send(res, 200, { provider: 'gemini-web', ...health }))
    return
  }

  if (req.method === 'POST' && req.url === '/api/inspiration') {
    readJson(req, 12e6).then(async (p) => {
      const { imageBase64, mimeType } = p || {}
      if (typeof imageBase64 !== 'string' || !imageBase64 ||
        !/^image\/(png|jpeg|webp)$/.test(mimeType) || !/^[A-Za-z0-9+/=]+$/.test(imageBase64))
        return send(res, 400, { error: 'Choose a PNG, JPEG or WebP inspiration image.' })
      const health = await geminiWebHealth()
      if (!health.reachable) return send(res, 503, { error: `Gemini Web bridge unavailable. ${health.note}` })
      try {
        const preferences = await analyzeInspiration({ imageBase64, mimeType, prompt: INSPIRATION_PROMPT })
        return send(res, 200, { preferences })
      } catch (error) {
        return send(res, 502, { error: String(error?.message || error) })
      }
    }).catch((error) => send(res, 400, { error: String(error?.message || error) }))
    return
  }

  if (req.method === 'POST' && req.url === '/api/render') {
    try {
      const p = await readJson(req,16e6)
      const validImage = x => typeof x === 'string' && x.length > 0 && /^[A-Za-z0-9+/=]+$/.test(x)
      if (!validImage(p.imageBase64) || typeof p.prompt !== 'string' || !p.prompt.trim())
        return send(res,400,{error:'imageBase64 and prompt are required'})
      if (p.mimeType && p.mimeType !== 'image/png') return send(res,400,{error:'Reference must be PNG'})
      if (p.edgeBase64 && !validImage(p.edgeBase64)) return send(res,400,{error:'Invalid edge map'})
      if (p.inspirationBase64 && (!validImage(p.inspirationBase64) || !/^image\/(png|jpeg|webp)$/.test(p.inspirationMimeType)))
        return send(res,400,{error:'Invalid inspiration image'})
      const seed = Number.isSafeInteger(p.seed) ? p.seed : 0
      const result = await generateBuildingWithFallback({beauty:p.imageBase64,edge:p.edgeBase64,
        positive:p.prompt,negative:'changed silhouette, extra floors, relocated doors or windows, solid rooftop blocks',
        params:{seed},inspiration:p.inspirationBase64 ? {data:p.inspirationBase64,mimeType:p.inspirationMimeType}:null})
      return send(res,200,result)
    } catch(error) {return send(res,400,{error:String(error?.message || error)})}
  }

  // ---- AI interior render (SDXL + ControlNet via ComfyUI, modular provider) ----
  if (req.method === 'GET' && req.url === '/api/interior/health') {
    resolveProvider()
      .then(({ activeId, reachable, note }) =>
        send(res, 200, { provider: activeId, reachable, note }),
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
          const out = await generateInteriorWithFallback({
            beauty,
            depth,
            edge,
            positive,
            negative,
            params,
            onProgress,
          }, (note) => sse('progress', { pct, stage: note }))
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
  const interior = providerName()
  console.log(
    `[formstead] http://localhost:${PORT}  static=${SERVE_STATIC ? 'dist' : 'off'}  ` +
      `render=gemini-web/comfyui/mock  interior=${interior}`,
  )
})
