/** Rasterize a detached <svg> to a PNG data URL at a fixed 3:2 size. */
export async function rasterizeSvg(svg: SVGSVGElement, w = 1200, h = 800): Promise<string> {
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready
    } catch {
      /* fonts fall back — acceptable, the drawing is self-contained */
    }
  }

  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('width', String(w))
  clone.setAttribute('height', String(h))
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')

  const xml = new XMLSerializer().serializeToString(clone)
  const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml)

  const img = new Image()
  img.decoding = 'sync'
  await new Promise<void>((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('svg rasterization timed out')), 8000)
    img.onload = () => {
      clearTimeout(to)
      resolve()
    }
    img.onerror = () => {
      clearTimeout(to)
      reject(new Error('svg rasterization failed'))
    }
    img.src = src
  })

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  ctx.fillStyle = '#0b0b0c'
  ctx.fillRect(0, 0, w, h)
  const scale = Math.min(w / (img.width || w), h / (img.height || h))
  const dw = (img.width || w) * scale
  const dh = (img.height || h) * scale
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
  return canvas.toDataURL('image/png')
}
