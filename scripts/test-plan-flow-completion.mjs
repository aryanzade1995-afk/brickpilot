import test from 'node:test'
import assert from 'node:assert/strict'
import {registerHooks} from 'node:module'
import {newPlanDraft,restorePlanDraft} from '../src/lib/existing/planDraft.ts'
import {drawingDraftToRaw,rawSurveyToSurvey,digitizeWithFallback,registerDigitizer,unregisterDigitizer,validateRawSurvey} from '../src/lib/existing/digitizer.ts'
import {rotateDrawing90} from '../src/lib/existing/drawingTransforms.ts'
import {prepareDrawingImport} from '../src/lib/existing/prepareDrawingImport.ts'
import {generateExisting} from '../src/lib/engine/generateExisting.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {createBuildingModel} from '../src/lib/engine/buildingModel.ts'
import {applySuggestionChanges} from '../src/lib/model/briefSuggestion.ts'
import {defaultBrief} from '../src/lib/model/brief.ts'

registerHooks({resolve(s,c,next){return s.startsWith('@/')?{url:new URL(`../src/${s.slice(2)}`,import.meta.url).href,shortCircuit:true}:next(s,c)}})

function rawPlan(upper=false){
 const point=(x,y)=>({x:x+100,y:y+100})
 return {imageWidth:1200,imageHeight:800,scaleMPerPx:.01,elements:{
  rooms:[{id:'living',name:upper?'Family lounge':'Living',type:'living',box:{...point(0,0),w:400,h:450},confidence:1},
   {id:'kitchen',name:upper?'Study':'Kitchen',type:upper?'study':'kitchen',box:{...point(400,0),w:300,h:450},confidence:1},
   {id:'stair',name:'Stair',type:'stair',stairStartSide:'S',box:{...point(700,0),w:240,h:450},confidence:1}],
  walls:[[0,0,940,0,'exterior'],[940,0,940,450,'exterior'],[940,450,0,450,'exterior'],[0,450,0,0,'exterior'],[400,0,400,450,'interior'],[700,0,700,450,'interior']].map(([x,y,x1,y1,kind],i)=>({id:`w${i}`,a:point(x,y),b:point(x1,y1),kind,confidence:1})),
  openings:[...(!upper?[{id:'entry',kind:'entry',orient:'h',at:point(200,450),widthPx:100,swing:-1,confidence:1}]:[]),
   {id:'door1',kind:'door',orient:'v',at:point(400,180),widthPx:90,leaf:false,confidence:1},
   {id:'door2',kind:'door',orient:'v',at:point(700,180),widthPx:90,leaf:false,confidence:1},
   {id:'window1',kind:'window',orient:'v',at:point(0,200),widthPx:120,confidence:1},
   {id:'window2',kind:'window',orient:'h',at:point(550,0),widthPx:120,confidence:1}],dimensions:[]}}
}
function reviewed(count=1){
 const draft=newPlanDraft();draft.count=count;draft.name='Confirmed drawing';draft.answers.parking=false
 draft.answers.floorHeightM=3;draft.answers.storeysWanted=count;draft.answers.storeysBuilt=count
 draft.floors=draft.floors.map((f,i)=>i<count?{...f,imageUrl:'data:image/png;base64,AA==',raw:rawPlan(i>0),scale:.01,calibrated:true}:f)
 return draft
}

test('a reader failure starts an empty manual tracing draft and clears its timeout',async()=>{
 registerDigitizer({id:'offline-test',name:'Offline',async digitize(){throw Error('Reader offline')}})
 try{const result=await digitizeWithFallback(new Blob(['test'],{type:'image/png'}),'offline-test',{timeoutMs:1000});assert.equal(result.fallbackUsed,true);assert.deepEqual(result.survey.elements.rooms,[]);assert.match(result.error,/offline/)}finally{unregisterDigitizer('offline-test')}
})

test('normalized reader geometry follows the cropped image frame and opening coordinates',()=>{
 const draft={widthM:8,depthM:6,heightM:null,columns:[],footings:[],beams:[],walls:[],notes:[],
  rooms:[{name:'Living',type:'living',x:0,y:0,w:1000,h:1000}],openings:[{kind:'entry',orient:'h',x:500,y:1000,widthM:1,headM:null,sillM:null}],
  source:{imageBox:[100,80,900,680],imageSize:[1000,800]}}
 const raw=drawingDraftToRaw(draft,1000,800)
 assert.deepEqual(raw.elements.rooms[0].box,{x:100,y:80,w:800,h:600})
 assert.deepEqual(raw.elements.openings[0].at,{x:500,y:680});assert.equal(raw.elements.openings[0].widthPx,100)
 const survey=rawSurveyToSurvey(raw,raw.scaleMPerPx)
 assert.equal(survey.rooms[0].w,8);assert.equal(survey.rooms[0].h,6)
 assert.throws(()=>validateRawSurvey({...raw,elements:{...raw.elements,rooms:[{...raw.elements.rooms[0],box:{x:990,y:0,w:100,h:100}}]}}),/outside/)
})

test('image rotation moves all rooms, walls and openings together and is reversible',()=>{
 const original=rawPlan();let rotated=original
 for(let i=0;i<4;i++)rotated=rotateDrawing90(rotated)
 assert.deepEqual(rotated.elements.rooms,original.elements.rooms)
 assert.deepEqual(rotated.elements.walls,original.elements.walls)
 assert.deepEqual(rotated.elements.openings.map(({swing,...o})=>o),original.elements.openings.map(({swing,...o})=>o))
})

test('every floor and scale survives draft restoration; invalid stored geometry is rejected',()=>{
 const draft=reviewed(2);draft.step='review';draft.active=1;draft.floors[1].scale=.012
 assert.deepEqual(restorePlanDraft(JSON.parse(JSON.stringify(draft))),draft)
 assert.throws(()=>restorePlanDraft({...draft,active:2}))
 assert.throws(()=>restorePlanDraft({...draft,floors:draft.floors.map((f,i)=>i===0?{...f,scale:Infinity}:f)}))
})

test('confirmed source drawings produce valid 2D and 3D geometry without inventing supports',()=>{
 const draft=reviewed(),result=prepareDrawingImport(draft),model=createBuildingModel(result.design)
 assert.equal(result.design.floors.length,1);assert.equal(result.structure.columns.length,0)
 assert.equal(result.design.floors[0].rooms.length,3);assert.equal(model.floors.length,1)
 assert.equal(result.brief.site.plotWidth,draft.answers.plotWidthM)
 assert.equal(result.brief.project.name,draft.name)
})

test('separate upper-floor drawings stay distinct through import and saved replay',()=>{
 const draft=reviewed(2),result=prepareDrawingImport(draft)
 assert.equal(result.design.floors.length,2)
 assert.equal(result.design.floors[0].rooms[1].name,'Kitchen');assert.equal(result.design.floors[1].rooms[1].name,'Study')
 const structure=JSON.parse(JSON.stringify(result.structure)),replay=generateExisting(compile(result.brief),structure,1)
 assert.ok(replay.valid)
 assert.deepEqual(replay.design.floors.map(f=>f.rooms),result.design.floors.map(f=>f.rooms))
 assert.equal(createBuildingModel(replay.design).floors.length,2)
})

test('missing floors, uncalibrated input and shifted stairs block handoff without enlarging the plot',()=>{
 const draft=reviewed(2)
 assert.throws(()=>prepareDrawingImport({...draft,floors:draft.floors.map((f,i)=>i===1?{...f,calibrated:false}:f)}),/Calibrate/)
 assert.throws(()=>prepareDrawingImport({...draft,floors:draft.floors.map((f,i)=>i===1?{...f,offsetX:f.offsetX+1}:f)}),/not aligned/)
 assert.throws(()=>prepareDrawingImport({...draft,answers:{...draft.answers,plotWidthM:6}}),/does not fit/)
 assert.equal(draft.answers.plotWidthM,15)
})

test('applying a cached space suggestion preserves newer project names and finishes',()=>{
 const original=defaultBrief(),target=structuredClone(original),current=structuredClone(original)
 target.rooms.studies=0;current.project.name='New project name';current.finish='premium'
 applySuggestionChanges(current,original,target)
 assert.equal(current.project.name,'New project name');assert.equal(current.finish,'premium');assert.equal(current.rooms.studies,0)
})
