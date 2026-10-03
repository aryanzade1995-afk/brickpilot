import {mkdir,writeFile} from 'node:fs/promises'
import {createServer} from 'vite'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {mlReviewBriefs} from './ml-review-data.mjs'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {validate} from '../src/lib/rules/index.ts'
import {planFeatures,planDistance} from '../src/lib/engine/planner/planDiversity.ts'
import {planFingerprint} from '../src/lib/engine/planner/planFingerprint.ts'
import {buildMassing} from '../src/lib/three/buildMassing.ts'
import {createBlenderInput} from './export-blender-input.mjs'

const dir='output/ml-review';await mkdir(dir,{recursive:true})
const records=[], examples=[]
for(const {name,brief} of mlReviewBriefs()){
 const model=compile(brief)
 for(let seed=1;seed<=3;seed++){
  const baseline=generate(model,{seed,planner:'baseline'}),learned=generate(model,{seed,planner:'ml'})
  const before=validate(baseline),after=validate(learned)
  if(before.hardChecksPass&&!after.hardChecksPass)throw Error(`Regression: ${name}, ${seed}`)
  const bf=planFeatures(baseline),lf=planFeatures(learned)
  const boxes=buildMassing(learned).boxes
  if(!boxes.every(b=>b.pos.every(Number.isFinite)&&b.size.every(n=>Number.isFinite(n)&&n>0)))throw Error('Invalid 3D geometry')
  const entry={name,seed,baselineValid:before.hardChecksPass,learnedValid:after.hardChecksPass,
   baselineFamily:baseline.massingType,learnedFamily:learned.massingType,
   changedRooms:JSON.stringify(baseline.floors.map(f=>f.rooms))!==JSON.stringify(learned.floors.map(f=>f.rooms)),
   changedFootprint:bf.some((n,i)=>n!==lf[i]),distance:planDistance(baseline,learned),
   exemplar:learned.planProposal?.exemplarId??null,model:learned.planProposal?.version??'validated-rule-fallback'}
  records.push(entry)
  if(seed===1){examples.push({name,baseline,learned,entry})
   if(after.hardChecksPass)await writeFile(`${dir}/blender-${examples.length}.json`,JSON.stringify(createBlenderInput(learned,41)))
  }
 }
}
// Same requirements, 20 seeds: compare exact geometry and footprint diversity.
const reference=mlReviewBriefs()[8].brief, samePlan=[], seedExamples=[]
for(const planner of ['baseline','ml']){
 const plans=Array.from({length:20},(_,i)=>generate(compile(reference),{seed:i+1,planner}))
 if(planner==='ml')seedExamples.push(...plans)
 samePlan.push({planner,valid:plans.filter(p=>validate(p).hardChecksPass).length,
  uniquePlans:new Set(plans.map(p=>planFingerprint(p).key)).size,
  uniqueFootprints:new Set(plans.map(p=>JSON.stringify(planFeatures(p)))).size,
  consecutiveChangedFootprints:plans.slice(1).filter((p,i)=>JSON.stringify(planFeatures(plans[i]))!==JSON.stringify(planFeatures(p))).length,
  consecutiveMeanDistance:plans.slice(1).reduce((s,p,i)=>s+planDistance(plans[i],p),0)/19})
}
const summary={pairs:records.length,baselineValid:records.filter(r=>r.baselineValid).length,
 learnedValid:records.filter(r=>r.learnedValid).length,changedRoomLayouts:records.filter(r=>r.changedRooms).length,
 changedFootprints:records.filter(r=>r.changedFootprint).length,learnedGuidanceUsed:records.filter(r=>r.exemplar!==null).length,
 meanDistance:records.reduce((s,r)=>s+r.distance,0)/records.length,sameBriefSeeds:samePlan}
await writeFile(`${dir}/comparison.json`,JSON.stringify({summary,records},null,2))
const server=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,entries:[]},
 server:{middlewareMode:true,watch:null,ws:false,hmr:false},appType:'custom'})
try{
 const {FloorDrawing}=await server.ssrLoadModule('/src/lib/draw/FloorDrawing.tsx')
 const sheets=examples.map(({name,baseline,learned,entry})=>`<section><h2>${name}</h2><p>Seed 1 · ${entry.changedFootprint?'Footprint changed':entry.changedRooms?'Rooms changed; footprint similar':'Same valid geometry'} · guidance ${entry.exemplar??'rule fallback'}</p><div class="pair">${[baseline,learned].map((p,i)=>`<article><h3>${i?'Learned guidance':'Baseline'} · ${p.massingType}</h3>${renderToStaticMarkup(React.createElement(FloorDrawing,{floor:p.floors[0],model:p.model,theme:'paper',siteFeatures:p.siteFeatures}))}</article>`).join('')}</div></section>`).join('')
 const gallery=seedExamples.map((p,i)=>`<article><h3>Seed ${i+1} · ${p.massingType}</h3>${renderToStaticMarkup(React.createElement(FloorDrawing,{floor:p.floors[0],model:p.model,theme:'paper',siteFeatures:p.siteFeatures}))}</article>`).join('')
 await writeFile(`${dir}/index.html`,`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>2D learned planner comparison</title><style>body{margin:32px;font:15px system-ui;background:#f3f3f0;color:#222}main{max-width:1500px;margin:auto}.pair,.gallery{display:grid;grid-template-columns:1fr 1fr;gap:24px}.gallery{grid-template-columns:repeat(4,1fr)}section{background:white;margin:24px 0;padding:24px;border:1px solid #ccc}svg{width:100%;height:auto}pre{white-space:pre-wrap}a{color:inherit}h3{font-size:15px}@media(max-width:700px){.pair,.gallery{grid-template-columns:1fr}body{margin:12px}}</style><main><h1>Learned 2D planner: measured comparison</h1><p>20 briefs · ${summary.pairs} paired comparisons · ${summary.learnedValid} valid · ${summary.changedRoomLayouts} changed room layouts · ${summary.changedFootprints} changed footprints.</p><p>Same requirements and seed on each pair. Production rooms, walls and openings; materials do not affect distance.</p><a href="comparison.json">Download measured results</a><section><h2>One brief, 20 seeds</h2><p>Baseline: ${samePlan[0].uniqueFootprints} occupied footprint. Learned: ${samePlan[1].uniqueFootprints} occupied footprints and ${samePlan[1].uniquePlans} distinct plans. Every seed passes all hard checks.</p><div class="gallery">${gallery}</div></section><h2>Before / after on 20 briefs</h2>${sheets}</main>`)
}finally{await server.close()}
console.log(JSON.stringify(summary))
