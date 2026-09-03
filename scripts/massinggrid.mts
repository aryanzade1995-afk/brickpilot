/**
 * massinggrid.mts — render 20 seeded villas as one contact sheet so the
 * structural diversity of the massing grammar is visually verifiable.
 *
 *   npx tsx scripts/massinggrid.mts [seeds=20] [diversity=high] > massing-grid.html
 *   # then open massing-grid.html
 *
 * Each cell draws every storey's footprint (a rect-union) stacked back-to-front
 * with the courtyard void cut out, plus the massing type, storeys and score.
 */
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/index.ts'
import { validate } from '../src/lib/rules/index.ts'
import { MASSING_LABEL } from '../src/lib/engine/massing/types.ts'

const SEEDS = Number(process.argv[2] ?? 20)
const DIV = (process.argv[3] ?? 'high') as 'low' | 'medium' | 'high' | 'extreme'
const CHARS = ['modernist', 'warm-minimal', 'kerala-contemporary'] as const

const cells: string[] = []
const typeCount = new Map<string, number>()

for (let seed = 1; seed <= SEEDS; seed++) {
  const b = defaultBrief()
  b.levels.storeys = 1 + (seed % 3)
  b.style.character = CHARS[seed % 3]
  b.style.diversity = DIV
  b.style.massing = 'auto'
  b.variation = seed * 7919
  const d = generate(compile(b))
  const r = validate(d)
  typeCount.set(d.massingType, (typeCount.get(d.massingType) ?? 0) + 1)

  // world bbox across all floors
  const all = d.floors.flatMap((f) => f.footprint)
  const minX = Math.min(...all.map((x) => x.x))
  const minY = Math.min(...all.map((x) => x.y))
  const maxX = Math.max(...all.map((x) => x.x + x.w))
  const maxY = Math.max(...all.map((x) => x.y + x.h))
  const W = maxX - minX
  const H = maxY - minY
  const S = 150 / Math.max(W, H)
  const dy = 14 // faux-iso vertical rise per storey (px)
  const pad = 14
  const vbW = W * S + pad * 2
  const vbH = H * S + dy * d.floors.length + pad * 2

  const court = d.floors[0].rooms.find((rm) => rm.id.startsWith('hall')) && null // (void cut is implicit in the blocks)
  void court

  const layers = [...d.floors]
    .map((f) => {
      const lvl = f.level
      const shade = 240 - lvl * 30
      return f.footprint
        .map((blk) => {
          const x = (blk.x - minX) * S + pad
          const y = (blk.y - minY) * S - lvl * dy + pad + dy * d.floors.length
          return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(blk.w * S).toFixed(1)}" height="${(blk.h * S).toFixed(1)}" fill="rgb(${shade},${shade},${shade})" stroke="#2a2a2a" stroke-width="1"/>`
        })
        .join('')
    })
    .join('')

  cells.push(`
  <div class="cell${r.hardChecksPass ? '' : ' bad'}">
    <svg viewBox="0 0 ${vbW.toFixed(0)} ${vbH.toFixed(0)}">${layers}</svg>
    <div class="meta">
      <b>${MASSING_LABEL[d.massingType]}</b>
      <span>seed ${b.variation} · ${b.style.character} · G+${b.levels.storeys}</span>
      <span class="${r.hardChecksPass ? 'ok' : 'bad'}">score ${r.score} · ${r.hardChecksPass ? 'hard checks pass' : r.counts.error + ' errors'} · ${d.builtAreaSqm.toFixed(0)} m²</span>
    </div>
  </div>`)
}

const summary = [...typeCount.entries()].sort((a, c) => c[1] - a[1]).map(([t, n]) => `${MASSING_LABEL[t as keyof typeof MASSING_LABEL]} ×${n}`).join(' · ')

process.stdout.write(`<!doctype html><meta charset="utf-8"><title>Massing grid — ${SEEDS} seeds</title>
<style>
  body{background:#12140f;color:#e7e4dc;font:13px/1.5 ui-sans-serif,system-ui;margin:0;padding:28px}
  h1{font:600 20px/1 ui-serif,Georgia;margin:0 0 4px}
  .sub{color:#9a978d;margin-bottom:20px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px}
  .cell{background:#1b1d17;border:1px solid #2c2e26;padding:10px;border-radius:6px}
  .cell.bad{border-color:#7a3b32}
  svg{display:block;background:#0d0e0b;border-radius:4px;width:100%;height:auto}
  .meta{margin-top:8px;display:flex;flex-direction:column;gap:2px}
  .meta b{font-size:13px}
  .meta span{color:#9a978d;font-size:11px}
  .ok{color:#7bb26a}.bad{color:#d98a7f}
</style>
<h1>Massing grammar — ${SEEDS} seeded villas</h1>
<div class="sub">diversity: ${DIV} · ${summary}</div>
<div class="grid">${cells.join('')}</div>
`)
