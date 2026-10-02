/** Audit building outlines, not room partition hashes or painted facade labels.
 * First run writes production Blender inputs. --measure adds realized comparisons
 * after blender/review_wings.py has rendered them. */
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {validate} from '../src/lib/rules/index.ts'
import {createBuildingModel} from '../src/lib/engine/buildingModel.ts'
import {generateAlternativeDesign} from '../src/lib/engine/generateAlternativeDesign.ts'
import {rectUnionEdges} from '../src/lib/geometry.ts'
import {realizedSimilarity} from '../server/villa-shape.mjs'
import {WING_GALLERY_FAMILIES} from './wing-gallery-data.mjs'

const directory='output/wing-geometry-review'
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const outlineKey=building=>hash(building.floors.map(f=>[f.elevationMm,f.heightMm,
 rectUnionEdges(f.footprint).map(e=>[e.side,e.a.x,e.a.y,e.b.x,e.b.y]).sort()]))
const read=async path=>JSON.parse(await readFile(path,'utf8'))
const write=async (path,value)=>writeFile(path,JSON.stringify(value,null,2))
const report={gallery:[],samples:[],comparisons:[],limitations:[
 'Different room arrangements do not necessarily create a new outer building shape.',
 'A fixed-plan exterior seed preserves occupied rooms, stairs, openings and floor plates.',
 'Distinct geometric outlines do not establish 100 fundamentally different architectural concepts.'
]}
await mkdir(`${directory}/inputs`,{recursive:true})
for(const [family] of WING_GALLERY_FAMILIES){
 const group=await read(`output/wing-review/families/${family}.json`)
 const keys=group.designs.map(plan=>{
  if(!validate(plan).hardChecksPass||plan.massingType!==family)throw new Error('Invalid gallery source plan')
  return outlineKey(createBuildingModel(plan))
 })
 report.gallery.push({family,plans:keys.length,uniqueOccupiedOutlines:new Set(keys).size,
  consecutiveDifferent:keys.slice(1).filter((key,i)=>key!==keys[i]).length,consecutivePairs:keys.length-1})
}
const brief=defaultBrief();brief.site.plotWidth=24;brief.site.plotDepth=30
let uPlan
for(const [family,label] of WING_GALLERY_FAMILIES){
 brief.style.massing=family
 const plan=generate(compile(brief),{seed:41})
 if(family==='u-wing')uPlan=plan
 const payload=generateAlternativeDesign(plan,41)
 const name=family
 if(!process.argv.includes('--measure'))await write(`${directory}/inputs/${name}.json`,payload)
 report.samples.push({name,label,family,planSeed:plan.planSeed,exteriorSeed:41,
  sourcePlanId:payload.buildingModel.planId,occupiedOutline: outlineKey(payload.buildingModel),
  input:`inputs/${name}.json`,render:true})
}
for(const seed of [1,2]){
 const payload=generateAlternativeDesign(uPlan,seed),name=`u-wing-exterior-${seed}`
 if(!process.argv.includes('--measure'))await write(`${directory}/inputs/${name}.json`,payload)
 report.samples.push({name,label:`Same U-wing plan, exterior seed ${seed}`,family:'u-wing',
  planSeed:uPlan.planSeed,exteriorSeed:seed,sourcePlanId:payload.buildingModel.planId,
  occupiedOutline:outlineKey(payload.buildingModel),input:`inputs/${name}.json`,render:false})
}
if(process.argv.includes('--measure')){
 const scenes=await Promise.all(report.samples.map(s=>read(`${directory}/scenes/${s.name}.json`)))
 for(let i=0;i<scenes.length;i++)for(let j=i+1;j<scenes.length;j++){
  const a=scenes[i],b=scenes[j],ap=a.reviewTop,bp=b.reviewTop
  const union=ap.reduce((n,v,k)=>n+Math.max(v,bp[k]),0),overlap=ap.reduce((n,v,k)=>n+Math.min(v,bp[k]),0)
  report.comparisons.push({a:report.samples[i].name,b:report.samples[j].name,
   sameOccupiedOutline:report.samples[i].occupiedOutline===report.samples[j].occupiedOutline,
   sameEvaluatedVertices:a.reviewVertexHash===b.reviewVertexHash,
   topSilhouetteSimilarityPercent:Number((100*(union?overlap/union:1)).toFixed(2)),
   existingMeshSimilarityPercent:Number((100*realizedSimilarity(a.realizedGeometry,b.realizedGeometry)).toFixed(2))})
 }
 const cards=report.samples.filter(s=>s.render).map(s=>`<article><h2>${s.label}</h2><img src="scenes/${s.name}_hero.png" alt="${s.label} white clay perspective"><img src="scenes/${s.name}_aerial.png" alt="${s.label} white clay aerial"><p>Plan seed ${s.planSeed} · exterior seed ${s.exteriorSeed}</p></article>`).join('')
 await writeFile(`${directory}/index.html`,`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Formstead · Wing geometry checks</title><style>body{margin:24px;background:#eee;color:#222;font:15px system-ui}main{max-width:1400px;margin:auto}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}article{background:white;padding:16px;border:1px solid #ccc}img{width:100%}h2{font:24px Georgia}p{line-height:1.5}table{border-collapse:collapse}td,th{padding:10px;border:1px solid #ccc}</style></head><body><main><h1>Villa layout → real 3D geometry</h1><p>Same 24 × 30 m brief and exterior seed for all four families. Blender meshes, white clay, fixed cameras, no landscaping.</p><div class="grid">${cards}</div><h2>100-plan outline audit</h2><p>The separate 40 × 60 m large-villa gallery has 100 distinct room layouts per family. Some share the same building outline.</p><table><tr><th>Family</th><th>Plans</th><th>Distinct outlines</th></tr>${report.gallery.map(s=>`<tr><td>${s.family}</td><td>${s.plans}</td><td>${s.uniqueOccupiedOutlines}</td></tr>`).join('')}</table><p>New exterior seeds keep the selected floor plan fixed. Choose another Villa layout in Brief → Style to change occupied building geometry.</p><p><a href="report.json">Full material-independent measurements</a> · <a href="../wing-review/index.html">100-seed wing gallery</a></p></main></body></html>`)
}
await write(`${directory}/report.json`,report)
console.log(JSON.stringify({gallery:report.gallery,samples:report.samples.map(s=>({name:s.name,outline:s.occupiedOutline.slice(0,12)})),comparisons:report.comparisons},null,2))
console.log(resolve(`${directory}/report.json`))
