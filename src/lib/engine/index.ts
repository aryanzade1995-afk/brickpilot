export * from './types.ts'
export {
  generate,
  generateDirections,
  STRATEGIES,
  type Strategy,
  type GenerateOpts,
  type DirectionResult,
} from './generate.ts'
export {
  MASSING_TYPES,
  MASSING_LABEL,
  DIVERSITIES,
  type MassingType,
  type Diversity,
} from './massing/types.ts'
export { createBuildingModel, type BuildingModel } from './buildingModel.ts'
export { createVillaDesignDNA, villaGeometrySignature, type VillaDesignDNA } from './villaDesignDna.ts'
export { MassingGenerator } from './massing/MassingGenerator.ts'
export { MASSING_FAMILIES, type Mass, type MassingFamily, type MassingModel } from './massing/model.ts'
export { assessMassingFamilies } from './massing/families.ts'
export { validateMassing, massingSilhouetteSignature } from './massing/validate.ts'
export { ArchitectureValidator, type ArchitectureReport, type ArchitectureIssue,
  type ArchitectureLimits } from './massing/ArchitectureValidator.ts'
export * from './massing/transforms.ts'
export { ArchitecturalFeatureGenerator } from './facade/ArchitecturalFeatureGenerator.ts'
export { ARCHITECTURAL_FAMILIES, ARCHITECTURAL_FAMILY_RECIPES, architecturalFamilyFitsPlan,
  chooseArchitecturalFamily, type ArchitecturalFamily } from './facade/architecturalFamilies.ts'
export { FacadeGrammar, buildFacadeZones, freeFacadeSpans, validateProceduralFeatures, worldPart } from './facade/FacadeGrammar.ts'
export { ARCHITECTURAL_FEATURE_TYPES, FACADE_ZONE_KINDS,
  type ArchitecturalFeature, type ArchitecturalFeatureType, type FacadeZone,
  type ProceduralFacadeModel, type FrameParameters } from './facade/proceduralTypes.ts'
export { SpecializedGrammarGenerator } from './facade/specialized/SpecializedGrammarGenerator.ts'
export { validateSpecializedAssemblies } from './facade/specialized/validate.ts'
export { BALCONY_TYPES, ENTRANCE_TYPES, WINDOW_TYPES, ROOFLINE_TYPES, DEPTH_TYPES,
  DEFAULT_GRAMMAR_LIMITS, type SpecializedGrammarModel, type GrammarOptions, type GrammarLimits } from './facade/specialized/types.ts'
export { createVillaShapeFingerprint, villaShapeSimilarity, fingerprintRecord, parseFingerprintHistory,
  FINGERPRINT_VECTOR_LENGTH, FINGERPRINT_GROUPS, type VillaShapeFingerprint, type ShapeFingerprintRecord } from './fingerprint/VillaShapeFingerprint.ts'
export { DEFAULT_DIVERSITY_LIMITS, evaluateVillaFingerprint, selectDistinctVilla, formatFingerprintDebug,
  type VillaDiversityLimits, type FingerprintDebug } from './fingerprint/VillaDiversityGate.ts'
export { createVillaArchitecture } from './fingerprint/createVillaArchitecture.ts'
export { generateAlternativeDesign, ENVELOPE_LIMITS } from './generateAlternativeDesign.ts'
