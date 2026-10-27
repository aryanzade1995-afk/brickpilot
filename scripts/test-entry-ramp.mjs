import test from 'node:test'
import assert from 'node:assert/strict'
import {defaultBrief,briefSchema,geometryBrief} from '../src/lib/model/brief.ts'
import {compile} from '../src/lib/model/canonical.ts'
import {generate} from '../src/lib/engine/generate.ts'
import {createBuildingModel} from '../src/lib/engine/buildingModel.ts'
import {entryRamp} from '../src/lib/engine/entryRamp.ts'
import {resetFinishSpecifications} from '../src/lib/solar/editor.ts'
import {createEntryRampGroup,disposeEntryRampGroup} from '../src/lib/three/entryRamp.ts'
import {Vector3} from 'three'

function source(){const brief=defaultBrief();brief.site.plotWidth=30;brief.site.plotDepth=40;const design=generate(compile(brief),{seed:3});return design}
function clearHouse(){const d=source();d.model.brief.entry.ramp=true;d.siteFeatures=[];d.floors[0].columns=[];d.floors[0].rooms=[{...d.floors[0].rooms[0],id:'foyer',rect:{x:10000,y:5000,w:4000,h:4000},outdoor:false}];d.floors[0].openings=[{id:'main',kind:'entry',orient:'h',at:{x:12000,y:9000},width:1500,rooms:['foyer',null]}];return d}
test('a canonical ramp has constant source-derived gradient, supported rails and level top/bottom landings',()=>{
 const d=clearHouse(),before=JSON.stringify(d),r=entryRamp(d)
 assert.equal(r.status,'ready');assert.equal(r.clearWidthMm,1800);assert.equal(r.gradeMm,-400);assert.equal(r.siteGradeMm,-450)
 assert.equal(r.landings[0].elevationMm,0);assert.equal(r.landings.at(-1).elevationMm,r.gradeMm)
 for(const f of r.flights){assert.ok(Math.abs(Math.hypot(f.to.x-f.from.x,f.to.y-f.from.y)/(f.from.z-f.to.z)-r.gradientRatio)<1e-8);assert.ok(f.widthMm>r.clearWidthMm)}
 assert.ok(r.rails.some(x=>x.id.includes('760')));assert.ok(r.rails.some(x=>x.id.includes('900')))
 for(const s of r.solids){assert.ok(s.verticesMm.flat().every(Number.isFinite));assert.equal(s.indices.length,36)
  let volume=0;for(let i=0;i<s.indices.length;i+=3){const[a,b,c]=s.indices.slice(i,i+3).map(n=>new Vector3(...s.verticesMm[n]));volume+=a.dot(b.cross(c))/6}assert.ok(volume>0,`${s.id} outward closed volume`)
 }
 assert.equal(JSON.stringify(d),before)
 const view=createEntryRampGroup(r);assert.ok(view.children.length);assert.equal(view.userData.formstead_entry_ramp,true);disposeEntryRampGroup(view)
})
test('raised settings agree with structural site grade, cost setting and gentle multi-flight ramp; blocked sites are explicit',()=>{
 const d=clearHouse();d.model.brief.specs.overrides['plinth-height']='flood'
 const b=createBuildingModel(d),r=b.entryRamp
 assert.equal(b.structuralSizing.plinthHeightMm,900);assert.equal(r.siteGradeMm,-900);assert.equal(r.riseMm,850);assert.equal(r.gradientRatio,15);assert.ok(r.flights.length>1)
 const blocked=clearHouse();blocked.siteFeatures=[{id:'blocked',kind:'pool',rect:{x:0,y:9000,w:30000,h:31000}}]
 const no=entryRamp(blocked);assert.equal(no.status,'needs-review');assert.equal(no.solids.length,0);assert.ok(no.issues[0].includes('do not fit'))
 const existing=clearHouse();existing.existingStructure={};assert.equal(entryRamp(existing).status,'needs-review')
})
test('legacy projects retain building/composition identity; optional entry choice does not change the room-planning seed',()=>{
 const d=source(),before=createBuildingModel(d),oldBrief=structuredClone(d.model.brief)
 const again=createBuildingModel({...d,model:{...d.model,brief:briefSchema.parse(JSON.parse(JSON.stringify(oldBrief)))}})
 assert.equal(before.planId,again.planId);assert.equal(before.entryRamp,undefined)
 const requested={...oldBrief,entry:{...oldBrief.entry,ramp:true}}
 assert.deepEqual(geometryBrief(requested),geometryBrief(oldBrief));assert.equal(compile(requested).seed,compile(oldBrief).seed)
 const updated=createBuildingModel({...d,model:{...d.model,brief:requested}})
 assert.equal(updated.compositionId,before.compositionId);assert.deepEqual(updated.rooms,before.rooms);assert.notEqual(updated.planId,before.planId)
})
test('finish resets and level changes retain the selected plinth; source data persist through Brief JSON',()=>{
 const brief=defaultBrief();brief.entry.ramp=true;brief.specs.overrides['plinth-height']='raised';brief.specs.overrides['painting']='premium'
 assert.equal(resetFinishSpecifications(brief,'basic').specs.overrides['plinth-height'],'raised')
 assert.equal(briefSchema.parse(JSON.parse(JSON.stringify(brief))).entry.ramp,true)
})
