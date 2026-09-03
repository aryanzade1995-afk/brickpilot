import { useEffect, useMemo, useRef, useState } from 'react'
import { compile } from '@/lib/model/canonical.ts'
import { defaultBrief, characterSchema, CHARACTER_LABEL, type Character } from '@/lib/model/brief.ts'
import { generate } from '@/lib/engine/index.ts'
import { MassingViewport } from '@/lib/render/CaptureCanvas.tsx'

/* ------------------------------------------------------------------ *
 *  /__styles — a dev-only contact sheet: the same villa (fixed brief,
 *  massing and seed) rendered in every character, ONE canvas at a time
 *  (8 live WebGL contexts lose each other), then composited into one
 *  PNG posted to /__shot. Not linked from the app.
 * ------------------------------------------------------------------ */

const STYLES = characterSchema.options as readonly Character[]
const CELL_W = 720
const CELL_H = 470
const COLS = 2
const GAP = 14
const LABEL_H = 34
const SETTLE_MS = 3200

export function StyleSheet() {
  const designs = useMemo(() => {
    const b = defaultBrief()
    b.site.plotWidth = 19
    b.site.plotDepth = 23
    b.levels.storeys = 1 // G+1 — the roof reads as most of the silhouette
    return STYLES.map((c) => ({
      c,
      design: generate(
        compile({ ...b, style: { ...b.style, character: c, massing: 'l-shape' as const } }),
        { massing: 'l-shape', seed: 7 },
      ),
    }))
  }, [])

  const [i, setI] = useState(0) // which style is on the live canvas
  const [sheet, setSheet] = useState<string | null>(null)
  const shots = useRef<string[]>([])

  const [bump, setBump] = useState(0)
  const tries = useRef(0)
  useEffect(() => {
    if (i >= STYLES.length) {
      void composite(shots.current, setSheet)
      return
    }
    const t = setTimeout(() => {
      const el = document.querySelector<HTMLCanvasElement>('[data-massing-capture] canvas')
      let url = ''
      try {
        url = el ? el.toDataURL('image/png') : ''
      } catch {
        url = ''
      }
      // a canvas that hasn't finished its first frames reads back near-black —
      // retry a few times before giving up on this style
      if ((url && el && !looksBlank(el)) || tries.current >= 4) {
        shots.current[i] = url
        tries.current = 0
        setI((v) => v + 1)
      } else {
        tries.current += 1
        setBump((v) => v + 1)
      }
    }, SETTLE_MS)
    return () => clearTimeout(t)
  }, [i, bump])

  const active = designs[Math.min(i, STYLES.length - 1)]

  return (
    <div style={{ background: '#12140f', minHeight: '100vh', padding: 16, color: '#e7e4dc', font: '13px system-ui' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginBottom: 10 }}>
        <b>Style contact sheet</b>
        <span style={{ color: '#9a978d' }}>
          {i < STYLES.length ? `rendering ${i + 1}/${STYLES.length} — ${CHARACTER_LABEL[active.c]}` : 'done'}
        </span>
      </div>

      {i < STYLES.length && (
        <div style={{ width: CELL_W, height: CELL_H }}>
          <MassingViewport key={active.c} design={active.design} character={active.c} view="collage" />
        </div>
      )}

      {sheet && (
        <div style={{ marginTop: 14 }}>
          <img src={sheet} alt="composite" style={{ maxWidth: '100%', border: '1px solid #2c2e26' }} />
        </div>
      )}
    </div>
  )
}

/** true if the canvas reads back as ~solid dark (first frames not drawn yet) */
function looksBlank(el: HTMLCanvasElement): boolean {
  try {
    const s = document.createElement('canvas')
    s.width = 24
    s.height = 24
    const c = s.getContext('2d')!
    c.drawImage(el, 0, 0, 24, 24)
    const px = c.getImageData(0, 0, 24, 24).data
    let bright = 0
    for (let k = 0; k < px.length; k += 4) bright += px[k] + px[k + 1] + px[k + 2]
    return bright / (24 * 24) < 90 // avg channel-sum per pixel
  } catch {
    return false
  }
}

async function composite(urls: string[], setSheet: (s: string) => void) {
  const rows = Math.ceil(STYLES.length / COLS)
  const W = COLS * CELL_W + (COLS + 1) * GAP
  const H = rows * (CELL_H + LABEL_H) + (rows + 1) * GAP
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d')!
  ctx.fillStyle = '#12140f'
  ctx.fillRect(0, 0, W, H)
  for (let k = 0; k < STYLES.length; k++) {
    const col = k % COLS
    const row = Math.floor(k / COLS)
    const x = GAP + col * (CELL_W + GAP)
    const y = GAP + row * (CELL_H + LABEL_H + GAP)
    if (urls[k]) {
      const img = new Image()
      await new Promise<void>((r) => {
        img.onload = () => r()
        img.onerror = () => r()
        img.src = urls[k]
      })
      ctx.drawImage(img, x, y, CELL_W, CELL_H)
    }
    ctx.fillStyle = '#1b1d17'
    ctx.fillRect(x, y + CELL_H, CELL_W, LABEL_H)
    ctx.fillStyle = '#e7e4dc'
    ctx.font = '600 18px ui-serif, Georgia, serif'
    ctx.textBaseline = 'middle'
    ctx.fillText(CHARACTER_LABEL[STYLES[k]], x + 14, y + CELL_H + LABEL_H / 2)
  }
  const out = cv.toDataURL('image/png')
  ;(window as unknown as { __sheet: string }).__sheet = out
  setSheet(out)
  fetch('/__shot', { method: 'POST', body: JSON.stringify({ name: 'style-sheet', dataUrl: out }) }).catch(() => {})
}
