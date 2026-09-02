/* ComfyUI interior provider — SDXL + ControlNet (depth + edge), img2img
 * on the 3D beauty render, run on a local ComfyUI. Zero dependencies:
 * Node 22 globals fetch / WebSocket / FormData / Blob.
 *
 * Swap in another backend by adding a sibling file with the same
 * { id, healthy, generateInterior } shape and registering it in index.mjs.
 */
import { readFileSync } from 'node:fs'

const base = () => (process.env.COMFYUI_URL || 'http://127.0.0.1:8188').replace(/\/+$/, '')
const wsBase = () => base().replace(/^http/, 'ws')

export const id = 'comfyui'

export async function healthy() {
  try {
    const r = await fetch(`${base()}/system_stats`, { signal: AbortSignal.timeout(2500) })
    return { reachable: r.ok, note: r.ok ? '' : `ComfyUI responded ${r.status}` }
  } catch {
    return { reachable: false, note: `ComfyUI unreachable at ${base()} — start it or set COMFYUI_URL` }
  }
}

/* ---- workflow assembly ---- */

const NUMERIC = new Set(['seed', 'steps', 'cfg', 'denoise', 'strength', 'start_percent', 'end_percent'])
const esc = (s) => JSON.stringify(String(s)).slice(1, -1)

function buildWorkflow({ depthName, edgeName, beautyName, positive, negative, params }) {
  const seed = Number(params.seed ?? Math.floor(Math.random() * 1e15))
  const sub = {
    '%CKPT%': esc(process.env.SDXL_CKPT || 'sd_xl_base_1.0.safetensors'),
    '%CN_DEPTH_MODEL%': esc(process.env.CN_DEPTH_MODEL || 'control-lora-depth-rank256.safetensors'),
    '%CN_CANNY_MODEL%': esc(process.env.CN_CANNY_MODEL || 'control-lora-canny-rank256.safetensors'),
    '%POSITIVE%': esc(positive),
    '%NEGATIVE%': esc(negative),
    '%DEPTH%': esc(depthName),
    '%EDGE%': esc(edgeName),
    '%BEAUTY%': esc(beautyName),
    '%SEED%': String(seed),
    '%STEPS%': String(params.steps ?? process.env.INTERIOR_STEPS ?? 28),
    '%CFG%': String(params.cfg ?? process.env.INTERIOR_CFG ?? 6.5),
    '%DENOISE%': String(params.denoise ?? process.env.INTERIOR_DENOISE ?? 0.75),
    '%CN_DEPTH_STR%': String(params.cnDepth ?? process.env.CN_DEPTH_STR ?? 0.85),
    '%CN_CANNY_STR%': String(params.cnCanny ?? process.env.CN_CANNY_STR ?? 0.55),
  }
  let s = readFileSync(new URL('../workflows/interior-sdxl.json', import.meta.url), 'utf8')
  for (const [k, v] of Object.entries(sub)) s = s.split(k).join(v)
  const graph = JSON.parse(s)
  // coerce the numeric inputs back from their (JSON-valid) string tokens
  for (const node of Object.values(graph)) {
    for (const [key, val] of Object.entries(node.inputs || {})) {
      if (NUMERIC.has(key) && typeof val === 'string' && /^-?\d+(\.\d+)?$/.test(val)) {
        node.inputs[key] = Number(val)
      }
    }
  }
  return { graph, seed }
}

/* ---- ComfyUI HTTP ---- */

async function uploadImage(b64, name) {
  const fd = new FormData()
  fd.append('image', new Blob([Buffer.from(b64, 'base64')], { type: 'image/png' }), name)
  fd.append('overwrite', 'true')
  const r = await fetch(`${base()}/upload/image`, { method: 'POST', body: fd })
  if (!r.ok) throw new Error(`ComfyUI upload failed (${r.status})`)
  const j = await r.json()
  return j.subfolder ? `${j.subfolder}/${j.name}` : j.name
}

async function submit(graph, clientId) {
  const r = await fetch(`${base()}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: clientId }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    const detail = j?.error?.message || j?.error || JSON.stringify(j?.node_errors || j).slice(0, 400)
    throw new Error(`ComfyUI rejected the graph: ${detail}`)
  }
  return j.prompt_id
}

async function fetchImage(ref) {
  const q = new URLSearchParams({
    filename: ref.filename,
    subfolder: ref.subfolder || '',
    type: ref.type || 'output',
  })
  const r = await fetch(`${base()}/view?${q}`)
  if (!r.ok) throw new Error(`ComfyUI /view failed (${r.status})`)
  const ab = await r.arrayBuffer()
  return {
    imageBase64: Buffer.from(ab).toString('base64'),
    mimeType: r.headers.get('content-type') || 'image/png',
  }
}

async function historyImage(promptId) {
  const r = await fetch(`${base()}/history/${promptId}`)
  if (!r.ok) return null
  const h = (await r.json())[promptId]
  if (!h?.outputs) return null
  for (const out of Object.values(h.outputs)) {
    if (out.images?.length) return out.images[out.images.length - 1]
  }
  return null
}

/** resolve with the output image ref: live WS progress, history poll as backstop */
function awaitResult(clientId, promptId, onProgress) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn, arg) => {
      if (settled) return
      settled = true
      clearInterval(poll)
      clearTimeout(timeout)
      try {
        ws.close()
      } catch {
        /* already closed */
      }
      fn(arg)
    }

    const timeout = setTimeout(() => finish(reject, new Error('ComfyUI generation timed out (5 min)')), 5 * 60 * 1000)

    const poll = setInterval(async () => {
      try {
        const img = await historyImage(promptId)
        if (img) finish(resolve, img)
      } catch {
        /* keep polling */
      }
    }, 2000)

    const ws = new WebSocket(`${wsBase()}/ws?clientId=${clientId}`)
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return
      let m
      try {
        m = JSON.parse(ev.data)
      } catch {
        return
      }
      const d = m.data || {}
      if (d.prompt_id && d.prompt_id !== promptId) return
      if (m.type === 'progress') {
        const pct = 15 + Math.round((d.value / Math.max(1, d.max)) * 78)
        onProgress?.(pct, 'sampling')
      } else if (m.type === 'executing' && d.node) {
        onProgress?.(undefined, `node ${d.node}`)
      } else if (m.type === 'executed' && d.output?.images?.length) {
        finish(resolve, d.output.images[d.output.images.length - 1])
      } else if (m.type === 'execution_error') {
        finish(reject, new Error(d.exception_message || 'ComfyUI execution error'))
      }
    }
    ws.onerror = () => {
      // WS is best-effort for progress; the history poll still resolves us
      onProgress?.(undefined, 'sampling (no live progress)')
    }
  })
}

export async function generateInterior({ beauty, depth, edge, positive, negative, params = {}, onProgress }) {
  const h = await healthy()
  if (!h.reachable) throw new Error(h.note)

  const clientId = `brickpilot-${Math.random().toString(36).slice(2)}`
  const tag = Date.now().toString(36)
  onProgress?.(5, 'uploading conditioning maps')
  const [depthName, edgeName, beautyName] = await Promise.all([
    uploadImage(depth, `bp_depth_${tag}.png`),
    uploadImage(edge, `bp_edge_${tag}.png`),
    uploadImage(beauty, `bp_beauty_${tag}.png`),
  ])

  onProgress?.(10, 'queuing')
  const { graph, seed } = buildWorkflow({ depthName, edgeName, beautyName, positive, negative, params })
  const promptId = await submit(graph, clientId)

  const ref = await awaitResult(clientId, promptId, onProgress)
  onProgress?.(96, 'fetching image')
  const img = await fetchImage(ref)
  return { ...img, meta: { provider: 'comfyui', seed, promptId } }
}
