import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {directionImageKey,readDirectionImageCache,writeDirectionImageCache} from '../server/direction-image-cache.mjs'
import {createRenderQueue} from '../server/render-queue.mjs'
import {readyHero} from '../server/direction-render-profile.mjs'

test('image cache identity includes the complete plan, finishes, exact seed and renderer revision',()=>{
 const request={plan:{floors:[{level:0,rooms:[]}],finishes:{wall:'stone'}},seed:42,quality:'preview'}
 const key=directionImageKey(request,'renderer-a')
 assert.equal(key,directionImageKey({quality:'preview',seed:42,plan:{finishes:{wall:'stone'},floors:[{rooms:[],level:0}]}},'renderer-a'))
 for(const changed of [{...request,seed:43},{...request,quality:'final'},
  {...request,plan:{...request.plan,finishes:{wall:'paint'}}},
  {...request,plan:{...request.plan,floors:[{level:1,rooms:[]}]}}])assert.notEqual(key,directionImageKey(changed,'renderer-a'))
 assert.notEqual(key,directionImageKey(request,'renderer-b'))
})

test('image cache survives restoration and incomplete images cannot become ready',async()=>{
 const root=await mkdtemp(resolve(tmpdir(),'formstead-directions-'))
 try{
  const key=directionImageKey({plan:{},seed:42,quality:'preview'},'test'),id='12345678-1234-1234-1234-123456789abc'
  assert.equal(await readDirectionImageCache(root,key),null)
  await writeDirectionImageCache(root,key,id)
  assert.equal(await readDirectionImageCache(root,key),id)
  const candidate=resolve(root,id,'candidates','42');await mkdir(candidate,{recursive:true})
  const file=resolve(candidate,'villa_42_hero.png'),job={directory:resolve(root,id),mode:'direction-image',seed:42,status:'complete'}
  assert.equal(readyHero(job),null)
  await writeFile(file,Buffer.alloc(100));assert.equal(readyHero(job),null)
  const complete=Buffer.alloc(100);complete.write('IEND',92,'ascii');await writeFile(file,complete)
  assert.equal(readyHero(job),file)
  for(const status of ['queued','generating','failed'])assert.equal(readyHero({...job,status}),null)
  assert.equal(readyHero({...job,mode:undefined}),null)
  assert.equal(JSON.parse(await readFile(resolve(root,'direction-image-cache',key+'.json'),'utf8')).jobId,id)
 }finally{await rm(root,{recursive:true,force:true})}
})

test('independent card renders overlap; full exports remain exclusive and failures release their slot',async()=>{
 const started=[],running=new Set(),releases=new Map(),violations=[]
 let finish
 const allDone=new Promise(resolve=>{finish=resolve})
 const work=async job=>{
  if(job.mode!=='direction-image'&&running.size)violations.push(job.id)
  if([...running].some(id=>id==='full'))violations.push(job.id)
  running.add(job.id);started.push(job.id)
  await new Promise(resolve=>releases.set(job.id,resolve))
  running.delete(job.id)
  if(job.id==='last')finish()
  if(job.id==='broken')throw Error('Test render failed')
 }
 const queue=createRenderQueue(work,2)
 for(const [id,mode] of [['a','direction-image'],['broken','direction-image'],['c','direction-image'],['full','villa'],['last','direction-image']])queue.push({id,mode})
 const tick=()=>new Promise(resolve=>setImmediate(resolve))
 await tick();assert.deepEqual(started,['a','broken'])
 releases.get('broken')();await tick();assert.deepEqual(started,['a','broken','c'])
 releases.get('a')();await tick();assert.equal(started.includes('full'),false)
 releases.get('c')();await tick();assert.deepEqual(started,['a','broken','c','full'])
 releases.get('full')();await tick();assert.equal(started.at(-1),'last')
 releases.get('last')();await allDone
 assert.deepEqual(violations,[]);assert.equal(queue.length,0)
})
