/*
 * genome-corpus — §14 SYNTHETIC REFERENCE DATASET.
 *
 *   Generate 500+ UNIQUE architectural design genomes, each from a
 *   structured Design Genome (never a random AI house). Every genome
 *   is a real output of resolveGenome() — the exact vocabulary
 *   BrickPilot can procedurally build — deduplicated by architectural
 *   fingerprint so no two are near-identical.
 *
 *   npx tsx scripts/genome-corpus.mts [--target 600]
 *     → brickpilot-architecture-dataset/metadata/genomes.json
 *
 *   Each entry is a synthetic ReferenceDesign: id, style, source
 *   (CC0 synthetic), the full genome, its DNA projection and its
 *   fingerprint. imagePath is null until a render is baked.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/index.ts'
import { CHARACTER_OF_STYLE, generateDesign, requirementsOf, STYLE_IDS } from '../src/architecture/index.ts'
import { areTooSimilar } from '../src/architecture/index.ts'
import { internalSource } from '../src/architecture/library/designLibrary.ts'
import type { ArchitecturalFingerprint, DesignGenome, StyleId } from '../src/architecture/index.ts'

const target = Number(process.argv[process.argv.indexOf('--target') + 1]) || 600

// a spread of realistic Indian plot programmes
const PLOTS = [
  { w: 9, d: 15, beds: 3, baths: 2 }, // 30×50 ft
  { w: 12, d: 18, beds: 4, baths: 3 }, // 40×60 ft
  { w: 15, d: 24, beds: 4, baths: 4 }, // 50×80 ft
  { w: 18, d: 27, beds: 5, baths: 4 }, // 60×90 ft
  { w: 24, d: 30, beds: 5, baths: 5 }, // large
  { w: 11, d: 20, beds: 3, baths: 3 },
]
const STOREYS = [0, 1, 2] // G, G+1, G+2

/** project a genome onto the ReferenceDNA shape (the analysis-pipeline schema) */
function dnaOf(g: DesignGenome) {
  return {
    planFigure: g.planFigure,
    massingComposition: g.massingComposition,
    volumeCount: g.volumeCount,
    compositionBalance: g.compositionBalance,
    upperFloorStrategy: g.upperFloorStrategy,
    voidStrategy: g.voidStrategy,
    roof: g.roof,
    overhang: g.overhang,
    entrance: g.entrance,
    doubleHeightEntrance: g.doubleHeightEntrance,
    balcony: g.balcony,
    balconyPosition: g.balconyPosition,
    facadeComposition: g.facadeComposition,
    screen: g.screen,
    materialPalette: g.materialPalette,
    glazing: g.glazing,
    windowStrategy: g.windowStrategy,
    courtyard: g.courtyard,
    parking: g.parking,
    landscape: g.landscape,
    characteristics: g.characteristics,
  }
}

type Entry = {
  id: string
  style: StyleId
  source: ReturnType<typeof internalSource>
  requirements: { plotWidthMm: number; plotDepthMm: number; floors: number; bedrooms: number; bathrooms: number; parking: number }
  genome: DesignGenome
  dna: ReturnType<typeof dnaOf>
  fingerprint: ArchitecturalFingerprint
  imagePath: null
}

const kept: Entry[] = []
const keptFps: ArchitecturalFingerprint[] = []
const perStyle: Record<string, number> = {}
let attempts = 0

// round-robin the styles so the corpus stays balanced
outer: for (let round = 0; round < 400; round++) {
  for (const style of STYLE_IDS as readonly StyleId[]) {
    for (const plot of PLOTS) {
      for (const storeys of STOREYS) {
        if (kept.length >= target) break outer
        attempts++
        const seed = 20000 + round * 97 + plot.w * 7 + storeys
        const b = defaultBrief()
        b.style.character = CHARACTER_OF_STYLE[style]
        b.levels.storeys = storeys
        b.site.plotWidth = plot.w
        b.site.plotDepth = plot.d
        b.rooms.bedroomsWithBath = Math.min(2, plot.baths)
        b.rooms.bedroomsNoBath = Math.max(0, plot.beds - 2)
        b.rooms.sharedBaths = Math.max(1, plot.baths - 2)
        b.rooms.priorities.coveredParking = true
        b.spaces.occupants = plot.beds + 1
        b.variation = seed
        let spec
        try {
          spec = generateDesign(requirementsOf(generate(compile(b)), style), seed)
        } catch {
          continue
        }
        if (spec.validation.issues.length) continue
        // dedup at the SAME 0.86 threshold the dataset's deduplicate.py uses,
        // so every genome that ships survives the pipeline's dedup pass
        if (keptFps.some((k) => areTooSimilar(k, spec.fingerprint, 0.86))) continue
        kept.push({
          id: `${style}_${String(kept.length + 1).padStart(4, '0')}`,
          style,
          source: internalSource('synthetic'),
          requirements: {
            plotWidthMm: spec.plot.widthMm,
            plotDepthMm: spec.plot.depthMm,
            floors: spec.requirements.floors,
            bedrooms: spec.requirements.bedrooms,
            bathrooms: spec.requirements.bathrooms,
            parking: spec.requirements.parking,
          },
          genome: spec.genome,
          dna: dnaOf(spec.genome),
          fingerprint: spec.fingerprint,
          imagePath: null,
        })
        keptFps.push(spec.fingerprint)
        perStyle[style] = (perStyle[style] ?? 0) + 1
      }
    }
  }
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'brickpilot-architecture-dataset', 'metadata')
mkdirSync(ROOT, { recursive: true })
writeFileSync(
  join(ROOT, 'genomes.json'),
  JSON.stringify(
    {
      generated: new Date().toISOString(),
      kind: 'synthetic',
      note: 'Each genome is a real resolveGenome() output — the exact architectural vocabulary BrickPilot procedurally builds. Deduplicated by architectural fingerprint.',
      count: kept.length,
      perStyle,
      attempts,
      designs: kept,
    },
    null,
    2,
  ) + '\n',
)

console.log(`✓ ${kept.length} unique synthetic genomes from ${attempts} attempts`)
for (const s of Object.keys(perStyle).sort()) console.log(`   ${s.padEnd(24)} ${perStyle[s]}`)
console.log(`→ brickpilot-architecture-dataset/metadata/genomes.json`)
