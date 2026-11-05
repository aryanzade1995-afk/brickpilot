import test from 'node:test'
import assert from 'node:assert/strict'
import {registerHooks} from 'node:module'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {createBriefValidationClient} from '../src/state/briefValidationClient.ts'
import {assessBriefFit} from '../src/lib/engine/planner/fit.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {validate} from '../src/lib/rules/index.ts'

class WorkerMock{
 sent=[];terminated=false;onmessage=null;onerror=null
 postMessage(request){this.sent.push(request)}
 terminate(){this.terminated=true}
 emit(data){this.onmessage?.({data})}
}
const request=(key,kind='fit')=>({key,kind,brief:defaultBrief()})
function setup(t){
 t.mock.timers.enable({apis:['setTimeout']})
 const workers=[],client=createBriefValidationClient(()=>{const worker=new WorkerMock();workers.push(worker);return worker},{debounceMs:80,timeoutMs:1000,idleMs:5000})
 t.after(()=>client.dispose())
 return {workers,client,tick:ms=>t.mock.timers.tick(ms)}
}
test('rapid brief edits coalesce and late cancelled results cannot approve current inputs',t=>{
 const {workers,client,tick}=setup(t),seen=[]
 const off=client.subscribe(request('old'),r=>seen.push(r));tick(80)
 off();client.subscribe(request('latest'),r=>seen.push(r));tick(80)
 assert.ok(workers[0].terminated)
 workers[0].emit({key:'old',complete:true,result:{fit:{fits:true}}})
 assert.equal(seen.length,0)
 workers[1].emit({key:'latest',complete:false,result:{fit:{fits:false},suggestionsChecking:true}})
 assert.equal(seen.at(-1).result.fit.fits,false)
 assert.equal(seen.at(-1).result.suggestionsChecking,true)
 workers[1].emit({key:'latest',complete:true,result:{fit:{fits:false},suggestionsChecking:false,suggestions:[]}})
 assert.equal(client.get('latest').fit.fits,false)
})
test('completed checks reuse the loaded worker, identical requests and cache immediately',t=>{
 const {workers,client,tick}=setup(t),a=[],b=[]
 const off=client.subscribe(request('a'),r=>a.push(r))
 client.subscribe(request('a'),r=>b.push(r));tick(80)
 assert.equal(workers.length,1);assert.equal(workers[0].sent.length,1)
 workers[0].emit({key:'a',complete:true,result:{fit:{fits:true}}});off();tick(1)
 assert.equal(a.length,1);assert.equal(b.length,1);assert.equal(workers[0].terminated,false)
 const cache=[];client.subscribe(request('a'),r=>cache.push(r));assert.equal(cache[0].result.fit.fits,true)
 client.subscribe(request('b'),()=>{});tick(80)
 assert.equal(workers.length,1);assert.equal(workers[0].sent.length,2)
})
test('fit result survives optional-suggestion failure; shape searches cannot block the fit lane',t=>{
 const {workers,client,tick}=setup(t),seen=[]
 client.subscribe(request('fit'),r=>seen.push(r));client.subscribe(request('shape','shapes'),()=>{});tick(80)
 assert.equal(workers.length,2)
 workers[0].emit({key:'fit',complete:false,result:{fit:{fits:false},suggestionsChecking:true}})
 workers[0].onerror(new Error('suggestions failed'))
 assert.equal(seen.at(-1).result.fit.fits,false);assert.equal(seen.at(-1).error,undefined)
 assert.equal(seen.at(-1).result.suggestionsChecking,false)
 assert.equal(workers[1].terminated,false)
})
test('unmount cancels unfinished work and a timeout stays retryable',t=>{
 const {workers,client,tick}=setup(t),seen=[]
 const off=client.subscribe(request('unmount'),()=>{});tick(80);off();tick(1)
 assert.ok(workers[0].terminated)
 client.subscribe(request('timeout'),r=>seen.push(r));tick(80);tick(1000)
 assert.match(seen.at(-1).error,/too long/)
 client.invalidate('timeout');client.subscribe(request('timeout'),r=>seen.push(r));tick(80)
 workers.at(-1).emit({key:'timeout',complete:true,result:{fit:{fits:true}}})
 assert.equal(seen.at(-1).result.fit.fits,true)
})
test('the faster availability path retains production hard checks across styles and constrained sites',()=>{
 for(const [w,d,character,vastu] of [[18,24,'modern-box','ignore'],[9,11,'modern-box','ignore'],[25,30,'modern-box','strict'],[18,24,'coastal-bungalow','ignore'],[18,24,'courtyard-indian','ignore']]){
  const b=defaultBrief();b.site.plotWidth=w;b.site.plotDepth=d;b.style.character=character;b.lifestyle.vastu=vastu
  assert.equal(assessBriefFit(b).fits,validate(generate(compile(b))).hardChecksPass)
 }
})
test('real worker publishes the checked fit before doing optional suggestion searches',async()=>{
 registerHooks({resolve(s,c,next){return s.startsWith('@/')?{url:new URL(`../src/${s.slice(2)}`,import.meta.url).href,shortCircuit:true}:next(s,c)}})
 const updates=[],previous=globalThis.self
 globalThis.self={postMessage:message=>updates.push(message)}
 try{
  await import('../src/state/briefValidation.worker.ts')
  const brief=defaultBrief();brief.site.plotWidth=9;brief.site.plotDepth=11;brief.rooms.bedroomsWithBath=3
  self.onmessage({data:{key:'small',kind:'fit',brief}})
  assert.equal(updates.length,1);assert.equal(updates[0].complete,false)
  assert.equal(updates[0].result.fit.fits,false);assert.equal(updates[0].result.suggestionsChecking,true)
  await new Promise(resolve=>setTimeout(resolve,5))
  assert.equal(updates.at(-1).complete,true);assert.equal(updates.at(-1).result.suggestionsChecking,false)
 }finally{globalThis.self=previous}
})
