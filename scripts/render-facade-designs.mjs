import {mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {FACADE_DESIGNS} from '../src/lib/model/facadeDesign.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {generateAlternativeDesign} from '../src/lib/engine/generateAlternativeDesign.ts'
import {createFinishAssignments} from '../src/lib/cost/finishAssignments.ts'
import {runBlender} from '../server/blender-process.mjs'
const brief=defaultBrief();brief.site.plotWidth=18;brief.site.plotDepth=24;brief.lifestyle.vastu='ignore'
const plan=generate(compile(brief),{seed:41,massing:'stepped'})
const mixed=process.argv.includes('--mixed')
const designs=mixed?[['MIXED','Randomized facade mix']]:FACADE_DESIGNS
const root=resolve(mixed?'output/facade-mix':'output/facade-designs');await mkdir(root,{recursive:true})
const timings=[]
for(const [id,label] of designs){
 const dir=resolve(root,id);await mkdir(dir,{recursive:true})
 const source=structuredClone(plan);source.model.brief.facadeDesign={version:1,facadeStyle:id,facadeSeed:77085,facadeVariation:.75,materialPalette:'selected'}
 const payload={...generateAlternativeDesign(source,41),specifications:createFinishAssignments(source)}
 await writeFile(resolve(dir,'input.json'),JSON.stringify(payload))
 if(process.argv.includes('--inputs-only'))continue
 const started=performance.now()
 try{
  await runBlender(['--input',resolve(dir,'input.json'),'--out-dir',dir,'--name',id,'--quality','preview','--render','--camera','HeroPerspectiveCamera','--resolution','800x700','--samples','24'],resolve(dir,'blender.log'),240000,4)
  timings.push({id,label,status:'complete',ms:Math.round(performance.now()-started),parts:payload.facadeDesign.parts.length})
 }catch(error){timings.push({id,label,status:'failed',error:error.message})}
 console.log(timings.at(-1));await writeFile(resolve(root,'timings.json'),JSON.stringify(timings,null,2))
}
await writeFile(resolve(root,'index.html'),`<!doctype html><meta charset="utf-8"><title>Facade design review</title><style>body{background:#eeeae3;color:#242724;font:14px system-ui;margin:24px}h1{font:28px Georgia}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}figure{margin:0;background:white;border:1px solid #d0d2cd}img{width:100%;display:block}figcaption{padding:12px;font-size:12px}b{display:block;margin-bottom:4px}</style><h1>Formstead · ${mixed?'randomized facade mix':'ten facade designs'}</h1><p>Same validated rooms, windows, structural walls and architectural seed. Facade seed 77085.</p><main>${designs.map(([id,label])=>`<figure><img src="${id}/${id}.png"><figcaption><b>${id} · ${label}</b>Procedural geometry · same validated house</figcaption></figure>`).join('')}</main>`)
if(timings.some(t=>t.status==='failed'))process.exitCode=1
