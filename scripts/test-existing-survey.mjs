import assert from 'node:assert/strict'
import test from 'node:test'
import { measuredStructure, emptySurvey, scaleDrawing } from '../src/lib/existing/survey.ts'
import { defaultAnswers } from '../src/lib/existing/types.ts'
import { buildMapping } from '../src/lib/existing/calibrate.ts'
import { briefFromAnswers, planAroundStructure } from '../src/lib/existing/plan.ts'
import { generateExisting } from '../src/lib/engine/generateExisting.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { handleExistingPlan } from '../server/existing-plan.mjs'
const answers={...defaultAnswers(),plotWidthM:22,plotDepthM:22,storeysWanted:1,bedroomsWithBath:1,bedroomsNoBath:1,sharedBaths:1,utility:false,parking:false,floorHeightM:3.1}
const survey=()=>({...emptySurvey(),widthM:15,depthM:7.5,heightM:3.1,plotOffsetXM:3,plotOffsetYM:5,columns:[0,7.5].flatMap(y=>[0,5,10,15].map(x=>({x,y,sizeMm:230})))})

test('manual measurement gates: no fabricated sizes, placement, supports or calibration',()=>{
  assert.throws(()=>measuredStructure(emptySurvey(),answers,true),/width, depth and floor height/)
  assert.throws(()=>measuredStructure(survey(),answers,false),/Confirm/)
  assert.throws(()=>measuredStructure({...survey(),plotOffsetXM:null},answers,true),/origin/)
  assert.throws(()=>measuredStructure({...survey(),columns:[]},answers,true),/at least two/)
  assert.throws(()=>measuredStructure({...survey(),columns:[{x:1,y:1,sizeMm:null},{x:4,y:4,sizeMm:230}]},answers,true),/column size/)
  assert.throws(()=>measuredStructure({...survey(),columns:[{x:1,y:NaN,sizeMm:230}]},answers,true),/valid measurements/)
  assert.throws(()=>measuredStructure({...survey(),beams:[{a:0,b:99,widthMm:230}]},answers,true),/column numbers/)
  assert.equal(buildMapping({mode:'corners',pts:[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}],widthMm:0,depthMm:10000},[]).toPlan,null)
})

test('drawing scale is measured and unknown construction dimensions remain null',()=>{
  const draft={...emptySurvey(),columns:[{x:100,y:200,sizeMm:null},{x:900,y:800,sizeMm:230}],rooms:[{name:'Living',type:'living',x:100,y:200,w:400,h:300}]}
  const scaled=scaleDrawing(draft,20,10)
  assert.deepEqual(scaled.columns[0],{x:2,y:2,sizeMm:null})
  assert.equal(scaled.rooms[0].w,8);assert.equal(scaled.rooms[0].h,3)
  assert.throws(()=>scaleDrawing(draft,0,10),/measured/)
})

test('irregular measured columns and beams keep their exact surveyed locations',()=>{
  const data=survey();data.columns[1].x=5.073;data.columns[1].y=.027
  data.beams=[{a:0,b:1,widthMm:230}]
  const built=measuredStructure(data,answers,true)
  assert.deepEqual(built.structure.columns[1].at,{x:5073,y:27})
  const result=planAroundStructure(built,answers)
  assert.ok(result.ok)
  assert.equal(result.design.existingStructure.dx,3000)
  assert.equal(result.design.existingStructure.dy,5000)
  for(const c of built.structure.columns)assert.ok(result.design.floors[0].columns.some(v=>v.at.x===c.at.x+3000&&v.at.y===c.at.y+5000&&v.size===c.size&&v.state==='LOCKED'))
})

test('regular measured foundation has a valid layout without a partition cutting a column edge',()=>{
  const built=measuredStructure(survey(),answers,true),result=planAroundStructure(built,answers)
  assert.ok(result.ok&&result.valid,JSON.stringify(result.ok?result.existing.findings:result))
  assert.equal(result.existing.findings.some(f=>f.code==='COLUMN_WALL_CONFLICT'),false)
  for(const c of built.structure.columns)assert.ok(result.design.floors[0].columns.some(v=>v.state==='LOCKED'&&v.at.x===c.at.x+3000&&v.at.y===c.at.y+5000&&v.size===c.size))
})

test('confirmed house tracing survives normal generation and replays without replacing its geometry',()=>{
  const original=generateExisting(compile(briefFromAnswers(answers)),measuredStructure(survey(),answers,true).structure)
  assert.ok(original.design)
  const floor=original.design.floors[0]
  const structure={columns:floor.columns.filter(c=>c.state==='LOCKED').map(c=>({id:c.id,at:c.at,size:c.size})),footings:[],beams:floor.beams.filter(b=>b.state==='LOCKED').map(b=>({...b,width:230})),walls:floor.walls.map(w=>({id:w.id,a:w.a,b:w.b,thickness:w.thickness})),storeysBuilt:1,measuredPlan:{rooms:floor.rooms,walls:floor.walls,openings:floor.openings,heightM:3.1,stairStartSide:floor.stair.startSide??'S'}}
  const result=generateExisting(compile(briefFromAnswers(answers)),structure,10)
  assert.deepEqual(result.design.floors[0].rooms,floor.rooms)
  assert.deepEqual(result.design.floors[0].openings,floor.openings)
  assert.deepEqual(result.design.floors[0].walls,floor.walls)
  assert.ok(result.valid,JSON.stringify(result.design&&planAroundStructure({structure,elements:[],size:{w:15000,d:7500},notes:[],needsConfirmation:[]},answers).rules?.findings.filter(f=>f.severity==='error')))
  const replay=generateExisting(compile(briefFromAnswers(answers)),JSON.parse(JSON.stringify(structure)),999)
  assert.deepEqual(replay.design.floors[0].rooms,floor.rooms)
  assert.deepEqual(replay.design.floors[0].openings,floor.openings)
})

test('existing walls are never dropped and a room crossing one is reported',()=>{
  const data=survey();data.walls=[{a:{x:7,y:0},b:{x:7,y:7.5},thicknessMm:230,kind:'interior'}]
  const built=measuredStructure(data,answers,true),result=planAroundStructure(built,answers)
  assert.ok(result.ok)
  assert.ok(result.design.floors[0].walls.some(w=>w.a.x===10000&&w.b.x===10000&&w.a.y===5000&&w.b.y===12500&&w.thickness===230))
  if(result.existing.findings.some(f=>f.code==='LOCKED_WALL_ROOM_CONFLICT'))assert.equal(result.valid,false)
})

test('house drawing measured tables produce the same valid rooms and openings',()=>{
  const original=generateExisting(compile(briefFromAnswers(answers)),measuredStructure(survey(),answers,true).structure).design
  const f=original.floors[0],local=p=>({x:(p.x-3000)/1000,y:(p.y-5000)/1000})
  const kind=r=>r.id==='stair'?'stair':r.id.startsWith('bed')?'bed':r.id.startsWith('bath')||r.id.startsWith('sharedBath')?'bath':r.id.startsWith('study')?'study':r.id
  const data={...survey(),rooms:f.rooms.map(r=>({name:r.name,type:kind(r),...local(r.rect),w:r.rect.w/1000,h:r.rect.h/1000,stairStartSide:r.id==='stair'?f.stair.startSide??'S':null})),walls:f.walls.map(w=>({a:local(w.a),b:local(w.b),thicknessMm:w.thickness,kind:w.kind})),openings:f.openings.map(o=>({...local(o.at),kind:o.kind,orient:o.orient,widthM:o.width/1000,headM:(o.head??(o.kind==='entry'?2500:2100))/1000,sillM:o.kind==='window'?(o.sill??900)/1000:null,swing:o.swing??1,leaf:o.leaf??true,emergencyExit:!!o.emergencyExit}))}
  const built=measuredStructure(data,answers,true)
  const result=planAroundStructure(built,answers)
  assert.ok(result.ok&&result.valid,JSON.stringify(result.ok?[...result.rules.findings.filter(f=>f.severity==='error'),...result.existing.findings.filter(f=>f.severity==='error')]:result))
  assert.deepEqual(result.design.floors[0].rooms.map(r=>r.rect),f.rooms.map(r=>r.rect))
  assert.deepEqual(result.design.floors[0].openings.map(o=>o.at),f.openings.map(o=>o.at))
})

test('drawing API returns real reader output, rejects invalid input, and reports unavailable extraction',async()=>{
  const call=async(payload,reader)=>{let code,body;const res={writeHead:c=>code=c,end:s=>body=JSON.parse(s)};await handleExistingPlan({method:'POST',url:'/api/existing-plan/read'},res,async()=>payload,reader);return {code,body}}
  const payload={imageBase64:'aGVsbG8=',mimeType:'image/png'}
  assert.equal((await call(payload,async()=>emptySurvey())).code,200)
  assert.equal((await call({...payload,mimeType:'text/plain'},async()=>emptySurvey())).code,400)
  assert.equal((await call(payload,async()=>{throw new Error('offline')})).code,503)
  assert.equal((await call(payload,async()=>({fake:true}))).code,503)
})
