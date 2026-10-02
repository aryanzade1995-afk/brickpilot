/** Sobel on the (bottom-up) RGBA buffer of the normal pass → white lines on black. */
export function sobelToDataURL(buf: Uint8Array | Uint8ClampedArray, w: number, h: number, bottomUp = true): string {
  const lum = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sy = bottomUp ? h - 1 - y : y // flip: WebGL readPixels is bottom-up
      const i = (sy * w + x) * 4
      lum[y * w + x] = 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2]
    }
  }
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')!
  const img = ctx.createImageData(w, h)
  const at = (x: number, y: number) => lum[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx =
        -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) +
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)
      const gy =
        -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) +
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)
      const g = Math.min(255, Math.hypot(gx, gy))
      const v = g > 36 ? 255 : 0 // threshold to crisp lines
      const o = (y * w + x) * 4
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v
      img.data[o + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return out.toDataURL('image/png')
}

/** Pixel edges of the actual reference, not an RGB image labelled as ControlNet edges. */
export async function buildingEdgeMap(imageBase64: string): Promise<string> {
  const image = new Image()
  image.src = `data:image/png;base64,${imageBase64}`
  await image.decode()
  const scale = Math.min(1, 1024 / Math.max(image.width, image.height))
  const w = Math.max(1, Math.round(image.width * scale)), h = Math.max(1, Math.round(image.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(image, 0, 0, w, h)
  return sobelToDataURL(ctx.getImageData(0, 0, w, h).data, w, h, false).split(',')[1]
}
