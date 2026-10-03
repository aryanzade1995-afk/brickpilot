import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {join,resolve,sep} from 'node:path'
import {createServer as httpServer} from 'node:http'
import {createServer} from 'vite'
import {defaultBrief,briefSchema} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {estimateProjectBoq} from '../src/lib/cost/index.ts'
import {defaultSelection} from '../src/lib/cost/specifications.ts'
import {snapshotCost,parseCostReplay,restoreCostReplay} from '../src/lib/cost/replay.ts'
import {createPublicSheet} from '../src/lib/cost/publicSheet.ts'
import {publicSheetSchema} from '../src/lib/cost/deliverySchemas.ts'
import {handleCostShareRequest} from '../server/cost-shares.mjs'

const brief=defaultBrief();brief.specs.overrides={'floor-bedrooms':'stone'}
const design=generate(compile(brief)),selection={...defaultSelection(),catalogue:true,feePercent:7,includeGst:false},cost=estimateProjectBoq(design,brief,selection)
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'})
test.after(()=>{restoreCostReplay(null);return vite.close()})

test('saved project round-trips full finishes and the exact priced snapshot, while old records still load',async()=>{
 const {parseSavedDesignRow}=await vite.ssrLoadModule('/src/state/designs.ts')
 const replay=snapshotCost(design,brief,cost),pin={massing:design.massingType,seed:design.dna.seed,costReplay:replay}
 const row={id:'saved-review',name:'Review',brief:JSON.parse(JSON.stringify(brief)),pinned:JSON.stringify(pin),created_at:'2026-10-03',updated_at:'2026-10-03'}
 const saved=parseSavedDesignRow(row);assert.ok(saved);assert.deepEqual(saved.brief.specs.overrides,brief.specs.overrides)
 assert.deepEqual(saved.costReplay.cost.selection,cost.selection);assert.equal(saved.costReplay.cost.expected,cost.expected)
 restoreCostReplay(parseCostReplay(JSON.parse(JSON.stringify(replay))))
 const reopened=generate(compile(briefSchema.parse(row.brief)))
 assert.deepEqual(reopened.floors,design.floors)
 const estimate=estimateProjectBoq(reopened,saved.brief)
 assert.equal(estimate.expected,cost.expected);assert.equal(estimate.selection.feePercent,7);assert.equal(estimate.selection.includeGst,false)
 const changed=structuredClone(brief);changed.specs.overrides['floor-bedrooms']='tile'
 assert.notEqual(estimateProjectBoq(reopened,changed).expected,cost.expected)
 const old=parseSavedDesignRow({...row,pinned:`${design.massingType}:${design.dna.seed}`,brief:{...brief,specs:undefined,budget:100}})
 assert.equal(old.costReplay,null);assert.deepEqual(old.brief.specs.overrides,{});assert.equal('budget' in old.brief,false)
 restoreCostReplay(null)
})

test('invalid saved prices and quantities cannot replace an estimate; changing allowances invalidates the snapshot',()=>{
 const replay=snapshotCost(design,brief,cost)
 for(const mutate of [r=>r.cost.expected+=100,r=>r.cost.boq[0].qty=-1,r=>r.cost.tradeTotals[0].amount+=100,r=>r.cost.quantities.rooms[0].area='large']){
  const bad=structuredClone(replay);mutate(bad);assert.equal(parseCostReplay(bad),null)
 }
 restoreCostReplay(replay)
 assert.notEqual(estimateProjectBoq(design,brief,{...selection,feePercent:1}).expected,cost.expected)
 restoreCostReplay(null)
})

test('shared sheets contain no private brief or editable state and reject external photo paths',()=>{
 const sheet=createPublicSheet(brief,cost),text=JSON.stringify(sheet)
 assert.ok(!text.includes('household'));assert.ok(!text.includes('plotWidth'));assert.ok(!text.includes('"overrides":'))
 assert.equal(sheet.cost.expected,cost.expected);assert.equal('boq' in sheet.cost,false)
 const bad=structuredClone(sheet);bad.schedule[0].photo='https://evil.example/image.jpg';assert.equal(publicSheetSchema.safeParse(bad).success,false)
})

test('share API persists immutable snapshots across handlers, rejects writes/traversal and does not expose editing',async()=>{
 const dir=await mkdtemp('output/cost-share-test-')
 const readJson=req=>new Promise((resolve,reject)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{try{resolve(JSON.parse(body))}catch(e){reject(e)}})})
 const server=httpServer(async(req,res)=>{if(!await handleCostShareRequest(req,res,readJson,dir)){res.writeHead(404);res.end()}})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`
 try{
  const sheet=createPublicSheet(brief,cost),response=await fetch(`${origin}/api/cost-shares`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(sheet)})
  assert.equal(response.status,201);const {path}=await response.json();assert.match(path,/^\/share\/finishes\/[a-f0-9]{64}$/)
  const token=path.split('/').at(-1),url=`${origin}/api/cost-shares/${token}`
  const before=await (await fetch(url)).json();assert.equal(before.cost.expected,cost.expected)
  for(const method of ['PUT','PATCH','DELETE','POST'])assert.equal((await fetch(url,{method})).status,405)
  assert.deepEqual(await (await fetch(url)).json(),before)
  assert.deepEqual(JSON.parse(await readFile(join(dir,`${token}.json`),'utf8')),before)
  assert.equal((await fetch(`${origin}/api/cost-shares/%2e%2e%2fprivate`)).status,404)
  assert.equal((await fetch(`${origin}/api/cost-shares`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,400)
 }finally{await new Promise(resolve=>server.close(resolve));const target=resolve(dir);assert.ok(target.startsWith(resolve('output')+sep)&&target.includes('cost-share-test-'));await rm(target,{recursive:true,force:true})}
})
