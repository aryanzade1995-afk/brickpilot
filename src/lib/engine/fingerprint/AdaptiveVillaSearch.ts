import { makeRng } from '../massing/rng.ts'
import { evaluateVillaFingerprint, diversityLimits, type VillaDiversityLimits, type DistinctVillaResult, type FingerprintDebug } from './VillaDiversityGate.ts'
import { fingerprintRecord, parseFingerprintHistory, villaShapeSimilarity, type ShapeFingerprintRecord, type VillaShapeFingerprint } from './VillaShapeFingerprint.ts'

export const ADAPTIVE_SIMILARITY_STEPS = [.75, .82, .9, .97, 1] as const
/** Uniqueness is a preference. Geometry validation inside createCandidate is mandatory at every stage. */
export function selectAdaptiveVilla<T>(seed: number, recent: ShapeFingerprintRecord[],
 createCandidate: (seed: number) => {candidate:T; fingerprint:VillaShapeFingerprint},
 options: Partial<VillaDiversityLimits> = {}, references:ShapeFingerprintRecord[]=[]): DistinctVillaResult<T> {
 if(!Number.isSafeInteger(seed)) throw new RangeError('Villa seed must be a safe integer')
 const limits=diversityLimits(options), history=parseFingerprintHistory(recent,limits.recentLimit)
 const rng=makeRng(seed,'adaptive-villa-search-v1'), seen=new Set<number>(), debug:FingerprintDebug[]=[]
 const candidates:ReturnType<typeof createCandidate>[]=[]
 const stages=[limits.similarityThreshold,...ADAPTIVE_SIMILARITY_STEPS.filter(t=>t>limits.similarityThreshold)]
 const accept=(item:ReturnType<typeof createCandidate>,decision:FingerprintDebug,stage:number)=>{
  const reason=stage ? `Adaptive uniqueness stage ${stage+1}: ${decision.reason} Geometry hard checks passed.` : decision.reason
  debug.push({...decision,accepted:true,code:'ACCEPTED',reason})
  return {accepted:item,history:[...history,fingerprintRecord(item.fingerprint)].slice(-limits.recentLimit),debug}
 }
 for(let stage=0;stage<stages.length;stage++) {
  const threshold=stages[stage], final=threshold===1
  const stageLimits={...limits,similarityThreshold:threshold,
   maxSameMassingFamily:final?limits.windowSize:Math.max(limits.maxSameMassingFamily,2+stage),
   maxSameHero:stage===0?limits.maxSameHero:final?limits.windowSize:Math.max(limits.maxSameHero,1+stage),
   maxSameFacadeFamily:stage===0?limits.maxSameFacadeFamily:final?limits.windowSize:Math.max(limits.maxSameFacadeFamily,1+stage),
   maxSameRoofline:final?limits.windowSize:Math.max(limits.maxSameRoofline,3+stage)}
  const evaluate=(item:ReturnType<typeof createCandidate>)=>{
   const decision=evaluateVillaFingerprint(item.fingerprint,history,stageLimits,references)
   // Never fill a direction set with exact physical duplicates, even at the final stage.
   if(references.some(ref=>villaShapeSimilarity(ref,item.fingerprint)===1)) return {...decision,accepted:false,code:'SIMILAR_SHAPE' as const,reason:'Exact geometry duplicates an existing direction.'}
   return decision
  }
  // Reconsider validated candidates before doing any more expensive assembly.
  const previousHero=history.at(-1)?.heroFeature
  const repeatCandidates:ReturnType<typeof createCandidate>[]=[]
  for(const item of candidates) {
   if(item.fingerprint.heroFeature===previousHero){repeatCandidates.push(item);continue}
   const d=evaluate(item);if(d.accepted)return accept(item,d,stage)
  }
  for(let i=0;i<Math.min(limits.maxAttempts,16);i++) {
   let next=stage===0&&i===0?seed:rng.int(0,0xffffffff)
   while(seen.has(next))next=rng.int(0,0xffffffff)
   seen.add(next)
   try {
    const item=createCandidate(next); if(item.fingerprint.seed!==next)throw new Error('Candidate seed mismatch')
    candidates.push(item)
    const decision=evaluate(item)
    if(decision.accepted && item.fingerprint.heroFeature!==previousHero)return accept(item,decision,stage)
    debug.push({...decision,reason:`Stage ${stage+1}, threshold ${Math.round(threshold*100)}%: ${decision.reason}`})
   } catch(error) {debug.push({seed:next,family:'unknown',nearestPreviousSeed:null,similarityPercent:0,accepted:false,code:'INVALID_ARCHITECTURE',reason:error instanceof Error?error.message:'Architecture failed validation'})}
  }
  // Exhaust the bounded alternative search before allowing a consecutive repeat.
  if(final)for(const item of [...repeatCandidates,...candidates]){const d=evaluate(item);if(d.accepted)return accept(item,d,stage)}
 }
 return {accepted:null,history,debug}
}
