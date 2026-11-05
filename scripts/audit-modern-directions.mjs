import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {distinctDirectionPlans,generate} from '../src/lib/engine/generate.ts'
import {SITE_FORM_VERSION} from '../src/lib/engine/siteForm.ts'
import {validate} from '../src/lib/rules/index.ts'
import {generateAlternativeDesign} from '../src/lib/engine/generateAlternativeDesign.ts'
import {MODERN_DIRECTION_COMPOSITIONS} from '../src/lib/model/modernCompositions.ts'
import {writeFileSync,mkdirSync} from 'node:fs'
const b=defaultBrief();b.site.plotWidth=25;b.site.plotDepth=30
const start=performance.now(),plans=distinctDirectionPlans(compile(b),4,SITE_FORM_VERSION)
console.log('Directions',performance.now()-start,plans.map(p=>[p.plan.model.brief.style.composition,p.massing]))
mkdirSync('output/modern-realism',{recursive:true})
for(const c of MODERN_DIRECTION_COMPOSITIONS){
 const source=plans.find(p=>p.plan.model.brief.style.composition===c)
 const brief=structuredClone(b);brief.style.composition=c
 const d=source?.plan??generate(compile(brief),{seed:41,formVersion:SITE_FORM_VERSION})
 const report=validate(d)
 console.log(c,report.hardChecksPass,report.checks?.filter(c=>c.status==='fail'),d.floors.map(f=>f.supportZones?.filter(z=>z.review)))
 if(report.hardChecksPass)try{
  const a=generateAlternativeDesign(d,41)
  writeFileSync(`output/modern-realism/${c}.json`,JSON.stringify(a))
  writeFileSync(`output/modern-realism/${c}-design.json`,JSON.stringify(d))
  console.log(c,'3D',a.facadeGrammar.status)
 }catch(e){console.log(c,'3D ERROR',e.message)}
}
