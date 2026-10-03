import fs from 'node:fs'
import path from 'node:path'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {validate} from '../src/lib/rules/index.ts'
import {planFeatures} from '../src/lib/engine/planner/planDiversity.ts'
import {planFingerprint} from '../src/lib/engine/planner/planFingerprint.ts'

// Locally generated baseline records, never described as real-world training data.
const out=path.resolve('output/ml-baseline/plans.jsonl')
fs.mkdirSync(path.dirname(out),{recursive:true})
const records=[]
for(const family of ['rectangular','stepped','l-shape','courtyard','twin-wing','u-wing','courtyard-ring','pavilion']){
 for(let seed=1;seed<=4;seed++){
  const brief=defaultBrief();brief.project.buildingType='large-villa'
  brief.site.plotWidth=40;brief.site.plotDepth=50;brief.rooms.bedroomsWithBath=2
  const design=generate(compile(brief),{massing:family,seed})
  const report=validate(design)
  records.push({version:1,source:'synthetic-production-planner',requestedFamily:family,seed,
   brief,actualFamily:design.massingType,planSeed:design.planSeed,valid:report.hardChecksPass,
   errors:report.findings.filter(f=>f.severity==='error').map(f=>f.message),
   fingerprint:planFingerprint(design),features:planFeatures(design),floors:design.floors})
 }
}
fs.writeFileSync(out,records.map(record=>JSON.stringify(record)).join('\n')+'\n')
console.log(JSON.stringify({output:out,records:records.length,valid:records.filter(r=>r.valid).length}))
