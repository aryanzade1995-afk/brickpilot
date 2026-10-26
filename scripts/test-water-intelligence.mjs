import test from 'node:test'
import assert from 'node:assert/strict'
import {emptyWaterConfig,parseWaterConfig,waterConfigSchema,waterSignature} from '../src/lib/water/schema.ts'
import {rainfallYield,tankStep,simulateWater,validateWaterSystem,sensorState,waterSimulationSchema} from '../src/lib/water/engineering.ts'
import {newWaterComponent,waterRoof,addRoofCatchment,addHarvestingChain} from '../src/lib/water/roof.ts'
import {defaultBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {utilityFloor} from '../src/lib/utilities/plan.ts'

function system(){
  const config=emptyWaterConfig('plan-1','roof-1'),kinds=['catchment','gutter','downpipe','first_flush','filter','tank','overflow','recharge']
  config.components=kinds.map((kind,i)=>({...newWaterComponent(kind,kind),positionM:[1,8-i,2]}))
  config.components.find(n=>n.kind==='first_flush').diversionLitres=10
  config.components.find(n=>n.kind==='filter').efficiency=.9
  Object.assign(config.components.find(n=>n.kind==='tank'),{tankCapacityLitres:500,initialStorageLitres:0})
  config.components.find(n=>n.kind==='recharge').destinationApproved=true
  config.connections=kinds.slice(1).map((to,i)=>({id:`c${i}`,from:kinds[i],to,kind:i>=5?'overflow':'collection',viaM:[],routingBasis:'concept-user-route'}))
  config.catchments=[{id:'roof-area',componentId:'catchment',surfaceId:'roof',areaM2:100,areaBasis:'measured',runoffCoefficient:.8,collectionEfficiency:.9,note:'Measured projected catchment; factors user-provided.'}]
  config.demands=[{tankId:'tank',dailyLitres:100,basis:'user-provided'}]
  config.scenarios=[{id:'rain',name:'Rain then dry',basis:'user-provided',source:'Test scenario',days:[{date:'2026-10-01',rainfallMm:10,eventStart:true},{date:'2026-10-02',rainfallMm:0,eventStart:false}]}]
  return config
}
test('rainfall units, explicit zero and losses applied once',()=>{
  assert.deepEqual(rainfallYield(10,100,.8,.9),{incidentLitres:1000,runoffLossLitres:200,collectionLossLitres:80,collectedLitres:720})
  assert.equal(rainfallYield(0,100,.8,.9).collectedLitres,0)
  assert.equal(rainfallYield(10,0,.8,.9).collectedLitres,0)
  assert.equal(rainfallYield(10,100,0,.9).collectedLitres,0)
  for(const values of [[-1,100,.8,.9],[1,NaN,.8,.9],[1,100,1.1,.9],[1,100,.8,Infinity]])assert.throws(()=>rainfallYield(...values))
})
test('tank capacity and demand maintain mass balance including empty and zero-size tanks',()=>{
  assert.deepEqual(tankStep(500,0,639,100),{storageLitres:400,overflowLitres:139,servedLitres:100,unmetLitres:0})
  assert.deepEqual(tankStep(0,0,100,50),{storageLitres:0,overflowLitres:100,servedLitres:0,unmetLitres:50})
  assert.equal(tankStep(500,0,0,100).unmetLitres,100)
  assert.throws(()=>tankStep(10,11,0,0));assert.throws(()=>tankStep(10,0,-1,0))
})
test('deterministic simulation balances incident rain, all losses, demand, storage and recharge routing',()=>{
  const c=system(),before=JSON.stringify(c),r=simulateWater(c,c.scenarios[0])
  assert.equal(r.signature,waterSignature(c))
  assert.equal(r.status,'complete',r.reasons.join(';'))
  assert.equal(r.days[0].inflowLitres,639)
  assert.equal(r.days[0].overflowLitres,139)
  assert.equal(r.days[0].rechargeRoutedLitres,139)
  assert.equal(r.days[1].storageLitres,300)
  assert.ok(r.days.every(d=>Math.abs(d.balanceErrorLitres)<1e-8))
  assert.deepEqual(r,simulateWater(c,c.scenarios[0]));assert.equal(JSON.stringify(c),before)
  const larger=simulateWater(c,c.scenarios[0],{tank:1000})
  assert.equal(larger.days[0].overflowLitres,0);assert.equal(larger.days[1].storageLitres,439)
  assert.equal(c.components.find(n=>n.kind==='tank').tankCapacityLitres,500)
})
test('first flush resets by explicit rain event, not each daily step, including shared treatment',()=>{
  const c=system();c.scenarios[0].days[1].rainfallMm=10
  let r=simulateWater(c,c.scenarios[0]);assert.equal(r.days[1].inflowLitres,648)
  c.scenarios[0].days[1].eventStart=true;r=simulateWater(c,c.scenarios[0]);assert.equal(r.days[1].inflowLitres,639)
  c.components.push({...newWaterComponent('catchment','catchment-2'),positionM:[2,8,2]})
  c.catchments.push({...c.catchments[0],id:'area-2',componentId:'catchment-2',surfaceId:'other-roof'})
  c.connections.push({id:'merge',from:'catchment-2',to:'gutter',kind:'collection',viaM:[],routingBasis:'concept-user-route'})
  r=simulateWater(c,c.scenarios[0]);assert.equal(r.days[0].inflowLitres,1287)
})
test('missing data, invalid endpoints, branching, cycles, order and source changes remain visible',()=>{
  const c=system();c.catchments[0].runoffCoefficient=null
  assert.equal(simulateWater(c,c.scenarios[0]).status,'insufficient-information')
  c.catchments[0].runoffCoefficient=.8;c.connections[0].to='missing'
  assert.ok(validateWaterSystem(c).some(x=>x.status==='Fail'))
  const b=system();b.connections.push({...b.connections[0],id:'branch',to:'filter'})
  assert.ok(validateWaterSystem(b).some(x=>x.id==='branch:catchment'))
  const loop=system();loop.connections.push({id:'loop',from:'recharge',to:'filter',kind:'collection',viaM:[],routingBasis:'concept-user-route'})
  assert.equal(simulateWater(loop,loop.scenarios[0]).status,'insufficient-information')
  assert.ok(validateWaterSystem(system(),{sourcePlanId:'different',roofSignature:'roof-1'}).some(x=>x.id==='roof-changed'))
  assert.ok(validateWaterSystem({...system(),components:[{...newWaterComponent('gutter','invalid'),name:''}]}).some(x=>x.id.startsWith('invalid-input:')))
  const noOverflow=system();noOverflow.connections=noOverflow.connections.filter(e=>e.from!=='tank')
  assert.equal(simulateWater(noOverflow,noOverflow.scenarios[0]).status,'insufficient-information')
})
test('daily rainfall is not a peak-flow rating; checks use explicit sourced mm/hour data only',()=>{
  const c=system();assert.ok(validateWaterSystem(c).some(x=>x.id==='capacity:downpipe'&&x.status==='Not Checked'))
  c.designStorm={intensityMmH:100,source:'User design storm, local IDF review required'}
  const pipe=c.components.find(n=>n.kind==='downpipe');pipe.capacityLps=1;pipe.capacityBasis='User manufacturer curve'
  assert.ok(validateWaterSystem(c).some(x=>x.id==='capacity:downpipe'&&x.status==='Warning'))
  pipe.capacityLps=3;assert.ok(validateWaterSystem(c).some(x=>x.id==='capacity:downpipe'&&x.status==='Pass'))
})
test('versioned input round trip, unknowns and scenario day validation',()=>{
  const c=system();assert.deepEqual(parseWaterConfig(JSON.parse(JSON.stringify(c))),c)
  assert.equal(waterSignature(c),waterSignature({...c,components:c.components.map(n=>({kind:n.kind,...n,name:n.name}))}))
  assert.equal(parseWaterConfig({...c,version:2}),null)
  const invalid=system();invalid.scenarios[0].days[1].date='2026-10-03';assert.equal(waterConfigSchema.safeParse(invalid).success,false)
  const missing=system();missing.scenarios[0].days[0].rainfallMm=null;assert.equal(simulateWater(missing,missing.scenarios[0]).status,'insufficient-information')
  assert.equal(parseWaterConfig({}),null)
})
test('sensor current, stale, invalid, future, unit mismatch and offline states use real timestamps',()=>{
  const now=Date.parse('2026-10-26T12:00:00Z'),s={id:'level',componentId:'tank',type:'tank_level',unit:'%',value:60,recordedAt:'2026-10-26T11:50:00Z',online:true,staleAfterMinutes:30,source:'User observation'}
  assert.equal(sensorState(s,now),'current');assert.equal(sensorState({...s,recordedAt:'2026-10-26T10:00:00Z'},now),'stale')
  assert.equal(sensorState({...s,online:false},now),'offline')
  for(const p of [{value:101},{value:null},{value:-1},{unit:'mm'},{recordedAt:'bad'},{recordedAt:'2026-10-27T00:00:00Z'},{recordedAt:'2026-10-26T11:50:00'}])assert.equal(sensorState({...s,...p},now),'invalid')
  assert.equal(waterSignature({...system(),sensors:[s]}),waterSignature(system()))
})
test('roof adapter preserves courtyard holes and source house and leaves indoor water/drainage unchanged',()=>{
  const brief=defaultBrief();brief.site.plotWidth=18;brief.site.plotDepth=24
  const design=generate(compile(brief),{seed:41}),before=JSON.stringify(design),indoor=JSON.stringify(utilityFloor(design,0,brief))
  const roof=waterRoof(design);assert.ok(roof.surfaces.length)
  let c=emptyWaterConfig(roof.sourcePlanId,roof.roofSignature)
  c=addRoofCatchment(c,roof.surfaces[0],'catchment');assert.equal(c.catchments[0].runoffCoefficient,null)
  assert.equal(JSON.stringify(design),before)
  assert.equal(JSON.stringify(utilityFloor(design,0,brief)),indoor)
  assert.ok(c.components[0].positionM[1]>=0)
  assert.ok(c.components[0].positionM[2]<=0)
})


test('chain scaffold keeps positions, levels and engineering inputs explicitly unknown',()=>{
  let c=emptyWaterConfig('plan','roof');c.components=[newWaterComponent('catchment','roof')]
  c.catchments=[{id:'area',componentId:'roof',surfaceId:null,areaM2:null,areaBasis:'unknown',runoffCoefficient:null,collectionEfficiency:null,note:''}]
  c=addHarvestingChain(c,'roof',['g','d','ff','f','t','o','end'])
  assert.equal(c.connections.length,7)
  assert.ok(c.components.every(n=>n.positionM===null))
  assert.equal(c.components.find(n=>n.kind==='tank').tankCapacityLitres,null)
  assert.equal(simulateWater(c,system().scenarios[0]).status,'insufficient-information')
})
test('many tank states conserve water and emitted simulation records pass the versioned output schema',()=>{
  for(let i=0;i<200;i++){const capacity=i*17,previous=capacity*.43,inflow=i*13.7,demand=i*2.9,r=tankStep(capacity,previous,inflow,demand)
    assert.ok(Math.abs(previous+inflow-r.storageLitres-r.overflowLitres-r.servedLitres)<1e-8)
    assert.ok(r.storageLitres<=capacity&&r.storageLitres>=0)
    assert.ok(Math.abs(r.servedLitres+r.unmetLitres-demand)<1e-8)
  }
  assert.ok(waterSimulationSchema.safeParse(simulateWater(system(),system().scenarios[0])).success)
  assert.throws(()=>rainfallYield(1e308,1e308,1,1))
})
test('roof catchment area subtracts a represented courtyard instead of using the enclosing bounding box',()=>{
  const brief=defaultBrief();brief.site.plotWidth=18;brief.site.plotDepth=24
  const design=generate(compile(brief),{seed:41}),top=design.floors.at(-1),rect=top.footprint[0]
  top.courtyard={x:rect.x+rect.w*.4,y:rect.y+rect.h*.4,w:rect.w*.1,h:rect.h*.1}
  const roof=waterRoof(design),surface=roof.surfaces.find(s=>s.label.includes('top roof'))
  assert.ok(surface)
  for(const r of surface.regionsMm){const overlapX=Math.min(r.x+r.w,top.courtyard.x+top.courtyard.w)-Math.max(r.x,top.courtyard.x),overlapY=Math.min(r.y+r.h,top.courtyard.y+top.courtyard.h)-Math.max(r.y,top.courtyard.y)
    assert.ok(overlapX<=0||overlapY<=0,'Courtyard must remain outside catchment rectangles')
  }
})
