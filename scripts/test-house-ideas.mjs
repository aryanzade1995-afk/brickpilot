import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { HOUSE_IDEA_COMBINATIONS, houseIdeaKey, houseIdeaSelection } from '../src/lib/gallery/houseIdeas.ts'
import { defaultBrief } from '../src/lib/model/brief.ts'

test('all 240 house type/style/composition/layout/floor combinations have unambiguous image keys',()=>{
 assert.equal(HOUSE_IDEA_COMBINATIONS.length,240)
 assert.equal(new Set(HOUSE_IDEA_COMBINATIONS.map(houseIdeaKey)).size,240)
 for(const item of HOUSE_IDEA_COMBINATIONS){
  const b=defaultBrief();b.project.buildingType=item.type;b.style.character=item.style;b.style.massing=item.layout;b.levels.storeys=item.storeys
  if(item.composition!=='auto')b.style.composition=item.composition
  assert.equal(houseIdeaKey(houseIdeaSelection(b)),houseIdeaKey(item))
 }
})
test('images describe only reference style choices, not a user plot, finish or project identity',()=>{
 const b=defaultBrief(),before=houseIdeaKey(houseIdeaSelection(b))
 b.site.plotWidth+=4;b.finish='premium';b.project.name='Changed';b.style.personality='bold';b.style.diversity='high'
 assert.equal(houseIdeaKey(houseIdeaSelection(b)),before)
 b.levels.storeys=3;assert.notEqual(houseIdeaKey(houseIdeaSelection(b)),before)
 b.style.character='contemporary-indian';b.style.composition='glazed-bay'
 assert.equal(houseIdeaSelection(b).composition,'auto')
})
test('the Brief card has no architecture compiler, render action, WebGL viewer or generation controls',()=>{
 const source=fs.readFileSync(new URL('../src/routes/brief/HouseIdeaPreview.tsx',import.meta.url),'utf8')
 for(const forbidden of ['useBlender','houseIdeaPlan','HouseIdeaViewport','<Canvas','Generate Blender preview','createBuildingModel'])assert.ok(!source.includes(forbidden),forbidden)
 assert.match(source,/\/house-ideas\/manifest.json/)
 assert.match(source,/Blender design example/)
})
test('published images are actual completed Blender outputs with a source identity; unavailable choices have no fake image',()=>{
 const manifest=JSON.parse(fs.readFileSync(new URL('../public/house-ideas/manifest.json',import.meta.url),'utf8'))
 assert.equal(manifest.entries.length,240)
 assert.equal(manifest.source,'Blender');assert.equal(manifest.examplesOnly,true)
 assert.equal(manifest.entries.filter(e=>e.composition==='auto'&&e.status==='ready').length,120,'Every core type/style/layout/floor combination must have a real image')
 for(const e of manifest.entries){
  assert.equal(e.id,houseIdeaKey(e))
  if(e.status!=='ready'){assert.ok(e.reason);assert.ok(!e.image);continue}
  assert.ok(e.planId.startsWith('plan-'));assert.ok(Number.isSafeInteger(e.seed))
  assert.match(e.renderDigest,/^[a-f0-9]{64}$/)
  const png=fs.readFileSync(new URL('../public'+e.image,import.meta.url))
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a')
  assert.equal(png.readUInt32BE(16),768);assert.equal(png.readUInt32BE(20),576)
  if(e.layout!=='auto')assert.equal(e.actualLayout,e.layout,'Never substitute another selected shape')
 }
})
