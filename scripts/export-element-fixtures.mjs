import {mkdir,writeFile} from 'node:fs/promises'
import {elementFixture} from './fixtures/element-building.mjs'
import {createVillaDesignDNA} from '../src/lib/engine/villaDesignDna.ts'
import {MassingGenerator} from '../src/lib/engine/massing/MassingGenerator.ts'
import {ArchitecturalFeatureGenerator} from '../src/lib/engine/facade/ArchitecturalFeatureGenerator.ts'
import {NEW_ELEMENTS} from '../src/lib/engine/facade/elementRecipes.ts'
import {ARCHITECTURAL_FAMILIES} from '../src/lib/engine/facade/architecturalFamilies.ts'
const buildingModel=elementFixture(),villaDesignDNA=createVillaDesignDNA(buildingModel,41)
const massingModel=MassingGenerator.generate(buildingModel,villaDesignDNA)
await mkdir('output/element-review',{recursive:true})
for(const name of [...NEW_ELEMENTS,...ARCHITECTURAL_FAMILIES.slice(22)]){
 const facadeGrammar=ArchitecturalFeatureGenerator.generate(buildingModel,villaDesignDNA,massingModel,
  {supportingFeatures:[],...(NEW_ELEMENTS.includes(name)?{heroFeature:name}:{architecturalFamily:name})})
 if(facadeGrammar.status!=='valid')throw new Error(name+': '+JSON.stringify(facadeGrammar.issues))
 await writeFile(`output/element-review/${name}.json`,JSON.stringify({schemaVersion:1,buildingModel,villaDesignDNA,massingModel,facadeGrammar}))
}
