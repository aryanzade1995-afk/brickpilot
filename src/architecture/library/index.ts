/* ------------------------------------------------------------------ *
 *  src/architecture/library — the data-driven architectural reference
 *  layer. Vocabulary → element libraries → style patterns →
 *  compatibility rules → design genome → fingerprint → seed reference
 *  set. Everything here is pure data + pure functions; no geometry,
 *  no Blender, no React.
 *
 *      resolveGenome(stylePattern(style), requirements, constraints,
 *                    planShape, rng)  →  DesignGenome
 *      architecturalFingerprint(genome, floors)  →  ArchitecturalFingerprint
 * ------------------------------------------------------------------ */

export * from './architecturalVocabulary.ts'
export * from './compatibilityRules.ts'
export * from './massingLibrary.ts'
export * from './roofLibrary.ts'
export * from './facadeLibrary.ts'
export * from './balconyLibrary.ts'
export * from './entranceLibrary.ts'
export * from './windowLibrary.ts'
export * from './courtyardLibrary.ts'
export { STYLE_PATTERNS, stylePattern } from './stylePatterns.ts'
export type { StylePattern, Weighted } from './stylePatterns.ts'
export {
  resolveGenome,
  repairGenome,
  validateGenome,
  genomeSummary,
  genomeToMap,
  planShapeToFigure,
} from './designGenome.ts'
export {
  architecturalFingerprint,
  fingerprintSimilarity,
  areTooSimilar,
  distinctCount,
  meanPairwiseSimilarity,
  stableHash,
} from './fingerprint.ts'
export {
  SEED_REFERENCES,
  referencesForStyle,
  referenceFingerprint,
  referenceHints,
  internalSource,
} from './designLibrary.ts'
export type { ReferenceDesign, ReferenceDNA, ReferenceSource, LicenseStatus } from './designLibrary.ts'
