import {statSync,openSync,readSync,closeSync} from 'node:fs'
import {resolve} from 'node:path'
/** Card-only render settings; full/final villa requests keep their own quality. */
export function directionRenderOptions(request){
 return request.directionPreview===true&&request.exact===true&&request.quality==='preview'
  ? ['--samples','16','--resolution','960x720']:[]
}

export function readyHero(job){
  if(job.status!=='rendering'||!Number.isSafeInteger(job.seed))return null
  const path=resolve(job.directory,'candidates',String(job.seed),`villa_${job.seed}_hero.png`)
  let fd
  try{const size=statSync(path).size;if(size<32)return null;fd=openSync(path,'r');const tail=Buffer.alloc(12);readSync(fd,tail,0,12,size-12);return tail.toString('ascii',4,8)==='IEND'?path:null}catch{return null}finally{if(fd!==undefined)closeSync(fd)}
}
