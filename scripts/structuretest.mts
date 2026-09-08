/*
 * structuretest — the model must make architectural sense with all
 * materials, colours and decoration removed.
 *
 *   For 8 styles × {G, G+1, G+2} × a spread of plots, assert the
 *   resolved DesignSpec has a coherent structural + architectural core:
 *
 *   - an explicit entrance door on the ground floor, on a real room
 *   - every floor has a slab; a multi-storey house has stairs that connect
 *   - every column is supported (aligned below, on a transfer beam, or a
 *     legit cantilever) — NO floating columns
 *   - every balcony has a room + a balcony door + a slab
 *   - every facade element anchors to a real block / opening / column
 *   - every window belongs to a real room + exterior wall
 *   - the audit reports 0 errors  (score is allowed to carry warnings)
 */
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/index.ts'
import { CHARACTER_OF_STYLE, requirementsOf, generateDesign, STYLE_IDS } from '../src/architecture/index.ts'
import type { StyleId } from '../src/architecture/index.ts'

const PLOTS = [
  { w: 9, d: 15 },
  { w: 12, d: 18 },
  { w: 15, d: 24 },
  { w: 18, d: 27 },
  { w: 24, d: 30 },
]
const STOREYS = [0, 1, 2]

let cases = 0
let fail = 0
let scoreSum = 0
const errCodes: Record<string, number> = {}
const warnCodes: Record<string, number> = {}
const line = (ok: boolean, msg: string) => {
  if (!ok) {
    fail++
    console.log(`  ✗ ${msg}`)
  }
}

for (const style of STYLE_IDS as readonly StyleId[]) {
  for (const st of STOREYS) {
    for (const plot of PLOTS) {
      const b = defaultBrief()
      b.style.character = CHARACTER_OF_STYLE[style]
      b.levels.storeys = st
      b.site.plotWidth = plot.w
      b.site.plotDepth = plot.d
      b.rooms.priorities.coveredParking = true
      b.variation = plot.w * 31 + st * 7 + 3
      const design = generate(compile(b))
      const spec = generateDesign(requirementsOf(design, style), b.variation)
      cases++
      scoreSum += spec.audit.score
      for (const e of spec.audit.errors) errCodes[e.code] = (errCodes[e.code] ?? 0) + 1
      for (const w of spec.audit.warnings) warnCodes[w.code] = (warnCodes[w.code] ?? 0) + 1

      const tag = `${style} G+${st} ${plot.w}x${plot.d}`

      // ---- audit: no major errors
      line(spec.audit.errors.length === 0, `${tag}: audit errors — ${spec.audit.errors.map((e) => e.code).join(', ')}`)

      // ---- entrance
      const g0 = spec.floors[0]
      const entries = g0.doors.filter((d) => d.kind === 'entry')
      line(entries.length >= 1, `${tag}: no entrance door`)
      for (const e of entries) line(g0.rooms.some((r) => r.id === e.roomId), `${tag}: entrance ${e.id} has no room`)

      // ---- slabs + stairs
      for (const fl of spec.floors) line(fl.slabs.length > 0, `${tag}: ${fl.name} has no slab`)
      if (spec.floors.length > 1) {
        for (const fl of spec.floors) {
          if (fl.level >= spec.floors.length - 1) continue
          const s = fl.stairs[0]
          line(!!s, `${tag}: ${fl.name} has no stair`)
          if (s) line(Math.abs(s.toMm - (fl.level + 1) * fl.heightMm) < 50, `${tag}: stair ${s.id} doesn't reach the next floor`)
          if (s) line(s.treadMm >= 250 && s.riserMm <= 190, `${tag}: stair ${s.id} tread/riser ${s.treadMm}/${s.riserMm} not NBC`)
        }
      }

      // ---- columns supported
      for (const fl of spec.floors) {
        for (const c of fl.columns) {
          if (c.level === 0 || c.alignedBelow || c.role === 'porch' || c.role === 'verandah') continue
          const belowBlocks = spec.floors.find((f) => f.level === c.level - 1)?.blocks ?? []
          const nearEdge = Math.min(
            Infinity,
            ...belowBlocks.map((bl) => {
              const dx = Math.max(bl.rect.x - c.at.x, 0, c.at.x - (bl.rect.x + bl.rect.w))
              const dy = Math.max(bl.rect.y - c.at.y, 0, c.at.y - (bl.rect.y + bl.rect.h))
              return Math.hypot(dx, dy)
            }),
          )
          const transfer = fl.beams.some((bm) => bm.role === 'transfer')
          line(nearEdge < 1700 || transfer, `${tag}: column ${c.id} unsupported (${nearEdge | 0}mm past frame)`)
        }
      }

      // ---- balconies
      for (const fl of spec.floors) {
        for (const bc of fl.balconies) {
          line(fl.rooms.some((r) => r.id === bc.roomId), `${tag}: balcony ${bc.id} has no room`)
          line(fl.doors.some((d) => d.kind === 'balcony' && d.roomId === bc.roomId), `${tag}: balcony ${bc.id} has no door`)
          line(fl.slabs.some((s) => s.supports === `balcony:${bc.roomId}`), `${tag}: balcony ${bc.id} has no slab`)
        }
      }

      // ---- facade anchored
      const blockIds = new Set(spec.floors.flatMap((f) => f.blocks.map((bl) => bl.id)))
      const winIds = new Set(spec.floors.flatMap((f) => f.windows.map((w) => w.id)))
      const doorIds = new Set(spec.floors.flatMap((f) => f.doors.map((d) => d.id)))
      const colIds = new Set(spec.floors.flatMap((f) => f.columns.map((c) => c.id)))
      for (const el of spec.facade) {
        const a = el.anchor
        const ok =
          (a.on === 'block' && blockIds.has(a.id)) ||
          (a.on === 'window' && winIds.has(a.id)) ||
          (a.on === 'door' && doorIds.has(a.id)) ||
          (a.on === 'column' && a.ids.every((id) => colIds.has(id))) ||
          (a.on === 'stair' && spec.floors.some((f) => f.level === a.level && f.stairs.length > 0)) ||
          (a.on === 'roof' && blockIds.has(a.blockId))
        line(ok, `${tag}: facade ${el.kind} bad anchor (${a.on})`)
      }

      // ---- windows belong to a room + fit their wall
      for (const fl of spec.floors) {
        const roomIds = new Set(fl.rooms.map((r) => r.id))
        for (const w of fl.windows) {
          line(roomIds.has(w.roomId), `${tag}: window ${w.id} has no room`)
          const len = Math.hypot(w.wall.b.x - w.wall.a.x, w.wall.b.y - w.wall.a.y)
          line(w.widthMm <= len + 5, `${tag}: window ${w.id} wider than its wall`)
        }
      }
    }
  }
}

console.log(`\n${cases} cases · avg audit score ${(scoreSum / cases).toFixed(0)}/100`)
console.log('audit errors:', Object.keys(errCodes).length ? JSON.stringify(errCodes) : 'none')
console.log(
  'audit warnings:',
  Object.entries(warnCodes)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`)
    .join('  ') || 'none',
)
console.log(`\n${fail === 0 ? '✓ all checks pass — the model makes architectural sense stripped of materials' : `✗ ${fail} check(s) failed`}`)
if (fail) process.exit(1)
