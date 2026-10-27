import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
registerHooks({resolve(s,c,next){return s.startsWith('@/')?{url:new URL('../src/'+s.slice(2),import.meta.url).href,shortCircuit:true}:next(s,c)}})
const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};globalThis.window={localStorage}
const {emptyImpact,parseImpact}=await import('../src/lib/impact/schema.ts')
const {housingTopic,waterImpact,roofHeatComparison,carbonImpact,pilotImpact,analyzeImpact,affordableAlternatives}=await import('../src/lib/impact/analysis.ts')
const {defaultBrief}=await import('../src/lib/model/brief.ts')
const {compile}=await import('../src/lib/model/canonical.ts')
const {generate}=await import('../src/lib/engine/generate.ts')
const {estimateBoq}=await import('../src/lib/cost/boq.ts')
const {validate}=await import('../src/lib/rules/index.ts')
const {useSocialImpact}=await import('../src/state/socialImpact.ts')
const {useStudio}=await import('../src/state/studio.ts')
const {useProjects,applyCore,parseCore}=await import('../src/state/projects.ts')
const {translate}=await import('../src/lib/i18n/index.ts')
const brief=defaultBrief();brief.site.plotWidth=25;brief.site.plotDepth=30
const design=generate(compile(brief),{seed:41}),cost=estimateBoq(design),report=validate(design)

test('unknown inputs remain unknown; schema rejects unsupported versions, nonfinite values and duplicate factors',()=>{
 const doc=emptyImpact();assert.equal(waterImpact(doc.water,'key').litres,null);assert.equal(roofHeatComparison(doc.climate),null)
 assert.equal(parseImpact({...doc,version:2}),null)
 assert.equal(parseImpact({...doc,budgetInr:Infinity}),null)
 assert.equal(parseImpact({...doc,water:{...doc.water,runoff:1.1}}),null)
 const factor={lineId:'line',specId:'a',unit:'m²',low:1,high:2,source:'EPD',boundary:'A1-A3',geometryKey:'key'}
 assert.equal(parseImpact({...doc,carbon:[factor,factor]}),null)
})
test('water reuses the shared loss-once calculation, conserves mass, supports zero and marks old roof inputs for review',()=>{
 const w={...emptyImpact().water,rainfallMm:10,areaM2:100,runoff:.8,efficiency:.9,capacityL:500,dailyDemandL:100,source:'Entered event',geometryKey:'key'}
 const a=waterImpact(w,'key');assert.equal(a.litres,720)
 assert.equal(a.storage.overflowLitres,220);assert.equal(a.storage.servedLitres,100);assert.equal(a.storage.storageLitres,400)
 assert.equal(a.litres,a.storage.storageLitres+a.storage.servedLitres+a.storage.overflowLitres)
 const zero=waterImpact({...w,rainfallMm:0},'key');assert.equal(zero.litres,0);assert.equal(zero.storage.unmetLitres,100)
 assert.equal(waterImpact(w,'different-roof').litres,null)
 assert.equal(waterImpact({...w,source:''},'key').litres,null)
})
test('roof comparison is only U area delta-T conduction; zero is real and no temperature reduction is inferred',()=>{
 const c={areaM2:100,currentRoofU:2,proposedRoofU:.5,temperatureDifferenceK:10,source:'User entered test'}
 assert.deepEqual(roofHeatComparison(c),{currentW:2000,proposedW:500,differenceW:1500})
 assert.equal(roofHeatComparison({...c,temperatureDifferenceK:0}).differenceW,0)
 assert.equal(roofHeatComparison({...c,source:''}),null)
})
test('carbon quantities match unit, specification and source geometry; mixed life-cycle boundaries never form one total',()=>{
 const doc=emptyImpact(),[a,b]=cost.boq
 const factor=l=>({lineId:l.id,specId:l.specId,unit:l.unit,low:1,high:2,source:'User-entered EPD',boundary:'A1-A3',geometryKey:cost.quantities.geometryKey})
 doc.carbon=[factor(a)];assert.equal(carbonImpact(cost,doc).low,a.quantity)
 for(const patch of [{unit:'incompatible'},{geometryKey:'different'},{specId:'different-product'}]){
  const next={...doc,carbon:[{...doc.carbon[0],...patch}]};assert.equal(carbonImpact(cost,next).covered,0)
 }
 doc.carbon.push({...factor(b),boundary:'A1-A5'});assert.equal(carbonImpact(cost,doc).mixedBoundaries,true);assert.equal(carbonImpact(cost,doc).low,null)
})
test('only the latest anonymous household outcome counts; evidence and comparable scope are required for reported benefits',()=>{
 const doc=emptyImpact(),base={householdCode:'HH-1',date:'2026-10-01',stage:'supported',evidence:'Site note',baselineCostInr:100,actualCostInr:80,sameScope:true,measuredWaterL:100,resilienceNote:'Observed after rainfall'}
 doc.pilots=[{...base,id:'1'},{...base,id:'2',householdCode:'hh-1',date:'2026-10-02',actualCostInr:110,measuredWaterL:120},{...base,id:'3',householdCode:'HH-2',evidence:''}]
 const a=pilotImpact(doc);assert.equal(a.households,1);assert.equal(a.costDifference,-10);assert.equal(a.measuredWaterL,120)
 doc.pilots[1].sameScope=false;assert.equal(pilotImpact(doc).costRecords,0)
 assert.equal(pilotImpact(emptyImpact()).households,0)
})
test('whole-building analysis and material comparisons are deterministic and cannot change quantities, architecture, selections or costs',()=>{
 const before=JSON.stringify({design,brief,cost,report}),doc=emptyImpact()
 const a=analyzeImpact(design,brief,cost,report,doc),b=analyzeImpact(design,brief,cost,report,doc)
 assert.deepEqual(a,b);assert.equal(JSON.stringify({design,brief,cost,report}),before)
 assert.equal(a.annualEnergyDifference,null);assert.equal(a.budgetDifference,null)
 assert.ok(a.checks.some(c=>c.id==='flood'&&c.status==='Not checked'))
 for(const row of affordableAlternatives(cost)){assert.ok(row.difference>0);assert.equal(cost.boq.find(l=>l.id===row.lineId).quantity,row.quantity)}
})
test('impact inputs survive project save, reload, switching, duplication and version restore without changing accepted design state',()=>{
 useProjects.setState({items:[],currentId:null,stage:'concept'})
 useStudio.setState({brief,result:null,pinned:null,layout:null,existing:null});useStudio.getState().run()
 const before=useStudio.getState(),doc=emptyImpact();doc.budgetInr=2500000
 assert.ok(useSocialImpact.getState().update(doc));const saved=useProjects.getState().save({name:'Community pilot'});assert.ok(saved)
 assert.equal(useStudio.getState().result,before.result);assert.equal(useStudio.getState().pinned,before.pinned)
 assert.deepEqual(saved.core.socialImpact,doc)
 applyCore(parseCore(JSON.parse(JSON.stringify(saved.core))));assert.deepEqual(useSocialImpact.getState().document,doc)
 const changed={...doc,budgetInr:2600000};useSocialImpact.getState().update(changed);useProjects.getState().save({label:'Updated budget'})
 const project=useProjects.getState().items.find(p=>p.id===saved.id),version=project.versions.find(v=>v.core.socialImpact.budgetInr===2500000)
 assert.ok(useProjects.getState().restore(saved.id,version.id));assert.equal(useSocialImpact.getState().document.budgetInr,2500000)
 const copy=useProjects.getState().duplicate(saved.id);assert.ok(copy)
 useProjects.getState().startNew();assert.equal(useSocialImpact.getState().document,null)
 useProjects.getState().open(copy);assert.equal(useSocialImpact.getState().document.budgetInr,2500000)
 const legacy={...saved.core};delete legacy.socialImpact;applyCore(parseCore(legacy));assert.equal(useSocialImpact.getState().document,null)
 const original=useSocialImpact.getState().document;assert.equal(useSocialImpact.getState().update({...doc,budgetInr:-1}),false);assert.equal(useSocialImpact.getState().document,original)
})
test('all views and housing-guidance responses support Hindi and Marathi through the existing language system',()=>{
 for(const key of ['Social Impact','Affordable housing','Climate-smart homes','Water conservation','Sustainable construction','Home safety','Inclusive housing','Community housing','Housing assistant','Essential tools','Impact dashboard','Building intelligence','Pilot outcomes','Compare measured finish lines first. Review product performance and local quotations before choosing a lower-cost option.'])
  for(const language of ['hi','mr'])assert.notEqual(translate(key,language),key)
})


test('guidance recognizes natural Hindi and Marathi word forms and never guesses an unrelated topic',()=>{
 assert.equal(housingTopic('How can I lower costs?'),'affordability')
 assert.equal(housingTopic('पाण्याची बचत कशी करू?'),'water')
 assert.equal(housingTopic('निर्माण की लागत कम करनी है'),'affordability')
 assert.equal(housingTopic('वायुवीजन कसे सुधारावे?'),'climate')
 assert.equal(housingTopic('व्हीलचेअर प्रवेश'),'access')
 assert.equal(housingTopic('Hello there'),null)
 assert.equal(housingTopic('chair'),null)
 assert.equal(housingTopic('stairs'),'access')
})


test('working impact inputs rehydrate defensively and blocked storage is reported without pretending they were saved',async()=>{
 const doc=emptyImpact();doc.budgetInr=123456;useSocialImpact.getState().update(doc)
 useSocialImpact.setState({document:null});storage.set('formstead.social-impact.v1',JSON.stringify({state:{document:doc},version:0}))
 await useSocialImpact.persist.rehydrate();assert.equal(useSocialImpact.getState().document.budgetInr,123456)
 storage.set('formstead.social-impact.v1',JSON.stringify({state:{document:{version:99}},version:0}))
 await useSocialImpact.persist.rehydrate();assert.equal(useSocialImpact.getState().document,null)
 const original=localStorage.setItem;localStorage.setItem=()=>{throw new Error('Storage full')}
 try{assert.equal(useSocialImpact.getState().update(doc),false);assert.match(useSocialImpact.getState().error,/storage/i);assert.equal(useSocialImpact.getState().document.budgetInr,123456)}finally{localStorage.setItem=original;useSocialImpact.getState().clear()}
})
