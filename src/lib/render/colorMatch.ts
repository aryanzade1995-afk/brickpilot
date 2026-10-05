/** Hold the AI image to the model's own colours. The generated image lines up pixel for pixel with the 3D capture it was
 *  made from, so its light, shadow and texture (luma) are kept while its colour (chroma) is taken mostly from the capture,
 *  softened slightly so edges do not fringe. A wooden door stays wood, beige walls stay beige. */
export async function matchModelColours(aiUrl: string, captureBase64: string, strength = 0.65): Promise<string> {
  const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('image load failed')); img.src = src
  })
  const [ai, cap] = await Promise.all([load(aiUrl), load(`data:image/png;base64,${captureBase64}`)])
  const w = cap.naturalWidth, h = cap.naturalHeight
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h
  const g = canvas.getContext('2d', { willReadFrequently: true })
  if (!g) return aiUrl
  g.filter = 'blur(1.5px)'; g.drawImage(cap, 0, 0, w, h); g.filter = 'none'
  const model = g.getImageData(0, 0, w, h).data
  g.drawImage(ai, 0, 0, w, h)
  const out = g.getImageData(0, 0, w, h), px = out.data
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], gr = px[i + 1], b = px[i + 2]
    const y = 0.299 * r + 0.587 * gr + 0.114 * b
    const cb = -0.168736 * r - 0.331264 * gr + 0.5 * b, cr = 0.5 * r - 0.418688 * gr - 0.081312 * b
    const mr = model[i], mg = model[i + 1], mb = model[i + 2]
    const mcb = -0.168736 * mr - 0.331264 * mg + 0.5 * mb, mcr = 0.5 * mr - 0.418688 * mg - 0.081312 * mb
    const ncb = cb + (mcb - cb) * strength, ncr = cr + (mcr - cr) * strength
    px[i] = y + 1.402 * ncr
    px[i + 1] = y - 0.344136 * ncb - 0.714136 * ncr
    px[i + 2] = y + 1.772 * ncb
  }
  g.putImageData(out, 0, 0)
  return canvas.toDataURL('image/jpeg', 0.92)
}
