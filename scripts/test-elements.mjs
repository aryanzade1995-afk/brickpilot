import assert from 'node:assert/strict'
import test from 'node:test'
import {elementFixture} from './fixtures/element-building.mjs'
import {createVillaDesignDNA} from '../src/lib/engine/villaDesignDna.ts'
import {MassingGenerator} from '../src/lib/engine/massing/MassingGenerator.ts'
import {ArchitecturalFeatureGenerator} from '../src/lib/engine/facade/ArchitecturalFeatureGenerator.ts'
import {validateProceduralFeatures} from '../src/lib/engine/facade/FacadeGrammar.ts'
import {createVillaShapeFingerprint,fingerprintRecord,parseFingerprintHistory,FINGERPRINT_GROUPS} from '../src/lib/engine/fingerprint/VillaShapeFingerprint.ts'
import {evaluateVillaFingerprint} from '../src/lib/engine/fingerprint/VillaDiversityGate.ts'
import {selectAdaptiveVilla} from '../src/lib/engine/fingerprint/AdaptiveVillaSearch.ts'
const b=elementFixture()
const make=(seed,options={})=>{
 const dna=createVillaDesignDNA(b,seed), massing=MassingGenerator.generate(b,dna)
 const facade=ArchitecturalFeatureGenerator.generate(b,dna,massing,options)
 assert.equal(facade.status,'valid',JSON.stringify(facade.issues))
 return {candidate:{dna,massing,facade},fingerprint:createVillaShapeFingerprint(b,dna,massing,facade)}
}
test('every feature records deterministic realized element parameters; 50 seeds have at least 12 hero parameter combinations',()=>{
 const combinations=new Set()
 for(let seed=1;seed<=50;seed++){
  const x=make(seed)
  for(const f of x.candidate.facade.features){
   assert.ok(f.parameters && Number.isInteger(f.parameters.projectionMm))
   assert.equal(f.parameters.projectionMm,Math.max(...f.parts.map(p=>p.offsetMm+p.depthMm)))
   assert.ok(f.parts.every(p=>p.materialHint))
  }
  combinations.add(x.fingerprint.heroFeature+':'+x.fingerprint.heroParameterBucket)
  if(seed<=3)assert.deepEqual(make(seed),x)
 }
 assert.ok(combinations.size>=12,`${combinations.size} combinations`)
})
test('history migrates schema 3 geometry and retains optional element diagnostics without using palette for novelty',()=>{
 const record=fingerprintRecord(make(41).fingerprint)
 const identity=FINGERPRINT_GROUPS.at(-1).size
 const old={...record,schemaVersion:3,vector:[...record.vector.slice(0,-identity),...Array(identity-18).fill(0)]}
 delete old.heroParameterBucket;delete old.palette
 const parsed=parseFingerprintHistory([old])
 assert.equal(parsed.length,1)
 assert.deepEqual(parsed[0].vector.slice(0,-identity),record.vector.slice(0,-identity))
 assert.equal(evaluateVillaFingerprint({...make(41).fingerprint,palette:'different'},[record]).accepted,false)
 assert.deepEqual(parseFingerprintHistory([record]),[record])
})
test('rolling default rejects a repeated hero or family and adaptive search prefers a valid different last hero',()=>{
 const first=make(41),record=fingerprintRecord(first.fingerprint)
 assert.equal(evaluateVillaFingerprint({...first.fingerprint,seed:42},[record],{similarityThreshold:1}).code,'DIVERSITY_LIMIT')
 let calls=0
 const other=make(117,{heroFeature:'FOLDED_CANOPY',supportingFeatures:[]})
 const selection=selectAdaptiveVilla(42,[record],seed=>{
  calls++
  const x=calls<=16?first:other
  return {...x,fingerprint:{...x.fingerprint,seed}}
 },{maxAttempts:16})
 assert.ok(selection.accepted)
 assert.notEqual(selection.accepted.fingerprint.heroFeature,record.heroFeature)
})
test('new anchors cannot be forged; roof support, source windows and screen occlusion remain checked',()=>{
 for(const type of ['GATE_PORTAL','POOL_PAVILION','SOLAR_SHADE_ROOF','BAY_WINDOW','PERFORATED_BRICK_WALL']){
  const x=make(41,{heroFeature:type,supportingFeatures:[]}), f=x.candidate.facade
  assert.deepEqual(validateProceduralFeatures(b,x.candidate.massing,f.zones,f.features),[])
  const modified=structuredClone(f)
  modified.features[0].parts[0].world.x+=100
  assert.ok(validateProceduralFeatures(b,x.candidate.massing,modified.zones,modified.features).some(i=>i.code==='ARBITRARY_COORDINATES'))
 }
})
