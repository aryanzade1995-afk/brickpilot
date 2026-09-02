/* Gemini interior provider — image-edit grounded on the 3D beauty render.
 * No true ControlNet (Gemini can't take depth/edge conditioning), but it
 * keeps the composition of the reference. Kept as a modular fallback. */

const KEY = () => process.env.GEMINI_API_KEY || ''
const MODEL = () => process.env.RENDER_MODEL || 'gemini-2.5-flash-image'
const ENDPOINT = (key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL()}:generateContent?key=${key}`

export const id = 'gemini'

export async function healthy() {
  return {
    reachable: Boolean(KEY()),
    note: KEY() ? '' : 'GEMINI_API_KEY not set — add it to server/.env',
  }
}

export async function generateInterior({ beauty, positive, onProgress }) {
  const key = KEY()
  if (!key) throw new Error('GEMINI_API_KEY not configured')
  onProgress?.(20, 'submitting')
  const prompt =
    `${positive}\n\nEdit the supplied 3D reference into this photorealistic interior. ` +
    'Keep every wall, window and door exactly where the reference has them; change only materials, furniture, light and finish.'
  const r = await fetch(ENDPOINT(key), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: 'image/png', data: beauty } }] }],
    }),
  })
  onProgress?.(80, 'decoding')
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error?.message || `gemini error (${r.status})`)
  const part = j?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)
  if (!part) throw new Error('no image in gemini response')
  return {
    imageBase64: part.inlineData.data,
    mimeType: part.inlineData.mimeType || 'image/png',
    meta: { provider: 'gemini' },
  }
}
