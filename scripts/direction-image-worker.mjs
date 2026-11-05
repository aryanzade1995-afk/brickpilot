import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {availableParallelism} from 'node:os'
import {generateAlternativeDesign} from '../src/lib/engine/generateAlternativeDesign.ts'
import {createFinishAssignments} from '../src/lib/cost/finishAssignments.ts'
import {runBlender} from '../server/blender-process.mjs'
import {directionRenderOptions} from '../server/direction-render-profile.mjs'
import {evaluateRealizedVilla} from '../server/villa-shape.mjs'
import {writeAtomicJson} from '../server/atomic-json.mjs'

const directory=resolve(process.argv[2])
const progress={id:directory.split(/[\\/]/).at(-1),directory,mode:'direction-image',workerPid:process.pid,debug:[]}
const emit=async event=>{Object.assign(progress,event);await writeAtomicJson(resolve(directory,'status.json'),progress);process.stdout.write(JSON.stringify(event)+'\n')}
try{
 const request=JSON.parse(await readFile(resolve(directory,'request.json'),'utf8'))
 if(request.exact!==true||request.directionPreview!==true||request.quality!=='preview')throw Error('An exact Directions preview is required')
 const payload={...generateAlternativeDesign(request.plan,request.seed),specifications:createFinishAssignments(request.plan)}
 const stage=resolve(directory,'candidates',String(request.seed)),name=`villa_${request.seed}`
 await mkdir(stage,{recursive:true})
 const input=resolve(stage,'input.json');await writeFile(input,JSON.stringify(payload))
 progress.seed=request.seed
 await emit({status:'generating',phase:'Rendering the checked villa view',progress:20})
 // Geometry, materials, lighting, samples and pixel size are unchanged. The
 // unused .blend, GLB, front and aerial artifacts wait until selection.
 await runBlender(['--input',input,'--out-dir',stage,'--name',name,'--production-names','--quality','preview',...directionRenderOptions(request),'--direction-image'],resolve(directory,'blender.log'),undefined,Math.max(1,Math.floor(availableParallelism()/4)))
 const manifest=JSON.parse(await readFile(resolve(stage,name+'.json'),'utf8'))
 if(manifest.planId!==payload.buildingModel.planId||manifest.seed!==request.seed)throw Error('Direction identity changed')
 const gate=evaluateRealizedVilla(payload,manifest.realizedGeometry,[],1)
 if(!gate.accepted)throw Error(gate.reason)
 const image={seed:request.seed,planId:manifest.planId,finishSignature:payload.specifications.signature,quality:'preview',file:name+'_hero.png',render:manifest.visualization.render}
 await writeFile(resolve(directory,'direction-image.json'),JSON.stringify(image))
 await emit({status:'complete',phase:'Ready',progress:100,directionImage:image})
}catch(error){await emit({status:'failed',phase:'Preview stopped',error:error.message});process.exitCode=1}
