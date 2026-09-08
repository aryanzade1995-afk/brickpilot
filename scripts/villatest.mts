/*
 * villatest — the acceptance test the brief asks for.
 *
 *   Modern Indian · Modern Kerala · Luxury Indian villa   × 5 seeds each,
 *   SAME user requirements (plot, floors, bedrooms, bathrooms).
 *
 * Verifies, per the brief:
 *   - models are visibly different  (distinct massing form + footprint signature)
 *   - requirements remain identical  (floors / beds / baths / plot / built-up)
 *   - plot dimensions correct        (spec.plot === brief plot, blocks inside setbacks)
 *   - windows reasonable / not excessive  (<=3 per room, sane ratio, every
 *     window on a real room's real exterior wall, no window in a doorway)
 *   - style is visually obvious      (per-style facade/roof signature present)
 *   - geometry valid                 (spec.validation, no leftover issues)
 *   - deterministic                  (same seed -> identical spec)
 */
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/index.ts'
import { CHARACTER_OF_STYLE, requirementsOf, generateDesign } from '../src/architecture/index.ts'
import { distinctCount, meanPairwiseSimilarity } from '../src/architecture/index.ts'
import type { ArchitecturalFingerprint, DesignSpec, StyleId } from '../src/architecture/index.ts'

// storeys = additional floors above ground -> a G+1 (2-level) 4-bed villa
const REQ = { beds: 4, baths: 3, storeys: 1, levels: 2, plotW: 18, plotD: 27 }
const SEEDS = [1001, 1002, 1003, 1004, 1005]
const STYLES: StyleId[] = ['modern_indian', 'modern_kerala', 'luxury_indian_villa']

/** per-style "is the style obvious" signature — geometry, not materials */
const STYLE_SIGNATURE: Record<string, (s: DesignSpec) => boolean> = {
  modern_indian: (s) =>
    s.floors.some((f) => f.blocks.some((b) => ['flat_band', 'flat_eave', 'flat_parapet'].includes(b.roof.kind))) &&
    s.facade.some((e) => ['fins', 'feature_pier', 'feature_tower', 'clad'].includes(e.kind)),
  modern_kerala: (s) =>
    s.floors.some((f) => f.blocks.some((b) => b.roof.kind === 'hip' && b.roof.pitchDeg >= 18)) &&
    s.facade.some((e) => e.kind === 'verandah' || e.kind === 'base_cladding' || e.kind === 'jaali'),
  luxury_indian_villa: (s) =>
    s.floors.some((f) => f.doors.some((d) => d.kind === 'entry' && (d.canopyMm > 0 || d.heightMm >= 3000))) &&
    s.facade.some((e) => e.kind === 'canopy' || e.kind === 'verandah' || e.kind === 'clad'),
}

function briefFor(style: StyleId, seed: number) {
  const b = defaultBrief()
  b.style.character = CHARACTER_OF_STYLE[style]
  b.levels.storeys = REQ.storeys
  b.rooms.bedroomsWithBath = 2
  b.rooms.bedroomsNoBath = REQ.beds - 2
  b.rooms.sharedBaths = 1
  b.site.plotWidth = REQ.plotW
  b.site.plotDepth = REQ.plotD
  b.variation = seed
  return b
}

let fail = 0
const line = (ok: boolean, msg: string) => {
  if (!ok) {
    fail++
    console.log(`  ✗ ${msg}`)
  }
}

for (const style of STYLES) {
  console.log(`\n=== ${style} ===`)
  const specs: DesignSpec[] = []
  const forms = new Set<string>()
  const fps: ArchitecturalFingerprint[] = []
  const reqSig = new Set<string>()

  for (const seed of SEEDS) {
    const brief = briefFor(style, seed)
    const design = generate(compile(brief))
    const req = requirementsOf(design, style)
    const spec = generateDesign(req, seed)
    specs.push(spec)

    // determinism
    line(JSON.stringify(spec) === JSON.stringify(generateDesign(req, seed)), `seed ${seed}: non-deterministic`)

    // requirements identical
    reqSig.add(`${spec.requirements.floors}|${spec.requirements.bedrooms}|${spec.requirements.bathrooms}`)
    line(spec.requirements.floors === REQ.levels, `seed ${seed}: floors ${spec.requirements.floors} != ${REQ.levels}`)
    line(spec.requirements.bedrooms === REQ.beds, `seed ${seed}: bedrooms ${spec.requirements.bedrooms} != ${REQ.beds}`)

    // plot correct
    line(spec.plot.widthMm === REQ.plotW * 1000 && spec.plot.depthMm === REQ.plotD * 1000, `seed ${seed}: plot ${spec.plot.widthMm}x${spec.plot.depthMm}`)
    const bx1 = spec.plot.widthMm - spec.setbacksMm.E
    const by1 = spec.plot.depthMm - spec.setbacksMm.S
    for (const f of spec.floors)
      for (const b of f.blocks) {
        const cant = Math.max(0, ...Object.values(b.cantilever))
        line(
          b.rect.x >= spec.setbacksMm.W - 80 && b.rect.y >= spec.setbacksMm.N - 80 && b.rect.x + b.rect.w <= bx1 + cant + 80 && b.rect.y + b.rect.h <= by1 + cant + 80,
          `seed ${seed}: ${b.id} outside setbacks`,
        )
      }

    // windows reasonable
    let winTotal = 0
    for (const f of spec.floors) {
      const perRoom = new Map<string, number>()
      const roomIds = new Set(f.rooms.map((r) => r.id))
      for (const w of f.windows) {
        winTotal++
        perRoom.set(w.roomId, (perRoom.get(w.roomId) ?? 0) + 1)
        line(roomIds.has(w.roomId), `seed ${seed}: window ${w.id} has no room`)
        const dx = w.wall.b.x - w.wall.a.x
        const dy = w.wall.b.y - w.wall.a.y
        const wallLen = Math.hypot(dx, dy)
        line(w.widthMm <= wallLen + 5, `seed ${seed}: ${w.id} wider than its wall`)
        // absolute centre of the window, in the plot frame
        const wc = { x: w.wall.a.x + (dx / wallLen) * w.centerMm, y: w.wall.a.y + (dy / wallLen) * w.centerMm }
        // not in a doorway: any door on the same wall line, along-overlap
        for (const d of f.doors) {
          const dc = { x: (d.wall.a.x + d.wall.b.x) / 2, y: (d.wall.a.y + d.wall.b.y) / 2 }
          const horiz = Math.abs(dy) < Math.abs(dx)
          const perp = horiz ? Math.abs(dc.y - wc.y) : Math.abs(dc.x - wc.x)
          const along = horiz ? Math.abs(dc.x - wc.x) : Math.abs(dc.y - wc.y)
          if (perp > 200) continue
          line(along > d.widthMm / 2 + w.widthMm / 2 + 250, `seed ${seed}: ${w.id} overlaps door ${d.id} (gap ${along | 0}mm)`)
        }
      }
      for (const [rid, n] of perRoom) line(n <= 3, `seed ${seed}: ${rid} has ${n} windows`)
    }
    const perFloorAvg = winTotal / spec.floors.length
    line(perFloorAvg >= 2 && perFloorAvg <= 9, `seed ${seed}: ${perFloorAvg.toFixed(1)} windows/floor (excessive?)`)

    // style obvious
    line(STYLE_SIGNATURE[style](spec), `seed ${seed}: style signature not detected`)

    // valid geometry
    line(spec.validation.issues.length === 0, `seed ${seed}: ${spec.validation.issues.join('; ')}`)

    fps.push(spec.fingerprint)
    forms.add(`${spec.massing.strategy}|${spec.floors.map((f) => f.blocks.map((b) => `${b.rect.w | 0}x${b.rect.h | 0}`).join(',')).join('/')}`)
    const roofs = spec.floors.flatMap((f) => f.blocks.map((b) => b.roof.kind))
    const facades = [...new Set(spec.facade.map((e) => e.kind))].sort().join('+')
    console.log(
      `  seed ${seed}: ${spec.genome.massingComposition.padEnd(20)} roof=${[...new Set(roofs)].join('/').padEnd(20)} bal=${(spec.floors.flatMap((f) => f.balconies.map((b) => b.type)).join(',') || '—').padEnd(24)} fp=${spec.fingerprint.hash}`,
    )
  }

  line(reqSig.size === 1, `requirements DIFFER across seeds: ${[...reqSig].join(' vs ')}`)
  // architectural distinctness via the fingerprint (§9) — not a hand-rolled string
  const distinct = distinctCount(fps, 0.86)
  const meanSim = meanPairwiseSimilarity(fps)
  line(distinct >= 3, `only ${distinct}/5 architecturally distinct (fingerprint)`)
  line(meanSim < 0.82, `mean similarity ${meanSim} too high — designs too alike`)
  console.log(`  -> ${distinct}/5 distinct fingerprints · mean similarity ${meanSim} · requirements ${reqSig.size === 1 ? 'identical ✓' : 'DIFFER ✗'}`)
}

console.log(`\n${fail === 0 ? '✓ all checks pass' : `✗ ${fail} check(s) failed`}`)
if (fail) process.exit(1)
