import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {validate} from '../src/lib/rules/index.ts'
import {planFingerprint} from '../src/lib/engine/planner/planFingerprint.ts'

export const WING_GALLERY_SEEDS=100
export const WING_GALLERY_LIMITS={maximumDuplicateRetries:64,seedStride:7919}
export const WING_GALLERY_FAMILIES=[
 ['twin-wing','Twin wings'],['u-wing','U wings'],['courtyard-ring','Courtyard wings'],['pavilion','Pavilion'],
]
/** Same brief, different source-plan seeds. Invalid or substituted families
 * cannot enter the review, and retries keep their actual replay seed visible. */
export function buildWingGallery(brief,count=WING_GALLERY_SEEDS){
 const model=compile(brief)
 return WING_GALLERY_FAMILIES.map(([family,label])=>{
  const designs=[],summary=[],seen=new Set()
  for(let seed=1;seed<=count;seed++){
   let design,fingerprint,retries=0
   for(;retries<WING_GALLERY_LIMITS.maximumDuplicateRetries;retries++){
    const candidate=generate(model,{massing:family,seed:seed+retries*WING_GALLERY_LIMITS.seedStride}),report=validate(candidate)
    if(!report.hardChecksPass||candidate.massingType!==family)throw new Error(`${family} seed ${seed}: ${JSON.stringify(report.findings.filter(f=>f.severity==='error'))}`)
    const key=planFingerprint(candidate).key
    if(!seen.has(key)){design=candidate;fingerprint=key;seen.add(key);break}
   }
   if(!design)throw new Error(`${family}: cannot find ${count} distinct valid plans within the configured search limit`)
   designs.push(design);summary.push({requestedSeed:seed,planSeed:design.planSeed,family,duplicateRetries:retries,
    fingerprint,choices:design.layoutChoices,hardChecksPass:true,
    coveredPercent:100*design.coveredFootprintSqm/(brief.site.plotWidth*brief.site.plotDepth)})
  }
  return {family,label,designs,summary,unique:new Set(summary.map(s=>s.fingerprint)).size}
 })
}
