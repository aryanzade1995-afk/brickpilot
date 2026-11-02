import test from 'node:test'
import assert from 'node:assert/strict'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {distinctDirectionPlans,generate} from '../src/lib/engine/generate.ts'
import {SITE_FORM_VERSION} from '../src/lib/engine/siteForm.ts'
import {planFingerprint} from '../src/lib/engine/planner/planFingerprint.ts'
import {planDistance} from '../src/lib/engine/planner/planDiversity.ts'
import {validate} from '../src/lib/rules/index.ts'
import {directionEvidence} from '../src/lib/engine/directionAdvice.ts'
import {directionAdvice} from '../server/direction-advice.mjs'
import {directionRenderOptions} from '../server/direction-render-profile.mjs'

const brief=defaultBrief();brief.site.plotWidth=25;brief.site.plotDepth=30
const model=compile(brief),plans=distinctDirectionPlans(model,4,SITE_FORM_VERSION)
test('four directions have actual 2D differences, valid rooms and replay the same geometry when selected',()=>{
 assert.equal(plans.length,4);assert.equal(new Set(plans.map(p=>planFingerprint(p.plan).key)).size,4)
 for(const item of plans){
  assert.ok(validate(item.plan).hardChecksPass)
  const replay=generate(model,{seed:item.planSeed,massing:item.massing,formVersion:SITE_FORM_VERSION,recipe:item.plan.planRecipe})
  assert.equal(planFingerprint(replay).key,planFingerprint(item.plan).key)
 }
 for(let i=0;i<plans.length;i++)for(let j=i+1;j<plans.length;j++)assert.ok(planDistance(plans[i].plan,plans[j].plan)>.1)
})
test('recommendations reflect the supplied geometry without modifying it',()=>{
 const source=plans.map(p=>p.plan),before=JSON.stringify(source),facts=directionEvidence(source)
 assert.equal(facts.length,4);assert.equal(JSON.stringify(source),before)
 for(let i=0;i<facts.length;i++){
  assert.equal(facts[i].built,Math.round(source[i].builtAreaSqm))
  assert.ok(facts[i].open>=0&&facts[i].open<=100)
  assert.ok(facts[i].candidates.every(c=>c.score>=0&&c.score<=1&&c.reason.length>0))
 }
})
const input={query:'Ground floor bedrooms for elderly family members',options:directionEvidence(plans.map(p=>p.plan)).map(d=>({id:d.id,candidates:d.candidates}))}
test('AI ranking selects existing evidence only and identifies its free local model',async()=>{
 const result=await directionAdvice(input,async({candidates})=>({similarity:candidates.map(c=>c.startsWith('Living on the ground')?1:0)}))
 assert.equal(result.mode,'local-ai');assert.match(result.model,/MiniLM/)
 assert.equal(result.recommendations.length,4)
 for(const item of result.recommendations){const option=input.options.find(o=>o.id===item.planId);assert.ok(option.candidates.some(c=>c.id===item.id&&c.reason===item.reason))}
})
test('inference failures use honest plan analysis and invalid evidence is rejected',async()=>{
 const fallback=await directionAdvice({...input,query:'Offline profile'},async()=>{throw Error('offline')})
 assert.equal(fallback.mode,'plan-analysis');assert.equal(fallback.model,null);assert.equal(fallback.recommendations.length,4)
 await assert.rejects(()=>directionAdvice({...input,options:[{...input.options[0],candidates:[{...input.options[0].candidates[0],score:Infinity}]}]}))
})
test('simultaneous identical advice requests share one inference job',async()=>{
 let calls=0
 const rank=async({candidates})=>{calls++;await new Promise(resolve=>setTimeout(resolve,20));return {similarity:candidates.map(()=>.5)}}
 const payload={...input,query:'Concurrent family brief'}
 const [a,b]=await Promise.all([directionAdvice(payload,rank),directionAdvice(payload,rank)])
 assert.deepEqual(a,b);assert.equal(calls,1)
})
test('faster direction images never reduce final villa render settings',()=>{
 assert.deepEqual(directionRenderOptions({exact:true,directionPreview:true,quality:'preview'}),['--samples','16','--resolution','960x720'])
 for(const request of [{quality:'final',exact:true,directionPreview:true},{quality:'preview',exact:true},{quality:'preview',directionPreview:true}])assert.deepEqual(directionRenderOptions(request),[])
})

test('early image availability requires a complete PNG from the checked candidate and correct job state',async()=>{
 const {mkdtempSync,mkdirSync,writeFileSync}=await import('node:fs')
 const {resolve}=await import('node:path')
 const {readyHero}=await import('../server/direction-render-profile.mjs')
 const directory=mkdtempSync(resolve('output/direction-preview-test-')),candidate=resolve(directory,'candidates','42')
 mkdirSync(candidate,{recursive:true});const file=resolve(candidate,'villa_42_hero.png')
 const job={directory,seed:42,status:'rendering'}
 assert.equal(readyHero(job),null)
 writeFileSync(file,Buffer.alloc(100));assert.equal(readyHero(job),null)
 const complete=Buffer.alloc(100);complete.write('IEND',92,'ascii');writeFileSync(file,complete)
 assert.equal(readyHero(job),file)
 assert.equal(readyHero({...job,status:'failed'}),null)
 assert.equal(readyHero({...job,status:'generating'}),null)
 assert.equal(readyHero({...job,seed:43}),null)
})
