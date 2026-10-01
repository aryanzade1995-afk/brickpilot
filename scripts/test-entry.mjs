import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultBrief, briefSchema } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { validate } from '../src/lib/rules/index.ts'
import { buildMassing } from '../src/lib/three/buildMassing.ts'
import { createBuildingModel } from '../src/lib/engine/buildingModel.ts'
for (const style of ['indian-carved','wide-pivot','framed-portico','stone-surround']) test(`main entry ${style} has a larger real aperture, two leaves, surround, threshold and shade`,()=>{
 const b=defaultBrief();b.site.plotWidth=24;b.site.plotDepth=28;b.entry.design=style;b.entry.mainDoorWidth=1800;b.rooms.priorities.compoundWall=true
 const d=generate(compile(b)),entry=d.floors[0].openings.find(o=>o.kind==='entry')
 assert.ok(validate(d).hardChecksPass)
 assert.equal(entry.width,1800);assert.equal(entry.entranceDesign,style)
 assert.ok(entry.head>2300)
 assert.ok(d.floors[0].openings.filter(o=>o.kind==='door'&&o.leaf).every(o=>o.width<entry.width))
 const boxes=buildMassing(d).boxes
 for(const id of ['main-entry-leaf--1','main-entry-leaf-1','main-entry-shade','main-entry-surround-head','main-entry-threshold','compound-gate-shade'])assert.ok(boxes.some(o=>o.id===id),id)
 assert.equal(createBuildingModel(d).siteRequirements.compoundWall,true)
 const broken=structuredClone(d);broken.floors[0].openings.find(o=>o.kind==='entry').width=900
 assert.ok(validate(broken).findings.some(f=>f.code==='MAIN_ENTRY_SIZE'))
})
test('old narrow main-door briefs are upgraded silently',()=>{assert.equal(briefSchema.parse({entry:{mainDoorWidth:900}}).entry.mainDoorWidth,1200)})
