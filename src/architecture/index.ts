/* ------------------------------------------------------------------ *
 *  src/architecture — the data-driven architectural grammar.
 *
 *      USER REQUIREMENTS + engine floor plan (`Design`)
 *        → StyleGrammar (grammar.ts)
 *        → generateDesign(requirements, seed)  ->  DesignSpec
 *        → blender/generator/*  ->  GLB / GLTF   (baked offline / in CI)
 *        → three.js viewer (loads the GLB, or falls back to buildMassing)
 *
 *  The grammar is Blender-independent: it emits a serialisable
 *  DesignSpec describing *what* to build, never *how*.
 * ------------------------------------------------------------------ */

export * from './types.ts'
export { DEFAULT_CONSTRAINTS, resolveConstraints } from './constraints.ts'
export {
  STYLE_GRAMMARS,
  STYLE_OF_CHARACTER,
  CHARACTER_OF_STYLE,
  styleGrammar,
  grammarForCharacter,
} from './grammar.ts'
export { generateDesign, requirementsOf, specFromDesign } from './generateDesign.ts'
export { generateWindows } from './generator/windowGenerator.ts'
export { classifyRoom, roomWalls, planShapeOf } from './generator/classify.ts'
export { validateSpec } from './generator/validator.ts'

/* ---- the data-driven architectural reference layer (library/) ---- */
export {
  VOCABULARY,
  ALL_TERMS,
  isValidTerm,
  normalizeTerm,
  STYLE_PATTERNS,
  stylePattern,
  resolveGenome,
  validateGenome,
  repairGenome,
  genomeSummary,
  architecturalFingerprint,
  fingerprintSimilarity,
  areTooSimilar,
  distinctCount,
  meanPairwiseSimilarity,
  MASSING_LIBRARY,
  ROOF_LIBRARY,
  SEED_REFERENCES,
  referenceHints,
  compatibilitySnapshot,
} from './library/index.ts'
export type { StylePattern } from './library/index.ts'
export type { ReferenceDesign, ReferenceDNA, ReferenceSource } from './library/index.ts'
