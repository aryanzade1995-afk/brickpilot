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
const SETTLE_MS = 2600

export function StyleSheet() {
  const designs = useMemo(() => {
    const b = defaultBrief()
    b.site.plotWidth = 18
    b.site.plotDepth = 22
    b.levels.storeys = 2
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

  useEffect(() => {
    if (i >= STYLES.length) {
      void composite(shots.current, setSheet)
      return
    }
    const t = setTimeout(() => {
      const el = document.querySelector<HTMLCanvasElement>('[data-massing-capture] canvas')
      try {
        shots.current[i] = el ? el.toDataURL('image/png') : ''
      } catch {
        shots.current[i] = ''
      }
      setI((v) => v + 1)
    }, SETTLE_MS)
    return () => clearTimeout(t)
  }, [i])

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
