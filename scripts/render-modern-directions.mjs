import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {runBlender} from '../server/blender-process.mjs'
import {createBlenderInput} from './export-blender-input.mjs'
import {MODERN_DIRECTION_COMPOSITIONS} from '../src/lib/model/modernCompositions.ts'
const timings=[]
for(const id of MODERN_DIRECTION_COMPOSITIONS){
 const dir=resolve('output/modern-realism',id);await mkdir(dir,{recursive:true})
 const design=JSON.parse(await readFile(`output/modern-realism/${id}-design.json`,'utf8'))
 await writeFile(resolve(dir,'input.json'),JSON.stringify(createBlenderInput(design,41)))
 const started=performance.now()
 try{await runBlender(['--input',resolve(dir,'input.json'),'--out-dir',dir,'--name',id,'--production-names','--quality','preview','--render-all'],resolve(dir,'blender.log'),300000,4)
  timings.push({id,ms:performance.now()-started,status:'complete'})
 }catch(error){timings.push({id,ms:performance.now()-started,status:'failed',error:error.message})}
 console.log(timings.at(-1))
 await writeFile('output/modern-realism/render-timings.json',JSON.stringify(timings,null,2))
}
