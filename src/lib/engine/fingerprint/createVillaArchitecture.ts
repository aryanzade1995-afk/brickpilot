import type { Design } from '../types.ts'
import { validate } from '../../rules/index.ts'
import { createBuildingModel } from '../buildingModel.ts'
import { createVillaDesignDNA } from '../villaDesignDna.ts'
import { MassingGenerator } from '../massing/MassingGenerator.ts'
import { ArchitectureValidator } from '../massing/ArchitectureValidator.ts'
import { ArchitecturalFeatureGenerator, type FeatureGenerationOptions } from '../facade/ArchitecturalFeatureGenerator.ts'
import { validateProceduralFeatures } from '../facade/FacadeGrammar.ts'
import { validateSpecializedAssemblies } from '../facade/specialized/validate.ts'
import { createVillaShapeFingerprint } from './VillaShapeFingerprint.ts'

/** Pure exact-seed assembly for candidate evaluation and saved-design replay.
 * History/retries belong to VillaDiversityGate, not to this deterministic adapter. */
export function createVillaArchitecture(design: Design, seed = design.dna.seed, options: FeatureGenerationOptions = {}) {
  if (!validate(design).hardChecksPass) throw new Error('The source 2D plan has failed validation')
  const buildingModel = createBuildingModel(design)
  const villaDesignDNA = createVillaDesignDNA(buildingModel, seed, design.model.brief.style.character)
  const massingModel = MassingGenerator.generate(buildingModel, villaDesignDNA)
  ArchitectureValidator.assertReadyForGeometry(buildingModel, massingModel)
  const facadeGrammar = ArchitecturalFeatureGenerator.generate(buildingModel, villaDesignDNA, massingModel, options)
  if (facadeGrammar.status !== 'valid') throw new Error(`Facade rejected: ${JSON.stringify(facadeGrammar.issues)}`)
  const issues = validateProceduralFeatures(buildingModel, massingModel, facadeGrammar.zones, facadeGrammar.features)
  if (issues.length) throw new Error(`Facade geometry rejected: ${JSON.stringify(issues)}`)
  if (!facadeGrammar.specialized || facadeGrammar.specialized.status !== 'valid') throw new Error('Component grammar rejected')
  const specializedIssues = validateSpecializedAssemblies({ building: buildingModel, dna: villaDesignDNA,
    massing: massingModel, facade: facadeGrammar, limits: facadeGrammar.specialized.limits }, facadeGrammar.specialized.assemblies)
  if (specializedIssues.length) throw new Error(`Component grammar rejected: ${JSON.stringify(specializedIssues)}`)
  return { buildingModel, massingModel, villaDesignDNA, facadeGrammar,
    shapeFingerprint: createVillaShapeFingerprint(buildingModel, villaDesignDNA, massingModel, facadeGrammar) }
}
