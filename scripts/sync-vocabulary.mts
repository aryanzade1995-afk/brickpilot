/*
 * sync-vocabulary — serialise the TS architectural libraries to the
 * dataset's metadata JSON so the offline Python pipeline validates
 * references against EXACTLY the same taxonomy the runtime generator
 * uses. Single source of truth = src/architecture/library/*.
 *
 *   npx tsx scripts/sync-vocabulary.mts
 *     → brickpilot-architecture-dataset/metadata/vocabulary.json
 *     → brickpilot-architecture-dataset/metadata/compatibility.json
 *     → brickpilot-architecture-dataset/metadata/styles.json
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VOCABULARY, ALL_TERMS, VOCAB_ALIASES } from '../src/architecture/library/architecturalVocabulary.ts'
import { compatibilitySnapshot } from '../src/architecture/library/compatibilityRules.ts'
import { STYLE_PATTERNS } from '../src/architecture/library/stylePatterns.ts'
import { MASSING_LIBRARY } from '../src/architecture/library/massingLibrary.ts'
import { ROOF_LIBRARY } from '../src/architecture/library/roofLibrary.ts'
import { BALCONY_LIBRARY } from '../src/architecture/library/balconyLibrary.ts'
import { ENTRANCE_LIBRARY } from '../src/architecture/library/entranceLibrary.ts'
import { FACADE_COMPOSITION_LIBRARY, SCREEN_LIBRARY } from '../src/architecture/library/facadeLibrary.ts'
import { COURTYARD_LIBRARY } from '../src/architecture/library/courtyardLibrary.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'brickpilot-architecture-dataset', 'metadata')
mkdirSync(ROOT, { recursive: true })

const write = (name: string, data: unknown) => {
  const path = join(ROOT, name)
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n')
  console.log(`  ${name.padEnd(22)} ${JSON.stringify(data).length.toLocaleString()} bytes`)
}

/* ---- vocabulary.json ------------------------------------------- */
write('vocabulary.json', {
  generated: new Date().toISOString(),
  source: 'src/architecture/library/architecturalVocabulary.ts',
  fields: Object.fromEntries(Object.entries(VOCABULARY).map(([k, v]) => [k, [...v]])),
  aliases: VOCAB_ALIASES,
  termCount: ALL_TERMS.length,
})

/* ---- compatibility.json ---------------------------------------- */
write('compatibility.json', {
  generated: new Date().toISOString(),
  source: 'src/architecture/library/compatibilityRules.ts',
  ...compatibilitySnapshot(),
})

/* ---- styles.json --------------------------------------------- *
 *  the per-style genome distribution + the element libraries the
 *  analysis pipeline scores a real reference against               */
write('styles.json', {
  generated: new Date().toISOString(),
  source: 'src/architecture/library/stylePatterns.ts',
  patterns: STYLE_PATTERNS,
  libraries: {
    massing: MASSING_LIBRARY,
    roof: ROOF_LIBRARY,
    balcony: BALCONY_LIBRARY,
    entrance: ENTRANCE_LIBRARY,
    facadeComposition: FACADE_COMPOSITION_LIBRARY,
    screen: SCREEN_LIBRARY,
    courtyard: COURTYARD_LIBRARY,
  },
})

console.log('\n✓ synced TS architectural libraries → dataset metadata')
