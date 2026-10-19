import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultBrief } from '../src/lib/model/brief.ts'
import { compile } from '../src/lib/model/canonical.ts'
import { generate } from '../src/lib/engine/generate.ts'
import { SITE_FORM_VERSION, plotForm, siteFormScore, setbackTerraceArea, parseFormVersion } from '../src/lib/engine/siteForm.ts'
import { placeBalcony } from '../src/lib/engine/planner/index.ts'
import { validate } from '../src/lib/rules/index.ts'
import { generateAlternativeDesign } from '../src/lib/engine/generateAlternativeDesign.ts'
import { buildingShape } from '../src/lib/engine/buildingShapes.ts'
import { rectUnionArea } from '../src/lib/geometry.ts'

const briefOf=(w,d,facing='S',storeys=1)=>{
  const b=defaultBrief();b.site.plotWidth=w;b.site.plotDepth=d
  b.site.facing=facing;b.site.roadEdges=[facing];b.entry.primarySide=facing
  b.style.character='modern-box';b.lifestyle.vastu='ignore';b.levels.storeys=storeys
  return b
}
const form=(b,seed=41,massing='auto')=>generate(compile(b),{seed,massing,formVersion:SITE_FORM_VERSION})
const intersection=(a,b)=>{
  const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y)
  return {x,y,w:Math.max(0,Math.min(a.x+a.w,b.x+b.w)-x),h:Math.max(0,Math.min(a.y+a.h,b.y+b.h)-y)}
}
const cases=[[12,30,'S',1,'stepped'],[30,20,'S',1,'l-shape'],[22,28,'N',2,'stepped'],
  [22,28,'E',1,'l-shape'],[22,28,'W',2,'stepped'],[30,36,'S',1,'u-wing'],[30,36,'S',1,'courtyard-ring'],[30,36,'S',2,'u-wing']]

test('site-shaped source plans retain rooms, stairs, supports and 3D validity across plots and bearings',()=>{
  for(const [w,d,facing,storeys,family] of cases){
    const b=briefOf(w,d,facing,storeys),design=form(b,41,family)
    const errors=validate(design).findings.filter(f=>f.severity==='error')
    assert.deepEqual(errors,[],JSON.stringify([w,d,facing,storeys,family]))
    assert.equal(design.formVersion,SITE_FORM_VERSION)
    for(const req of compile(b).floors.flatMap(f=>f.spaces).filter(s=>!s.outdoor&&!s.autoExtra)){
      assert.ok(design.floors.some(f=>f.rooms.some(r=>r.id===req.id)),`Missing ${req.id}`)
    }
    for(let i=1;i<design.floors.length;i++){
      const lower=design.floors[i-1],upper=design.floors[i]
      assert.deepEqual(upper.stair.rect,lower.stair.rect)
      const overlap=upper.footprint.flatMap(a=>lower.footprint.map(b=>intersection(a,b))).filter(r=>r.w&&r.h)
      assert.ok(Math.abs(rectUnionArea(upper.footprint)-rectUnionArea(overlap))<1,'Upper floor grows beyond the supporting floor')
      for(const c of upper.columns)assert.ok(lower.columns.some(p=>p.at.x===c.at.x&&p.at.y===c.at.y),'Unsupported column')
    }
    assert.doesNotThrow(()=>generateAlternativeDesign(design,41))
  }
})

test('narrow/deep and wide/shallow sites produce different actual building proportions',()=>{
  const narrow=form(briefOf(12,30)),wide=form(briefOf(30,20))
  assert.equal(plotForm(narrow.model),'narrow');assert.equal(plotForm(wide.model),'wide')
  assert.ok(narrow.floors[0].outline.w/narrow.floors[0].outline.h<.9)
  assert.ok(wide.floors[0].outline.w/wide.floors[0].outline.h>1.25)
  assert.notEqual(buildingShape(narrow).key,buildingShape(wide).key)
})

test('upper wings and recessed corners expose real lower roofs',()=>{
  for(const [w,d,family] of [[30,20,'l-shape'],[30,36,'u-wing'],[30,36,'courtyard-ring']]){
    const design=form(briefOf(w,d),41,family)
    assert.ok(rectUnionArea(design.floors[0].footprint)-rectUnionArea(design.floors[1].footprint)>6e6)
    const legacy=generate(compile(briefOf(w,d)),{seed:41,massing:family})
    assert.notEqual(buildingShape(design).key,buildingShape(legacy).key)
  }
})

test('a saved source recipe replays the complete floor geometry exactly',()=>{
  for(const [w,d,family] of [[30,20,'l-shape'],[30,36,'u-wing']]){
    const b=briefOf(w,d),a=form(b,41,family)
    const b2=generate(compile(b),{seed:a.planSeed,massing:a.planFamily??a.massingType,
      recipe:a.planRecipe,planner:a.planProposal?'ml':'baseline',formVersion:a.formVersion})
    assert.deepEqual(b2.floors,a.floors)
    assert.deepEqual(b2.structure,a.structure)
  }
})

test('daylight and street-facing bedroom privacy affect valid plan selection only',()=>{
  const a=form(briefOf(22,28)),b=structuredClone(a)
  b.model.brief.site.roadEdges=['N','E','S','W']
  assert.ok(siteFormScore(b)<siteFormScore(a))
  assert.deepEqual(a.floors,b.floors)
})

test('finish climate choices do not change a pinned floor recipe',()=>{
  const a=form(briefOf(30,20),41,'l-shape'),b=structuredClone(a.model.brief)
  b.site.climate='hot'
  const next=generate(compile(b),{massing:a.planFamily??a.massingType,seed:a.planSeed,recipe:a.planRecipe,formVersion:a.formVersion})
  assert.deepEqual(next.floors,a.floors)
})

test('new balconies use a substantial supported setback before adding a front projection',()=>{
  const host={id:'bed1',rect:{x:3000,y:3000,w:6000,h:6000},area:36,outdoor:false}
  const site={envelope:{x:0,y:0,w:15000,h:20000}}
  const lower=[{x:3000,y:0,w:6000,h:9000}]
  const legacy=placeBalcony([host],host.rect,site,()=> 'bed',lower)
  const terrace=placeBalcony([host],host.rect,site,()=> 'bed',lower,true)
  assert.equal(legacy.y,9000)
  assert.ok(terrace.y<host.rect.y)
  assert.ok(terrace.w*terrace.h>=6e6)
  assert.ok(terrace.w*terrace.h<=18e6)
})

test('door-connected setback terraces are present in source plans and old form pins remain supported',()=>{
  assert.equal(parseFormVersion('site-form-v1'),'site-form-v1')
  assert.equal(parseFormVersion('site-form-v2'),'site-form-v2')
  assert.equal(parseFormVersion('site-form-v3'),SITE_FORM_VERSION)
  assert.equal(parseFormVersion('unknown'),undefined)
  const design=form(briefOf(30,36),42,'u-wing')
  assert.ok(setbackTerraceArea(design)>=6)
  assert.ok(design.floors.some(f=>f.rooms.some(r=>r.name==='Setback terrace')))
  const withoutDoors=structuredClone(design)
  withoutDoors.floors.forEach(f=>{f.openings=f.openings.filter(o=>o.kind!=='door'||!o.rooms?.some(id=>id?.startsWith('balcony')))})
  assert.equal(setbackTerraceArea(withoutDoors),0)
})
